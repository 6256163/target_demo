import { test, expect, uniq } from '../fixtures'

const RECEIVER = {
  receiverName: '吴十',
  receiverPhone: '13200000000',
  receiverAddress: '武汉市江汉区测试路 8 号'
}

function order(client: any, productId: number, quantity = 1, extra: Record<string, any> = {}) {
  return client.createOrder({
    items: [{ productId, quantity }],
    ...RECEIVER,
    ...extra
  })
}

test.describe('M10 数据一致性 · P2', () => {
  test('[DAT-001][P2][L3] 库存守恒：剩余+占用+已售=初始，无负数 @p2 @l3 @m10', async ({ userApi, products }) => {
    const initial = 50
    const product = await products.create({ price: 10, stock: initial })
    expect((await userApi.productDetail(product.id)).data.stock).toBe(initial)

    const cancelled = await order(userApi, product.id, 2)
    expect(cancelled.code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(initial - 2)
    expect((await userApi.cancelOrder(cancelled.data.orderNo)).code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(initial)

    const failed = await order(userApi, product.id, 2)
    const failedPay = await userApi.pay({ orderNo: failed.data.orderNo, outcome: 'FAILED' })
    await userApi.waitForPaymentStatus(failedPay.data.tradeNo, ['FAILED'])
    await userApi.waitForOrderStatus(failed.data.orderNo, ['PAY_FAILED'])
    expect((await userApi.productDetail(product.id)).data.stock).toBe(initial)

    const refunded = await order(userApi, product.id, 2)
    const refundPay = await userApi.pay({ orderNo: refunded.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(refundPay.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(refunded.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])
    expect((await userApi.refund(refundPay.data.tradeNo)).code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(initial)

    const paid = await order(userApi, product.id, 2)
    const paidPay = await userApi.pay({ orderNo: paid.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(paidPay.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(paid.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])

    const finalStock = (await userApi.productDetail(product.id)).data.stock
    expect(finalStock, '仅剩已支付订单占用 2 件').toBe(initial - 2)
    expect(finalStock).toBeGreaterThanOrEqual(0)

    const orders = await userApi.listOrders({ size: 100 })
    const statuses = orders.data.content.map((o: any) => o.status)
    expect(statuses.filter((s: string) => s === 'CANCELLED')).toHaveLength(2)
    expect(statuses.filter((s: string) => s === 'PAY_FAILED')).toHaveLength(1)
    expect(statuses.filter((s: string) => ['PAID', 'SHIPPED', 'DELIVERED'].includes(s))).toHaveLength(1)
    const totalOrdered = orders.data.content.reduce((acc: number, o: any) => acc + o.totalQuantity, 0)
    expect(totalOrdered, '所有订单数量合计=2*4').toBe(8)
    expect(initial - finalStock, '初始化-剩余应等于净占用（仅已支付 2 件）').toBe(2)
  })

  test('[DAT-002][P2][L3] 四路径回滚：取消/失败/超时/退款均精确回滚且只回滚一次 @p2 @l3 @m10', async ({ userApi, products }) => {
    const baseline = 30
    const qty = 3
    const product = await products.create({ price: 10, stock: baseline })
    const stock = async () => (await userApi.productDetail(product.id)).data.stock

    const cancelled = await order(userApi, product.id, qty)
    expect((await stock())).toBe(baseline - qty)
    expect((await userApi.cancelOrder(cancelled.data.orderNo)).code).toBe(0)
    expect(await stock()).toBe(baseline)
    expect((await userApi.cancelOrder(cancelled.data.orderNo)).code).toBe(40904)
    expect(await stock()).toBe(baseline)

    const failed = await order(userApi, product.id, qty)
    const failedPay = await userApi.pay({ orderNo: failed.data.orderNo, outcome: 'FAILED' })
    await userApi.waitForPaymentStatus(failedPay.data.tradeNo, ['FAILED'])
    await userApi.waitForOrderStatus(failed.data.orderNo, ['PAY_FAILED'])
    expect(await stock()).toBe(baseline)

    const timeout = await order(userApi, product.id, qty)
    const timeoutPay = await userApi.pay({ orderNo: timeout.data.orderNo, outcome: 'TIMEOUT' })
    await userApi.waitForPaymentStatus(timeoutPay.data.tradeNo, ['TIMEOUT'])
    await userApi.waitForOrderStatus(timeout.data.orderNo, ['PAY_FAILED'])
    expect(await stock()).toBe(baseline)

    const refunded = await order(userApi, product.id, qty)
    const refundPay = await userApi.pay({ orderNo: refunded.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(refundPay.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(refunded.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])
    expect((await userApi.refund(refundPay.data.tradeNo)).code).toBe(0)
    expect(await stock()).toBe(baseline)
    expect((await userApi.refund(refundPay.data.tradeNo)).code).toBe(40906)
    expect(await stock()).toBe(baseline)
  })

  test('[DAT-003][P2][L3] 支付唯一性：每订单至多 1 条 SUCCESS，退款后无有效 SUCCESS @p2 @l3 @m10', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const created = await order(userApi, product.id, 1)
    expect(created.code).toBe(0)

    const timeout = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'TIMEOUT' })
    await userApi.waitForPaymentStatus(timeout.data.tradeNo, ['TIMEOUT'])
    await userApi.waitForOrderStatus(created.data.orderNo, ['PAY_FAILED'])

    const success = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS' })
    expect(success.code).toBe(0)
    await userApi.waitForPaymentStatus(success.data.tradeNo, ['SUCCESS'])

    const payments = await userApi.paymentList(created.data.orderNo)
    expect(payments.data).toHaveLength(2)
    expect(payments.data.filter((p: any) => p.status === 'SUCCESS'), '只能有 1 条 SUCCESS').toHaveLength(1)
    expect(new Set(payments.data.map((p: any) => p.tradeNo)).size, 'tradeNo 不得重复').toBe(payments.data.length)

    const refund = await userApi.refund(success.data.tradeNo)
    expect(refund.code).toBe(0)
    const after = await userApi.paymentList(created.data.orderNo)
    expect(after.data.filter((p: any) => p.status === 'SUCCESS'), '退款后不得残留有效 SUCCESS').toHaveLength(0)
    expect(after.data.filter((p: any) => p.status === 'REFUNDED')).toHaveLength(1)
    expect((await userApi.getOrder(created.data.orderNo)).data.status).toBe('CANCELLED')
    expect((await userApi.productDetail(product.id)).data.stock, '退款后库存回到初始 10').toBe(10)
  })

  test('[DAT-004][P2][L3] 金额一致性：购物车/订单/支付/退款逐级相等 @p2 @l3 @m10', async ({ userApi, products }) => {
    const first = await products.create({ price: 12.34, stock: 10 })
    const second = await products.create({ price: 5, stock: 10 })

    await userApi.cartAdd(first.id, 2)
    const cart = await userApi.cartAdd(second.id, 3)
    expect(cart.code).toBe(0)
    const expected = 12.34 * 2 + 5 * 3
    expect(Number(cart.data.items[0].subtotal) + Number(cart.data.items[1].subtotal)).toBeCloseTo(expected, 2)
    expect(Number(cart.data.totalAmount)).toBeCloseTo(expected, 2)
    expect(cart.data.totalQuantity).toBe(5)

    const created = await userApi.createOrder({ fromCart: true, ...RECEIVER })
    expect(created.code).toBe(0)
    expect(Number(created.data.totalAmount)).toBeCloseTo(expected, 2)
    expect(Number(created.data.payAmount)).toBeCloseTo(expected, 2)
    const itemSum = created.data.items.reduce((acc: number, i: any) => acc + Number(i.subtotal), 0)
    expect(itemSum, '订单明细小计之和=订单总额').toBeCloseTo(expected, 2)
    expect(created.data.totalQuantity).toBe(5)
    expect((await userApi.cartView()).data.items, '下单后购物车应清空').toEqual([])

    const pay = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS' })
    expect(pay.code).toBe(0)
    await userApi.waitForPaymentStatus(pay.data.tradeNo, ['SUCCESS'])
    expect(Number(pay.data.amount)).toBeCloseTo(expected, 2)
    expect(Number((await userApi.paymentDetail(pay.data.tradeNo)).data.amount)).toBeCloseTo(expected, 2)

    const refund = await userApi.refund(pay.data.tradeNo)
    expect(refund.code).toBe(0)
    expect(Number(refund.data.amount)).toBeCloseTo(expected, 2)
    const after = await userApi.getOrder(created.data.orderNo)
    expect(Number(after.data.totalAmount)).toBeCloseTo(expected, 2)
    expect(Number(after.data.payAmount)).toBeCloseTo(expected, 2)
    expect(Number(refund.data.amount)).toBeCloseTo(Number(after.data.payAmount), 2)
  })

  test('[DAT-005][P2][L3] 缓存一致性：改价/改库存/删除后详情与列表一致 @p2 @l3 @m10', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 10, name: uniq('dat5') })
    await userApi.cartAdd(product.id, 1)

    expect((await userApi.productDetail(product.id)).data.cached).toBe(false)
    expect((await userApi.productDetail(product.id)).data.cached).toBe(true)

    const updated = await adminApi.adminUpdateProduct(product.id, {
      name: product.name,
      description: product.description,
      price: 12,
      stock: 8,
      status: 'ON_SALE'
    })
    expect(updated.code).toBe(0)

    const detail = await userApi.productDetail(product.id)
    expect(Number(detail.data.price)).toBeCloseTo(12, 2)
    expect(detail.data.stock).toBe(8)
    expect(detail.data.cached, '更新后应回源').toBe(false)

    const list = await userApi.listProducts({ keyword: product.name, size: 10 })
    const listed = list.data.content.find((p: any) => p.id === product.id)
    expect(listed).toBeTruthy()
    expect(Number(listed.price)).toBeCloseTo(12, 2)
    expect(listed.stock).toBe(8)
    expect(Number(listed.price), '列表与详情价格一致').toBeCloseTo(Number(detail.data.price), 2)

    const cart = await userApi.cartView()
    expect(Number(cart.data.items[0].snapshotPrice), '购物车保留加购时快照价').toBeCloseTo(10, 2)
    expect(cart.data.items[0].availableStock, 'availableStock 与最新库存一致').toBe(8)

    const created = await userApi.createOrder({ fromCart: true, ...RECEIVER })
    expect(created.code).toBe(0)
    // 与 CART-011 同口径：当前实现按商品最新价下单，购物车仅保留快照展示
    expect(Number(created.data.totalAmount), '当前实现按最新价 12 下单').toBeCloseTo(12, 2)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(7)

    expect((await adminApi.adminDeleteProduct(product.id)).code).toBe(0)
    expect((await userApi.productDetail(product.id)).code).toBe(40401)
    const afterDelete = await userApi.listProducts({ keyword: product.name, size: 10 })
    expect(afterDelete.data.content.map((p: any) => p.id)).not.toContain(product.id)
  })

  test('[DAT-006][P2][L6] 异步收敛：支付/履约最终一致，MQ 健康 @p2 @l6 @m10', async ({ userApi, api, products }) => {
    const product = await products.create({ price: 15, stock: 10 })
    const created = await order(userApi, product.id, 2)
    expect(created.code).toBe(0)

    const start = Date.now()
    const paid = await userApi.pay({ orderNo: created.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    expect(await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'], 30_000)).toBe('SUCCESS')
    const elapsed = Date.now() - start
    expect(elapsed, `支付收敛 ${elapsed}ms 应 < 30s`).toBeLessThan(30_000)

    const orderStatus = await userApi.waitForOrderStatus(
      created.data.orderNo,
      ['PAID', 'SHIPPED', 'DELIVERED'],
      30_000
    )
    expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain(orderStatus)

    const payment = await userApi.paymentDetail(paid.data.tradeNo)
    expect(payment.data.status).not.toBe('PROCESSING')
    expect(Number(payment.data.amount)).toBeCloseTo(30, 2)
    expect((await userApi.getOrder(created.data.orderNo)).data.status).not.toBe('PAYING')
    expect((await userApi.productDetail(product.id)).data.stock, '库存=10-2').toBe(8)

    const health = await api.raw('GET', '/actuator/health', { token: false })
    expect(health.raw.components.rabbit.status, 'MQ 应健康').toBe('UP')
    expect(health.raw.components.db.status).toBe('UP')
    expect(health.raw.components.redis.status).toBe('UP')

    const first = (await userApi.getOrder(created.data.orderNo)).data.status
    await new Promise(resolve => setTimeout(resolve, 1000))
    const second = (await userApi.getOrder(created.data.orderNo)).data.status
    expect(second, '收敛后状态不应回退').toBe(first)

    test.info().annotations.push({
      type: 'observed',
      description: `支付到 SUCCESS 耗时 ${elapsed}ms，订单最终 ${first}；MQ/DB/Redis 健康`
    })
  })
})
