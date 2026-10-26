# Shop Demo · 测试靶场商城

一套用于 **API 测试 / 性能测试 / 压力测试 / UI 自动化** 的本地 Docker 商城靶场：
后端 Spring Boot 3 单体服务（MySQL + Redis + RabbitMQ），前端 Vue 3 + Element Plus，
配套 Playwright 自动化与 JMeter 压测方案，Jenkins 在代码合并时自动触发并按版本归档报告。

---

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Spring Boot 3.2.5 · Java 17 · Spring Security + JWT · JPA/Hibernate · MySQL 8 · Redis 7 · RabbitMQ 3.13 |
| 前端 | Vue 3 + Vite + Element Plus + Vue Router（关键元素带 `data-testid`） |
| 自动化测试 | Playwright + TypeScript（`api` / `ui` 两个 project，Allure + HTML 双报告） |
| 性能/压力 | Apache JMeter 5.6.3 + InfluxDB 2 + Grafana 实时监控 |
| CI | Jenkins（Docker 部署），merge 触发，报告按 `分支-commit-构建号` 归档 |

## 2. 目录结构

```
target_demo/
├── backend/              Spring Boot 服务（Dockerfile + 源码）
├── frontend/             Vue3 前端（Dockerfile + nginx.conf）
├── db/init/              01-schema.sql / 02-seed.sql（1000 用户 + 200 商品 + 管理员）
├── tests/                Playwright 工程（API + UI）
├── perf/                 JMeter 脚本与方案文档
│   ├── Dockerfile        JMeter 5.6.3 运行环境
│   └── notes/            性能测试方案 / 压力测试方案
├── monitoring/grafana/   Grafana 数据源与 JMeter 看板（自动 provisioning）
├── jenkins/              Jenkins 镜像与插件清单
├── docker-compose.yml    主应用栈
├── docker-compose.test.yml  测试执行栈（Playwright / JMeter 容器）
└── Jenkinsfile           流水线
```

## 3. 快速开始

```bash
cd target_demo

# 一键起环境（首次会构建镜像，约 3~5 分钟）
docker compose up -d --build

# 查看状态
docker compose ps

# 等待后端就绪
until curl -fsS http://localhost:8080/actuator/health; do sleep 3; done
```

访问地址：

> 已在 macOS 26.4 (arm64) + Docker Desktop 4.92.0 / Engine 29.8.0 / Compose v5.5.1 上实测通过：
> 登录 → 下单 → 支付成功/失败/超时三条分支、库存扣减与回滚、MQ 异步发货签收均验证 OK。

| 服务 | 地址 | 账号 |
|---|---|---|
| 前端商城 | http://localhost:8081 | `tester / 123456` |
| 后端 API | http://localhost:8080 | — |
| Swagger | http://localhost:8080/swagger-ui.html | — |
| RabbitMQ 管理台 | http://localhost:15672 | `guest / guest` |
| Grafana | http://localhost:3000 | `admin / admin123456` |
| InfluxDB | http://localhost:8086 | `admin / admin123456` |
| Jenkins | http://localhost:8082 | 无初始密码（已跳过安装向导，本地未开鉴权）|

内置账号：

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin123` |
| 固定演示用户 | `tester` | `123456` |
| 压测用户池 | `user00001` ~ `user01000` | `123456` |

## 4. 核心业务链路

```
登录(JWT) → 商品列表/详情(Redis缓存) → 加购物车 → 下单(乐观锁扣库存 + 投递延迟关单队列)
    → 发起支付(Mock 状态机) → MQ 异步落终态
        ├─ SUCCESS → 订单 PAID → 延迟队列 → SHIPPED → DELIVERED
        ├─ FAILED  → 订单 PAY_FAILED，回滚库存
        └─ TIMEOUT → 支付单 TIMEOUT，允许重新支付
    → 退款 → REFUNDED，回滚库存，订单 CANCELLED
超时未支付 → 延迟队列 TTL 到期 → 死信路由 → 自动关单并回滚库存（另有定时补偿任务兜底）
```

Mock 支付网关行为可通过 `PUT /api/admin/payment/config` **运行时调整**（失败率 / 超时率 / 延迟区间 / 是否走 MQ 异步），
也可以在发起支付时用 `outcome` 字段强制指定 `SUCCESS / FAILED / TIMEOUT`，方便自动化测试构造确定性场景。

## 5. 常用接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录，返回 accessToken/refreshToken |
| POST | `/api/auth/register` | 注册 |
| GET | `/api/products` | 商品分页（keyword / categoryId） |
| GET | `/api/products/{id}` | 商品详情（返回 `cached` 命中标记） |
| POST/GET/PUT/DELETE | `/api/cart/...` | 购物车 |
| POST | `/api/orders` | 下单（支持 `fromCart:true`） |
| POST | `/api/orders/{orderNo}/cancel` | 取消订单并回滚库存 |
| POST | `/api/payments` | 发起支付 |
| POST | `/api/payments/{tradeNo}/callback` | 模拟网关回调（幂等） |
| POST | `/api/payments/{tradeNo}/refund` | 退款 |
| GET/PUT | `/api/admin/payment/config` | Mock 网关配置 |
| GET | `/api/admin/orders/stats` | 各状态订单数量 |

## 6. 本地执行自动化

```bash
cd tests
npm install
npx playwright install chromium

# 全量（API + UI）
REPORT_VERSION=local npx playwright test

# 只跑 API / 只跑 UI
REPORT_VERSION=local npx playwright test --project=api
REPORT_VERSION=local npx playwright test --project=ui

# 报告
npx playwright show-report ../reports/local/playwright-report
npx allure serve ../reports/local/allure-results
```

环境变量：`API_BASE_URL`（默认 `http://localhost:8080`）、`BASE_URL`（默认 `http://localhost:8081`）、
`USER_NAME/USER_PASS`、`ADMIN_USER/ADMIN_PASS`、`REPORT_VERSION`。

在 Jenkins 中这些由 `docker-compose.test.yml` 注入，容器内默认指向 `http://backend:8080` 与 `http://frontend`。

## 7. 关键调参（压测时直接改 env 重启 backend）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TOMCAT_MAX_THREADS` | 200 | Tomcat 最大工作线程 |
| `DB_POOL_MAX` | 20 | HikariCP 最大连接数 |
| `PAY_MIN_DELAY_MS` / `PAY_MAX_DELAY_MS` | 300 / 2000 | Mock 支付延迟区间 |
| `PAY_FAILURE_RATE` / `PAY_TIMEOUT_RATE` | 0.05 / 0.03 | 随机失败率 / 超时率 |
| `ORDER_PAY_TIMEOUT_MS` | 600000 | 超时关单 TTL |
| `ORDER_SHIP_DELAY_MS` | 3000 | 发货/签收延迟 |
| `MQ_CONSUMER_MIN` / `MQ_CONSUMER_MAX` | 2 / 8 | MQ 消费者并发 |

示例：

```bash
TOMCAT_MAX_THREADS=400 DB_POOL_MAX=50 docker compose up -d backend
```

## 8. Jenkins 流水线

1. 启动 Jenkins：`docker compose up -d --build jenkins`，访问 http://localhost:8082 。
   - 镜像已预装 BlueOcean 等插件（首次构建镜像约 20+ 分钟，主要在下载插件）。
   - **已修复**：Debian trixie 的 `docker.io` 包不含可用的 `docker` 客户端二进制，故 `jenkins/Dockerfile`
     改用官方静态二进制安装 `docker` CLI + `compose` 插件；运行中的容器也已安装同样版本，确保流水线里的
     `docker` / `docker compose` 可用。
2. 首次进入**没有初始密码**：镜像通过 `-Djenkins.install.runSetupWizard=false` 跳过安装向导，默认不开启鉴权（本地测试环境）。
3. **Pipeline 任务已创建**：任务名 `target_demo`，类型为 Pipeline（内联脚本，内容即本仓库 `Jenkinsfile`）。
   - 仓库已通过 compose 卷挂载挂进 Jenkins 工作区 `/var/jenkins_home/workspace/target_demo`，
     流水线执行 `docker compose`、读取 `Jenkinsfile` 时直接使用工作区文件。
   - 仓库已 `git init` 并提交（默认分支 `main`），满足 `Jenkinsfile` 里 `git rev-parse` 取版本号的要求。
4. 触发方式：手动「立即构建」，或配置 Git webhook / `Poll SCM` 在 merge / push 时触发；
   参数 `RUN_PERF_TEST` 可勾选跑性能测试，`BASE_URL` 指定被测服务地址。
5. 流水线阶段：
   `准备（计算版本号）→ 构建镜像 → 部署环境 → 冒烟 → API 自动化 → UI 自动化 → 生成 Allure → （可选）性能测试 → 归档报告`
6. 报告归档位置：`reports/<分支>-<commit>-b<构建号>/`，含 `playwright-report/`、`allure-report/`、`junit.xml`；
   失败用例会把构建标记为 `UNSTABLE` 并保留截图/视频/trace。

> **容器内运行 Jenkins 的注意事项**：流水线默认 `BASE_URL=http://localhost` 访问后端/前端，这只对「Jenkins 跑在宿主机」成立。
> 当前 Jenkins 本身是 Docker 容器，在它内部访问 `localhost:8080` 指的是 Jenkins 自己。请在「立即构建」时把参数 `BASE_URL`
> 填为 `http://host.docker.internal`（Docker Desktop 已内置该主机名解析），冒烟检查才能正确打到宿主机上的 backend/frontend。
> 也可直接把 `host.docker.internal` 作为 `BASE_URL` 默认值提交进 `Jenkinsfile`。

> 说明：测试容器的代码在**构建镜像时**打进镜像，报告通过命名卷 + `docker cp` 取回，
> 规避「Jenkins 容器内路径 ≠ 宿主 docker daemon 路径」的 bind mount 问题。

## 9. 性能测试 / 压力测试

### 9.1 方案文档

- `perf/notes/性能测试方案.md` —— 场景、负载模型、断言、SLA、参数化设计
- `perf/notes/压力测试方案.md` —— 阶梯加压、分层压测、瓶颈定位、压后一致性校验

### 9.2 已产出物

```
perf/
├── Dockerfile                 JMeter 5.6.3 运行环境（含插件管理，镜像 target_demo-jmeter）
├── tools/build_plans.py       JMX 生成器（改这里重新生成，不要手改 .jmx）
├── data/generate_csv.py       参数池生成器
│   ├── users.csv / products.csv             性能池（user00001~user01000 / 200 商品）
│   ├── users-stress.csv / products-stress.csv  压力池（与性能池隔离）
│   └── consistency-check.sql  压后数据一致性校验（超卖 / 重复扣款 / 库存守恒）
├── plans/                     8 份脚本（均已冒烟通过）
│   ├── shop-browse.jmx        纯浏览（列表/详情/购物车，命中 Redis 缓存）
│   ├── shop-order-pay.jmx     下单支付全链路
│   ├── shop-mixed.jmx         6:3:1 混合（浏览/下单/后台）
│   ├── shop-spike.jmx         突发脉冲（SyncTimer 集合点）
│   ├── shop-endurance.jmx     稳定性长跑
│   ├── stress-ramp.jmx        阶梯加压到崩
│   ├── stress-spike.jmx       尖峰冲击
│   └── stress-layer.jmx       分层压测 L1~L6（剥离瓶颈用，-Jlayer=N）
├── run-perf.sh                性能执行入口
├── run-stress.sh              压力执行入口
└── reports/<version>/<scenario>/{result.jtl, html/index.html}
```

所有脚本统一通过 `-J` 属性驱动（`host/port/threads/rampUp/duration/usersFile/productsFile/influxHost`），
事务控制器（Transaction Controller）下挂业务采样，**思考时间放在采样器内部**，
因此事务响应时间 = 纯服务端耗时，思考时间不会污染统计。

### 9.3 跑性能测试

```bash
cd target_demo

# 1) 先冒烟：1 线程 30s，确认脚本能跑通、变量解析正常、断言命中
./perf/run-perf.sh --scenario order --smoke

# 2) 正式场景
./perf/run-perf.sh --scenario browse --threads 50  --duration 300
./perf/run-perf.sh --scenario order  --threads 100 --duration 600
./perf/run-perf.sh --scenario mixed  --threads 200 --duration 600 --version v1.2.3

# 3) 特殊用法
./perf/run-perf.sh --scenario mixed --threads 200 --no-influx        # 不接 InfluxDB（不刷监控）
./perf/run-perf.sh --scenario order --extra "-JpayOutcome=FAILED"    # 强制支付失败分支
./perf/run-perf.sh --scenario browse --build                         # 重新构建 JMeter 镜像
```

场景：`browse` / `order` / `mixed` / `spike` / `endurance`。
`mixed` 与 `endurance` 会把总并发按 6:3:1 自动拆到「浏览 / 下单 / 后台」三个线程组。

### 9.4 跑压力测试

```bash
# 分层压测（L1 静态资源 → L2 只读 → L3 登录+读 → L4 写 → L5 支付 → L6 全链路）
./perf/run-stress.sh --scenario layer --layer 3 --threads 50 --duration 300

# 阶梯加压到崩（默认天花板 800，小机器请调小）
./perf/run-stress.sh --scenario ramp --max-threads 400 --duration 600

# 尖峰冲击 + 压后数据一致性校验（强烈建议加 --check）
./perf/run-stress.sh --scenario spike --spike-threads 500 --check
```

停止条件（人工盯盘，满足任一立即中止）：错误率 > 5% 持续 30s / P95 > 3s / 后端 CPU > 90% / OOM 或线程池耗尽。
盯盘入口：Grafana http://localhost:3000 、RabbitMQ http://localhost:15672 （看队列堆积）。

### 9.5 实时监控

InfluxDB2 + Grafana 已随主栈启动，JMeter 通过 Backend Listener 实时写入：

- Grafana http://localhost:3000 （`admin / admin123456`），看板 **Shop Demo · JMeter 实时压测看板** 自动 provisioning
- InfluxDB http://localhost:8086 （`admin / admin123456`），bucket `jmeter`，org `shop`，保留 7 天

不想要监控时用 `--no-influx`（脚本会临时生成一份禁用 Backend Listener 的 jmx，不污染 `plans/`）。

看板顶部有 **应用 / 事务** 两个下拉筛选：每次压测的指标都带 `application` 标签，默认 `shop-demo`，
可以用 `--extra "-JappName=nightly-mixed"` 区分不同批次，看板里切一下就能只看这一次的数据。

### 9.6 重新生成脚本 / 数据

```bash
python3 perf/data/generate_csv.py          # 重建 CSV 参数池
python3 perf/tools/build_plans.py          # 重建 perf/plans/*.jmx
```

> 约定：`plans/*.jmx` 是生成产物，需要改脚本请改 `tools/build_plans.py` 再重新生成，避免手改被覆盖。

## 10. 常见问题

- **curl 本机端口返回 `upstream connect failed`**：本机设置了 `HTTP_PROXY/HTTPS_PROXY`（指向 127.0.0.1 的本地代理），
  访问 localhost 时要加 `--noproxy '*'`，例如 `curl --noproxy '*' http://localhost:8080/actuator/health`；
  跑 Playwright 时同理，必要时设置 `NO_PROXY=localhost,127.0.0.1`。
- **MySQL 起来但后端连不上**：首次初始化脚本执行需要时间，看 `docker compose logs mysql` 直到出现 `ready for connections`。
- **商品名乱码**：`db/init/*.sql` 已加 `SET NAMES utf8mb4`；若之前用旧卷起过，需要 `docker compose down -v` 重建数据卷。
- **支付单一直 PROCESSING**：检查 `docker compose logs backend` 是否有 `payment not found`；
  消息投递已改为事务提交后触发，若还有堆积，去 RabbitMQ 管理台看 `q.payment.process` 队列深度与消费者数。
- **RabbitMQ 队列已存在导致 TTL 不生效**：改了 `ORDER_PAY_TIMEOUT_MS` 后需 `docker compose down -v` 重建。
- **UI 用例报错 `element not found`**：前端构建产物未更新，执行 `docker compose build frontend && docker compose up -d frontend`。
- **压测后数据脏了**：轻量做法是只清业务表、恢复库存（**不重启**监控栈与 Jenkins）：
  ```sql
  SET FOREIGN_KEY_CHECKS=0;
  DELETE FROM order_items; DELETE FROM orders; DELETE FROM payments; DELETE FROM cart_items;
  SET FOREIGN_KEY_CHECKS=1;
  UPDATE products SET stock = 100000 WHERE id BETWEEN 1 AND 10;   -- 热点商品
  UPDATE products SET stock = 10000 WHERE id BETWEEN 11 AND 200;  -- 普通商品
  ```
  若想连同监控数据一起彻底重置，再 `docker compose down -v && docker compose up -d --build`。
- **订单时间 / 超时关单差 8 小时**：后端 JVM、Hibernate、MySQL 三处时区必须一致。
  已在 `docker-compose.yml` 给 backend 设 `TZ=Asia/Shanghai` + `-Duser.timezone=Asia/Shanghai`，
  `application.yml` 里是 `hibernate.jdbc.time_zone: ${DB_TZ:Asia/Shanghai}`。
  如果你改过这些值，或库里的旧数据是在修复前写入的，请 `docker compose down -v` 重建。
