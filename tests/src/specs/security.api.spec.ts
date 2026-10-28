import { test, expect, credentials, registerFreshUser, uniq } from '../fixtures'
import type { FreshUser } from '../fixtures'
import { decodeJwt, detectJwtSecret, noneAlgToken, signJwt, tamperPayload } from '../support/jwt'

const RECEIVER = {
  receiverName: '孙八',
  receiverPhone: '13400000000',
  receiverAddress: '成都市武侯区测试路 6 号'
}

const XSS = `<script>alert('xss')</script>`
const XSS_IMG = `<img src=x onerror="alert(1)">`

async function createPaidOrder(user: FreshUser, productId: number, quantity = 1) {
  const order = await user.client.createOrder({
    items: [{ productId, quantity }],
    ...RECEIVER
  })
  if (order.code !== 0) throw new Error(`创建订单失败: ${order.code} ${order.message}`)
  const paid = await user.client.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
  if (paid.code !== 0) throw new Error(`发起支付失败: ${paid.code} ${paid.message}`)
  await user.client.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
  return { order: order.data, tradeNo: paid.data.tradeNo }
}

test.describe('M8 安全 · P2', () => {
  test('[SEC-001][P2][L5] 水平越权：他人订单/购物车/支付单不可访问 @p2 @l5 @m8', async ({ freshUser, products }) => {
    const other = await registerFreshUser()
    try {
      const product = await products.create({ price: 10, stock: 10 })
      const { order, tradeNo } = await createPaidOrder(freshUser, product.id, 1)
      await freshUser.client.cartAdd(product.id, 1)

      const detail = await other.client.getOrder(order.orderNo)
      expect.soft(detail.status, '他人订单详情应 HTTP 403').toBe(403)
      expect.soft(detail.code).toBe(40300)
      expect.soft(detail.data, '不得泄露他人订单').toBeUndefined()

      const cancel = await other.client.cancelOrder(order.orderNo)
      expect.soft(cancel.status, '他人订单取消应 HTTP 403').toBe(403)
      expect.soft(cancel.code).toBe(40300)

      const status = await other.client.orderStatus(order.orderNo)
      expect.soft(status.status, '他人订单状态应 HTTP 403').toBe(403)
      expect.soft(status.code).toBe(40300)

      const orders = await other.client.listOrders({ size: 100 })
      expect(orders.code).toBe(0)
      expect(orders.data.content.map((o: any) => o.orderNo)).not.toContain(order.orderNo)

      const cart = await other.client.cartView()
      expect(cart.code).toBe(0)
      expect(cart.data.items, 'B 的购物车不得包含 A 的商品').toEqual([])

      const payment = await other.client.paymentDetail(tradeNo)
      expect.soft(payment.status, '他人支付单详情应 HTTP 403（当前实现越权，缺陷）').toBe(403)
      expect.soft(payment.code).toBe(40300)
      expect.soft(payment.data, '不得泄露他人支付单').toBeUndefined()

      const paymentList = await other.client.paymentList(order.orderNo)
      expect.soft(paymentList.status, '他人订单支付单列表应 HTTP 403（当前实现越权，缺陷）').toBe(403)
      expect.soft(paymentList.code).toBe(40300)

      const refund = await other.client.refund(tradeNo)
      expect.soft(refund.status, '他人支付单退款应 HTTP 403（当前实现越权，缺陷）').toBe(403)
      expect.soft(refund.code).toBe(40300)

      expect((await freshUser.client.paymentDetail(tradeNo)).data.status, '越权退款不得改变支付单状态').toBe('SUCCESS')
      expect((await freshUser.client.getOrder(order.orderNo)).data.status, '越权退款不得取消他人订单').not.toBe(
        'CANCELLED'
      )
    } finally {
      await other.client.dispose()
    }
  })

  test('[SEC-002][P2][L5] 垂直越权：USER 403、匿名 401、role 篡改 401 @p2 @l5 @m8', async ({ freshUser, api }) => {
    const user = freshUser.client
    const probes: Array<[string, Promise<any>]> = [
      ['GET /api/admin/products', user.adminProducts()],
      ['POST /api/admin/products', user.adminCreateProduct({ name: uniq('sec'), price: 1, stock: 1 })],
      ['GET /api/admin/orders/stats', user.adminStats()],
      ['GET /api/admin/payment/config', user.paymentConfig()],
      ['PUT /api/admin/payment/config', user.updatePaymentConfig({ failureRate: 0 })]
    ]
    for (const [label, pending] of probes) {
      const res = await pending
      expect.soft(res.status, `${label} USER 调用应 403`).toBe(403)
      expect.soft(res.code, `${label} 应返回 40300`).toBe(40300)
      expect.soft(res.data, `${label} 不得返回业务数据`).toBeUndefined()
    }

    const anonymous = await api.raw('GET', '/api/admin/products', { token: false })
    expect(anonymous.status, '匿名访问管理端应 401').toBe(401)
    expect(anonymous.code).toBe(40100)

    const token = user.getAccessToken()
    const tampered = await api.raw('GET', '/api/admin/products', {
      token: tamperPayload(token, { role: 'ADMIN', uid: 1 })
    })
    expect(tampered.status, '篡改 role 后签名失效，应 401').toBe(401)
    expect(tampered.code).toBe(40100)
    expect(tampered.data).toBeUndefined()
  })

  test('[SEC-003][P2][L5] JWT 安全：改签名/alg=none/过期/混用 @p2 @l5 @m8', async ({ freshUser, api }) => {
    const token = freshUser.client.getAccessToken()

    const tampered = await api.raw('GET', '/api/cart', { token: tamperPayload(token, { role: 'ADMIN' }) })
    expect.soft(tampered.status, '篡改 payload 应 401').toBe(401)
    expect.soft(tampered.code).toBe(40100)

    const none = await api.raw('GET', '/api/cart', { token: noneAlgToken(token) })
    expect.soft(none.status, 'alg=none 应 401').toBe(401)
    expect.soft(none.code).toBe(40100)

    const secret = await detectJwtSecret(api, decodeJwt(token))
    if (secret) {
      const now = Math.floor(Date.now() / 1000)
      const expired = signJwt(secret, { ...decodeJwt(token), iat: now - 7200, exp: now - 3600 })
      const expiredRes = await api.raw('GET', '/api/cart', { token: expired })
      expect.soft(expiredRes.status, '过期 accessToken 应 401').toBe(401)
      expect.soft(expiredRes.code).toBe(40100)
    } else {
      test.info().annotations.push({ type: 'observed', description: '未探测到 JWT 密钥，跳过过期 token 分支' })
    }

    const refreshAsAccess = await api.raw('GET', '/api/cart', {
      token: freshUser.client.getRefreshToken()
    })
    expect.soft(refreshAsAccess.status, 'refreshToken 作为 access 应 401（当前实现缺陷）').toBe(401)
    expect.soft(refreshAsAccess.code).toBe(40100)

    const accessAsRefresh = await api.raw('POST', '/api/auth/refresh', {
      data: { refreshToken: token },
      token: false
    })
    expect.soft(accessAsRefresh.status, 'accessToken 作为 refresh 应 401').toBe(401)
    expect.soft([40000, 40100]).toContain(accessAsRefresh.code)
  })

  test('[SEC-004][P2][L5] SQL 注入 payload：不 500、不返回全量 @p2 @l5 @m8', async ({ api, userApi, products }) => {
    const keywordPayloads = [`' OR 1=1--`, `%`, `_`, `1' UNION SELECT NULL--`, `' AND '1'='2`]
    for (const keyword of keywordPayloads) {
      const res = await api.listProducts({ keyword, size: 20 })
      expect.soft(res.status, `keyword=${keyword} 不应 500`).toBeLessThan(500)
      expect.soft(res.code, `keyword=${keyword} 不应返回 50000`).not.toBe(50000)
      if (res.code === 0) {
        expect.soft(res.data.total, `keyword=${keyword} 不应返回全量数据`).toBeLessThan(50)
      }
    }

    const category = await api.listProducts({ categoryId: `1 OR 1=1` })
    expect.soft(category.status, 'categoryId 注入应 400').toBe(400)
    expect.soft(category.code).toBe(40000)

    const orderNo = `' OR '1'='1`
    const order = await userApi.raw('GET', `/api/orders/${encodeURIComponent(orderNo)}`)
    expect.soft(order.status, 'orderNo 注入应 404').toBe(404)
    expect.soft(order.code).toBe(40402)

    const login = await api.raw('POST', '/api/auth/login', {
      data: { username: `admin' OR '1'='1`, password: 'x' },
      token: false
    })
    expect.soft(login.status, '登录用户名注入应 401').toBe(401)
    expect.soft(login.code).toBe(40101)

    const product = await products.create({ stock: 5 })
    const paid = await userApi.pay({ orderNo: 'NO_SUCH_ORDER', outcome: 'SUCCESS' })
    expect.soft(paid.code, '支付注入订单号应 40402').toBe(40402)
    expect(product.id).toBeGreaterThan(0)
  })

  test('[SEC-005][P2][L5] 存储型 XSS：商品/备注/收货信息原样返回且为 JSON @p2 @l5 @m8', async ({ userApi, products, api }) => {
    const product = await products.create({ name: `${XSS}-${uniq('xss')}`, description: XSS_IMG })

    const detail = await api.productDetail(product.id)
    expect(detail.code).toBe(0)
    expect(detail.data.name, 'name 应按原样存储/返回').toContain(XSS)
    expect(detail.data.description).toBe(XSS_IMG)
    expect(detail.raw).toBeTruthy()

    const list = await api.listProducts({ keyword: XSS.replace(/'/g, ''), size: 50 })
    expect(list.code).toBe(0)

    const order = await userApi.createOrder({
      items: [{ productId: product.id, quantity: 1 }],
      receiverName: XSS,
      receiverPhone: '13400000000',
      receiverAddress: XSS_IMG,
      remark: `${XSS}${XSS_IMG}`
    })
    expect(order.code).toBe(0)
    expect(order.data.receiverName).toBe(XSS)
    expect(order.data.receiverAddress).toBe(XSS_IMG)
    expect(order.data.remark).toBe(`${XSS}${XSS_IMG}`)

    const stored = await userApi.getOrder(order.data.orderNo)
    expect(stored.data.receiverName).toBe(XSS)
    expect(stored.data.receiverAddress).toBe(XSS_IMG)
    expect(stored.data.remark).toBe(`${XSS}${XSS_IMG}`)

    test.info().annotations.push({
      type: 'observed',
      description: 'API 层按 JSON 原样返回 XSS payload，未做 HTML 转义；前端渲染需自行转义，API.md 未规定转义策略'
    })
  })

  test('[SEC-006][P2][L5] 敏感信息泄露：响应无密码/密钥/堆栈/SQL @p2 @l5 @m8', async ({ api }) => {
    const login = await api.login(credentials.USER.name, credentials.USER.pass)
    expect(login.code).toBe(0)
    const loginKeys = Object.keys(login.data).map(k => k.toLowerCase())
    for (const forbidden of ['password', 'passwordhash', 'secret', 'jwtsecret', 'salt']) {
      expect.soft(loginKeys, `登录响应不得包含 ${forbidden}`).not.toContain(forbidden)
    }

    const me = await api.me()
    expect(me.code).toBe(0)
    expect(Object.keys(me.data).map(k => k.toLowerCase())).not.toContain('password')
    expect(JSON.stringify(me.data)).not.toContain('$2a$')

    const sensitive = [
      'java.lang.', 'org.springframework', 'org.hibernate', 'SQLException',
      'select ', 'insert into', ' at com.', 'password='
    ]
    const bodies: Array<[string, any]> = [
      ['401', (await api.raw('GET', '/api/cart', { token: false })).raw],
      ['401-admin', (await api.adminProducts()).raw],
      ['404', (await api.productDetail(99999999)).raw],
      ['500', (await api.listProducts({ size: 0 })).raw]
    ]
    for (const [label, body] of bodies) {
      const text = JSON.stringify(body ?? {})
      for (const token of sensitive) {
        expect.soft(text.toLowerCase(), `${label} 响应不得泄露 ${token}`).not.toContain(token.toLowerCase())
      }
    }
  })

  test('[SEC-007][P2][L5] mass assignment：订单/支付/商品字段不可被覆盖 @p2 @l5 @m8', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })

    const order = await userApi.createOrder({
      items: [{ productId: product.id, quantity: 2 }],
      status: 'PAID',
      payAmount: 0.01,
      totalAmount: 0.01,
      userId: 1,
      orderNo: 'HACKED_ORDER_NO',
      ...RECEIVER
    } as any)
    expect(order.code).toBe(0)
    expect(order.data.status, 'status 必须由服务端固定为 PENDING_PAYMENT').toBe('PENDING_PAYMENT')
    expect(Number(order.data.totalAmount), 'totalAmount 必须按商品价格计算').toBeCloseTo(20, 2)
    expect(Number(order.data.payAmount)).toBeCloseTo(20, 2)
    expect(order.data.orderNo, 'orderNo 必须由服务端生成').not.toBe('HACKED_ORDER_NO')

    const paid = await userApi.pay({
      orderNo: order.data.orderNo,
      outcome: 'SUCCESS',
      status: 'REFUNDED',
      amount: 0.01,
      userId: 1,
      tradeNo: 'HACKED_TRADE_NO'
    } as any)
    expect(paid.code).toBe(0)
    expect(Number(paid.data.amount), '支付金额必须取订单应付').toBeCloseTo(20, 2)
    expect(paid.data.tradeNo).not.toBe('HACKED_TRADE_NO')
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])

    const created = await adminApi.adminCreateProduct({
      id: 1,
      name: uniq('mass'),
      price: 3,
      stock: 1,
      cached: true
    })
    expect(created.code).toBe(0)
    expect(created.data.id, '商品 id 必须由数据库生成').not.toBe(1)
    expect(created.data.cached, 'cached 为只读响应字段，不得由请求体注入').toBe(false)
    await adminApi.adminDeleteProduct(created.data.id)
  })

  test('[SEC-008][P2][L5] 资源枚举：他人 orderNo/tradeNo 不泄露内容 @p2 @l5 @m8', async ({ freshUser, products }) => {
    const other = await registerFreshUser()
    try {
      const product = await products.create({ price: 10, stock: 10 })
      const { order, tradeNo } = await createPaidOrder(freshUser, product.id, 1)

      expect((await other.client.getOrder(order.orderNo)).status, '他人订单应 403').toBe(403)
      expect((await other.client.cancelOrder(order.orderNo)).status, '他人订单取消应 403').toBe(403)
      expect((await other.client.orderStatus(order.orderNo)).status, '他人订单状态应 403').toBe(403)

      const randomOrder = await other.client.getOrder(`NO_SUCH_${Date.now()}`)
      expect(randomOrder.status, '不存在订单应 404').toBe(404)
      expect(randomOrder.code).toBe(40402)
      expect(randomOrder.data).toBeUndefined()

      const payment = await other.client.paymentDetail(tradeNo)
      expect.soft(payment.status, '他人支付单应 403（当前实现越权）').toBe(403)
      expect.soft(payment.data).toBeUndefined()

      const randomTrade = await other.client.paymentDetail(`PAYNO${Date.now()}`)
      expect(randomTrade.status, '不存在支付单应 404').toBe(404)
      expect(randomTrade.code).toBe(40403)
      expect(randomTrade.data).toBeUndefined()

      const paymentList = await other.client.paymentList(order.orderNo)
      expect.soft(paymentList.status, '他人订单支付单列表应 403（当前实现越权）').toBe(403)
      expect.soft(paymentList.data).toBeUndefined()
    } finally {
      await other.client.dispose()
    }
  })

  test('[SEC-009][P2][L5] CORS 预检与 CSRF 关闭符合文档 @p2 @l5 @m8', async ({ api }) => {
    const origin = 'http://evil.example'
    const preflight = await api.raw('OPTIONS', '/api/auth/login', {
      token: false,
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    })
    expect([200, 204], '预检请求应成功').toContain(preflight.status)
    const headers = preflight.headers
    expect.soft(headers['access-control-allow-origin'], '文档：allowedOriginPatterns=*，应回显 Origin').toBeTruthy()
    expect.soft(headers['access-control-allow-credentials']).toBe('true')

    const actual = await api.raw('GET', '/api/products?size=1', {
      token: false,
      headers: { Origin: origin }
    })
    expect(actual.status).toBe(200)
    expect.soft(actual.headers['access-control-allow-origin']).toBeTruthy()

    const login = await api.raw('POST', '/api/auth/login', {
      data: { username: credentials.USER.name, password: credentials.USER.pass },
      token: false
    })
    expect(login.status, 'CSRF 已关闭，登录无需 CSRF token').toBe(200)
    expect(login.code).toBe(0)

    test.info().annotations.push({
      type: 'observed',
      description: 'CORS 允许任意 Origin 且 allowCredentials=true（文档明示），属于已知配置风险而非实现偏差'
    })
  })

  test('[SEC-010][P2][L6] Actuator/Swagger 暴露面：仅文档端点匿名可访问 @p2 @l6 @m8', async ({ api }) => {
    const health = await api.raw('GET', '/actuator/health', { token: false })
    expect(health.status).toBe(200)
    expect(health.raw.status).toBe('UP')

    const docs = await api.raw('GET', '/v3/api-docs', { token: false })
    expect(docs.status).toBe(200)
    expect(docs.raw.openapi).toBeTruthy()

    const swagger = await api.raw('GET', '/swagger-ui/index.html', { token: false })
    expect([200, 302], 'Swagger UI 应匿名可访问').toContain(swagger.status)

    const overshared = ['/actuator/metrics', '/actuator/prometheus', '/actuator/info', '/actuator/env', '/actuator/beans']
    for (const path of overshared) {
      const res = await api.raw('GET', path, { token: false })
      expect.soft(
        res.status,
        `API.md §1.1 仅承诺 /actuator/health/** 匿名；${path} 不应匿名暴露（当前=${res.status}）`
      ).not.toBe(200)
    }

    const detailedHealth = await api.raw('GET', '/actuator/health', { token: false })
    expect(detailedHealth.raw.components, '健康检查应包含组件状态').toHaveProperty('db')
    expect(detailedHealth.raw.components).toHaveProperty('redis')
    expect(detailedHealth.raw.components).toHaveProperty('rabbit')
  })
})
