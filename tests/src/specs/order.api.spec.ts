import { test, expect, uniq } from '../fixtures'

test.describe('订单 API', () => {
  test('直接下单成功并预扣库存', async ({ adminApi, userApi }) => {
    const product = await adminApi.adminCreateProduct({
      name: uniq('下单商品'), price: 12.5, stock: 100, status: 'ON_SALE'
    })
    const productId = product.data.id

    const before = (await userApi.productDetail(productId)).data.stock
    const order = await userApi.createOrder({
      items: [{ productId, quantity: 3 }],
      receiverName: '自动化买家',
      receiverPhone: '13900000001',
      receiverAddress: '测试地址 001 号'
    })
    expect(order.code).toBe(0)
    expect(order.data.status).toBe('PENDING_PAYMENT')
    expect(Number(order.data.payAmount)).toBeCloseTo(37.5, 2)

    const after = (await userApi.productDetail(productId)).data.stock
    expect(after).toBe(before - 3)
  })

  test('购物车下单后清空购物车', async ({ userApi }) => {
    await userApi.cartAdd(1, 2)
    const order = await userApi.createOrder({ fromCart: true })
    expect(order.code).toBe(0)
    expect(order.data.totalQuantity).toBe(2)
    expect((await userApi.cartView()).data.totalQuantity).toBe(0)
  })

  test('取消订单回滚库存', async ({ adminApi, userApi }) => {
    const product = await adminApi.adminCreateProduct({
      name: uniq('取消订单商品'), price: 20, stock: 50, status: 'ON_SALE'
    })
    const productId = product.data.id
    const before = (await userApi.productDetail(productId)).data.stock

    const order = await userApi.createOrder({ items: [{ productId, quantity: 5 }] })
    const cancelled = await userApi.cancelOrder(order.data.orderNo)
    expect(cancelled.code).toBe(0)
    expect(cancelled.data.status).toBe('CANCELLED')

    const after = (await userApi.productDetail(productId)).data.stock
    expect(after).toBe(before)
  })

  test('库存不足时下单返回 40903', async ({ adminApi, userApi }) => {
    const product = await adminApi.adminCreateProduct({
      name: uniq('库存不足下单'), price: 5, stock: 2, status: 'ON_SALE'
    })
    const res = await userApi.createOrder({ items: [{ productId: product.data.id, quantity: 10 }] })
    expect(res.status).toBe(409)
    expect(res.code).toBe(40903)
  })

  test('不能访问他人订单', async ({ adminApi, userApi }) => {
    const product = await adminApi.adminCreateProduct({
      name: uniq('越权订单商品'), price: 8, stock: 20, status: 'ON_SALE'
    })
    const order = await userApi.createOrder({ items: [{ productId: product.data.id, quantity: 1 }] })

    // admin 可跨用户访问
    const byAdmin = await adminApi.getOrder(order.data.orderNo)
    expect(byAdmin.code).toBe(0)

    // 另一个普通用户访问则 403
    const otherName = uniq('other')
    await adminApi.register(otherName, '123456')
    const { ShopApiClient } = await import('../clients/api.client')
    const other = await ShopApiClient.loginAs(otherName, '123456')
    const res = await other.getOrder(order.data.orderNo)
    expect(res.status).toBe(403)
    await other.dispose()
  })

  test('订单分页列表可查询', async ({ userApi }) => {
    const res = await userApi.listOrders({ page: 0, size: 5 })
    expect(res.code).toBe(0)
    expect(res.data.content.length).toBeLessThanOrEqual(5)
    expect(res.data.total).toBeGreaterThan(0)
  })
})
