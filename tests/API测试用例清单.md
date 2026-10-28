# target_demo 接口测试用例清单（Phase 1）

> 依据：`backend/API.md`（35 个端点）+ `backend/src/main/java/com/demo/shop` 源码 + 现有 `tests/` 工程
> 版本：v1.1 ｜ 日期：2026-10-28（完成 API.md 对账修正）
> 总量：**140 条** = P0 44 + P1 52 + P2 44
> 层级：**L0** 契约 ｜ **L1** 单接口 ｜ **L2** 链路状态机 ｜ **L3** 数据一致性 ｜ **L4** 并发幂等 ｜ **L5** 安全 ｜ **L6** 非功能
> 模块：**M1** 认证鉴权 ｜ **M2** 商品分类 ｜ **M3** 购物车 ｜ **M4** 订单状态机 ｜ **M5** 支付退款 ｜ **M6** 管理端 ｜ **M7** 契约 ｜ **M8** 安全 ｜ **M9** 并发幂等 ｜ **M10** 数据一致性

---

## 0. 优先级与执行约定

| 优先级 | 含义 | 执行时机 | 门禁 |
|---|---|---|---|
| **P0** | 核心链路与冒烟，失败即阻断 | 每次 merge / push | 通过率 100% |
| **P1** | 主要功能、权限、契约、异常分支 | 每日 / 合并前 | 通过率 ≥ 98% |
| **P2** | 边界、并发、安全、一致性、非功能 | nightly / 发布前 | 通过率 ≥ 95% |

| 执行属性 | 含义 |
|---|---|
| 并行 | 使用独立 `runId` 用户/商品，可与其他用例并行 |
| 串行 | 修改全局配置、清缓存、依赖库存基线、并发/一致性专项，需 `workers=1` 或放 `@destructive` / `@slow` project |

**串行用例清单**：AUTH-013、CAT-006、CAT-013、CART-011、ORD-017~021、PAY-004、PAY-015、PAY-022~024、ADM-008、ADM-010、ADM-013、ADM-014、CTR-008、SEC-010、CON-001~008、DAT-001~006。

**数据约定**
- 每次运行生成 `runId`；每个 worker 注册独立用户，不再共用 `tester`。
- 需要库存的用例自建商品，用例结束删除；订单保留但带 `runId` 标记，由 Jenkins 清理。
- 支付确定性优先用 `outcome` 强制结果；需要随机分布时才改全局配置，且执行前保存、执行后恢复。
- 金额统一按 2 位小数比较；时间只断言格式与时区（Asia/Shanghai），不断言具体值。
- 异步一律轮询（`expect.poll` / wait helper），超时 30s，记录实际收敛耗时。

---

## 1. 总量与分布

### 1.1 模块 × 优先级

| 模块 | 端点 | P0 | P1 | P2 | 合计 |
|---|---:|---:|---:|---:|---:|
| M1 认证鉴权 | 4 | 8 | 7 | 2 | 17 |
| M2 商品分类 | 4 | 6 | 6 | 2 | 14 |
| M3 购物车 | 5 | 6 | 4 | 4 | 14 |
| M4 订单状态机 | 5 | 8 | 11 | 4 | 23 |
| M5 支付退款 | 5 | 10 | 9 | 6 | 25 |
| M6 管理端 | 12 | 6 | 7 | 2 | 15 |
| M7 契约 | 全部 | 0 | 8 | 0 | 8 |
| M8 安全 | 全部 | 0 | 0 | 10 | 10 |
| M9 并发幂等 | 全部 | 0 | 0 | 8 | 8 |
| M10 数据一致性 | 全部 | 0 | 0 | 6 | 6 |
| **合计** | **35** | **44** | **52** | **44** | **140** |

### 1.2 层级分布

| 层级 | 条数 | 主要模块 |
|---|---:|---|
| L0 契约 | 10 | M7 为主，M2/M4/M5/M6 各 1 条 Schema |
| L1 单接口 | 66 | M1~M6 的正向、校验、错误码 |
| L2 链路状态机 | 11 | M4 订单履约、M5 支付/退款/回调 |
| L3 数据一致性 | 13 | M10、商品缓存、购物车快照、支付金额 |
| L4 并发幂等 | 13 | M9、支付幂等、订单竞争 |
| L5 安全 | 18 | M8、鉴权/越权、JWT、注入 |
| L6 非功能 | 9 | 健康检查、traceId、并发冒烟、MQ 收敛 |

---

## 2. M1 认证与鉴权（17 条）

涉及端点：`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/refresh`、`GET /api/auth/me`

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| AUTH-001 | L1 | P0 | 正确账号登录 | `code=0`；accessToken/refreshToken 非空；tokenType=Bearer；expiresIn≈3600；role=USER | 并行 |
| AUTH-002 | L1 | P0 | 密码错误登录 | HTTP 401；`code=40101`；响应无 token | 并行 |
| AUTH-003 | L1 | P0 | 不存在用户登录 | HTTP 401；`code=40101`；与密码错误响应一致，不泄露用户是否存在 | 并行 |
| AUTH-004 | L1 | P0 | 匿名访问受保护接口（me/cart/orders/payments） | HTTP 401；`code=40100`；不返回业务数据 | 并行 |
| AUTH-005 | L1 | P0 | 注册新用户 | code=0；role=USER；balance=10000.00（源码默认）；新账号可登录并访问 me | 并行 |
| AUTH-006 | L1 | P0 | 重复用户名注册 | HTTP 409；`code=40901`；用户数不增加 | 并行 |
| AUTH-007 | L1 | P0 | 当前用户信息 | `code=0`；id/username/role 正确；无 password/secret 字段 | 并行 |
| AUTH-008 | L1 | P0 | refreshToken 换新令牌 | `code=0`；新 access 可访问 me；新 refresh 可用；旧 refresh 是否失效按实现记录 | 并行 |
| AUTH-009 | L1 | P1 | 注册参数边界：username 2/3/64/65，password 5/6/128/129，email 非法，nickname 65 | 合法通过；非法 HTTP 400/`40000`；错误信息能定位字段 | 并行 |
| AUTH-010 | L1 | P1 | 登录参数缺失/空串/超长 | `40000` 或 `40101`（按实现）；不出现 500 | 并行 |
| AUTH-011 | L1 | P1 | 用户名规范化：trim、大小写、中文、特殊字符 | 行为稳定且与注册规则一致；重复判定正确 | 并行 |
| AUTH-012 | L5 | P1 | JWT 篡改：改 role、改签名、alg=none | HTTP 401/`40100`；不能获得 ADMIN 权限 | 并行 |
| AUTH-013 | L5 | P1 | accessToken 过期（短 TTL 环境） | HTTP 401/`40100`；refresh 后可继续访问 | 串行 |
| AUTH-014 | L5 | P1 | refreshToken 与 accessToken 混用 | 预期 401/40000；当前实现 refresh 可当 access 用（安全缺陷，Phase 0 确认） | 并行 |
| AUTH-015 | L5 | P2 | 注册 mass assignment：body 带 role/balance/id | 仍为 USER、balance=10000.00；role/balance/id 被忽略 | 并行 |
| AUTH-016 | L1 | P2 | 并发注册同一用户名 | 仅 1 个 `code=0`；其余 `40901`；DB 仅 1 条 | 并行 |
| AUTH-017 | L1 | P1 | JWT claims 与 TTL | 解码 access/refresh：sub=username、role、uid、typ；access TTL≈3600s、refresh≈86400s | 并行 |

---

## 3. M2 商品与分类（14 条）

涉及端点：`GET /api/products`、`GET /api/products/{id}`、`GET /api/products/hot`、`GET /api/categories`

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| CAT-001 | L1 | P0 | 商品列表默认分页 | code=0；content≤20；total 与种子数据一致（当前 200，允许用例增量）；totalPages 自洽 | 并行 |
| CAT-002 | L1 | P0 | 商品详情与不存在 id | 字段/类型/价格精度正确；不存在 HTTP 404/`40401` | 并行 |
| CAT-003 | L1 | P0 | 分类列表 | 非空；id/name/sortOrder 完整；顺序按实现记录（源码 findAll 未显式排序） | 并行 |
| CAT-004 | L1 | P0 | 热销商品 | 默认 10；limit=5 时≤5；id 唯一；字段完整 | 并行 |
| CAT-005 | L1 | P0 | 关键字搜索 | 命中 name；无结果 content=[]、total=0 | 并行 |
| CAT-006 | L3 | P0 | Redis 缓存命中 | 清缓存后首次未命中 cached=false，二次命中 true；再次清缓存后回到 false | 串行 |
| CAT-007 | L1 | P1 | 分页边界：page 超界、size=1/100/0/-1/10000 | 超界空页且 last=true；size>200 收敛到 200；size=0/-1 当前 500（缺陷候选）；默认 20 | 并行 |
| CAT-008 | L1 | P1 | keyword 特殊输入：中文、大小写、`%`、`_`、`' OR 1=1--` | 不 500；不返回全量；结果符合 LIKE 语义 | 并行 |
| CAT-009 | L1 | P1 | categoryId 过滤（含不存在、非数字） | 只返回该分类；不存在空页；非数字 `40000` | 并行 |
| CAT-010 | L1 | P1 | keyword + categoryId 组合 | 结果同时满足；total 与 content 一致 | 并行 |
| CAT-011 | L1 | P1 | OFF_SALE 商品可见性 | API.md 未定义；先记录实现行为（源码列表未过滤 OFF_SALE），Phase 0 定基线 | 并行 |
| CAT-012 | L0 | P1 | 商品/分类响应 Schema | 字段类型、枚举、金额精度、时间格式与 `API.md` 一致 | 并行 |
| CAT-013 | L3 | P2 | 不存在商品重复请求（缓存穿透） | 稳定 404；无 500；响应时间不随次数劣化 | 串行 |
| CAT-014 | L6 | P2 | 50 并发读列表/详情 | 错误率 0；P95 阈值（本地 <200ms）；无连接耗尽 | 并行 |

---

## 4. M3 购物车（14 条）

涉及端点：`GET /api/cart`、`POST /api/cart/items`、`PUT /api/cart/items/{productId}`、`DELETE /api/cart/items/{productId}`、`DELETE /api/cart`

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| CART-001 | L1 | P0 | 新用户空购物车 | items=[]；totalAmount=0；totalQuantity=0 | 并行 |
| CART-002 | L1 | P0 | 加入购物车 | 数量/快照价/小计/总额/availableStock 正确 | 并行 |
| CART-003 | L1 | P0 | 同商品重复加购 | 源码为单行累加；API.md 未定义，需固化；金额与总数量正确 | 并行 |
| CART-004 | L1 | P0 | 修改购物车数量 | 数量/金额/总数量同步；availableStock 不超 | 并行 |
| CART-005 | L1 | P0 | 删除单项与清空购物车 | 删除后 items 移除；清空后 totals=0 | 并行 |
| CART-006 | L1 | P0 | 加购异常商品 | 不存在 `40401`；下架 `40902` | 并行 |
| CART-007 | L1 | P1 | 加购数量边界：1、库存上限、库存+1、0、-1 | 单次超库存 40903；累计加购/修改可超库存（源码未校验，缺陷候选）；0/-1 40000 | 并行 |
| CART-008 | L1 | P1 | 修改数量边界：0、负数、超库存、缺 quantity | 0 删除；负数/超库存源码未校验（缺陷候选）；缺 quantity 当前 500 | 并行 |
| CART-009 | L1 | P1 | 删除不存在条目、重复删除、清空空车 | API.md 写空车 40905；源码空车清空返回成功（文档/实现冲突） | 并行 |
| CART-010 | L5 | P1 | 用户购物车隔离 | A/B 互不可见；A 操作不影响 B；无操作他人购物车的入口 | 并行 |
| CART-011 | L3 | P2 | 商品改价/改库存后的购物车快照 | 源码保存 snapshotPrice；改价后是否刷新 API.md 未定义，需确认；availableStock 刷新 | 串行 |
| CART-012 | L3 | P2 | 加购后商品下架/删除 | 下单返回 `40902`/`40401`；购物车状态可预期 | 并行 |
| CART-013 | L4 | P2 | 同用户并发加购同一商品 | 无重复行；数量=Σ成功加购；总额正确 | 并行 |
| CART-014 | L5 | P2 | 加购异常入参：字符串、小数、超长、额外字段 | `40000`；不 500；不写入脏数据 | 并行 |

---

## 5. M4 订单与状态机（23 条）

涉及端点：`POST /api/orders`、`GET /api/orders/{orderNo}`、`GET /api/orders`、`POST /api/orders/{orderNo}/cancel`、`GET /api/orders/{orderNo}/status`

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| ORD-001 | L1 | P0 | 直接下单 | PENDING_PAYMENT；payAmount=totalAmount=Σ(price×qty)（源码）；remark/收货信息正确；库存预扣 | 并行 |
| ORD-002 | L1 | P0 | 购物车下单（fromCart=true） | 使用全部购物车商品并忽略 items；源码下单后清空购物车（API.md 未写清空）；金额正确 | 并行 |
| ORD-003 | L1 | P0 | 订单详情 | 本人可查；字段/金额/明细一致 | 并行 |
| ORD-004 | L1 | P0 | 我的订单列表 | 分页；status 过滤（含非法枚举）；只含本人订单 | 并行 |
| ORD-005 | L1 | P0 | 取消待支付订单 | CANCELLED；库存回滚 | 并行 |
| ORD-006 | L1 | P0 | 库存不足下单 | HTTP 409/`40903`；库存不变；无订单落库 | 并行 |
| ORD-007 | L2 | P0 | 支付成功履约链路 | PAID→SHIPPED→DELIVERED；最终库存=初始-qty | 并行 |
| ORD-008 | L2 | P0 | 支付失败/支付超时 | FAILED→PAY_FAILED；TIMEOUT 可重付；库存回滚 | 并行 |
| ORD-009 | L1 | P1 | 下单参数校验：items 空/缺失、qty 0/-1、productId 不存在 | items 空/缺返回 40000；qty 0/-1 40000；productId 不存在 40401；收货信息超长源码无校验 | 并行 |
| ORD-010 | L1 | P1 | 同一商品重复行 | 源码按传入行分别建明细；API.md 未定义合并规则，需固化；金额/库存正确 | 并行 |
| ORD-011 | L1 | P1 | 订单号不存在/格式非法 | HTTP 404/`40402`；不泄露他人订单 | 并行 |
| ORD-012 | L5 | P1 | 订单越权：他人详情/取消/状态 | 他人 403；管理员可查（源码 assertOwnership 放行，API.md 未文档化） | 并行 |
| ORD-013 | L1 | P1 | 非法状态取消：PAID/SHIPPED/DELIVERED/CANCELLED/PAY_FAILED | `40904`；状态与库存不变 | 并行 |
| ORD-014 | L2 | P1 | 已取消/已支付订单再次支付 | 源码返回 40906（API.md 写 40904，冲突）；不重复扣款 | 并行 |
| ORD-015 | L2 | P1 | 管理端非法发货/收货：未支付发货、重复发货、未发货收货 | `40904`；状态不变 | 并行 |
| ORD-016 | L0 | P1 | 订单响应 Schema | 字段/枚举/时间格式；status 与 updatedAt 随时态变化 | 并行 |
| ORD-017 | L3 | P2 | 四路径库存守恒：取消/失败/超时/退款 | 库存=基线；重复操作不重复回滚 | 串行 |
| ORD-018 | L4 | P2 | 并发下单同一商品 | 成功数≤库存；其余 `40903`/`40900`；最终库存精确 | 串行 |
| ORD-019 | L4 | P2 | 取消与支付并发 | 终态仅 CANCELLED 或 PAID；无“取消且扣款” | 串行 |
| ORD-020 | L6 | P2 | 订单状态轮询收敛 | P95 收敛时间达标；错误率 0；无长期 PROCESSING/PAYING | 串行 |
| ORD-021 | L2 | P1 | 超时未支付自动关单（延迟队列 + 补偿任务兜底） | 短 TTL 下订单 CANCELLED、库存回滚；API.md 未描述自动关单；关联支付单 CLOSED 源码未实现 | 串行 |
| ORD-022 | L1 | P1 | fromCart=true 同时传 items | 只使用购物车商品，items 被忽略；订单金额=购物车合计 | 并行 |
| ORD-023 | L1 | P1 | fromCart=true 且购物车为空 | API.md 预期 40905；源码实际 40000（文档/实现冲突，Phase 0 定基线） | 并行 |

---

## 6. M5 支付、退款与回调（25 条）

涉及端点：`POST /api/payments`、`GET /api/payments/{tradeNo}`、`GET /api/payments`、`POST /api/payments/{tradeNo}/callback`、`POST /api/payments/{tradeNo}/refund`

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| PAY-001 | L1 | P0 | outcome=SUCCESS | 支付单 SUCCESS；订单 PAID；金额=payAmount | 并行 |
| PAY-002 | L1 | P0 | outcome=FAILED | FAILED；订单 PAY_FAILED；库存回滚（README/实现约定，API.md 未明写） | 并行 |
| PAY-003 | L1 | P0 | outcome=TIMEOUT | TIMEOUT；订单 PAY_FAILED；可重新支付并成功（README/实现约定） | 并行 |
| PAY-004 | L1 | P0 | 配置 failureRate=0、timeoutRate=0 时不传 outcome | 必成功；配置前后一致 | 串行 |
| PAY-005 | L1 | P0 | 支付单详情与不存在 tradeNo | 字段完整；允许 PROCESSING 中间态；不存在 40403 | 并行 |
| PAY-006 | L1 | P0 | 按订单查支付单 | 返回该订单全部支付单（createdAt 倒序）；TIMEOUT 重付后应有多条；orderNo 缺失见 PAY-011 | 并行 |
| PAY-007 | L2 | P0 | 回调 SUCCESS + 重复回调 | 支付单/订单终态正确；同 callbackId 重复无副作用 | 并行 |
| PAY-008 | L2 | P0 | 退款 | REFUNDED；订单 CANCELLED、库存回滚（源码 markRefunded；API.md 4.1 未画 PAID→CANCELLED） | 并行 |
| PAY-009 | L1 | P0 | 支付非法订单：不存在/已取消/已支付 | 不存在 40402；已取消/已支付源码返回 40906（API.md 写 40904，冲突） | 并行 |
| PAY-010 | L1 | P0 | 四种 payType：ALIPAY/WECHAT/CARD/BALANCE | 新用户余额 10000；BALANCE 余额不足 40907；其余三种成功 | 并行 |
| PAY-011 | L1 | P1 | 支付参数校验：orderNo 缺失/空、payType/outcome 非法 | API.md 要求 orderNo 必填；源码无 @Valid，缺失返回 40402（缺陷）；idempotencyKey 无长度约束 | 并行 |
| PAY-012 | L1 | P1 | 回调参数校验：status 缺失/非法、callbackId 超长 | status 缺失/非法 400；callbackId 无长度约束 | 并行 |
| PAY-013 | L1 | P1 | 退款非法状态：PROCESSING/FAILED/TIMEOUT/REFUNDED/CLOSED | `40906`；状态/库存不变 | 并行 |
| PAY-014 | L2 | P1 | 重复退款 | 第二次 `40906`；库存只回滚一次 | 并行 |
| PAY-015 | L2 | P1 | 手动回调与 MQ 自动结果竞争 | 终态唯一；订单/库存只变更一次 | 串行 |
| PAY-016 | L5 | P1 | 支付越权：他人支付单/退款/按订单查 | 应为 403；源码 get/listByOrder/refund 均无归属校验（严重越权缺陷） | 并行 |
| PAY-017 | L0 | P1 | PaymentResponse Schema | 字段/枚举/金额/时间；PaymentResponse 不含 callbackId（API.md 字段表），现有用例断言 callbackId 是错误 | 并行 |
| PAY-018 | L3 | P1 | 支付金额一致性 | 支付金额=订单应付；多支付单一致；退款金额=支付金额 | 并行 |
| PAY-019 | L4 | P2 | 同 idempotencyKey 并发支付 | API.md 承诺幂等；源码未使用 idempotencyKey（缺陷候选），当前仅靠订单 PAYING+PROCESSING 去重 | 串行 |
| PAY-020 | L4 | P2 | 同 callbackId 并发回调 | 只生效一次；状态/库存不变 | 串行 |
| PAY-021 | L4 | P2 | 不同 idempotencyKey 重复支付 | API.md 未定义；源码在 PAY_FAILED 时允许新建支付单，需确认；禁止重复扣款 | 串行 |
| PAY-022 | L3 | P2 | 随机配置分布：failure=1、timeout=1、各 0.5 | 样本分布符合容差；实际耗时落在 minDelay~maxDelay；无 500 | 串行 |
| PAY-023 | L2 | P2 | 同步/异步模式（asyncEnabled=false/true） | 两种模式下状态机一致 | 串行 |
| PAY-024 | L6 | P2 | 支付端到端耗时 | 下单→终态 P95 达标；MQ 无异常堆积 | 串行 |
| PAY-025 | L2 | P1 | outcome 覆盖全局配置 | failureRate=1/timeoutRate=1 时，传 outcome=SUCCESS/FAILED/TIMEOUT 仍按指定结果执行 | 并行 |

---

## 7. M6 管理端（15 条）

涉及端点：`/api/admin/products`（列表/新增/更新/删除/调库存/清缓存）、`/api/admin/orders`（列表/发货/收货/统计）、`/api/admin/payment/config`

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| ADM-001 | L1 | P0 | 新建商品 | 字段/默认 ON_SALE；普通用户调用 403 | 并行 |
| ADM-002 | L1 | P0 | 更新商品 | 价格/库存/状态生效；不存在 `40401` | 并行 |
| ADM-003 | L1 | P0 | 删除商品 | 删除为物理删除（源码）；用户端不可见/40401；历史订单明细保存快照仍可查；API.md 未明确语义 | 并行 |
| ADM-004 | L1 | P0 | 调整库存（正/负 delta） | 正确增减；扣成负数 `40903`；不存在 `40401` | 并行 |
| ADM-005 | L1 | P0 | 管理端订单列表 | 分页/状态过滤/金额明细；普通用户 403 | 并行 |
| ADM-006 | L1 | P0 | 订单统计 | Map 键为各 OrderStatus 枚举名 + totalOrders（源码）；先探明再断言计数准确 | 并行 |
| ADM-007 | L1 | P1 | 管理端商品列表 | 分页/关键字/分类过滤；含下架商品 | 并行 |
| ADM-008 | L1 | P1 | 清除商品缓存 | 返回 data=true；清后 cached=false；再读 true；不影响其他商品 | 串行 |
| ADM-009 | L1 | P1 | 发货/确认收货 | PAID→SHIPPED→DELIVERED；重复/非法迁移 `40904` | 并行 |
| ADM-010 | L1 | P1 | 支付配置读写与校验 | API.md 范围 0~1/≥0；源码校验 min≤max；但控制器无 @Valid，越界值当前被接受（缺陷） | 串行 |
| ADM-011 | L5 | P1 | 管理端垂直越权矩阵 | USER 调用全部 `/api/admin/**` 返回 403；匿名 401 | 并行 |
| ADM-012 | L0 | P1 | 管理端响应 Schema | 商品/订单/统计/配置字段与 `API.md` 一致 | 并行 |
| ADM-013 | L3 | P2 | 管理端变更后的缓存一致性 | 源码 update/delete/adjustStock 均 evict；API.md 仅暴露 clear cache，未承诺自动失效 | 串行 |
| ADM-014 | L6 | P2 | 统计接口性能与准确性 | 数据量可控下响应时间达标；计数准确 | 串行 |
| ADM-015 | L1 | P1 | 商品字段校验 | name 必填、price>0、stock 必填；非法 40000；status 仅 ON_SALE/OFF_SALE | 并行 |

---

## 8. M7 契约（8 条）

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| CTR-001 | L0 | P1 | 统一响应信封 | 成功：code/message/data/timestamp，无 traceId（源码 ok() 未设置）；错误：+traceId；401/403 仅 code/message | 并行 |
| CTR-002 | L0 | P1 | 分页结构 | page/size/total/totalPages/last 语义与边界 | 并行 |
| CTR-003 | L0 | P1 | 错误码与 HTTP 映射 | 40000/40100/40101/40300/40400~40403/40900~40907/50000 与文档一致；50000/40400 无自然触发；401/403 message 编码需确认 | 并行 |
| CTR-004 | L0 | P1 | 枚举与字段类型 | Role/OrderStatus/PaymentStatus/PayType/Product.status 全集 | 并行 |
| CTR-005 | L0 | P1 | 金额与时间格式 | 信封 timestamp 为 Instant UTC（Z）；实体 createdAt/updatedAt 为 LocalDateTime（Asia/Shanghai） | 并行 |
| CTR-006 | L0 | P1 | OpenAPI 与 API.md 对账 | 35 端点的方法/参数/必填/响应模型一致；输出差异清单 | 并行 |
| CTR-007 | L6 | P1 | 健康检查 | `/actuator/health` UP；db/redis/rabbit 子项 UP | 并行 |
| CTR-008 | L6 | P1 | traceId 可关联日志 | 业务错误响应有 traceId；成功响应当前无 traceId；安全 401/403 无；需统一后再断言全覆盖 | 串行 |

---

## 9. M8 安全（10 条）

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| SEC-001 | L5 | P2 | 水平越权 | 他人订单/购物车 403/404；支付详情/列表/退款当前无归属校验（严重缺陷） | 并行 |
| SEC-002 | L5 | P2 | 垂直越权 | USER 调 admin 403；JWT role 篡改 401 | 并行 |
| SEC-003 | L5 | P2 | JWT 安全 | 改签名、alg=none、过期、refresh/access 混用 → 401 | 并行 |
| SEC-004 | L5 | P2 | SQL 注入 | keyword/categoryId/orderNo/status 注入 payload：不 500、不返回全量、不泄露 SQL | 并行 |
| SEC-005 | L5 | P2 | 存储型 XSS | 商品名/描述/备注/收货信息写入 `<script>`；API 返回原样或转义符合约定 | 并行 |
| SEC-006 | L5 | P2 | 敏感信息泄露 | 响应/错误/日志无 password/secret/堆栈/SQL；401/403 中文 message 当前乱码 | 并行 |
| SEC-007 | L5 | P2 | mass assignment | 注册/下单/支付 body 带 role/balance/status/userId 被忽略 | 并行 |
| SEC-008 | L5 | P2 | 资源枚举 | 遍历 orderNo/tradeNo 不返回他人数据；错误不区分存在性 | 并行 |
| SEC-009 | L5 | P2 | CORS/CSRF | allowedOriginPatterns=*、allowedMethods=*、allowCredentials=true；CSRF disabled；非白名单说法不成立 | 并行 |
| SEC-010 | L6 | P2 | Actuator/Swagger 暴露面 | 仅 /actuator/health/**、/v3/api-docs/**、/swagger-ui/** 匿名；其他 actuator 端点未在文档承诺 | 串行 |

---

## 10. M9 并发与幂等（8 条）

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| CON-001 | L4 | P2 | 并发下单同一商品 | 成功数=min(N,M)；其余 `40903`/`40900`；最终库存=M-成功数 | 串行 |
| CON-002 | L4 | P2 | 多商品部分库存不足 | 业务要求事务原子：全成功或全失败；API.md 未明写，需固化；无半单 | 串行 |
| CON-003 | L4 | P2 | 同 idempotencyKey 并发支付 | API.md 承诺；源码未使用 key（缺陷候选），并发下可能生成多条支付单 | 串行 |
| CON-004 | L4 | P2 | 同 callbackId 并发回调 | 只生效一次；库存/状态不变 | 串行 |
| CON-005 | L4 | P2 | 支付与取消并发 | 终态唯一；无“取消+扣款”双成功 | 串行 |
| CON-006 | L4 | P2 | 退款与发货并发 | 状态机合法；库存只回滚一次 | 串行 |
| CON-007 | L4 | P2 | 并发加购/改数量 | 无丢失更新；最终数量符合约定 | 串行 |
| CON-008 | L6 | P2 | 50 并发下单/支付混合冒烟 | 排除预期 409 后错误率 0；P95 达标；无 500 | 串行 |

---

## 11. M10 数据一致性（6 条）

> 注：本组是业务不变量，`API.md` 只定义了部分状态与字段，未逐条定义回滚/守恒规则；Phase 0 需把口径固化到文档。

| ID | 层 | 优先级 | 测试内容 | 关键断言 / 数据要点 | 执行 |
|---|---|---|---|---|---|
| DAT-001 | L3 | P2 | 库存守恒 | 初始=剩余+占用+已售；无负数/超卖 | 串行 |
| DAT-002 | L3 | P2 | 四路径回滚 | 取消/失败/超时/退款库存精确回滚；重复操作不重复回滚 | 串行 |
| DAT-003 | L3 | P2 | 支付唯一性 | 每订单最多 1 条 SUCCESS；退款后无有效 SUCCESS | 串行 |
| DAT-004 | L3 | P2 | 金额一致性 | 订单=Σ明细；支付=应付；退款=支付；购物车=Σ小计 | 串行 |
| DAT-005 | L3 | P2 | 缓存一致性 | 改价/库存/删除/清缓存后，详情/列表/购物车/下单一致 | 串行 |
| DAT-006 | L6 | P2 | 异步收敛与 MQ | 支付/发货/签收最终一致；队列无异常堆积；延迟阈值 | 串行 |

---

## 12. 附录 A：端点覆盖矩阵

| 端点 | 覆盖用例 |
|---|---|
| `POST /api/auth/register` | AUTH-005、006、009、011、015、016 |
| `POST /api/auth/login` | AUTH-001、002、003、010、017 |
| `POST /api/auth/refresh` | AUTH-008、014 |
| `GET /api/auth/me` | AUTH-004、007、008 |
| `GET /api/products` | CAT-001、005、007、008、009、010、012、014 |
| `GET /api/products/{id}` | CAT-002、006、011、012、013、014 |
| `GET /api/products/hot` | CAT-004、012 |
| `GET /api/categories` | CAT-003、012 |
| `GET /api/cart` | CART-001、002、003、004、005、010 |
| `POST /api/cart/items` | CART-002、003、006、007、010、013、014 |
| `PUT /api/cart/items/{productId}` | CART-004、008、013 |
| `DELETE /api/cart/items/{productId}` | CART-005、009 |
| `DELETE /api/cart` | CART-005、009 |
| `POST /api/orders` | ORD-001、002、006、009、010、018、022、023 |
| `GET /api/orders/{orderNo}` | ORD-003、011、012 |
| `GET /api/orders` | ORD-004、012、016 |
| `POST /api/orders/{orderNo}/cancel` | ORD-005、012、013、019 |
| `GET /api/orders/{orderNo}/status` | ORD-016、020 |
| `POST /api/payments` | PAY-001、002、003、004、009、010、011、019、021、025 |
| `GET /api/payments/{tradeNo}` | PAY-005、016 |
| `GET /api/payments` | PAY-006、016 |
| `POST /api/payments/{tradeNo}/callback` | PAY-007、012、015、020 |
| `POST /api/payments/{tradeNo}/refund` | PAY-008、013、014、016 |
| `GET /api/admin/products` | ADM-007、011、012 |
| `POST /api/admin/products` | ADM-001、011、012、015 |
| `PUT /api/admin/products/{id}` | ADM-002、011、013、015 |
| `DELETE /api/admin/products/{id}` | ADM-003、011、013 |
| `PATCH /api/admin/products/{id}/stock` | ADM-004、011 |
| `DELETE /api/admin/products/cache` | ADM-008、013 |
| `GET /api/admin/orders` | ADM-005、011 |
| `POST /api/admin/orders/{orderNo}/ship` | ADM-009、011 |
| `POST /api/admin/orders/{orderNo}/deliver` | ADM-009、011 |
| `GET /api/admin/orders/stats` | ADM-006、014 |
| `GET /api/admin/payment/config` | ADM-010、011 |
| `PUT /api/admin/payment/config` | ADM-010 |

---

## 13. 附录 B：Phase 0 待对账项

以下问题会直接影响断言口径，实施前必须先定基线：

1. **`callbackId`**：`PaymentResponse` 当前无此字段，但现有 `payment.api.spec.ts` 断言了 `second.data.callbackId`。需确认是补字段还是改用 `tradeNo`/回调记录。
2. **OFF_SALE 商品可见性**：用户端列表/详情是否展示下架商品，`API.md` 未明确。
3. **refreshToken 是否旋转**：刷新后旧 refreshToken 是否失效，影响 AUTH-008/014。
4. **删除商品语义**：物理删除还是逻辑删除；删除后历史订单明细是否仍可查。
5. **空购物车清空**：`DELETE /api/cart` 在空车时返回成功还是 `40905`。
6. **BALANCE 支付**：是否需要预置余额，种子用户初始余额是多少。
7. **回调幂等边界**：同 callbackId 不同 status、不同 callbackId 同 tradeNo 的预期行为。
8. **`40900` 统计口径**：并发冲突属于预期业务结果，性能脚本和测试报告中的“错误率”需排除。

---

## 14. 附录 C：实施分批建议

| 批次 | 内容 | 用例 | 预计 |
|---|---|---|---|
| 第 1 批 | 框架增强 + M1/M2 P0 | AUTH、CAT 的 P0，共 14 条 | 2 天 |
| 第 2 批 | M3/M4 P0 | CART、ORD 的 P0，共 14 条 | 2 天 |
| 第 3 批 | M5/M6 P0 + CI 门禁 | PAY、ADM 的 P0，共 16 条 | 2 天 |
| 第 4 批 | P1 校验/权限/契约 | 47 条 | 3 天 |
| 第 5 批 | P2 并发/安全/一致性 | 44 条 | 3 天 |

> 第 1~3 批完成即为可 merge 的 P0 门禁（44 条，目标 ≤5 分钟）。

---

## 15. 附录 D：v1.1 对账修正记录

- 新增 5 条：AUTH-017、ORD-022、ORD-023、PAY-025、ADM-015。
- 修正 48 条断言口径，重点：
  - AUTH-005/015：新用户余额源码为 10000.00，不是 0。
  - AUTH-014：refresh 当 access 用当前实现返回 200，需按安全缺陷处理。
  - CART-009/ORD-023：空车清空/空车下单，API.md 写 40905，源码分别返回 200/40000。
  - ORD-014/PAY-009：已支付/已取消再支付，API.md 写 40904，源码返回 40906。
  - PAY-016/SEC-001：支付详情/列表/退款源码无归属校验，属高危越权。
  - PAY-017：PaymentResponse 不含 callbackId，现有用例断言错误。
  - PAY-019：idempotencyKey 源码未使用。
  - ADM-010：控制器无 @Valid，越界配置会被接受。
  - CTR-001/008：成功响应无 traceId；401/403 仅 code/message。
  - CTR-005：信封 timestamp 为 UTC Z；实体时间为 Asia/Shanghai LocalDateTime。
- 详细证据与待决策项见 `tests/API用例-文档对账报告.md`。
