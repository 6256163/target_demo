import { test, expect } from '../fixtures'

test.describe('购物车 API', () => {
  test.beforeEach(async ({ userApi }) => {
    await userApi.cartClear()
  })

  test('加入购物车后可查询，数量累加且金额正确', async ({ userApi }) => {
    await userApi.cartAdd(1, 2)
    const res = await userApi.cartAdd(1, 3)
    expect(res.code).toBe(0)
    expect(res.data.totalQuantity).toBe(5)

    const view = await userApi.cartView()
    const item = view.data.items.find((i: any) => i.productId === 1)
    expect(item.quantity).toBe(5)
    expect(Number(item.subtotal)).toBeCloseTo(Number(item.snapshotPrice) * 5, 2)
  })

  test('修改数量与删除商品生效', async ({ userApi }) => {
    await userApi.cartAdd(2, 1)
    await userApi.cartUpdate(2, 4)
    expect((await userApi.cartView()).data.totalQuantity).toBe(4)

    await userApi.cartRemove(2)
    expect((await userApi.cartView()).data.totalQuantity).toBe(0)
  })

  test('超过库存加入购物车返回 40903', async ({ adminApi, userApi }) => {
    const created = await adminApi.adminCreateProduct({
      name: `库存不足商品_${Date.now()}`, price: 10, stock: 1, status: 'ON_SALE'
    })
    const res = await userApi.cartAdd(created.data.id, 999)
    expect(res.status).toBe(409)
    expect(res.code).toBe(40903)
  })

  test('下架商品不可加入购物车', async ({ adminApi, userApi }) => {
    const created = await adminApi.adminCreateProduct({
      name: `下架商品_${Date.now()}`, price: 10, stock: 10, status: 'OFF_SALE'
    })
    const res = await userApi.cartAdd(created.data.id, 1)
    expect(res.code).toBe(40902)
  })
})
