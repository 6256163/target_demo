# target_demo 接口测试用例 × API.md 对账报告

> 对账对象：`backend/API.md`（35 个端点）↔ `tests/API测试用例清单.md`
> 对账日期：2026-10-28 ｜ 对账版本：用例清单 v1.0 → v1.1
> 辅助证据：`backend/src/main/java` 源码审计 + 本地运行环境实测（见第 6 节）

---

## 1. 结论

**不能直接确认“零遗漏、零冲突”。** 对账结果分三层：

| 维度 | 结果 |
|---|---|
| 端点覆盖 | ✅ **35/35 全覆盖**，没有漏掉任何 API.md 中的端点 |
| 用例遗漏 | ❌ 发现 **5 条文档行为没有对应用例**，已补入 v1.1 |
| 用例与文档冲突/超出文档 | ❌ 发现 **20+ 处断言口径需要修正或标注**，已修入 v1.1 |
| API.md 与实现不一致 | ❌ 发现 **15 处以上**，其中 **2 个高危安全缺陷、4 个高优先级功能/契约缺陷**；这不是改用例能解决的，必须改代码或改文档 |

**一句话**：端点没漏，但原 v1.0 用例并非全部“有文档依据”；API.md 本身也有多处与实现不一致。v1.1 已把用例修正为“文档依据明确，或有明确待确认标记”，同时把文档/实现冲突单独列出，交由 Phase 0 决策。

---

## 2. 核对方法

1. 从 `API.md` §6 端点速查表提取 35 个端点（方法 + 路径）。
2. 从用例清单附录 A 提取端点覆盖矩阵，做集合对比。
3. 逐条核对用例断言与 `API.md` 的以下内容：
   - §1.1 鉴权、JWT claims、URL 权限、CORS；
   - §1.2 统一响应信封、401/403 特殊返回；
   - §1.3 分页约定；
   - §1.4 错误码与 HTTP 映射；
   - §2 响应/请求模型、字段约束、枚举；
   - §3 每个端点的参数、响应、错误码；
   - §4 订单/支付状态机；
   - §5 测试要点（确定性支付、幂等、缓存、并发、刷新、健康检查）。
4. 对文档未定义或存在歧义的行为，回到源码确认“实现事实”，再决定用例是“按文档断言”还是“标注待确认”。
5. 对关键冲突做最小化实测（不破坏环境，执行后恢复支付配置、清空购物车、取消测试订单）。

---

## 3. 端点覆盖核对

| 模块 | API.md 端点数 | 覆盖用例 | 结论 |
|---|---:|---|---|
| M1 认证鉴权 | 4 | AUTH-001~017 | ✅ 全覆盖 |
| M2 商品分类 | 4 | CAT-001~014 | ✅ 全覆盖 |
| M3 购物车 | 5 | CART-001~014 | ✅ 全覆盖 |
| M4 订单状态机 | 5 | ORD-001~023 | ✅ 全覆盖 |
| M5 支付退款 | 5 | PAY-001~025 | ✅ 全覆盖 |
| M6 管理端 | 12 | ADM-001~015 | ✅ 全覆盖 |
| **合计** | **35** | **140 条用例** | **✅ 35/35** |

> 说明：M7 契约、M8 安全、M9 并发、M10 一致性是跨端点专项，不单独增加端点，但会覆盖多个端点的组合行为。

**端点层面结论：无遗漏。**

---

## 4. 原 v1.0 遗漏的文档行为（已补 5 条）

| # | API.md 依据 | 遗漏内容 | 新增用例 |
|---|---|---|---|
| 1 | §1.1 Token 携带 `subject`、`role`、`uid` | 只验证了登录响应，没有解码 JWT 验证 claims 与 TTL | **AUTH-017** |
| 2 | §2.2 / §3.5 `fromCart=true` 时忽略 `items` | 只测了“用购物车下单”，没测“同时传 items 时 items 被忽略” | **ORD-022** |
| 3 | §3.5 购物车为空且未指定 items → 40905 | 没有测 `fromCart=true` + 空购物车 | **ORD-023** |
| 4 | §5 `outcome` 可绕过失败率/超时率 | 只测了 `outcome` 本身，没测“全局 failureRate=1 时 outcome=SUCCESS 仍成功” | **PAY-025** |
| 5 | §2.2 `ProductUpsertRequest`：name 必填、price>0、stock 必填 | 只测了正常 CRUD，没测字段校验 | **ADM-015** |

另有 8 个文档行为已并入现有用例，不再单列：

| 文档行为 | 并入用例 |
|---|---|
| `LoginResponse.expiresIn` 单位为秒 | AUTH-001、AUTH-017 |
| `OrderStatus.PAYING` 中间态 | ORD-007、ORD-020 |
| `PaymentStatus.PROCESSING` 中间态 | PAY-001、PAY-005 |
| `PaymentStatus.CLOSED` | ORD-021 |
| 订单 `remark` 字段 | ORD-001 |
| 管理端删除/清缓存返回 `Boolean true` | ADM-003、ADM-008 |
| `data=null` 时省略 | CTR-001 |
| 401/403 特殊响应体 | CTR-001、CTR-003、CTR-008 |

---

## 5. 原 v1.0 与 API.md 冲突/超出文档的用例（已修）

### 5.1 实质性错误（断言与实现或文档不一致）

| 用例 | 原断言 | 事实 | 修正 |
|---|---|---|---|
| AUTH-005 | 注册后 `balance=0` | 源码 `AuthService.register` 设为 **10000.00** | 改为 10000.00 |
| AUTH-015 | mass assignment 后 `balance=0` | 同上 | 改为 10000.00 |
| AUTH-014 | refresh 与 access 混用应 401 | 实测 refreshToken 当 access 用返回 **200** | 标注“安全缺陷，Phase 0 确认” |
| ORD-014 | 已支付/已取消再支付 40904 | 源码 `PaymentService.pay` 返回 **40906** | 标注文档/实现冲突 |
| PAY-009 | 已支付/已取消支付 40904 | 同上，实际 **40906** | 标注冲突 |
| PAY-016 | 管理员可查他人支付 | **没有管理员支付查询端点**；且源码支付详情/列表/退款无归属校验 | 改为“他人应 403；源码存在严重越权” |
| PAY-017 | 断言 `callbackId` | `PaymentResponse` 无该字段 | 改为“响应不得含 callbackId”，现有测试需修 |
| ADM-010 | 越界配置返回 40000 | 控制器无 `@Valid`，实测 `failureRate=2.0` 被接受 | 标注“缺陷” |
| SEC-009 | “非白名单 Origin” | API.md 明确 `allowedOriginPatterns=*` | 改为通配符语义 |
| CTR-001/008 | 每个响应都有 traceId | 成功响应无 traceId；401/403 仅 code/message | 按成功/错误/安全三类分别断言 |
| CTR-005 | 所有时间都是 Asia/Shanghai | 信封 `timestamp` 是 **UTC Instant（Z）**；实体时间是 LocalDateTime | 分开断言 |

### 5.2 超出 API.md 定义（已标注“待确认/实现约定”）

| 用例 | 原断言 | API.md 状态 | 修正 |
|---|---|---|---|
| CAT-003 | sortOrder 升序 | 未定义排序 | 改为“按实现记录，源码 findAll 未排序” |
| CAT-007 | size=0/-1 返回 40000 | 未定义 | 实测 500，标注“缺陷候选” |
| CAT-011 | OFF_SALE 是否可见 | 未定义 | 标注“Phase 0 定基线” |
| CART-003 | 重复加购累加 | 未定义 | 标注“源码累加，需固化” |
| CART-007 | 加购超库存 40903 | 购物车错误码只列 40401/40902 | 标注“40903 为实现行为” |
| CART-008 | 修改超库存应报错 | 未定义 | 源码允许超库存，标注“缺陷候选” |
| CART-011 | 改价后快照价保持 | 未定义 | 标注“源码保存 snapshotPrice，需确认” |
| ORD-001 | payAmount=总额 | 未明写相等 | 改为“源码相等，需文档固化” |
| ORD-002 | 下单后清空购物车 | 未明写 | 标注“源码清空，需文档固化” |
| ORD-009 | 收货信息超长 40000 | 无长度约束 | 标注“源码无校验” |
| ORD-012 | 管理员可查用户订单 | 未文档化 | 标注“源码 assertOwnership 放行” |
| ADM-003 | 删除后历史订单明细仍可查 | 删除语义未定义 | 标注“源码物理删除，订单快照仍在” |
| ADM-006 | 统计字段名 | 只写“含各状态计数等” | 改为“先探明枚举名+totalOrders” |
| CART-009 | 空车清空 40905 | API.md 写 40905 | 实测 200，标注冲突 |
| ORD-023 | 空车下单 40905 | API.md 写 40905 | 实测 40000，标注冲突 |

> 这类“超出文档”不是用例写错，而是 **API.md 没有定义**。v1.1 保留测试意图，但把断言改成“可验证的约定 + 待确认标记”，避免把实现细节当成文档事实。

---

## 6. API.md 与实现不一致（需 Phase 0 决策）

### 6.1 高危（建议立即修代码）

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| 1 | **支付越权**：`GET /api/payments/{tradeNo}`、`GET /api/payments?orderNo=`、`POST /api/payments/{tradeNo}/refund` 均未校验支付单归属 | `PaymentService.get/listByOrder/refund` 只按 tradeNo/orderNo 查询，未比较 `userId` | 任意登录用户可读他人支付单、按订单枚举支付记录、甚至退款他人已支付订单 | 修代码：三个方法增加 `payment.getUserId().equals(CurrentUser.id())`；管理员按角色放行 |
| 2 | **refreshToken 可当 accessToken 使用** | `AuthService.refresh` 未校验 `typ`；`JwtAuthenticationFilter` 解析 refresh 后 role 为 null，仍建立认证；实测 `/api/auth/me` 返回 200 | 令牌类型边界失效，refresh 泄露即可直接访问业务接口 | 修代码：refresh 校验 `typ=refresh`；access 校验 `typ=access`；过滤器拒绝无 role 的 token |

### 6.2 高优先级（功能/契约）

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| 3 | **`idempotencyKey` 未实现** | `PayRequest` 有字段，`PaymentService.pay` 完全未使用；仅靠订单 `PAYING` + `PROCESSING` 去重 | 同一 key 重复/并发支付可能生成多条支付单，违背 API.md §5 承诺 | 代码实现 key 唯一约束，或从 API.md 删除该承诺 |
| 4 | **支付配置越界不校验** | `AdminPaymentController.updateConfig` 无 `@Valid`；实测 `failureRate=2.0` 返回 200 并落库 | 失败率/超时率可 >1，随机支付行为异常 | 加 `@Valid`；补 `minDelayMs<=maxDelayMs` 文档 |
| 5 | **支付 orderNo 缺失返回 40402** | `PaymentController.pay` 无 `@Valid`；实测 `{}` → 404/40402 | 与 API.md “orderNo 必填/40000”不符；错误码误导 | 加 `@Valid`，统一 40000 |
| 6 | **成功响应无 traceId** | `ApiResponse.ok()` 未设置 traceId；实测 `/api/products` 无 traceId，只有错误响应有 | API.md 示例与 CTR-008 的“全链路 traceId”不成立 | 在 `ok()` 或全局过滤器中统一生成 traceId |
| 7 | **401/403 中文乱码且无 traceId/timestamp** | `SecurityConfig` 直接写 `application/json` 无 charset；实测 `message` 为 `?????????` | 前端/测试无法断言文案；安全响应与信封不一致 | 设置 `application/json;charset=UTF-8`，并统一信封字段 |
| 8 | **退款后订单 CANCELLED 未画进状态机** | `PaymentService.refund → OrderService.markRefunded` 设为 CANCELLED；API.md §4.1 只画 PENDING_PAYMENT/PAYING→CANCELLED | 文档读者会认为 PAID 不能取消 | 在 §4.1 补 `PAID --退款--> CANCELLED` |
| 9 | **自动关单未文档化；CLOSED 未实现** | `RabbitConfig`/`OrderCompensationJob` 有自动关单；`PaymentStatus.CLOSED` 全仓库无赋值 | API.md §4.2 的 CLOSED 是死状态；ORD-021 无法断言支付单 CLOSED | 补自动关单说明；实现或删除 CLOSED |
| 10 | **空车清空/空车下单错误码不一致** | API.md 写 40905；实测 `DELETE /api/cart` 空车 200，`fromCart=true` 空车 40000 | 用例与实现必有一方错 | 统一定义：空车清空幂等 200，空车下单 40000/40905 二选一 |
| 11 | **已支付/已取消再支付错误码不一致** | API.md §3.6 写 40904；源码 `pay()` 抛 40906 | 支付错误码断言不稳定 | 统一为 40904 或 40906，并改文档 |

### 6.3 中低优先级（文档/实现细节）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| 12 | 购物车累计加购/修改可超库存 | 实测 100000+1=100001 成功；update 200000 成功 | 补库存校验，或明确“购物车不校验库存，下单才校验” |
| 13 | 修改数量缺 `quantity` 返回 500/NPE | `CartController.update` 用裸 Map；实测 `{}` → 50000 | 加参数校验，返回 40000 |
| 14 | 分类列表未按 sortOrder 排序 | `CategoryController` 直接 `findAll()` | 明确排序契约或去掉 sortOrder 的排序预期 |
| 15 | `/api/auth/**` 匿名与 `/api/auth/me` 需登录自相矛盾 | §1.1 表写 `/api/auth/**` 匿名；§3.1 写 me 需登录；实现是 URL permitAll + service 401 | 文档改成“register/login/refresh 匿名，me 需登录” |
| 16 | `@JsonInclude(NON_NULL)` 也会省略 traceId | API.md 说“仅 data 省略” | 文档改为“data/traceId 为空时省略” |
| 17 | 信封 timestamp 为 UTC Z，实体时间为本地 | 实测订单 `createdAt=2026-10-28T21:11:57`，信封 `timestamp=...Z` | 文档分别说明两种时间格式 |
| 18 | 管理员可读用户订单但未文档化 | `assertOwnership` 对 admin 放行 | 在 §3.5 注明管理员可跨用户查询，或收回该能力 |
| 19 | 删除商品为物理删除，语义未文档化 | `ProductService.delete` 直接 `delete` | 文档明确物理/逻辑删除及历史订单快照策略 |
| 20 | `PaymentOutcome.RANDOM` 与不传的语义 | `decideOutcome` 把 RANDOM 当随机 | 文档补充 RANDOM 等价于不传 |

---

## 7. 本轮实测证据（最小化，已恢复现场）

| 探针 | 结果 | 对应结论 |
|---|---|---|
| `GET /api/products?page=0&size=1` | 200，成功响应 **无 traceId**，`timestamp` 带 `Z` | 6.2-#6、6.3-#17 |
| `GET /api/products/99999999` | 404/40401，**有 traceId** | 错误响应才有 traceId |
| `GET /api/cart` 未带 token | 401/40100，`message` 为 `?????????`，无 timestamp/traceId | 6.2-#7 |
| `POST /api/orders` `{"fromCart":true}` 空车 | 40000“下单商品不能为空” | 6.2-#10 |
| `POST /api/orders` `{"items":[]}` | 40000 | 6.2-#10 |
| `DELETE /api/cart` 空车 | 200/code=0 | 6.2-#10 |
| `POST /api/payments` `{}` | 404/40402 | 6.2-#5 |
| refreshToken 当 access 调 `/api/auth/me` | **200** | 6.1-#2 |
| `GET /api/products?size=0` | 500/50000 “Page size must not be less than one” | 5.2-CAT-007 |
| `PUT /api/admin/payment/config` `failureRate=2.0` | 200 并接受 | 6.2-#4 |
| 加购 100000 后再加 1 | 200，totalQuantity=100001（库存 100000） | 6.3-#12 |
| 修改购物车数量为 200000 | 200 成功 | 6.3-#12 |
| 修改购物车 `{}`（缺 quantity） | 500/50000 NPE | 6.3-#13 |

> 现场恢复：测试订单已取消（库存回滚）、购物车已清空、支付配置已恢复原值（`0.05/0.03/300/2000/true`）。

---

## 8. 修正后的用例清单统计（v1.1）

| 项 | 数值 |
|---|---:|
| 总用例 | **140** |
| P0 | 44 |
| P1 | 52 |
| P2 | 44 |
| 端点覆盖 | **35/35** |
| 重复 ID | 0 |
| 无层级/优先级 | 0 |

模块分布：

| 模块 | P0 | P1 | P2 | 合计 |
|---|---:|---:|---:|---:|
| M1 认证鉴权 | 8 | 7 | 2 | 17 |
| M2 商品分类 | 6 | 6 | 2 | 14 |
| M3 购物车 | 6 | 4 | 4 | 14 |
| M4 订单状态机 | 8 | 11 | 4 | 23 |
| M5 支付退款 | 10 | 9 | 6 | 25 |
| M6 管理端 | 6 | 7 | 2 | 15 |
| M7 契约 | 0 | 8 | 0 | 8 |
| M8 安全 | 0 | 0 | 10 | 10 |
| M9 并发幂等 | 0 | 0 | 8 | 8 |
| M10 数据一致性 | 0 | 0 | 6 | 6 |

---

## 9. Phase 0 必须做的决策

建议按以下顺序处理，不要直接用“现有实现”反向改测试，否则会把缺陷固化成预期：

1. **先修 2 个高危安全缺陷**：支付越权（详情/列表/退款）、refresh 当 access。
2. **再定 3 个契约口径**：成功响应是否补 traceId；401/403 是否统一信封+UTF-8；`ApiResponse` 省略规则。
3. **再定 4 个错误码**：空车清空、空车下单、已支付/已取消再支付、支付 orderNo 缺失。
4. **再定 4 个功能边界**：`idempotencyKey` 是否实现、支付配置是否加 `@Valid`、购物车是否校验库存、`CLOSED` 是否保留。
5. **最后改文档**：退款状态机、自动关单、管理员跨用户查询、删除语义、时间格式、CORS 通配符。
6. 决策完成后，按 v1.1 用例执行；对“已知缺陷”用例先红后绿，不要删除。

---

## 10. 最终判断

- **端点覆盖：通过**，35/35，确实没有遗漏任何 API.md 端点。
- **用例与文档一致性：原 v1.0 不通过**，已通过 v1.1 修正为“有文档依据或明确待确认”。
- **API.md 与实现一致性：不通过**，存在 2 个高危 + 4 个高优先级 + 多个中低优先级差异。
- **建议**：Phase 0 先做“代码/文档口径决策”，再进入 P0 自动化实现；否则用例会不断在“按文档断言”与“按实现断言”之间摇摆。

> 相关文件：
> - 用例清单：`tests/API测试用例清单.md`（v1.1，140 条）
> - 本对账报告：`tests/API用例-文档对账报告.md`
