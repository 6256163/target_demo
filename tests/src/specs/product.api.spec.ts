import { test, expect, uniq } from '../fixtures'

test.describe('商品 API', () => {
  test('商品列表分页返回且数量正确', async ({ api }) => {
    const res = await api.listProducts({ page: 0, size: 10 })
    expect(res.code).toBe(0)
    expect(res.data.content.length).toBe(10)
    expect(res.data.total).toBeGreaterThan(10)
    expect(res.data.totalPages).toBeGreaterThan(1)
  })

  test('按关键字搜索生效', async ({ adminApi, api }) => {
    const name = uniq('搜索专用商品')
    await adminApi.adminCreateProduct({ name, price: 66.6, stock: 100, status: 'ON_SALE' })

    const res = await api.listProducts({ keyword: name, size: 5 })
    expect(res.code).toBe(0)
    expect(res.data.content.some((p: any) => p.name === name)).toBeTruthy()
  })

  test('商品详情第二次请求命中 Redis 缓存', async ({ api }) => {
    const first = await api.productDetail(1)
    expect(first.code).toBe(0)
    const second = await api.productDetail(1)
    expect(second.code).toBe(0)
    expect(second.data.cached).toBe(true)
  })

  test('不存在的商品返回 40401', async ({ api }) => {
    const res = await api.productDetail(99999999)
    expect(res.status).toBe(404)
    expect(res.code).toBe(40401)
  })

  test('普通用户调用管理员接口返回 403', async ({ userApi }) => {
    const res = await userApi.adminCreateProduct({ name: uniq('非法商品'), price: 1, stock: 1 })
    expect(res.status).toBe(403)
  })

  test('管理员可完成商品新增-修改-删除全链路', async ({ adminApi }) => {
    const name = uniq('CRUD商品')
    const created = await adminApi.adminCreateProduct({
      name, description: '自动化创建', price: 88.8, stock: 300, status: 'ON_SALE'
    })
    expect(created.code).toBe(0)
    const id = created.data.id

    const updated = await adminApi.adminUpdateProduct(id, {
      name, description: '自动化修改', price: 66.6, stock: 200, status: 'ON_SALE'
    })
    expect(updated.code).toBe(0)
    expect(Number(updated.data.price)).toBeCloseTo(66.6, 2)
    expect(updated.data.stock).toBe(200)

    const stock = await adminApi.adminAdjustStock(id, 50)
    expect(stock.data.stock).toBe(250)

    const deleted = await adminApi.adminDeleteProduct(id)
    expect(deleted.code).toBe(0)
    expect((await adminApi.productDetail(id)).code).toBe(40401)
  })
})
