import { test, expect, registerFreshUser, uniq } from '../fixtures'
import type { ShopApiClient } from '../clients/api.client'
import type { ApiResult } from '../clients/api.client'
import { concurrently, percentile, timed } from '../support/perf'

const RECEIVER = {
  receiverName: '周九',
  receiverPhone: '13300000000',
  receiverAddress: '南京市鼓楼区测试路 7 号'
}

function order(
  client: ShopApiClient,
  productId: number,
  quantity = 1,
  extra: Record<string, any> = {}
): Promise<ApiResult> {
  return client.createOrder({
    items: [{ productId, quantity }],
    ...RECEIVER,
    ...extra
  })
}

test.describe('M9 并发与幂等 · P2', () => {
  test('[CON-001][P2][L4] 并发下单同一商品：不超卖、失败码可预期 @p2 @l4 @m9', async ({ userApi, products }) => {
    const stock = 8
    const attempts = 12
    const product = await products.create({ price: 10, stock })

    const results = await concurrently(attempts, () => order(userApi, product.id, 1))
    expect(results.every(r => !r.error), '并发下单不得出现网络异常').toBe(true)
    const responses = results.map(r => r.value!)
    const successes = responses.filter(r => r.code === 0)
    const failures = responses.filter(r => r.code !== 0)

    expect(successes, `成功数应等于库存 ${stock}`).toHaveLength(stock)
    expect(failures).toHaveLength(attempts - stock)
    for (const failure of failures) {
      expect.soft(failure.status, '失败订单应 HTTP 409').toBe(409)
      expect.soft([40903, 40900], '失败码应为 40903/40900').toContain(failure.code)
    }

    const detail = await userApi.productDetail(product.id)
    expect(detail.data.stock, '最终库存必须为 0').toBe(0)
    const orders = await userApi.listOrders({ size: 100 })
    expect(orders.data.total, '只应落库成功订单').toBe(stock)
  })

  test('[CON-002][P2][L4] 多商品部分库存不足：事务原子、无半单 @p2 @l4 @m9', async ({ userApi, products }) => {
    const enough = await products.create({ price: 10, stock: 5 })
    const scarce = await products.create({ price: 20, stock: 1 })

    const res = await userApi.createOrder({
      items: [
        { productId: enough.id, quantity: 2 },
        { productId: scarce.id, quantity: 2 }
      ],
      ...RECEIVER
    })

    expect(res.status, '部分库存不足应 HTTP 409').toBe(409)
    expect(res.code).toBe(40903)
    expect((await userApi.productDetail(enough.id)).data.stock, '先扣的商品库存必须回滚').toBe(5)
    expect((await userApi.productDetail(scarce.id)).data.stock, '不足商品库存不得变化').toBe(1)
    expect((await userApi.listOrders()).data.total, '失败下单不得产生半单').toBe(0)
  })

  test('[CON-003][P2][L4] 同 idempotencyKey 重试支付：至多 1 张支付单 @p2 @l4 @m9', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const created = await order(userApi, product.id, 1)
    expect(created.code).toBe(0)
    const key = uniq('con-key')

    const first = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'TIMEOUT', idempotencyKey: key })
    expect(first.code).toBe(0)
    await userApi.waitForPaymentStatus(first.data.tradeNo, ['TIMEOUT'])
    await userApi.waitForOrderStatus(created.data.orderNo, ['PAY_FAILED'])

    // 同 key 重试 4 次（并发）：都应命中同一张支付单
    const results = await concurrently(4, () =>
      userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS', idempotencyKey: key })
    )
    expect(results.every(r => !r.error), '重试不得出现网络异常').toBe(true)
    const responses = results.map(r => r.value!)
    expect(responses.every(r => r.status < 500), '重试不得 500').toBe(true)
    for (const response of responses) {
      expect.soft(response.code, '同 key 重试应成功').toBe(0)
      expect.soft(response.data?.tradeNo, '同 key 重试必须返回原支付单').toBe(first.data.tradeNo)
    }

    const payments = await userApi.paymentList(created.data.orderNo)
    expect(payments.data, '同 idempotencyKey 只能有 1 张支付单').toHaveLength(1)
    expect(payments.data.filter((p: any) => p.status === 'SUCCESS')).toHaveLength(1)
  })

  test('[CON-004][P2][L4] 同 callbackId 并发回调：幂等且不重复变更 @p2 @l4 @m9', async ({ userApi, adminApi, products }) => {
    const snapshot = (await adminApi.paymentConfig()).data
    try {
      await adminApi.updatePaymentConfig({
        failureRate: snapshot.failureRate,
        timeoutRate: snapshot.timeoutRate,
        minDelayMs: 3000,
        maxDelayMs: 3000,
        asyncEnabled: true
      })

      const product = await products.create({ price: 10, stock: 10 })
      const created = await order(userApi, product.id, 2)
      const paid = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS' })
      expect(paid.code).toBe(0)
      expect(paid.data.status).toBe('PROCESSING')

      const callbackId = uniq('con-cb')
      const results = await concurrently(6, () =>
        userApi.paymentCallback(paid.data.tradeNo, 'SUCCESS', callbackId)
      )
      const responses = results.map(r => r.value!)
      for (const response of responses) {
        expect.soft(response.status).toBe(200)
        expect.soft(response.code).toBe(0)
        expect.soft(response.data.status, '并发回调结果应为 SUCCESS').toBe('SUCCESS')
      }

      expect((await userApi.paymentDetail(paid.data.tradeNo)).data.status).toBe('SUCCESS')
      expect((await userApi.paymentList(created.data.orderNo)).data).toHaveLength(1)
      expect((await userApi.productDetail(product.id)).data.stock, '库存=10-2').toBe(8)
      expect((await userApi.getOrder(created.data.orderNo)).data.status).not.toBe('PAY_FAILED')

      const again = await userApi.paymentCallback(paid.data.tradeNo, 'SUCCESS', callbackId)
      expect(again.code).toBe(0)
      expect(again.data.status).toBe('SUCCESS')
    } finally {
      const restore = await adminApi.updatePaymentConfig({
        failureRate: snapshot.failureRate,
        timeoutRate: snapshot.timeoutRate,
        minDelayMs: snapshot.minDelayMs,
        maxDelayMs: snapshot.maxDelayMs,
        asyncEnabled: snapshot.asyncEnabled
      })
      expect(restore.code, '用例结束后必须恢复全局支付配置').toBe(0)
    }
  })

  test('[CON-005][P2][L4] 支付与取消并发：终态唯一 @p2 @l4 @m9', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const created = await order(userApi, product.id, 2)
    expect(created.code).toBe(0)

    const [cancel, pay] = await Promise.all([
      userApi.cancelOrder(created.data.orderNo),
      userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS' })
    ])
    expect(cancel.status, '取消不得 500').toBeLessThan(500)
    expect(pay.status, '支付不得 500').toBeLessThan(500)

    let paymentStatus = ''
    if (pay.code === 0) {
      paymentStatus = await userApi.waitForPaymentStatus(pay.data.tradeNo, ['SUCCESS', 'FAILED', 'TIMEOUT'])
    }
    const finalStatus = (await userApi.getOrder(created.data.orderNo)).data.status
    const stock = (await userApi.productDetail(product.id)).data.stock

    if (finalStatus === 'CANCELLED') {
      expect(cancel.code).toBe(0)
      expect(paymentStatus).not.toBe('SUCCESS')
      expect(stock).toBe(10)
    } else {
      expect(cancel.code).not.toBe(0)
      expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain(finalStatus)
      expect(paymentStatus).toBe('SUCCESS')
      expect(stock).toBe(8)
    }
    expect((await userApi.paymentList(created.data.orderNo)).data.length, '不得生成多张支付单').toBeLessThanOrEqual(1)
  })

  test('[CON-006][P2][L4] 退款与发货并发：库存只回滚一次 @p2 @l4 @m9', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const created = await order(userApi, product.id, 2)
    const paid = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(created.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])

    const [refund, ship] = await Promise.all([
      userApi.refund(paid.data.tradeNo),
      adminApi.adminShip(created.data.orderNo)
    ])
    expect(refund.status, '退款不得 500').toBeLessThan(500)
    expect(ship.status, '发货不得 500').toBeLessThan(500)
    expect(refund.code, 'SUCCESS 支付单退款应成功').toBe(0)

    const payment = await userApi.paymentDetail(paid.data.tradeNo)
    expect(payment.data.status).toBe('REFUNDED')
    const finalOrder = await userApi.getOrder(created.data.orderNo)
    expect(['CANCELLED', 'SHIPPED', 'DELIVERED']).toContain(finalOrder.data.status)
    const stock = (await userApi.productDetail(product.id)).data.stock
    expect(stock, '退款后库存只能回到初始值，且不得为负').toBe(10)

    const refundAgain = await userApi.refund(paid.data.tradeNo)
    expect(refundAgain.code, '重复退款应 40906').toBe(40906)
    expect((await userApi.productDetail(product.id)).data.stock, '重复退款不得再次回滚').toBe(10)
  })

  test('[CON-007][P2][L4] 并发改数量：无重复行、总额与数量自洽 @p2 @l4 @m9', async ({ userApi, products }) => {
    const product = await products.create({ price: 4, stock: 100 })
    const added = await userApi.cartAdd(product.id, 1)
    expect(added.code).toBe(0)

    const quantities = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    const results = await concurrently(quantities.length, index =>
      userApi.cartUpdate(product.id, quantities[index])
    )
    const responses = results.map(r => r.value!)
    expect(responses.every(r => r.status < 500), '并发改数量不得 500').toBe(true)

    const cart = await userApi.cartView()
    expect(cart.data.items, '不得产生重复购物车行').toHaveLength(1)
    const item = cart.data.items[0]
    expect(quantities, '最终数量必须是某一次成功写入的值').toContain(item.quantity)
    expect(Number(item.subtotal)).toBeCloseTo(4 * item.quantity, 2)
    expect(cart.data.totalQuantity).toBe(item.quantity)
    expect(Number(cart.data.totalAmount)).toBeCloseTo(4 * item.quantity, 2)
    expect(Number(cart.data.totalAmount)).toBeCloseTo(Number(item.subtotal), 2)
  })

  test('[CON-008][P2][L6] 50 并发下单/支付/查询混合冒烟 @p2 @l6 @m9', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 100 })
    const orderCount = 15
    const prepared: any[] = []
    for (let i = 0; i < orderCount; i++) {
      const created = await order(userApi, product.id, 1)
      expect(created.code).toBe(0)
      prepared.push(created.data)
    }
    expect((await userApi.productDetail(product.id)).data.stock).toBe(100 - orderCount)

    const tasks: Array<() => Promise<any>> = [
      ...prepared.map((o, i) => () => userApi.pay({ orderNo: o.orderNo, outcome: 'SUCCESS', idempotencyKey: `mix-${i}` })),
      ...Array.from({ length: 20 }, () => () => userApi.listProducts({ size: 20 })),
      ...Array.from({ length: 15 }, () => () => userApi.productDetail(product.id))
    ]

    const started = Date.now()
    const results = await concurrently(tasks.length, index => tasks[index]())
    const elapsed = Date.now() - started
    expect(results.every(r => !r.error), '混合并发不得出现网络异常').toBe(true)

    const responses = results.map(r => r.value!)
    const serverErrors = responses.filter(r => r.status >= 500)
    expect(serverErrors.map(r => `${r.status}/${r.code}`), '混合并发不得出现 5xx').toEqual([])
    const failures = responses.filter(r => r.status !== 200 || r.code !== 0)
    expect(failures.map(r => `${r.status}/${r.code}`), '混合并发全部应 200/0').toEqual([])

    const p95 = percentile(results.map(r => r.ms), 95)
    expect(p95, `混合并发 P95=${p95}ms 应 < 3000ms`).toBeLessThan(3000)
    expect(elapsed).toBeLessThan(30_000)

    const payResponses = responses.slice(0, orderCount)
    await Promise.all(
      payResponses.map(r => userApi.waitForPaymentStatus(r.data.tradeNo, ['SUCCESS'], 30_000))
    )
    expect((await userApi.productDetail(product.id)).data.stock, '15 笔支付成功后库存=85').toBe(85)

    test.info().annotations.push({
      type: 'observed',
      description: `50 并发混合（15 支付 + 20 列表 + 15 详情）总耗时 ${elapsed}ms，P95=${p95}ms`
    })
  })
})
