import { test, expect, uniq } from '../fixtures'

/** 造一个待支付订单，返回订单号与商品信息 */
async function prepareOrder(adminApi: any, userApi: any, stock = 100, price = 30) {
  const product = await adminApi.adminCreateProduct({
    name: uniq('支付商品'), price, stock, status: 'ON_SALE'
  })
  const productId = product.data.id
  const order = await userApi.createOrder({ items: [{ productId, quantity: 2 }] })
  return { productId, orderNo: order.data.orderNo, amount: order.data.payAmount }
}

test.describe('支付链路 API', () => {
  test('支付成功：订单流转 PAID -> SHIPPED -> DELIVERED', async ({ adminApi, userApi }) => {
    const { productId, orderNo } = await prepareOrder(adminApi, userApi)

    const pay = await userApi.pay({ orderNo, payType: 'ALIPAY', outcome: 'SUCCESS' })
    expect(pay.code).toBe(0)
    const tradeNo = pay.data.tradeNo

    expect(await userApi.waitForPaymentStatus(tradeNo, ['SUCCESS'])).toBe('SUCCESS')
    expect(await userApi.waitForOrderStatus(orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])).toBeTruthy()

    // MQ 异步发货/签收
    expect(await userApi.waitForOrderStatus(orderNo, ['SHIPPED', 'DELIVERED'], 30_000)).toBeTruthy()
    expect(await userApi.waitForOrderStatus(orderNo, ['DELIVERED'], 30_000)).toBe('DELIVERED')

    const detail = await userApi.getOrder(orderNo)
    expect(detail.data.status).toBe('DELIVERED')
    expect((await userApi.productDetail(productId)).data.stock).toBe(98)
  })

  test('支付失败：订单 PAY_FAILED 且库存回滚', async ({ adminApi, userApi }) => {
    const { productId, orderNo } = await prepareOrder(adminApi, userApi, 100)
    const pay = await userApi.pay({ orderNo, outcome: 'FAILED' })
    expect(pay.code).toBe(0)

    expect(await userApi.waitForPaymentStatus(pay.data.tradeNo, ['FAILED'])).toBe('FAILED')
    expect(await userApi.waitForOrderStatus(orderNo, ['PAY_FAILED'])).toBe('PAY_FAILED')
    expect((await userApi.productDetail(productId)).data.stock).toBe(100)
  })

  test('支付超时：支付单 TIMEOUT，订单可重新支付', async ({ adminApi, userApi }) => {
    const { orderNo } = await prepareOrder(adminApi, userApi)
    const pay = await userApi.pay({ orderNo, outcome: 'TIMEOUT' })
    expect(await userApi.waitForPaymentStatus(pay.data.tradeNo, ['TIMEOUT'])).toBe('TIMEOUT')

    // 重新发起支付
    const retry = await userApi.pay({ orderNo, outcome: 'SUCCESS' })
    expect(retry.code).toBe(0)
    expect(await userApi.waitForPaymentStatus(retry.data.tradeNo, ['SUCCESS'])).toBe('SUCCESS')
    expect(await userApi.waitForOrderStatus(orderNo, ['PAID'])).toBe('PAID')
  })

  test('支付回调幂等：重复 callback 不产生副作用', async ({ adminApi, userApi }) => {
    const { orderNo } = await prepareOrder(adminApi, userApi)
    const pay = await userApi.pay({ orderNo, outcome: 'SUCCESS' })
    const tradeNo = pay.data.tradeNo
    await userApi.waitForPaymentStatus(tradeNo, ['SUCCESS'])

    const first = await userApi.paymentCallback(tradeNo, 'SUCCESS', 'cb-001')
    const second = await userApi.paymentCallback(tradeNo, 'SUCCESS', 'cb-001')
    expect(first.data.status).toBe('SUCCESS')
    expect(second.data.status).toBe('SUCCESS')
    expect(second.data.callbackId).toBe('cb-001')
  })

  test('退款成功：库存回滚且订单取消', async ({ adminApi, userApi }) => {
    const { productId, orderNo } = await prepareOrder(adminApi, userApi, 100)
    const pay = await userApi.pay({ orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(pay.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(orderNo, ['PAID'])

    const refund = await userApi.refund(pay.data.tradeNo)
    expect(refund.code).toBe(0)
    expect(refund.data.status).toBe('REFUNDED')
    expect(await userApi.waitForOrderStatus(orderNo, ['CANCELLED'])).toBe('CANCELLED')
    expect((await userApi.productDetail(productId)).data.stock).toBe(100)
  })

  test('非 SUCCESS 单据退款返回 40906', async ({ adminApi, userApi }) => {
    const { orderNo } = await prepareOrder(adminApi, userApi)
    const pay = await userApi.pay({ orderNo, outcome: 'FAILED' })
    await userApi.waitForPaymentStatus(pay.data.tradeNo, ['FAILED'])
    const res = await userApi.refund(pay.data.tradeNo)
    expect(res.code).toBe(40906)
  })
})
