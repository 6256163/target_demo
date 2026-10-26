#!/usr/bin/env bash
# ============================================================
# target_demo 性能测试执行入口
#
# 用法：
#   ./perf/run-perf.sh --scenario mixed --threads 100 --duration 600
#   ./perf/run-perf.sh --scenario browse --threads 10 --duration 300 --version v1.2.3
#   ./perf/run-perf.sh --scenario order  --smoke          # 1 线程 30s 冒烟，先跑这个
#   ./perf/run-perf.sh --scenario mixed --threads 200 --no-influx --extra "-JpayOutcome=FAILED"
#
# 场景：browse(浏览) / order(下单支付) / mixed(6:3:1混合) / spike(突发) / endurance(稳定性)
# 报告：perf/reports/<version>/<scenario>/{result.jtl, html/index.html}
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ---------- 默认值 ----------
SCENARIO="mixed"
THREADS=100
RAMP_UP=60
DURATION=600
VERSION="$(date +%Y%m%d-%H%M%S)"
IMAGE="target_demo-jmeter:latest"
NETWORK="target_demo_shop-net"
TARGET_HOST="backend"
TARGET_PORT="8080"
INFLUX_HOST="influxdb"
DATA_TAG="perf"          # perf / stress：决定用哪套账号池
EXTRA=""
SMOKE=0
BUILD=0
LOCAL=0
GEN_PARENT=0

# ---------- 参数解析 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)   SCENARIO="$2"; shift 2;;
    --threads)    THREADS="$2"; shift 2;;
    --ramp-up)    RAMP_UP="$2"; shift 2;;
    --duration)   DURATION="$2"; shift 2;;
    --version)    VERSION="$2"; shift 2;;
    --image)      IMAGE="$2"; shift 2;;
    --network)    NETWORK="$2"; shift 2;;
    --host)       TARGET_HOST="$2"; shift 2;;
    --port)       TARGET_PORT="$2"; shift 2;;
    --data-tag)   DATA_TAG="$2"; shift 2;;
    --extra)      EXTRA="$2"; shift 2;;
    --influx-host) INFLUX_HOST="$2"; shift 2;;
    --no-influx)  INFLUX_HOST="__DISABLED__"; shift;;
    --gen-parent) GEN_PARENT=1; shift;;
    --smoke)      SMOKE=1; shift;;
    --build)      BUILD=1; shift;;
    --local)      LOCAL=1; shift;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0;;
    *)            echo "未知参数: $1"; exit 1;;
  esac
done

case "$SCENARIO" in
  browse)    PLAN="shop-browse.jmx";;
  order)     PLAN="shop-order-pay.jmx";;
  mixed)     PLAN="shop-mixed.jmx";;
  spike)     PLAN="shop-spike.jmx";;
  endurance) PLAN="shop-endurance.jmx";;
  *)         echo "未知场景: $SCENARIO（可选 browse/order/mixed/spike/endurance）"; exit 1;;
esac

if [[ "$DATA_TAG" == "stress" ]]; then
  USERS_FILE="data/users-stress.csv"
  PRODUCTS_FILE="data/products-stress.csv"
else
  USERS_FILE="data/users.csv"
  PRODUCTS_FILE="data/products.csv"
fi

if [[ $SMOKE -eq 1 ]]; then
  THREADS=1; RAMP_UP=1; DURATION=30
  echo "[冒烟模式] 1 线程 / 30s —— 目的是验证脚本能跑通、变量全部解析、断言匹配响应"
fi

# 混合场景按 6:3:1 拆分总并发
BROWSE_T=$THREADS; ORDER_T=$THREADS; ADMIN_T=$THREADS
if [[ "$SCENARIO" == "mixed" || "$SCENARIO" == "endurance" ]]; then
  BROWSE_T=$(( THREADS * 6 / 10 ))
  ORDER_T=$((  THREADS * 3 / 10 ))
  ADMIN_T=$((  THREADS - BROWSE_T - ORDER_T ))
fi

REPORT_DIR="$ROOT/perf/reports/$VERSION/$SCENARIO"
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

# ---------- 需要时禁用 InfluxDB 后端监听器 ----------
# 直接改 jmx 里那一行 enabled 标记；不这么做的话 InfluxDB 没起来时每条上报都会刷 ERROR
# （不影响测试结果，但日志会淹掉真正的问题）。
PLAN_PATH="/jmeter/plans/$PLAN"
if [[ "$INFLUX_HOST" == "__DISABLED__" ]]; then
  # 临时脚本落在报告目录（该目录已挂进容器的 /reports），避免污染 plans/
  sed 's|testname="InfluxDB2 Backend Listener" enabled="true"|testname="InfluxDB2 Backend Listener" enabled="false"|' \
      "$ROOT/perf/plans/$PLAN" > "$REPORT_DIR/$PLAN"
  PLAN_PATH="/reports/$PLAN"
  echo "[--no-influx] 已生成禁用 Backend Listener 的临时脚本: $REPORT_DIR/$PLAN"
  INFLUX_HOST="influxdb"
fi

COMMON_ARGS=(
  -Jhost="$TARGET_HOST" -Jport="$TARGET_PORT"
  -JusersFile="$USERS_FILE" -JproductsFile="$PRODUCTS_FILE"
  -Jthreads="$THREADS" -JrampUp="$RAMP_UP" -Jduration="$DURATION"
  -JthreadsBrowse="$BROWSE_T" -JthreadsOrder="$ORDER_T" -JthreadsAdmin="$ADMIN_T"
  -JinfluxHost="$INFLUX_HOST"
  -JgenParent="$([[ $GEN_PARENT -eq 1 ]] && echo true || echo false)"
)

echo "=============================================="
echo " 场景       : $SCENARIO ($PLAN)"
echo " 总并发     : $THREADS  (浏览 $BROWSE_T / 下单 $ORDER_T / 后台 $ADMIN_T)"
echo " Ramp-up    : ${RAMP_UP}s   时长: ${DURATION}s"
echo " 目标       : $TARGET_HOST:$TARGET_PORT"
echo " 数据池     : $USERS_FILE + $PRODUCTS_FILE"
echo " 版本号     : $VERSION"
echo " 报告目录   : $REPORT_DIR"
echo "=============================================="

if [[ $LOCAL -eq 1 ]]; then
  # 本地 JMeter（需要自行安装 5.6.3 并把 jmeter 放进 PATH）
  JMETER_BIN="${JMETER_BIN:-jmeter}"
  ( cd perf && "$JMETER_BIN" -n -t "${PLAN_PATH#/jmeter/}" "${COMMON_ARGS[@]}" $EXTRA \
      -l "$REPORT_DIR/result.jtl" -e -o "$REPORT_DIR/html" )
else
  if [[ $BUILD -eq 1 ]]; then
    docker compose -f docker-compose.test.yml build jmeter
  fi
  docker run --rm --network "$NETWORK" \
    -v "$REPORT_DIR:/reports" \
    "$IMAGE" \
    -n -t "$PLAN_PATH" "${COMMON_ARGS[@]}" $EXTRA \
    -l /reports/result.jtl -e -o /reports/html
fi

echo ""
echo "完成。报告："
echo "  JTL   : $REPORT_DIR/result.jtl"
echo "  HTML  : $REPORT_DIR/html/index.html"
