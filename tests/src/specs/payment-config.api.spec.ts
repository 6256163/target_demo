import { test, expect } from '../fixtures'

/** 该用例会临时改写 mock 网关配置，用完恢复，避免污染其他用例与压测 */
test.describe('支付网关配置 API', () => {
  let original: any

  test.beforeEach(async ({ adminApi }) => {
    const res = await adminApi.paymentConfig()
    original = res.data
  })

  test.afterEach(async ({ adminApi }) => {
    if (original) {
      await adminApi.updatePaymentConfig({
        failureRate: original.failureRate,
        timeoutRate: original.timeoutRate,
        minDelayMs: original.minDelayMs,
        maxDelayMs: original.maxDelayMs,
        asyncEnabled: original.asyncEnabled
      })
    }
  })

  test('配置可读写', async ({ adminApi }) => {
    const updated = await adminApi.updatePaymentConfig({
      failureRate: 0, timeoutRate: 0, minDelayMs: 10, maxDelayMs: 20, asyncEnabled: true
    })
    expect(updated.code).toBe(0)
    expect(updated.data.failureRate).toBe(0)
    expect(updated.data.maxDelayMs).toBe(20)
  })

  test('普通用户无权修改配置', async ({ userApi }) => {
    const res = await userApi.paymentConfig()
    expect(res.status).toBe(403)
  })

  test('失败率设为 1 时支付必然失败', async ({ adminApi, userApi }) => {
    await adminApi.updatePaymentConfig({
      failureRate: 1, timeoutRate: 0, minDelayMs: 10, maxDelayMs: 20, asyncEnabled: true
    })
    const product = await adminApi.adminCreateProduct({
      name: `必失败商品_${Date.now()}`, price: 10, stock: 50, status: 'ON_SALE'
    })
    const order = await userApi.createOrder({ items: [{ productId: product.data.id, quantity: 1 }] })
    const pay = await userApi.pay({ orderNo: order.data.orderNo })
    expect(await userApi.waitForPaymentStatus(pay.data.tradeNo, ['FAILED'])).toBe('FAILED')
  })
})
