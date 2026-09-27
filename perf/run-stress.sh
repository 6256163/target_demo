#!/usr/bin/env bash
# ============================================================
# shop-demo 压力测试（破坏性 / 极限探测）执行入口
#
# 用法：
#   ./perf/run-stress.sh --scenario layer --layer 1 --threads 50 --duration 300   # 分层剥离瓶颈
#   ./perf/run-stress.sh --scenario ramp  --max-threads 400                        # 阶梯加压到崩
#   ./perf/run-stress.sh --scenario spike --spike-threads 800                      # 尖峰冲击
#   ./perf/run-stress.sh --scenario ramp --check                                   # 跑完做数据一致性校验
#
# 停止条件（人工盯盘，满足任一立即 Ctrl-C）：
#   错误率 > 5% 持续 30s / P95 > 3s / 后端 CPU > 90% / 出现 OOM 或线程池耗尽
#
# 注意：压力测试用独立账号池 users-stress.csv（user00501~user01000），
#       与性能测试池隔离，避免互相污染。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SCENARIO="ramp"
LAYER=1
THREADS=50
MAX_THREADS=800
BASE_THREADS=50
SPIKE_THREADS=800
DURATION=600
VERSION="$(date +%Y%m%d-%H%M%S)-stress"
IMAGE="shop-demo-jmeter:latest"
NETWORK="shop-demo_shop-net"
TARGET_HOST="backend"
TARGET_PORT="8080"
INFLUX_HOST="influxdb"
EXTRA=""
CHECK=0
BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)      SCENARIO="$2"; shift 2;;
    --layer)         LAYER="$2"; shift 2;;
    --threads)       THREADS="$2"; shift 2;;
    --max-threads)   MAX_THREADS="$2"; shift 2;;
    --base-threads)  BASE_THREADS="$2"; shift 2;;
    --spike-threads) SPIKE_THREADS="$2"; shift 2;;
    --duration)      DURATION="$2"; shift 2;;
    --version)       VERSION="$2"; shift 2;;
    --host)          TARGET_HOST="$2"; shift 2;;
    --port)          TARGET_PORT="$2"; shift 2;;
    --extra)         EXTRA="$2"; shift 2;;
    --check)         CHECK=1; shift;;
    --build)         BUILD=1; shift;;
    -h|--help)       sed -n '2,22p' "$0"; exit 0;;
    *)               echo "未知参数: $1"; exit 1;;
  esac
done

case "$SCENARIO" in
  layer) PLAN="stress-layer.jmx";;
  ramp)  PLAN="stress-ramp.jmx";;
  spike) PLAN="stress-spike.jmx";;
  *)     echo "未知场景: $SCENARIO（可选 layer/ramp/spike）"; exit 1;;
esac

REPORT_DIR="$ROOT/perf/reports/$VERSION/$SCENARIO$([[ "$SCENARIO" == "layer" ]] && echo "-L$LAYER" || echo "")"
rm -rf "$REPORT_DIR"; mkdir -p "$REPORT_DIR"

# 阶梯加压：把 800 天花板按 --max-threads 等比压缩，避免小机器直接把宿主压死
S1=$(( MAX_THREADS * 50  / 800 )); if [[ $S1 -lt 1 ]]; then S1=1; fi
S2=$(( MAX_THREADS * 100 / 800 )); if [[ $S2 -lt 2 ]]; then S2=2; fi
S3=$(( MAX_THREADS * 200 / 800 )); if [[ $S3 -lt 3 ]]; then S3=3; fi
S4=$(( MAX_THREADS * 400 / 800 )); if [[ $S4 -lt 4 ]]; then S4=4; fi
S5=$MAX_THREADS

COMMON=(
  -Jhost="$TARGET_HOST" -Jport="$TARGET_PORT"
  -JusersFile="data/users-stress.csv" -JproductsFile="data/products-stress.csv"
  -JinfluxHost="$INFLUX_HOST"
  -Jthreads="$THREADS" -JrampUp="$(( DURATION / 10 < 30 ? 30 : DURATION / 10 ))" -Jduration="$DURATION"
  -Jstep1Threads="$S1" -Jstep2Threads="$S2" -Jstep3Threads="$S3" -Jstep4Threads="$S4" -Jstep5Threads="$S5"
  -JholdThreads="$S3" -JbaseThreads="$BASE_THREADS" -JspikeThreads="$SPIKE_THREADS"
  -Jlayer="$LAYER"
)

echo "=============================================="
echo " 压力场景   : $SCENARIO ($PLAN)$([[ "$SCENARIO" == "layer" ]] && echo "  layer=$LAYER" || echo "")"
echo " 并发       : threads=$THREADS max=$MAX_THREADS base=$BASE_THREADS spike=$SPIKE_THREADS"
echo " 阶梯       : $S1 -> $S2 -> $S3 -> $S4 -> $S5"
echo " 时长       : ${DURATION}s"
echo " 报告目录   : $REPORT_DIR"
echo "----------------------------------------------"
echo " 停止条件：错误率>5%(30s) / P95>3s / CPU>90% / OOM / 线程池耗尽"
echo " 盯盘：Grafana http://localhost:3000   RabbitMQ http://localhost:15672"
echo "=============================================="

if [[ $BUILD -eq 1 ]]; then docker compose -f docker-compose.test.yml build jmeter; fi

docker run --rm --network "$NETWORK" -v "$REPORT_DIR:/reports" "$IMAGE" \
  -n -t "/jmeter/plans/$PLAN" "${COMMON[@]}" $EXTRA \
  -l /reports/result.jtl -e -o /reports/html

echo ""
echo "完成。报告："
echo "  JTL   : $REPORT_DIR/result.jtl"
echo "  HTML  : $REPORT_DIR/html/index.html"

# ---------- 压后数据一致性校验 ----------
if [[ $CHECK -eq 1 ]]; then
  echo ""
  echo "================ 压后数据一致性校验 ================"
  # 延迟关单 TTL 是 10 分钟，这里先等队列消化再校验
  echo "等待 30s 让 MQ 消费完（延迟关单 TTL 更长，孤儿订单项请 15 分钟后再跑一次）..."
  sleep 30
  docker exec -i shop-mysql mysql -ushop -pshop123456 shop_demo \
      --default-character-set=utf8mb4 < "$ROOT/perf/data/consistency-check.sql" \
      2>&1 | grep -v "Using a password" | tee "$REPORT_DIR/consistency-check.txt" | head -60
  echo ""
  echo "完整结果：$REPORT_DIR/consistency-check.txt"
  echo "MQ 残留自查：docker exec shop-rabbitmq rabbitmqctl list_queues name messages"
fi
