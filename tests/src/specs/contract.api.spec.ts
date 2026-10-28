import { test, expect, credentials, uniq } from '../fixtures'
import type { ApiResult } from '../clients/api.client'

const RECEIVER = {
  receiverName: '赵六',
  receiverPhone: '13600000000',
  receiverAddress: '深圳市南山区测试路 4 号'
}

const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']
const PAYMENT_STATUSES = ['PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'REFUNDED', 'CLOSED']
const PAY_TYPES = ['ALIPAY', 'WECHAT', 'CARD', 'BALANCE']
const OUTCOMES = ['SUCCESS', 'FAILED', 'TIMEOUT', 'RANDOM']

const DOCUMENTED_OPERATIONS = [
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'GET /api/auth/me',
  'GET /api/products',
  'GET /api/products/{id}',
  'GET /api/products/hot',
  'GET /api/categories',
  'GET /api/cart',
  'POST /api/cart/items',
  'PUT /api/cart/items/{productId}',
  'DELETE /api/cart/items/{productId}',
  'DELETE /api/cart',
  'POST /api/orders',
  'GET /api/orders/{orderNo}',
  'GET /api/orders',
  'POST /api/orders/{orderNo}/cancel',
  'GET /api/orders/{orderNo}/status',
  'POST /api/payments',
  'GET /api/payments/{tradeNo}',
  'GET /api/payments',
  'POST /api/payments/{tradeNo}/callback',
  'POST /api/payments/{tradeNo}/refund',
  'GET /api/admin/products',
  'POST /api/admin/products',
  'PUT /api/admin/products/{id}',
  'DELETE /api/admin/products/{id}',
  'PATCH /api/admin/products/{id}/stock',
  'DELETE /api/admin/products/cache',
  'GET /api/admin/orders',
  'POST /api/admin/orders/{orderNo}/ship',
  'POST /api/admin/orders/{orderNo}/deliver',
  'GET /api/admin/orders/stats',
  'GET /api/admin/payment/config',
  'PUT /api/admin/payment/config'
]

function expectLocalDateTime(value: any, label: string) {
  expect(typeof value, `${label} 应为字符串`).toBe('string')
  expect(value, `${label} 应为无时区的 LocalDateTime`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/)
}

function checkMapping(label: string, res: ApiResult, status: number, code: number) {
  expect.soft(res.status, `${label} 应 HTTP ${status}`).toBe(status)
  expect.soft(res.code, `${label} 应返回 code=${code}`).toBe(code)
}

test.describe('M7 契约（L0）', () => {
  test('[CTR-001][P1][L0] 统一响应信封：成功/业务错误/401/403 @p1 @l0 @m7', async ({ api, freshUser }) => {
    const ok = await api.listProducts({ size: 1 })
    expect(ok.status).toBe(200)
    expect(ok.raw.code).toBe(0)
    expect(ok.raw.message, '成功 message 固定 success').toBe('success')
    expect(ok.raw).toHaveProperty('data')
    expect(typeof ok.raw.timestamp).toBe('string')
    expect.soft(typeof ok.raw.traceId, 'API.md §1.2 成功信封包含 traceId').toBe('string')

    const error = await api.productDetail(99999999)
    expect(error.status).toBe(404)
    expect(error.raw.code).toBe(40401)
    expect(typeof error.raw.message).toBe('string')
    expect(typeof error.raw.traceId, '业务错误必须携带 traceId').toBe('string')
    expect(error.raw).not.toHaveProperty('data')
    expect(typeof error.raw.timestamp).toBe('string')

    const anonymous = await api.raw('GET', '/api/cart', { token: false })
    expect(anonymous.status).toBe(401)
    expect(anonymous.code).toBe(40100)
    expect(Object.keys(anonymous.raw).sort(), 'API.md §1.2：401 仅 code/message').toEqual(['code', 'message'])

    const forbidden = await freshUser.client.adminProducts()
    expect(forbidden.status).toBe(403)
    expect(forbidden.code).toBe(40300)
    expect(Object.keys(forbidden.raw).sort(), 'API.md §1.2：403 仅 code/message').toEqual(['code', 'message'])
  })

  test('[CTR-002][P1][L0] 分页结构：page/size/total/totalPages/last 语义 @p1 @l0 @m7', async ({ api, products }) => {
    const categoryId = 700000 + Math.floor(Math.random() * 200000)
    for (let i = 0; i < 5; i++) {
      await products.create({ categoryId })
    }

    const first = await api.listProducts({ categoryId, page: 0, size: 2 })
    expect(first.code).toBe(0)
    expect(first.data.total).toBe(5)
    expect(first.data.page).toBe(0)
    expect(first.data.size).toBe(2)
    expect(first.data.totalPages).toBe(3)
    expect(first.data.last).toBe(false)
    expect(first.data.content).toHaveLength(2)

    const middle = await api.listProducts({ categoryId, page: 1, size: 2 })
    expect(middle.data.page).toBe(1)
    expect(middle.data.totalPages).toBe(3)
    expect(middle.data.last).toBe(false)
    expect(middle.data.content).toHaveLength(2)

    const last = await api.listProducts({ categoryId, page: 2, size: 2 })
    expect(last.data.last).toBe(true)
    expect(last.data.content).toHaveLength(1)

    const beyond = await api.listProducts({ categoryId, page: 99, size: 2 })
    expect(beyond.data.content).toEqual([])
    expect(beyond.data.last).toBe(true)
    expect(beyond.data.total).toBe(5)

    const huge = await api.listProducts({ categoryId, page: 0, size: 10000 })
    expect(huge.code).toBe(0)
    expect(huge.data.size).toBeLessThanOrEqual(10000)
    test.info().annotations.push({
      type: 'observed',
      description: `size=10000 被收敛为 ${huge.data.size}（API.md §1.3 未定义 size 上限）`
    })

    const empty = await api.listProducts({ categoryId: 99999997 })
    expect(empty.code).toBe(0)
    expect(empty.data.total).toBe(0)
    expect(empty.data.totalPages).toBe(0)
    expect(empty.data.last).toBe(true)
    expect(empty.data.content).toEqual([])
  })

  test('[CTR-003][P1][L0] 错误码与 HTTP 映射符合 §1.4 @p1 @l0 @m7', async ({ api, freshUser, products }) => {
    const user = freshUser.client
    const product = await products.create({ price: 10, stock: 20 })

    // 40400：购物车中不存在该商品
    checkMapping('40400 资源不存在', await user.cartUpdate(product.id, 1), 404, 40400)
    // 40905：空购物车清空（API.md §3.4 要求 409）
    checkMapping('40905 购物车为空', await user.cartClear(), 409, 40905)

    checkMapping('40000 参数校验', await api.register('ab', 'Passw0rd!'), 400, 40000)

    const anonymous = await api.raw('GET', '/api/cart', { token: false })
    checkMapping('40100 未登录', anonymous, 401, 40100)
    expect.soft(anonymous.raw.message, 'API.md §1.2：401 message 应为可读中文').toBe('未登录或登录已过期')

    checkMapping('40101 凭证错误', await api.login(credentials.USER.name, 'wrong-password'), 401, 40101)

    const forbidden = await user.adminProducts()
    checkMapping('40300 无权限', forbidden, 403, 40300)
    expect.soft(forbidden.raw.message, 'API.md §1.2：403 message 应为可读中文').toBe('无权限访问')

    checkMapping('40401 商品不存在', await api.productDetail(99999999), 404, 40401)
    checkMapping('40402 订单不存在', await user.getOrder('NO_SUCH_ORDER'), 404, 40402)
    checkMapping('40403 支付单不存在', await user.paymentDetail('NO_SUCH_TRADE'), 404, 40403)

    const duplicate = uniq('dup')
    expect((await api.register(duplicate, 'Passw0rd!')).code).toBe(0)
    checkMapping('40901 用户名已存在', await api.register(duplicate, 'Passw0rd!'), 409, 40901)

    const offSale = await products.create({ status: 'OFF_SALE', stock: 5 })
    checkMapping('40902 商品已下架', await user.cartAdd(offSale.id, 1), 409, 40902)

    const scarce = await products.create({ stock: 1 })
    checkMapping(
      '40903 库存不足',
      await user.createOrder({ items: [{ productId: scarce.id, quantity: 2 }], ...RECEIVER }),
      409,
      40903
    )

    const paidOrder = await user.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    const paid = await user.pay({ orderNo: paidOrder.data.orderNo, outcome: 'SUCCESS' })
    await user.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await user.waitForOrderStatus(paidOrder.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])
    checkMapping('40904 订单状态不允许', await user.cancelOrder(paidOrder.data.orderNo), 409, 40904)

    const timeoutOrder = await user.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    const timeout = await user.pay({ orderNo: timeoutOrder.data.orderNo, outcome: 'TIMEOUT' })
    await user.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])
    checkMapping('40906 支付单状态不允许', await user.refund(timeout.data.tradeNo), 409, 40906)

    const expensive = await products.create({ price: 20000, stock: 1 })
    const expensiveOrder = await user.createOrder({ items: [{ productId: expensive.id, quantity: 1 }], ...RECEIVER })
    checkMapping(
      '40907 余额不足',
      await user.pay({ orderNo: expensiveOrder.data.orderNo, payType: 'BALANCE', outcome: 'SUCCESS' }),
      409,
      40907
    )

    test.info().annotations.push({
      type: 'observed',
      description: '50000 无自然触发路径（业务异常均有明确错误码），本轮不以故意制造 500 的方式覆盖'
    })
  })

  test('[CTR-004][P1][L0] 枚举与字段类型：Role/OrderStatus/PaymentStatus/PayType @p1 @l0 @m7', async ({ api, freshUser, products }) => {
    const openapi = await api.raw('GET', '/v3/api-docs', { token: false })
    const schemas = openapi.raw.components.schemas

    expect(schemas.UserResponse.properties.role.enum).toEqual(['USER', 'ADMIN'])
    expect(schemas.OrderResponse.properties.status.enum).toEqual(ORDER_STATUSES)
    expect(schemas.PaymentResponse.properties.status.enum).toEqual(PAYMENT_STATUSES)
    expect(schemas.PaymentResponse.properties.payType.enum).toEqual(PAY_TYPES)
    expect(schemas.PayRequest.properties.outcome.enum).toEqual(OUTCOMES)
    expect(schemas.PayRequest.properties.payType.enum).toEqual(PAY_TYPES)

    const login = await api.login(credentials.USER.name, credentials.USER.pass)
    expect(['USER', 'ADMIN']).toContain(login.data.role)
    const adminLogin = await api.login(credentials.ADMIN.name, credentials.ADMIN.pass)
    expect(adminLogin.data.role).toBe('ADMIN')

    const product = await products.create({ price: 10, stock: 20 })
    const productDetail = await api.productDetail(product.id)
    expect(['ON_SALE', 'OFF_SALE']).toContain(productDetail.data.status)

    const observedOrderStatuses = new Set<string>()
    const pending = await freshUser.client.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    observedOrderStatuses.add(pending.data.status)
    const cancelled = await freshUser.client.cancelOrder(pending.data.orderNo)
    observedOrderStatuses.add(cancelled.data.status)

    const failedOrder = await freshUser.client.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    const failedPay = await freshUser.client.pay({ orderNo: failedOrder.data.orderNo, outcome: 'FAILED' })
    observedOrderStatuses.add((await freshUser.client.waitForOrderStatus(failedOrder.data.orderNo, ['PAY_FAILED'])))
    expect(failedPay.code).toBe(0)

    for (const status of observedOrderStatuses) {
      expect(ORDER_STATUSES, `订单状态 ${status} 必须在文档枚举内`).toContain(status)
    }
    expect([...observedOrderStatuses]).toEqual(expect.arrayContaining(['PENDING_PAYMENT', 'CANCELLED', 'PAY_FAILED']))

    const observedPaymentStatuses = new Set<string>()
    observedPaymentStatuses.add(failedPay.data.status)
    await freshUser.client.waitForPaymentStatus(failedPay.data.tradeNo, ['FAILED'])
    observedPaymentStatuses.add((await freshUser.client.paymentDetail(failedPay.data.tradeNo)).data.status)

    const successOrder = await freshUser.client.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    const successPay = await freshUser.client.pay({ orderNo: successOrder.data.orderNo, outcome: 'SUCCESS', payType: 'WECHAT' })
    expect(PAY_TYPES).toContain(successPay.data.payType)
    observedPaymentStatuses.add(successPay.data.status)
    await freshUser.client.waitForPaymentStatus(successPay.data.tradeNo, ['SUCCESS'])
    observedPaymentStatuses.add((await freshUser.client.paymentDetail(successPay.data.tradeNo)).data.status)
    const refunded = await freshUser.client.refund(successPay.data.tradeNo)
    observedPaymentStatuses.add(refunded.data.status)

    for (const status of observedPaymentStatuses) {
      expect(PAYMENT_STATUSES, `支付状态 ${status} 必须在文档枚举内`).toContain(status)
    }
    expect([...observedPaymentStatuses]).toEqual(
      expect.arrayContaining(['PROCESSING', 'FAILED', 'SUCCESS', 'REFUNDED'])
    )

    test.info().annotations.push({
      type: 'observed',
      description: 'ProductUpsertRequest.status 在 OpenAPI 中仅有 type=string、无 enum，且实现接受任意字符串（见 ADM-015），属于契约缺口'
    })
  })

  test('[CTR-005][P1][L0] 金额与时间格式：信封 Instant UTC、实体 LocalDateTime @p1 @l0 @m7', async ({ api, freshUser, products }) => {
    const product = await products.create({ price: 23.45, stock: 10 })
    const detail = await api.productDetail(product.id)
    expect(typeof detail.data.price).toBe('number')
    expect(Number(detail.data.price)).toBeCloseTo(23.45, 2)
    const decimals = JSON.stringify(detail.data.price).split('.')[1]
    expect(decimals === undefined || decimals.length <= 2, '金额最多保留 2 位小数').toBe(true)

    const order = await freshUser.client.createOrder({
      items: [{ productId: product.id, quantity: 3 }],
      ...RECEIVER
    })
    expect(order.code).toBe(0)
    expect(Number(order.data.totalAmount)).toBeCloseTo(70.35, 2)
    expect(Number(order.data.payAmount)).toBeCloseTo(70.35, 2)

    const envelopeTimestamp = order.raw.timestamp
    expect(envelopeTimestamp, 'API.md §1.2：信封 timestamp 为 Instant UTC（Z 结尾）').toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
    )
    expect(Number.isNaN(Date.parse(envelopeTimestamp)), '信封 timestamp 必须可解析').toBe(false)

    for (const field of ['createdAt', 'updatedAt']) {
      expectLocalDateTime(order.data[field], `order.${field}`)
    }

    // createdAt 为 LocalDateTime（本地墙钟，UTC+8）；as-UTC 解析后比信封 UTC 快 8 小时 => offsetMs ≈ -8h
    const offsetMs = Date.parse(envelopeTimestamp) - Date.parse(`${order.data.createdAt}Z`)
    expect.soft(
      Math.abs(offsetMs + 8 * 3600 * 1000),
      '实体时间使用 Asia/Shanghai（UTC+8），与信封 UTC 应相差约 -8 小时'
    ).toBeLessThan(3600 * 1000 + 60_000)

    expect(order.data.updatedAt >= order.data.createdAt).toBe(true)
  })

  test('[CTR-006][P1][L0] OpenAPI 与 API.md 端点/参数/模型对账 @p1 @l0 @m7', async ({ api }) => {
    const doc = await api.raw('GET', '/v3/api-docs', { token: false })
    expect(doc.status).toBe(200)
    const paths = doc.raw.paths
    const actual = new Set<string>()
    for (const [path, operations] of Object.entries(paths)) {
      for (const method of Object.keys(operations as Record<string, unknown>)) {
        actual.add(`${method.toUpperCase()} ${path}`)
      }
    }

    expect(actual.size, 'API.md §6 端点速查表共 35 个操作').toBe(35)
    expect([...actual].sort()).toEqual([...DOCUMENTED_OPERATIONS].sort())

    const schemas = doc.raw.components.schemas
    const payRequest = schemas.PayRequest
    expect(payRequest.required, 'API.md §2.2：PayRequest.orderNo 必填').toContain('orderNo')
    expect(payRequest.properties.payType.enum).toEqual(PAY_TYPES)
    expect(payRequest.properties.outcome.enum).toEqual(OUTCOMES)

    const paymentListParams = paths['/api/payments'].get.parameters
    const orderNoParam = paymentListParams.find((p: any) => p.name === 'orderNo')
    expect(orderNoParam.required, 'API.md §3.6：GET /api/payments orderNo 必填').toBe(true)

    const callbackParams = paths['/api/payments/{tradeNo}/callback'].post.parameters
    const statusParam = callbackParams.find((p: any) => p.name === 'status')
    expect(statusParam.required).toBe(true)
    expect(statusParam.schema.enum).toEqual(PAYMENT_STATUSES)
    expect(callbackParams.find((p: any) => p.name === 'callbackId').required).toBe(false)

    const listParams = paths['/api/products'].get.parameters
    const pageParam = listParams.find((p: any) => p.name === 'page')
    const sizeParam = listParams.find((p: any) => p.name === 'size')
    expect(pageParam.schema.default).toBe(0)
    expect(sizeParam.schema.default).toBe(20)

    const productUpsert = schemas.ProductUpsertRequest
    expect(productUpsert.required).toEqual(expect.arrayContaining(['name', 'price', 'stock']))
    expect(productUpsert.properties.price.minimum).toBe(0.01)

    const register = schemas.RegisterRequest
    expect(register.properties.username.minLength).toBe(3)
    expect(register.properties.username.maxLength).toBe(64)
    expect(register.properties.password.minLength).toBe(6)
    expect(register.properties.password.maxLength).toBe(128)
    expect(register.properties.nickname.maxLength).toBe(64)

    expect(schemas.ProductResponse.properties.cached.type).toBe('boolean')
    expect(schemas.CategoryResponse.properties.sortOrder.type).toBe('integer')
    expect(schemas.PaymentResponse.properties).not.toHaveProperty('callbackId')
    expect(schemas.ApiResponseProductResponse.properties.traceId.type, 'API.md §1.2：信封含 traceId').toBe('string')
    expect(schemas.ApiResponseProductResponse.properties.timestamp.type).toBe('string')

    test.info().annotations.push({
      type: 'observed',
      description: 'OpenAPI 缺口：ProductUpsertRequest.status 无 enum；CreateOrderRequest.items 未标记 required；401/403 安全响应未纳入 schema'
    })
  })

  test('[CTR-007][P1][L6] 健康检查：整体 UP 且 db/redis/rabbit 子项 UP @p1 @l6 @m7', async ({ api }) => {
    const health = await api.raw('GET', '/actuator/health', { token: false })
    expect(health.status).toBe(200)
    expect(health.raw.status).toBe('UP')
    for (const component of ['db', 'redis', 'rabbit']) {
      expect(health.raw.components, `健康检查应包含 ${component}`).toHaveProperty(component)
      expect(health.raw.components[component].status, `${component} 应 UP`).toBe('UP')
    }
  })

  test('[CTR-008][P1][L6] traceId 可关联：业务错误有、安全响应无、成功响应待补齐 @p1 @l6 @m7', async ({ api, freshUser }) => {
    const first = await api.productDetail(99999999)
    const second = await freshUser.client.getOrder('NO_SUCH_ORDER')
    const ids = [first.raw.traceId, second.raw.traceId]

    for (const traceId of ids) {
      expect(traceId, '业务错误 traceId 应为 16 位十六进制').toMatch(/^[0-9a-f]{16}$/)
    }
    expect(ids[0], '不同请求 traceId 应唯一').not.toBe(ids[1])

    const success = await api.listProducts({ size: 1 })
    expect.soft(typeof success.raw.traceId, 'API.md §1.2：成功响应也应携带 traceId').toBe('string')
    if (typeof success.raw.traceId === 'string') {
      expect.soft(success.raw.traceId, 'traceId 应为 16 位十六进制').toMatch(/^[0-9a-f]{16}$/)
    }

    const anonymous = await api.raw('GET', '/api/cart', { token: false })
    expect(anonymous.raw, 'API.md §1.2：401 特殊返回不含 traceId').not.toHaveProperty('traceId')

    const forbidden = await freshUser.client.adminProducts()
    expect(forbidden.raw, 'API.md §1.2：403 特殊返回不含 traceId').not.toHaveProperty('traceId')

    test.info().annotations.push({
      type: 'observed',
      description: '安全 401/403 由 SecurityConfig 直写，缺少 charset 导致中文 message 变成 "?????"（CTR-003 已断言）'
    })
  })
})
