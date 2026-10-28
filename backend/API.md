# target_demo 后端 API 接口文档

> 技术栈：Spring Boot 3（Java 17）+ Spring Security + Spring Data JPA + Redis + RabbitMQ
> 包路径：`com.demo.shop`
> 文档基于源码 `backend/src/main/java/com/demo/shop` 生成，与实现一一对应。

---

## 1. 概述

| 项 | 值 |
|---|---|
| 服务端口 | `8080`（`server.port`） |
| API 基址 | `http://localhost:8080/api` |
| OpenAPI / Swagger | `http://localhost:8080/swagger-ui.html`（`/v3/api-docs/**` 免登录） |
| 健康检查 | `http://localhost:8080/actuator/health` |
| 上下文路径 | 无（context path 未设置） |
| 字符集 / 内容类型 | `application/json; charset=UTF-8` |
| 会话策略 | 无状态（STATELESS），基于 JWT，关闭 CSRF |

### 1.1 鉴权与权限

采用 **JWT Bearer** 鉴权：

- 算法 `HS256`，密钥来自配置 `shop.jwt.secret`（默认测试密钥，生产务必替换）。
- 请求头：`Authorization: Bearer <accessToken>`。
- Token 中携带 `subject=用户名`、`role`、`uid=用户ID`；权限以 `ROLE_<role>` 形式注入（`ROLE_USER` / `ROLE_ADMIN`）。
- 有效期：`access-token-ttl-ms` 默认 **3600000 ms（1 小时）**；`refresh-token-ttl-ms` 默认 **86400000 ms（24 小时）**。

**URL 级访问控制**（`SecurityConfig`）：

| 匹配规则 | 权限 |
|---|---|
| `/api/auth/**` | 匿名可访问 |
| `GET /api/products/**`、`GET /api/categories/**` | 匿名可访问 |
| `/api/admin/**` | 需 `ROLE_ADMIN` |
| 其余 `/api/**` | 需登录（任意已认证用户） |
| `/actuator/health/**`、`/v3/api-docs/**`、`/swagger-ui/**` | 匿名可访问 |

> CORS 配置为 `allowedOriginPatterns=*`、`allowedMethods=*`、`allowCredentials=true`，本地前端（`localhost:8081`）跨域调试可直接调用。

### 1.2 统一响应结构

所有接口返回统一信封 `ApiResponse<T>`：

```json
{
  "code": 0,            // 0=成功；非 0 为业务/系统错误码（见 §1.4）
  "message": "success", // 成功固定 "success"，失败为错误描述
  "data": { },          // 业务数据（成功时存在，可为 null）
  "traceId": "a1b2c3d4e5f6a7b8", // 链路 ID，压测串联日志用
  "timestamp": "2026-10-28T01:00:00.123Z"
}
```

> 仅 `data` 字段为 `null` 时会被 `@JsonInclude(NON_NULL)` 省略。

**鉴权失败的特殊返回**：未登录 / 无权限时由 Security 直接写出与信封同形的 JSON（`code`/`message`），HTTP 状态码分别为 401 / 403：
```json
{"code":40100,"message":"未登录或登录已过期"}
{"code":40300,"message":"无权限访问"}
```

### 1.3 分页约定

列表类接口统一参数：`page`（从第 0 页起，默认 0）、`size`（默认 20）。
返回 `PageResponse<T>`：

```json
{
  "content": [ ... ],   // 当前页数据
  "page": 0,            // 当前页（0-based）
  "size": 20,           // 每页条数
  "total": 135,         // 总条数
  "totalPages": 7,      // 总页数
  "last": false         // 是否最后一页
}
```

### 1.4 业务错误码

| code | 含义 | HTTP |
|---|---|---|
| 0 | 成功 | 200 |
| 40000 | 请求参数错误（含 Bean Validation 校验失败） | 400 |
| 40100 | 未登录或登录已过期 | 401 |
| 40101 | 用户名或密码错误 | 401 |
| 40300 | 无权限访问 | 403 |
| 40400 | 资源不存在（通用） | 404 |
| 40401 | 商品不存在 | 404 |
| 40402 | 订单不存在 | 404 |
| 40403 | 支付单不存在 | 404 |
| 40900 | 并发冲突，请重试（乐观锁兜底） | 409 |
| 40901 | 用户名已存在 | 409 |
| 40902 | 商品已下架 | 409 |
| 40903 | 库存不足 | 409 |
| 40904 | 订单状态不允许该操作 | 409 |
| 40905 | 购物车为空 | 409 |
| 40906 | 支付单状态不允许该操作 | 409 |
| 40907 | 余额不足 | 409 |
| 50000 | 服务内部错误 | 500 |

> 测试脚本断言建议直接用 `code`，不依赖文案（文案可能调整）。

---

## 2. 数据模型（响应对象）

| 类型 | 字段 |
|---|---|
| **UserResponse** | `id`(Long), `username`(String), `nickname`(String), `email`(String), `role`(Role), `balance`(BigDecimal) |
| **LoginResponse** | `accessToken`(String), `refreshToken`(String), `tokenType`(固定 "Bearer"), `expiresIn`(Long, 秒), `userId`(Long), `username`(String), `role`(String) |
| **ProductResponse** | `id`(Long), `name`(String), `description`(String), `price`(BigDecimal), `stock`(Integer), `imageUrl`(String), `categoryId`(Long), `status`(String: `ON_SALE`/`OFF_SALE`), `cached`(Boolean, 详情接口走 Redis 时为 true) |
| **CategoryResponse** | `id`(Long), `name`(String), `description`(String), `sortOrder`(Integer) |
| **CartItemResponse** | `id`(Long), `productId`(Long), `productName`(String), `snapshotPrice`(BigDecimal), `quantity`(Integer), `subtotal`(BigDecimal), `availableStock`(Integer) |
| **CartResponse** | `items`(List\<CartItemResponse>), `totalAmount`(BigDecimal), `totalQuantity`(Integer) |
| **OrderItemResponse** | `id`(Long), `productId`(Long), `productName`(String), `price`(BigDecimal), `quantity`(Integer), `subtotal`(BigDecimal) |
| **OrderResponse** | `id`(Long), `orderNo`(String), `status`(OrderStatus), `totalAmount`(BigDecimal), `payAmount`(BigDecimal), `totalQuantity`(Integer), `receiverName`/`receiverPhone`/`receiverAddress`(String), `remark`(String), `items`(List\<OrderItemResponse>), `createdAt`/`updatedAt`(LocalDateTime) |
| **PaymentResponse** | `tradeNo`(String), `orderNo`(String), `payType`(PayType), `status`(PaymentStatus), `amount`(BigDecimal), `gatewayCode`(String), `gatewayMessage`(String), `createdAt`/`updatedAt`(LocalDateTime) |
| **PaymentConfigResponse** | `failureRate`(Double), `timeoutRate`(Double), `minDelayMs`(Integer), `maxDelayMs`(Integer), `asyncEnabled`(Boolean) |
| **PageResponse\<T>** | 见 §1.3 |

### 2.1 枚举值

| 枚举 | 取值 |
|---|---|
| **Role** | `USER`, `ADMIN` |
| **Product.status** | `ON_SALE`, `OFF_SALE` |
| **OrderStatus** | `PENDING_PAYMENT`, `PAYING`, `PAID`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `PAY_FAILED` |
| **PaymentStatus** | `PROCESSING`, `SUCCESS`, `FAILED`, `TIMEOUT`, `REFUNDED`, `CLOSED` |
| **PayType** | `ALIPAY`, `WECHAT`, `CARD`, `BALANCE` |
| **PaymentOutcome** | `SUCCESS`, `FAILED`, `TIMEOUT`, `RANDOM`（仅 mock 支付强制结果用） |

### 2.2 请求对象（入参）

| 类型 | 字段（约束） |
|---|---|
| **RegisterRequest** | `username`(3–64, 必填), `password`(6–128, 必填), `email`(Email 格式), `nickname`(≤64) |
| **LoginRequest** | `username`(≤64, 必填), `password`(≤128, 必填) |
| **CreateOrderRequest** | `items`(List\<OrderItemReq>, `OrderItemReq{productId(Long,必填), quantity(Integer≥1,必填)}`), `receiverName`, `receiverPhone`, `receiverAddress`, `remark`(String), `fromCart`(Boolean, 默认 false：true 时忽略 items、用购物车全部商品下单) |
| **CartItemRequest** | `productId`(Long, 必填), `quantity`(Integer≥1, 必填) |
| **PayRequest** | `orderNo`(String, 必填), `payType`(PayType), `outcome`(PaymentOutcome, 不传则按失败率/超时率随机), `idempotencyKey`(String, 幂等键) |
| **ProductUpsertRequest** | `name`(必填), `description`, `price`(BigDecimal>0, 必填), `stock`(Integer, 必填), `imageUrl`, `categoryId`(Long), `status`(默认 "ON_SALE") |
| **StockAdjustRequest** | `delta`(Integer, 必填, 可正可负) |
| **PaymentConfigRequest** | `failureRate`(Double 0–1), `timeoutRate`(Double 0–1), `minDelayMs`(Integer≥0), `maxDelayMs`(Integer≥0), `asyncEnabled`(Boolean) |
| **refresh / 数量更新** | 部分接口使用裸 `Map`：`POST /api/auth/refresh` → `{"refreshToken":"..."}`；`PUT /api/cart/items/{productId}` → `{"quantity": N}` |

---

## 3. 接口详述

> 标注 **🔓 匿名** 的接口无需登录；其余需 `Authorization: Bearer <token>`。
> 标注 **👑 管理员** 的接口需 `ROLE_ADMIN`。

### 3.1 认证 `AuthController` — `/api/auth` 🔓

#### POST `/api/auth/register`
注册新用户（默认角色 `USER`）。
- 请求体：`RegisterRequest`
- 响应：`ApiResponse<UserResponse>`
- 错误：`40901`（用户名已存在）、`40000`（参数校验）

#### POST `/api/auth/login`
登录并获取 JWT。
- 请求体：`LoginRequest`
- 响应：`ApiResponse<LoginResponse>`（`expiresIn` 单位秒，默认 3600）
- 错误：`40101`（用户名或密码错误）

#### POST `/api/auth/refresh`
用 refreshToken 换取新令牌对。
- 请求体（裸 JSON）：`{ "refreshToken": "eyJ..." }`
- 响应：`ApiResponse<LoginResponse>`

#### GET `/api/auth/me`
获取当前登录用户信息。
- 鉴权：需登录
- 响应：`ApiResponse<UserResponse>`

<details><summary>登录示例</summary>

```bash
curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
# => {"code":0,"message":"success","data":{"accessToken":"eyJ...","refreshToken":"eyJ...","tokenType":"Bearer","expiresIn":3600,"userId":1,"username":"admin","role":"ADMIN"},"traceId":"...","timestamp":"..."}
```
</details>

---

### 3.2 商品 `ProductController` — `/api/products` 🔓（GET 匿名）

#### GET `/api/products`
商品分页列表，支持关键字 / 分类筛选。
- 查询参数：`keyword`(String, 默认 "")、`categoryId`(Long, 可选)、`page`(默认 0)、`size`(默认 20)
- 响应：`ApiResponse<PageResponse<ProductResponse>>`

#### GET `/api/products/{id}`
商品详情（走 Redis 缓存，命中时 `cached=true`，便于观测缓存命中率）。
- 路径参数：`id`(Long)
- 响应：`ApiResponse<ProductResponse>`
- 错误：`40401`（商品不存在）

#### GET `/api/products/hot`
热销商品（压测热点数据场景）。
- 查询参数：`limit`(默认 10)
- 响应：`ApiResponse<List<ProductResponse>>`

---

### 3.3 分类 `CategoryController` — `/api/categories` 🔓（GET 匿名）

#### GET `/api/categories`
全部分类列表。
- 响应：`ApiResponse<List<CategoryResponse>>`

---

### 3.4 购物车 `CartController` — `/api/cart`（需登录，操作当前用户）

#### GET `/api/cart`
查看购物车。
- 响应：`ApiResponse<CartResponse>`

#### POST `/api/cart/items`
加入购物车。
- 请求体：`CartItemRequest`
- 响应：`ApiResponse<CartResponse>`
- 错误：`40401`（商品不存在）、`40902`（已下架）

#### PUT `/api/cart/items/{productId}`
修改购物车内某商品数量。
- 路径参数：`productId`(Long)
- 请求体（裸 JSON）：`{ "quantity": 3 }`
- 响应：`ApiResponse<CartResponse>`

#### DELETE `/api/cart/items/{productId}`
移除购物车内某商品。
- 路径参数：`productId`(Long)
- 响应：`ApiResponse<CartResponse>`

#### DELETE `/api/cart`
清空购物车。
- 响应：`ApiResponse<CartResponse>`
- 错误：`40905`（购物车为空时操作）

---

### 3.5 订单 `OrderController` — `/api/orders`（需登录，操作当前用户）

#### POST `/api/orders`
创建订单。
- 请求体：`CreateOrderRequest`（`fromCart=true` 时以购物车全部商品下单；否则用 `items` 直接下单）
- 响应：`ApiResponse<OrderResponse>`（初始状态 `PENDING_PAYMENT`）
- 错误：`40905`（购物车为空且未指定 items）、`40401`/`40903`（商品/库存问题）、`40900`（并发冲突）

#### GET `/api/orders/{orderNo}`
订单详情。
- 路径参数：`orderNo`(String)
- 响应：`ApiResponse<OrderResponse>`
- 错误：`40402`

#### GET `/api/orders`
当前用户订单列表。
- 查询参数：`status`(OrderStatus, 可选)、`page`(默认 0)、`size`(默认 20)
- 响应：`ApiResponse<PageResponse<OrderResponse>>`

#### POST `/api/orders/{orderNo}/cancel`
取消订单。
- 路径参数：`orderNo`(String)
- 响应：`ApiResponse<OrderResponse>`
- 错误：`40402`、`40904`（状态不允许取消，如已支付后只能退款）

#### GET `/api/orders/{orderNo}/status`
轮询订单状态（前端观察状态流转用）。
- 路径参数：`orderNo`(String)
- 响应：`ApiResponse<Map<String,Object>>` → `{ "orderNo":"...", "status":"PAID", "updatedAt":"..." }`

<details><summary>下单 → 支付 示例</summary>

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"tester","password":"123456"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")

# 直接下单
curl -s -X POST http://localhost:8080/api/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":1,"quantity":2}],"receiverName":"张三","receiverPhone":"13800000000","receiverAddress":"北京市..."}'
```
</details>

---

### 3.6 支付 `PaymentController` — `/api/payments`（需登录，操作当前用户）

> 支付为 **mock 网关**：可传 `outcome` 强制结果构造确定性测试场景，否则按 `PaymentConfig` 的失败率/超时率随机。

#### POST `/api/payments`
发起支付。
- 鉴权：需登录（绑定当前用户 `uid`）
- 请求体：`PayRequest`
- 响应：`ApiResponse<PaymentResponse>`（状态通常 `PROCESSING`/`SUCCESS`）
- 错误：`40402`（订单不存在）、`40904`（订单状态不允许支付）

#### GET `/api/payments/{tradeNo}`
查询支付单。
- 路径参数：`tradeNo`(String)
- 响应：`ApiResponse<PaymentResponse>`
- 错误：`40403`

#### GET `/api/payments`
按订单号查支付单列表。
- 查询参数：`orderNo`(String, **必填**)
- 响应：`ApiResponse<List<PaymentResponse>>`

#### POST `/api/payments/{tradeNo}/callback`
模拟第三方支付结果回调（**幂等**，重复 `callbackId` 返回同一支付单）。
- 路径参数：`tradeNo`(String)
- 查询参数：`status`(PaymentStatus, 必填)、`callbackId`(String, 可选)
- 响应：`ApiResponse<PaymentResponse>`

#### POST `/api/payments/{tradeNo}/refund`
退款。
- 路径参数：`tradeNo`(String)
- 响应：`ApiResponse<PaymentResponse>`
- 错误：`40403`、`40906`（支付单状态不允许退款）

---

### 3.7 管理端 · 商品 `AdminProductController` — `/api/admin/products` 👑

#### GET `/api/admin/products`
商品分页列表（管理视角，同用户端筛选参数）。
- 响应：`ApiResponse<PageResponse<ProductResponse>>`

#### POST `/api/admin/products`
新建商品。
- 请求体：`ProductUpsertRequest`
- 响应：`ApiResponse<ProductResponse>`
- 错误：`40000`（价格 ≤ 0 等校验）

#### PUT `/api/admin/products/{id}`
更新商品。
- 路径参数：`id`(Long)
- 请求体：`ProductUpsertRequest`
- 响应：`ApiResponse<ProductResponse>`

#### DELETE `/api/admin/products/{id}`
删除商品（物理/逻辑删除视实现）。
- 路径参数：`id`(Long)
- 响应：`ApiResponse<Boolean>`（true）

#### PATCH `/api/admin/products/{id}/stock`
调整库存（增量 `delta`，可正可负）。
- 路径参数：`id`(Long)
- 请求体：`StockAdjustRequest`（`delta`）
- 响应：`ApiResponse<ProductResponse>`
- 错误：`40401`、`40903`（扣减后为负等）

#### DELETE `/api/admin/products/cache`
清除商品缓存。
- 响应：`ApiResponse<Boolean>`（true）

---

### 3.8 管理端 · 订单 `AdminOrderController` — `/api/admin/orders` 👑

#### GET `/api/admin/orders`
全部订单列表（管理视角）。
- 查询参数：`status`(OrderStatus, 可选)、`page`(默认 0)、`size`(默认 20)
- 响应：`ApiResponse<PageResponse<OrderResponse>>`

#### POST `/api/admin/orders/{orderNo}/ship`
发货（订单 → `SHIPPED`）。
- 路径参数：`orderNo`(String)
- 响应：`ApiResponse<OrderResponse>`
- 错误：`40402`、`40904`

#### POST `/api/admin/orders/{orderNo}/deliver`
确认收货（订单 → `DELIVERED`）。
- 路径参数：`orderNo`(String)
- 响应：`ApiResponse<OrderResponse>`
- 错误：`40402`、`40904`

#### GET `/api/admin/orders/stats`
订单统计看板。
- 响应：`ApiResponse<Map<String,Object>>`（含各状态计数等指标）

---

### 3.9 管理端 · 支付配置 `AdminPaymentController` — `/api/admin/payment` 👑

#### GET `/api/admin/payment/config`
获取支付 mock 配置。
- 响应：`ApiResponse<PaymentConfigResponse>`

#### PUT `/api/admin/payment/config`
更新支付 mock 配置（失败率、超时率、延迟区间、是否异步）。
- 请求体：`PaymentConfigRequest`
- 响应：`ApiResponse<PaymentConfigResponse>`

---

## 4. 状态机与业务流程

### 4.1 订单状态流转
```
PENDING_PAYMENT ──(发起支付)──> PAYING ──(支付成功回调)──> PAID
                                               │
                              (支付失败/超时回调)│
                                               ▼
                                          PAY_FAILED
PAID ──(管理员发货)──> SHIPPED ──(确认收货)──> DELIVERED
PENDING_PAYMENT / PAYING ──(用户取消)──> CANCELLED
```
- 用户在 `PENDING_PAYMENT`/`PAYING` 可 `cancel`；`PAID` 之后需走退款。
- 管理员侧 `ship` / `deliver` 推进履约。

### 4.2 支付状态
```
PROCESSING ──(回调 SUCCESS)──> SUCCESS
PROCESSING ──(回调 FAILED)──> FAILED
PROCESSING ──(回调 TIMEOUT)──> TIMEOUT
SUCCESS ──(退款)──> REFUNDED
PROCESSING/SUCCESS/... ──(关单)──> CLOSED
```

---

## 5. 测试与压测要点

- **确定性支付**：`POST /api/payments` 传 `outcome=SUCCESS|FAILED|TIMEOUT` 可绕过随机失败率，构造可重复断言的用例；`PaymentOutcome.RANDOM` 与不传则按 `PaymentConfig` 概率。
- **幂等**：支付 `idempotencyKey` 与回调 `callbackId` 均支持重复请求返回同一结果，适合并发/重试测试。
- **缓存观测**：商品详情 `cached` 字段可验证 Redis 命中；管理端 `DELETE /api/admin/products/cache` 清缓存便于对比。
- **并发冲突**：高并发扣库存会触发乐观锁，`40900` 为预期正常响应（已映射为 409 而非 500），脚本不应将其计入错误率。
- **令牌刷新**：accessToken 过期用 `POST /api/auth/refresh` 续期，避免压测中途掉登录。
- **实时文档**：`/swagger-ui.html` 提供可交互的在线调试；`/actuator/health` 含 redis / rabbitmq 探针，可作就绪检查。

---

## 6. 端点速查表

| 方法 | 路径 | 匿名 | 管理员 | 说明 |
|---|---|:--:|:--:|---|
| POST | `/api/auth/register` | ✅ | | 注册 |
| POST | `/api/auth/login` | ✅ | | 登录取 JWT |
| POST | `/api/auth/refresh` | ✅ | | 刷新令牌 |
| GET | `/api/auth/me` | | | 当前用户 |
| GET | `/api/products` | ✅ | | 商品列表 |
| GET | `/api/products/{id}` | ✅ | | 商品详情 |
| GET | `/api/products/hot` | ✅ | | 热销 |
| GET | `/api/categories` | ✅ | | 分类 |
| GET | `/api/cart` | | | 购物车 |
| POST | `/api/cart/items` | | | 加购 |
| PUT | `/api/cart/items/{productId}` | | | 改数量 |
| DELETE | `/api/cart/items/{productId}` | | | 移除 |
| DELETE | `/api/cart` | | | 清空 |
| POST | `/api/orders` | | | 下单 |
| GET | `/api/orders/{orderNo}` | | | 订单详情 |
| GET | `/api/orders` | | | 我的订单 |
| POST | `/api/orders/{orderNo}/cancel` | | | 取消 |
| GET | `/api/orders/{orderNo}/status` | | | 状态轮询 |
| POST | `/api/payments` | | | 发起支付 |
| GET | `/api/payments/{tradeNo}` | | | 支付详情 |
| GET | `/api/payments` | | | 按订单查支付 |
| POST | `/api/payments/{tradeNo}/callback` | | | 支付回调(幂等) |
| POST | `/api/payments/{tradeNo}/refund` | | | 退款 |
| GET | `/api/admin/products` | | ✅ | 商品列表 |
| POST | `/api/admin/products` | | ✅ | 新建商品 |
| PUT | `/api/admin/products/{id}` | | ✅ | 更新商品 |
| DELETE | `/api/admin/products/{id}` | | ✅ | 删除商品 |
| PATCH | `/api/admin/products/{id}/stock` | | ✅ | 调库存 |
| DELETE | `/api/admin/products/cache` | | ✅ | 清缓存 |
| GET | `/api/admin/orders` | | ✅ | 订单列表 |
| POST | `/api/admin/orders/{orderNo}/ship` | | ✅ | 发货 |
| POST | `/api/admin/orders/{orderNo}/deliver` | | ✅ | 确认收货 |
| GET | `/api/admin/orders/stats` | | ✅ | 订单统计 |
| GET | `/api/admin/payment/config` | | ✅ | 支付配置 |
| PUT | `/api/admin/payment/config` | | ✅ | 改支付配置 |

---

*文档生成自 `target_demo/backend` 源码；若实现变更请以 `swagger-ui.html` 实时文档为准。*
