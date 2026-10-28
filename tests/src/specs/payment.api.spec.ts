import { test, expect, uniq, registerFreshUser } from '../fixtures'
import { concurrently } from '../support/perf'
import { ShopApiClient } from '../clients/api.client'

const RECEIVER = {
  receiverName: '李四',
  receiverPhone: '13900000000',
  receiverAddress: '上海市浦东新区测试路 2 号'
}

function directOrder(client: ShopApiClient, productId: number, quantity = 1) {
  return client.createOrder({ items: [{ productId, quantity }], ...RECEIVER })
}

test.describe('M5 支付、退款与回调', () => {
  test('[PAY-001][P0][L1] outcome=SUCCESS：支付单 SUCCESS、订单 PAID、金额一致 @p0 @l1 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 50, stock: 10 })
    const order = await directOrder(userApi, product.id, 1)
    expect(order.code).toBe(0)

    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    expect(['PROCESSING', 'SUCCESS'], 'API.md §3.6：响应通常 PROCESSING/SUCCESS').toContain(paid.data.status)
    expect(paid.data.orderNo).toBe(order.data.orderNo)
    expect(paid.data.payType).toBe('ALIPAY')
    expect(Number(paid.data.amount)).toBeCloseTo(50, 2)

    const finalStatus = await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    expect(finalStatus).toBe('SUCCESS')
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID'])

    const detail = await userApi.paymentDetail(paid.data.tradeNo)
    expect(detail.code).toBe(0)
    expect(Number(detail.data.amount), '支付金额=订单应付').toBeCloseTo(Number(order.data.payAmount), 2)
  })

  test('[PAY-002][P0][L1] outcome=FAILED：支付单 FAILED、订单 PAY_FAILED、库存回滚 @p0 @l1 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 20, stock: 5 })
    const order = await directOrder(userApi, product.id, 2)

    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'FAILED' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['FAILED'])
    expect((await userApi.getOrder(order.data.orderNo)).data.status).toBe('PAY_FAILED')
    expect((await userApi.productDetail(product.id)).data.stock, '支付失败应回滚库存').toBe(5)
  })

  test('[PAY-003][P0][L1] outcome=TIMEOUT：支付单 TIMEOUT、订单 PAY_FAILED、可重新支付 @p0 @l1 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 15, stock: 5 })
    const order = await directOrder(userApi, product.id, 1)

    const timeout = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'TIMEOUT' })
    expect(timeout.code).toBe(0)
    await userApi.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])
    expect((await userApi.getOrder(order.data.orderNo)).data.status).toBe('PAY_FAILED')

    const retry = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(retry.code).toBe(0)
    await userApi.waitForPaymentStatus(retry.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID'])
    expect(retry.data.tradeNo).not.toBe(timeout.data.tradeNo)
  })

  test('[PAY-004][P0][L1] failureRate=0/timeoutRate=0 时不传 outcome 必成功 @p0 @l1 @m5', async ({ userApi, adminApi, products }) => {
    const original = await adminApi.paymentConfig()
    expect(original.code).toBe(0)
    const snapshot = original.data

    try {
      const updated = await adminApi.updatePaymentConfig({
        failureRate: 0,
        timeoutRate: 0,
        minDelayMs: 1,
        maxDelayMs: 5,
        asyncEnabled: true
      })
      expect(updated.code).toBe(0)
      expect(updated.data.failureRate).toBe(0)
      expect(updated.data.timeoutRate).toBe(0)

      const product = await products.create({ price: 9.9, stock: 5 })
      const order = await directOrder(userApi, product.id, 1)
      const paid = await userApi.pay({ orderNo: order.data.orderNo })
      expect(paid.code).toBe(0)
      await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
      await userApi.waitForOrderStatus(order.data.orderNo, ['PAID'])
    } finally {
      const restored = await adminApi.updatePaymentConfig({
        failureRate: snapshot.failureRate,
        timeoutRate: snapshot.timeoutRate,
        minDelayMs: snapshot.minDelayMs,
        maxDelayMs: snapshot.maxDelayMs,
        asyncEnabled: snapshot.asyncEnabled
      })
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }
  })

  test('[PAY-005][P0][L1] 支付单详情字段完整，不存在返回 404/40403 @p0 @l1 @m5', async ({ userApi, products }) => {
    const product = await products.create({ stock: 5 })
    const order = await directOrder(userApi, product.id, 1)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])

    const detail = await userApi.paymentDetail(paid.data.tradeNo)
    expect(detail.code).toBe(0)
    expect(detail.data.tradeNo).toBe(paid.data.tradeNo)
    expect(detail.data.orderNo).toBe(order.data.orderNo)
    expect(detail.data.status).toBe('SUCCESS')
    expect(['ALIPAY', 'WECHAT', 'CARD', 'BALANCE']).toContain(detail.data.payType)
    expect(typeof detail.data.amount).toBe('number')
    expect(detail.data).toHaveProperty('createdAt')
    expect(detail.data).toHaveProperty('updatedAt')
    expect(Object.keys(detail.data), 'API.md §2：PaymentResponse 不含 callbackId').not.toContain('callbackId')

    const missing = await userApi.paymentDetail('PAY_NOT_EXIST')
    expect(missing.status, 'API.md §1.4：40403 映射 HTTP 404').toBe(404)
    expect(missing.code).toBe(40403)
  })

  test('[PAY-006][P0][L1] 按订单查支付单返回全部记录且按时间倒序 @p0 @l1 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 30, stock: 5 })
    const order = await directOrder(userApi, product.id, 1)

    const timeout = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'TIMEOUT' })
    await userApi.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])
    const success = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(success.data.tradeNo, ['SUCCESS'])

    const list = await userApi.paymentList(order.data.orderNo)
    expect(list.code).toBe(0)
    expect(list.data).toHaveLength(2)
    expect(list.data.every((p: any) => p.orderNo === order.data.orderNo)).toBe(true)
    expect(list.data.map((p: any) => p.tradeNo)).toContain(timeout.data.tradeNo)
    expect(list.data.map((p: any) => p.tradeNo)).toContain(success.data.tradeNo)

    const dates = list.data.map((p: any) => new Date(p.createdAt).getTime())
    expect(dates[0], '支付单按 createdAt 倒序').toBeGreaterThanOrEqual(dates[1])
  })

  test('[PAY-007][P0][L2] 回调 SUCCESS 且同 callbackId 重复回调无副作用 @p0 @l2 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 12, stock: 5 })
    const order = await directOrder(userApi, product.id, 1)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    const callbackId = uniq('cb')

    const first = await userApi.paymentCallback(paid.data.tradeNo, 'SUCCESS', callbackId)
    expect(first.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID'])

    const second = await userApi.paymentCallback(paid.data.tradeNo, 'SUCCESS', callbackId)
    expect(second.code).toBe(0)
    expect(second.data.tradeNo).toBe(paid.data.tradeNo)
    expect(second.data.status).toBe('SUCCESS')

    const list = await userApi.paymentList(order.data.orderNo)
    expect(list.data, '重复回调不得生成新支付单').toHaveLength(1)
    expect((await userApi.getOrder(order.data.orderNo)).data.status).toBe('PAID')
  })

  test('[PAY-008][P0][L2] 退款：支付单 REFUNDED、订单 CANCELLED、库存回滚 @p0 @l2 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 25, stock: 5 })
    const order = await directOrder(userApi, product.id, 2)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID'])

    const refunded = await userApi.refund(paid.data.tradeNo)
    expect(refunded.code).toBe(0)
    expect(refunded.data.status, 'API.md §4.2：SUCCESS → REFUNDED').toBe('REFUNDED')
    expect(Number(refunded.data.amount)).toBeCloseTo(50, 2)
    expect((await userApi.getOrder(order.data.orderNo)).data.status, '源码退款后订单置 CANCELLED').toBe('CANCELLED')
    expect((await userApi.productDetail(product.id)).data.stock, '退款应回滚库存').toBe(5)
  })

  test('[PAY-009][P0][L1] 支付非法订单：不存在 40402；已取消/已支付按文档应 40904 @p0 @l1 @m5', async ({ userApi, products }) => {
    const missing = await userApi.pay({ orderNo: 'NO_SUCH_ORDER', outcome: 'SUCCESS' })
    expect(missing.status).toBe(404)
    expect(missing.code).toBe(40402)

    const product = await products.create({ price: 10, stock: 20 })

    const cancelledOrder = await directOrder(userApi, product.id, 1)
    await userApi.cancelOrder(cancelledOrder.data.orderNo)
    const onCancelled = await userApi.pay({ orderNo: cancelledOrder.data.orderNo, outcome: 'SUCCESS' })
    expect.soft(onCancelled.status, 'API.md §1.4/§3.6：订单状态不允许支付应 40904').toBe(409)
    expect.soft(onCancelled.code, 'API.md §1.4/§3.6：订单状态不允许支付应 40904（实现返回 40906 时此处会红）').toBe(40904)

    const paidOrder = await directOrder(userApi, product.id, 1)
    const paid = await userApi.pay({ orderNo: paidOrder.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(paidOrder.data.orderNo, ['PAID'])
    const onPaid = await userApi.pay({ orderNo: paidOrder.data.orderNo, outcome: 'SUCCESS' })
    expect.soft(onPaid.status, 'API.md §3.6：已支付订单不可再次支付').toBe(409)
    expect.soft(onPaid.code, 'API.md §3.6：已支付订单不可再次支付应 40904').toBe(40904)
  })

  test('[PAY-010][P0][L1] 四种 payType 与 BALANCE 余额不足 40907 @p0 @l1 @m5', async ({ freshUser, products }) => {
    const user = freshUser.client

    for (const payType of ['ALIPAY', 'WECHAT', 'CARD', 'BALANCE']) {
      const product = await products.create({ price: 10, stock: 5 })
      const order = await directOrder(user, product.id, 1)
      const paid = await user.pay({ orderNo: order.data.orderNo, payType, outcome: 'SUCCESS' })
      expect(paid.code, `${payType} 应可发起支付`).toBe(0)
      expect(paid.data.payType).toBe(payType)
      await user.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
      await user.waitForOrderStatus(order.data.orderNo, ['PAID'])
    }

    const me = await user.me()
    expect(Number(me.data.balance), '4 笔 BALANCE=10 中仅 1 笔走余额，10000-10').toBeCloseTo(9990, 2)

    const expensive = await products.create({ price: 20000, stock: 5 })
    const order = await directOrder(user, expensive.id, 1)
    const rejected = await user.pay({ orderNo: order.data.orderNo, payType: 'BALANCE', outcome: 'SUCCESS' })
    expect(rejected.status, 'API.md §1.4：40907 映射 HTTP 409').toBe(409)
    expect(rejected.code).toBe(40907)
    expect(Number((await user.me()).data.balance), '余额不足不得扣款').toBeCloseTo(9990, 2)
  })
})

function configPayload(cfg: any) {
  return {
    failureRate: cfg.failureRate,
    timeoutRate: cfg.timeoutRate,
    minDelayMs: cfg.minDelayMs,
    maxDelayMs: cfg.maxDelayMs,
    asyncEnabled: cfg.asyncEnabled
  }
}

function expectLocalDateTime(value: any, label: string) {
  expect(typeof value, `${label} 应为字符串`).toBe('string')
  expect(value, `${label} 应为无时区的 LocalDateTime`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/)
}

test.describe('M5 支付、退款与回调 · P1', () => {
  test('[PAY-011][P1][L1] 支付参数校验：orderNo 缺失/空、payType/outcome 非法 @p1 @l1 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await directOrder(userApi, product.id, 1)
    const orderNo = order.data.orderNo

    const missing = await userApi.payRaw({ outcome: 'SUCCESS' })
    expect.soft(missing.status, 'API.md §2.2：orderNo 必填，缺失应 HTTP 400').toBe(400)
    expect.soft(missing.code, '缺少 orderNo 应返回 40000，而不是 40402').toBe(40000)

    const empty = await userApi.payRaw({ orderNo: '', outcome: 'SUCCESS' })
    expect.soft(empty.status, 'orderNo 为空串应 HTTP 400').toBe(400)
    expect.soft(empty.code).toBe(40000)

    const badPayType = await userApi.payRaw({ orderNo, payType: 'BITCOIN' })
    expect.soft(badPayType.status, '非法 payType 应 HTTP 400').toBe(400)
    expect.soft(badPayType.code, '非法 payType 应返回 40000，不应 500').toBe(40000)

    const badOutcome = await userApi.payRaw({ orderNo, outcome: 'MAYBE' })
    expect.soft(badOutcome.status, '非法 outcome 应 HTTP 400').toBe(400)
    expect.soft(badOutcome.code, '非法 outcome 应返回 40000，不应 500').toBe(40000)

    const longKey = await userApi.pay({ orderNo, outcome: 'SUCCESS', idempotencyKey: 'k'.repeat(1000) })
    expect.soft(longKey.status, 'idempotencyKey 无长度约束，超长不应 500').toBeLessThan(500)
  })

  test('[PAY-012][P1][L1] 回调参数校验：status 缺失/非法、callbackId 超长 @p1 @l1 @m5', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    try {
      await adminApi.updatePaymentConfig({ ...configPayload(snapshot), minDelayMs: 3000, maxDelayMs: 3000, asyncEnabled: true })

      const product = await products.create({ price: 10, stock: 10 })
      const order = await directOrder(userApi, product.id, 1)
      const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
      expect(paid.code).toBe(0)
      expect(paid.data.status, '异步模式下发起支付应 PROCESSING').toBe('PROCESSING')
      const tradeNo = paid.data.tradeNo

      const missingStatus = await userApi.raw('POST', `/api/payments/${tradeNo}/callback`)
      expect.soft(missingStatus.status, '缺少 status 应 HTTP 400').toBe(400)
      expect.soft(missingStatus.code, '缺少 status 应返回 40000，不应 500').toBe(40000)

      const invalidStatus = await userApi.raw('POST', `/api/payments/${tradeNo}/callback?status=NOPE`)
      expect.soft(invalidStatus.status, '非法 status 应 HTTP 400').toBe(400)
      expect.soft(invalidStatus.code, '非法 status 应返回 40000，不应 500').toBe(40000)

      const unsupported = await userApi.raw('POST', `/api/payments/${tradeNo}/callback?status=PROCESSING`)
      expect.soft(unsupported.status, '回调 PROCESSING 应 HTTP 400').toBe(400)
      expect.soft(unsupported.code).toBe(40000)

      const longCallback = await userApi.raw(
        'POST',
        `/api/payments/${tradeNo}/callback?status=SUCCESS&callbackId=${'x'.repeat(500)}`
      )
      expect.soft(longCallback.status, 'API.md 未限制 callbackId 长度，超长不应 500').toBeLessThan(500)

      const callbackId = uniq('cb')
      const ok = await userApi.paymentCallback(tradeNo, 'SUCCESS', callbackId)
      expect(ok.code).toBe(0)
      expect(ok.data.tradeNo).toBe(tradeNo)
      expect(ok.data.status).toBe('SUCCESS')

      const repeat = await userApi.paymentCallback(tradeNo, 'SUCCESS', callbackId)
      expect(repeat.code, '同 callbackId 重复回调应幂等').toBe(0)
      expect(repeat.data.tradeNo).toBe(tradeNo)
      expect(repeat.data.status).toBe('SUCCESS')

      const missingTrade = await userApi.paymentCallback(`NO_SUCH_${uniq('trade')}`, 'SUCCESS', callbackId)
      expect(missingTrade.status, '不存在的支付单应 HTTP 404').toBe(404)
      expect(missingTrade.code).toBe(40403)
    } finally {
      const restored = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }
  })

  test('[PAY-013][P1][L1] 退款非法状态：PROCESSING/FAILED/TIMEOUT/REFUNDED @p1 @l1 @m5', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    const product = await products.create({ price: 10, stock: 20 })

    try {
      await adminApi.updatePaymentConfig({ ...configPayload(snapshot), minDelayMs: 3000, maxDelayMs: 3000, asyncEnabled: true })
      const processingOrder = await directOrder(userApi, product.id, 1)
      const processingPay = await userApi.pay({ orderNo: processingOrder.data.orderNo, outcome: 'SUCCESS' })
      expect(processingPay.code).toBe(0)
      expect(processingPay.data.status).toBe('PROCESSING')
      const stockBefore = (await userApi.productDetail(product.id)).data.stock
      const refundProcessing = await userApi.refund(processingPay.data.tradeNo)
      expect.soft(refundProcessing.status, 'PROCESSING 支付单退款应 HTTP 409').toBe(409)
      expect.soft(refundProcessing.code).toBe(40906)
      expect.soft((await userApi.paymentDetail(processingPay.data.tradeNo)).data.status).toBe('PROCESSING')
      expect.soft((await userApi.productDetail(product.id)).data.stock).toBe(stockBefore)
    } finally {
      const restored = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }

    for (const outcome of ['FAILED', 'TIMEOUT'] as const) {
      const order = await directOrder(userApi, product.id, 1)
      const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome })
      expect(paid.code).toBe(0)
      await userApi.waitForPaymentStatus(paid.data.tradeNo, [outcome])
      const stockBefore = (await userApi.productDetail(product.id)).data.stock
      const refund = await userApi.refund(paid.data.tradeNo)
      expect.soft(refund.status, `${outcome} 支付单退款应 HTTP 409`).toBe(409)
      expect.soft(refund.code, `${outcome} 支付单退款应返回 40906`).toBe(40906)
      expect.soft((await userApi.paymentDetail(paid.data.tradeNo)).data.status).toBe(outcome)
      expect.soft((await userApi.productDetail(product.id)).data.stock).toBe(stockBefore)
    }

    const order = await directOrder(userApi, product.id, 1)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    const firstRefund = await userApi.refund(paid.data.tradeNo)
    expect(firstRefund.code).toBe(0)
    expect(firstRefund.data.status).toBe('REFUNDED')
    const stockAfterRefund = (await userApi.productDetail(product.id)).data.stock
    const secondRefund = await userApi.refund(paid.data.tradeNo)
    expect.soft(secondRefund.status, 'REFUNDED 支付单重复退款应 HTTP 409').toBe(409)
    expect.soft(secondRefund.code).toBe(40906)
    expect.soft((await userApi.productDetail(product.id)).data.stock).toBe(stockAfterRefund)
    expect.soft((await userApi.paymentDetail(paid.data.tradeNo)).data.status).toBe('REFUNDED')

    test.info().annotations.push({
      type: 'observed',
      description: 'PaymentStatus.CLOSED 无自然触发路径（API.md §4.2 描述关单，但实现未生成 CLOSED 支付单），本轮未覆盖'
    })
  })

  test('[PAY-014][P1][L2] 重复退款返回 40906 且库存只回滚一次 @p1 @l2 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 25, stock: 5 })
    const order = await directOrder(userApi, product.id, 2)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])

    const first = await userApi.refund(paid.data.tradeNo)
    expect(first.code).toBe(0)
    expect(first.data.status).toBe('REFUNDED')
    expect(Number(first.data.amount)).toBeCloseTo(50, 2)
    expect((await userApi.productDetail(product.id)).data.stock, '退款应回滚到初始库存').toBe(5)
    expect((await userApi.getOrder(order.data.orderNo)).data.status).toBe('CANCELLED')

    const second = await userApi.refund(paid.data.tradeNo)
    expect(second.status, '重复退款应 HTTP 409').toBe(409)
    expect(second.code).toBe(40906)
    expect((await userApi.productDetail(product.id)).data.stock, '库存只能回滚一次').toBe(5)
    expect((await userApi.paymentDetail(paid.data.tradeNo)).data.status).toBe('REFUNDED')
    expect((await userApi.paymentList(order.data.orderNo)).data, '退款不得生成新支付单').toHaveLength(1)
  })

  test('[PAY-015][P1][L2] 手动回调与 MQ 自动结果竞争：终态唯一且状态自洽 @p1 @l2 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await directOrder(userApi, product.id, 2)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'FAILED' })
    expect(paid.code).toBe(0)

    const callback = await userApi.paymentCallback(paid.data.tradeNo, 'SUCCESS', uniq('race'))
    expect(callback.code, '并发回调不应报错').toBe(0)

    const finalStatus = await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS', 'FAILED'], 20_000)
    const detail = await userApi.paymentDetail(paid.data.tradeNo)
    expect(detail.data.status, '支付单只能落到一个终态').toBe(finalStatus)

    const orderStatus = (await userApi.getOrder(order.data.orderNo)).data.status
    const stock = (await userApi.productDetail(product.id)).data.stock
    if (finalStatus === 'SUCCESS') {
      expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain(orderStatus)
      expect(stock, '成功支付库存=10-2').toBe(8)
    } else {
      expect(orderStatus).toBe('PAY_FAILED')
      expect(stock, '失败支付应回滚库存').toBe(10)
    }

    expect((await userApi.paymentList(order.data.orderNo)).data, '竞争不得生成第二张支付单').toHaveLength(1)

    const lateCallback = await userApi.paymentCallback(paid.data.tradeNo, 'FAILED', uniq('race-late'))
    expect(lateCallback.code).toBe(0)
    expect(lateCallback.data.status, '终态后回调不得反转状态').toBe(finalStatus)
    expect((await userApi.paymentDetail(paid.data.tradeNo)).data.status).toBe(finalStatus)
  })

  test('[PAY-016][P1][L5] 支付越权：他人支付单详情/列表/退款 @p1 @l5 @m5', async ({ userApi, products }) => {
    const other = await registerFreshUser()
    try {
      const product = await products.create({ price: 10, stock: 10 })
      const order = await directOrder(userApi, product.id, 1)
      const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
      await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])

      const detail = await other.client.paymentDetail(paid.data.tradeNo)
      expect.soft(detail.status, '他人支付单详情应 HTTP 403').toBe(403)
      expect.soft(detail.code).toBe(40300)
      expect.soft(detail.data, '越权响应不得泄露支付单').toBeUndefined()

      const list = await other.client.paymentList(order.data.orderNo)
      expect.soft(list.status, '他人订单支付单列表应 HTTP 403').toBe(403)
      expect.soft(list.code).toBe(40300)
      expect.soft(list.data, '越权响应不得返回支付单列表').toBeUndefined()

      const refund = await other.client.refund(paid.data.tradeNo)
      expect.soft(refund.status, '他人支付单退款应 HTTP 403').toBe(403)
      expect.soft(refund.code).toBe(40300)

      const after = await userApi.paymentDetail(paid.data.tradeNo)
      expect.soft(after.data.status, '越权退款不得改变支付单状态').toBe('SUCCESS')
      expect.soft((await userApi.getOrder(order.data.orderNo)).data.status, '越权退款不得取消他人订单')
        .not.toBe('CANCELLED')
    } finally {
      await other.client.dispose()
    }
  })

  test('[PAY-017][P1][L0] PaymentResponse Schema（不含 callbackId） @p1 @l0 @m5', async ({ userApi, products }) => {
    const expectedKeys = [
      'tradeNo', 'orderNo', 'payType', 'status', 'amount',
      'gatewayCode', 'gatewayMessage', 'createdAt', 'updatedAt'
    ]
    const product = await products.create({ price: 12, stock: 5 })
    const order = await directOrder(userApi, product.id, 1)
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])

    const detail = await userApi.paymentDetail(paid.data.tradeNo)
    expect(detail.code).toBe(0)
    expect(Object.keys(detail.data).sort(), 'API.md §2：PaymentResponse 字段固定').toEqual([...expectedKeys].sort())
    expect(detail.data).not.toHaveProperty('callbackId')
    expect(detail.data).not.toHaveProperty('requestedOutcome')
    expect(detail.data).not.toHaveProperty('userId')

    expect(detail.data.tradeNo).toBe(paid.data.tradeNo)
    expect(detail.data.orderNo).toBe(order.data.orderNo)
    expect(['ALIPAY', 'WECHAT', 'CARD', 'BALANCE']).toContain(detail.data.payType)
    expect(['PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'REFUNDED', 'CLOSED']).toContain(detail.data.status)
    expect(typeof detail.data.amount).toBe('number')
    expect(['string', 'object'], 'gatewayCode 应为 string 或 null').toContain(typeof detail.data.gatewayCode)
    expect(['string', 'object'], 'gatewayMessage 应为 string 或 null').toContain(typeof detail.data.gatewayMessage)
    expectLocalDateTime(detail.data.createdAt, 'payment.createdAt')
    expectLocalDateTime(detail.data.updatedAt, 'payment.updatedAt')

    expect(Object.keys(paid.data).sort(), 'POST /api/payments 响应 Schema 应与详情一致').toEqual([...expectedKeys].sort())

    const list = await userApi.paymentList(order.data.orderNo)
    expect(list.data).toHaveLength(1)
    expect(Object.keys(list.data[0]).sort()).toEqual([...expectedKeys].sort())
  })

  test('[PAY-018][P1][L3] 支付金额一致性：订单应付=支付金额=退款金额 @p1 @l3 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 12.34, stock: 10 })
    const order = await directOrder(userApi, product.id, 3)
    expect(Number(order.data.payAmount)).toBeCloseTo(37.02, 2)

    const timeout = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'TIMEOUT' })
    expect(Number(timeout.data.amount)).toBeCloseTo(37.02, 2)
    await userApi.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])
    expect((await userApi.getOrder(order.data.orderNo)).data.status).toBe('PAY_FAILED')

    const success = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(Number(success.data.amount)).toBeCloseTo(37.02, 2)
    await userApi.waitForPaymentStatus(success.data.tradeNo, ['SUCCESS'])
    const detail = await userApi.paymentDetail(success.data.tradeNo)
    expect(Number(detail.data.amount), '支付金额=订单应付').toBeCloseTo(Number(order.data.payAmount), 2)

    const list = await userApi.paymentList(order.data.orderNo)
    expect(list.data, '同一订单的多张支付单金额一致').toHaveLength(2)
    for (const payment of list.data) {
      expect(Number(payment.amount)).toBeCloseTo(37.02, 2)
    }

    const refunded = await userApi.refund(success.data.tradeNo)
    expect(Number(refunded.data.amount), '退款金额=支付金额').toBeCloseTo(37.02, 2)
    const after = await userApi.getOrder(order.data.orderNo)
    expect(Number(after.data.totalAmount), '退款不得改动订单金额').toBeCloseTo(37.02, 2)
    expect(Number(after.data.payAmount)).toBeCloseTo(37.02, 2)
  })

  test('[PAY-025][P1][L2] outcome 覆盖全局配置并恢复配置 @p1 @l2 @m5', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    try {
      const updated = await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        failureRate: 1,
        timeoutRate: 1,
        minDelayMs: 1,
        maxDelayMs: 5,
        asyncEnabled: true
      })
      expect(updated.code).toBe(0)

      const product = await products.create({ price: 10, stock: 10 })

      const successOrder = await directOrder(userApi, product.id, 1)
      const success = await userApi.pay({ orderNo: successOrder.data.orderNo, outcome: 'SUCCESS' })
      expect(success.code).toBe(0)
      expect(await userApi.waitForPaymentStatus(success.data.tradeNo, ['SUCCESS'])).toBe('SUCCESS')

      const failedOrder = await directOrder(userApi, product.id, 1)
      const failed = await userApi.pay({ orderNo: failedOrder.data.orderNo, outcome: 'FAILED' })
      expect(failed.code).toBe(0)
      expect(await userApi.waitForPaymentStatus(failed.data.tradeNo, ['FAILED'])).toBe('FAILED')

      const timeoutOrder = await directOrder(userApi, product.id, 1)
      const timeout = await userApi.pay({ orderNo: timeoutOrder.data.orderNo, outcome: 'TIMEOUT' })
      expect(timeout.code).toBe(0)
      expect(await userApi.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])).toBe('TIMEOUT')

      const randomOrder = await directOrder(userApi, product.id, 1)
      const random = await userApi.pay({ orderNo: randomOrder.data.orderNo })
      expect(random.code).toBe(0)
      const randomStatus = await userApi.waitForPaymentStatus(random.data.tradeNo, ['SUCCESS', 'FAILED', 'TIMEOUT'])
      expect(randomStatus, 'timeoutRate=1 时未指定 outcome 应超时（API.md §5 概率语义）').toBe('TIMEOUT')
    } finally {
      const restored = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
      expect(restored.data.failureRate).toBe(snapshot.failureRate)
      expect(restored.data.timeoutRate).toBe(snapshot.timeoutRate)
    }
  })
})

test.describe('M5 支付、退款与回调 · P2', () => {
  test('[PAY-019][P2][L4] 同 idempotencyKey 重试支付：返回原支付单 @p2 @l4 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await directOrder(userApi, product.id, 1)
    expect(order.code).toBe(0)
    const idempotencyKey = uniq('paykey')

    // 第一次支付超时（订单回到 PAY_FAILED），使用同一个幂等键重试
    const first = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'TIMEOUT', idempotencyKey })
    expect(first.code).toBe(0)
    await userApi.waitForPaymentStatus(first.data.tradeNo, ['TIMEOUT'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAY_FAILED'])

    const retry = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS', idempotencyKey })
    expect(retry.code, '同 key 重试应成功返回').toBe(0)
    expect(retry.data.tradeNo, '同 idempotencyKey 重试必须返回原支付单（当前实现会新建，缺陷）').toBe(
      first.data.tradeNo
    )

    const payments = await userApi.paymentList(order.data.orderNo)
    expect(payments.data, '同一 idempotencyKey 只允许 1 张支付单').toHaveLength(1)
    expect(payments.data.filter((p: any) => p.status === 'SUCCESS'), '只允许 1 张 SUCCESS 支付单').toHaveLength(1)

    test.info().annotations.push({
      type: 'observed',
      description: 'P2 首轮 5 并发同 key 支付曾生成 5 张支付单，说明 idempotencyKey 未落库/未查询；本用例改为同 key 串行重试，稳定复现'
    })
  })

  test('[PAY-020][P2][L4] 同 callbackId 并发回调：只生效一次 @p2 @l4 @m5', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    try {
      await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        minDelayMs: 3000,
        maxDelayMs: 3000,
        asyncEnabled: true
      })

      const product = await products.create({ price: 10, stock: 10 })
      const order = await directOrder(userApi, product.id, 2)
      const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
      expect(paid.code).toBe(0)
      expect(paid.data.status).toBe('PROCESSING')

      const callbackId = uniq('cb-race')
      const results = await concurrently(5, () =>
        userApi.paymentCallback(paid.data.tradeNo, 'SUCCESS', callbackId)
      )
      expect(results.every(r => !r.error), '并发回调不得出现网络异常').toBe(true)
      const responses = results.map(r => r.value!)
      for (const response of responses) {
        expect.soft(response.status, '回调应 200').toBe(200)
        expect.soft(response.code, '回调应 code=0').toBe(0)
        expect.soft(response.data.status, '并发回调结果应为 SUCCESS').toBe('SUCCESS')
      }

      const detail = await userApi.paymentDetail(paid.data.tradeNo)
      expect(detail.data.status).toBe('SUCCESS')
      expect((await userApi.paymentList(order.data.orderNo)).data, '回调不得生成新支付单').toHaveLength(1)
      expect((await userApi.productDetail(product.id)).data.stock, '库存=10-2').toBe(8)
      await userApi.waitForOrderStatus(order.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])

      const late = await userApi.paymentCallback(paid.data.tradeNo, 'FAILED', uniq('cb-late'))
      expect(late.code).toBe(0)
      expect(late.data.status, '终态后回调不得反转').toBe('SUCCESS')
    } finally {
      const restored = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }
  })

  test('[PAY-021][P2][L4] 不同 idempotencyKey 重复支付：不重复扣款 @p2 @l4 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await directOrder(userApi, product.id, 2)
    expect(order.code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(8)

    const timeout = await userApi.pay({
      orderNo: order.data.orderNo,
      outcome: 'TIMEOUT',
      idempotencyKey: uniq('key-a')
    })
    expect(timeout.code).toBe(0)
    await userApi.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAY_FAILED'])
    expect((await userApi.productDetail(product.id)).data.stock, '超时应回滚库存').toBe(10)

    const success = await userApi.pay({
      orderNo: order.data.orderNo,
      outcome: 'SUCCESS',
      idempotencyKey: uniq('key-b')
    })
    expect(success.code, 'PAY_FAILED 状态允许使用新 key 重新支付').toBe(0)
    await userApi.waitForPaymentStatus(success.data.tradeNo, ['SUCCESS'])

    const payments = await userApi.paymentList(order.data.orderNo)
    expect(payments.data, '两次支付应产生 2 张支付单').toHaveLength(2)
    expect(payments.data.filter((p: any) => p.status === 'SUCCESS'), '只允许 1 张 SUCCESS').toHaveLength(1)
    expect((await userApi.productDetail(product.id)).data.stock, '重付成功后库存应再次扣减为 8（当前实现缺陷时此处为红）').toBe(8)
    const detail = await userApi.getOrder(order.data.orderNo)
    expect(Number(detail.data.payAmount), '订单金额不得因重付变化').toBeCloseTo(20, 2)
  })

  test('[PAY-022][P2][L3] 随机配置：failure=1/timeout=1 确定性，耗时落在区间 @p2 @l3 @m5', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    const product = await products.create({ price: 5, stock: 100 })
    try {
      await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        failureRate: 1,
        timeoutRate: 0,
        minDelayMs: 0,
        maxDelayMs: 5,
        asyncEnabled: false
      })
      const failedStatuses: string[] = []
      for (let i = 0; i < 6; i++) {
        const order = await directOrder(userApi, product.id, 1)
        const paid = await userApi.pay({ orderNo: order.data.orderNo })
        expect(paid.code).toBe(0)
        failedStatuses.push(paid.data.status)
      }
      expect(new Set(failedStatuses), 'failureRate=1 时未指定 outcome 应全部 FAILED').toEqual(new Set(['FAILED']))

      await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        failureRate: 0,
        timeoutRate: 1,
        minDelayMs: 0,
        maxDelayMs: 5,
        asyncEnabled: false
      })
      const timeoutStatuses: string[] = []
      for (let i = 0; i < 6; i++) {
        const order = await directOrder(userApi, product.id, 1)
        const paid = await userApi.pay({ orderNo: order.data.orderNo })
        expect(paid.code).toBe(0)
        timeoutStatuses.push(paid.data.status)
      }
      expect(new Set(timeoutStatuses), 'timeoutRate=1 时未指定 outcome 应全部 TIMEOUT').toEqual(new Set(['TIMEOUT']))

      await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        failureRate: 0,
        timeoutRate: 0,
        minDelayMs: 150,
        maxDelayMs: 250,
        asyncEnabled: false
      })
      const order = await directOrder(userApi, product.id, 1)
      const start = Date.now()
      const paid = await userApi.pay({ orderNo: order.data.orderNo })
      const elapsed = Date.now() - start
      expect(paid.code).toBe(0)
      expect(paid.data.status, 'failure/timeout 均为 0 时应 SUCCESS').toBe('SUCCESS')
      expect(elapsed, `同步模式耗时 ${elapsed}ms 应 >= 150ms（模拟网关延迟）`).toBeGreaterThanOrEqual(100)
      expect(elapsed, `同步模式耗时 ${elapsed}ms 应 <= 3000ms`).toBeLessThan(3000)

      test.info().annotations.push({
        type: 'observed',
        description: `同步模式延迟区间 150~250ms，实测 POST /api/payments 耗时 ${elapsed}ms`
      })
    } finally {
      const restored = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }
  })

  test('[PAY-023][P2][L2] 同步/异步模式状态机一致 @p2 @l2 @m5', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    const product = await products.create({ price: 10, stock: 10 })
    try {
      await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        failureRate: 0,
        timeoutRate: 0,
        minDelayMs: 300,
        maxDelayMs: 300,
        asyncEnabled: true
      })
      const asyncOrder = await directOrder(userApi, product.id, 1)
      const asyncPay = await userApi.pay({ orderNo: asyncOrder.data.orderNo, outcome: 'SUCCESS' })
      expect(asyncPay.code).toBe(0)
      expect(asyncPay.data.status, '异步模式发起支付应立即返回 PROCESSING').toBe('PROCESSING')
      expect(await userApi.waitForPaymentStatus(asyncPay.data.tradeNo, ['SUCCESS'])).toBe('SUCCESS')
      expect(await userApi.waitForOrderStatus(asyncOrder.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])).toBeTruthy()

      await adminApi.updatePaymentConfig({
        ...configPayload(snapshot),
        failureRate: 0,
        timeoutRate: 0,
        minDelayMs: 50,
        maxDelayMs: 50,
        asyncEnabled: false
      })
      const syncOrder = await directOrder(userApi, product.id, 1)
      const syncPay = await userApi.pay({ orderNo: syncOrder.data.orderNo, outcome: 'SUCCESS' })
      expect(syncPay.code).toBe(0)
      expect(syncPay.data.status, '同步模式发起支付应直接返回终态 SUCCESS').toBe('SUCCESS')
      expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain((await userApi.getOrder(syncOrder.data.orderNo)).data.status)

      expect((await userApi.paymentList(asyncOrder.data.orderNo)).data).toHaveLength(1)
      expect((await userApi.paymentList(syncOrder.data.orderNo)).data).toHaveLength(1)
      expect((await userApi.productDetail(product.id)).data.stock, '两种模式各扣 1 件').toBe(8)
    } finally {
      const restored = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(restored.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }
  })

  test('[PAY-024][P2][L6] 支付端到端耗时与终态一致 @p2 @l6 @m5', async ({ userApi, products }) => {
    const product = await products.create({ price: 18.5, stock: 10 })
    const order = await directOrder(userApi, product.id, 2)
    expect(order.code).toBe(0)

    const start = Date.now()
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    const paymentStatus = await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'], 30_000)
    const elapsed = Date.now() - start
    expect(paymentStatus).toBe('SUCCESS')
    expect(elapsed, `支付端到端 ${elapsed}ms 应 < 30000ms`).toBeLessThan(30_000)

    const orderStatus = await userApi.waitForOrderStatus(order.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'], 30_000)
    expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain(orderStatus)
    const detail = await userApi.paymentDetail(paid.data.tradeNo)
    expect(Number(detail.data.amount), '支付金额=订单应付').toBeCloseTo(Number(order.data.payAmount), 2)
    expect((await userApi.productDetail(product.id)).data.stock, '库存=10-2').toBe(8)

    test.info().annotations.push({
      type: 'observed',
      description: `支付端到端（POST /api/payments → SUCCESS）耗时 ${elapsed}ms；订单最终 ${orderStatus}`
    })
  })
})
