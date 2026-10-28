import { test, expect, registerFreshUser } from '../fixtures'
import { concurrently } from '../support/perf'

const RECEIVER = {
  receiverName: '钱七',
  receiverPhone: '13500000000',
  receiverAddress: '杭州市西湖区测试路 5 号'
}

test.describe('M3 购物车', () => {
  test('[CART-001][P0][L1] 新用户购物车为空 @p0 @l1 @m3', async ({ userApi }) => {
    const res = await userApi.cartView()

    expect(res.status).toBe(200)
    expect(res.code).toBe(0)
    expect(res.data.items).toEqual([])
    expect(Number(res.data.totalAmount)).toBe(0)
    expect(res.data.totalQuantity).toBe(0)
  })

  test('[CART-002][P0][L1] 加入购物车后快照价/小计/总额/可用库存正确 @p0 @l1 @m3', async ({ userApi, products }) => {
    const product = await products.create({ price: 12.34, stock: 100 })

    const res = await userApi.cartAdd(product.id, 2)

    expect(res.code).toBe(0)
    expect(res.data.items).toHaveLength(1)
    const item = res.data.items[0]
    expect(item.productId).toBe(product.id)
    expect(item.productName).toBe(product.name)
    expect(Number(item.snapshotPrice), 'API.md §2：CartItemResponse.snapshotPrice').toBeCloseTo(12.34, 2)
    expect(item.quantity).toBe(2)
    expect(Number(item.subtotal)).toBeCloseTo(24.68, 2)
    expect(item.availableStock).toBe(100)
    expect(Number(res.data.totalAmount)).toBeCloseTo(24.68, 2)
    expect(res.data.totalQuantity).toBe(2)
  })

  test('[CART-003][P0][L1] 同商品重复加购累加为一行且金额正确 @p0 @l1 @m3', async ({ userApi, products }) => {
    const product = await products.create({ price: 12.34, stock: 100 })

    await userApi.cartAdd(product.id, 2)
    const res = await userApi.cartAdd(product.id, 3)

    expect(res.code).toBe(0)
    // API.md 未定义重复加购语义；按源码约定固定为“单行累加”，Phase 0 需写入文档
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].quantity).toBe(5)
    expect(Number(res.data.items[0].subtotal)).toBeCloseTo(61.7, 2)
    expect(Number(res.data.totalAmount)).toBeCloseTo(61.7, 2)
    expect(res.data.totalQuantity).toBe(5)
  })

  test('[CART-004][P0][L1] 修改购物车数量后数量与金额同步 @p0 @l1 @m3', async ({ userApi, products }) => {
    const product = await products.create({ price: 12.34, stock: 100 })
    await userApi.cartAdd(product.id, 1)

    const res = await userApi.cartUpdate(product.id, 4)

    expect(res.code).toBe(0)
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].quantity).toBe(4)
    expect(Number(res.data.items[0].subtotal)).toBeCloseTo(49.36, 2)
    expect(Number(res.data.totalAmount)).toBeCloseTo(49.36, 2)
    expect(res.data.totalQuantity).toBe(4)
    expect(res.data.items[0].availableStock).toBe(100)
  })

  test('[CART-005][P0][L1] 删除单项与清空购物车 @p0 @l1 @m3', async ({ userApi, products }) => {
    const first = await products.create({ price: 5, stock: 20 })
    const second = await products.create({ price: 8, stock: 20 })
    await userApi.cartAdd(first.id, 1)
    await userApi.cartAdd(second.id, 2)

    const removed = await userApi.cartRemove(first.id)
    expect(removed.code).toBe(0)
    expect(removed.data.items).toHaveLength(1)
    expect(removed.data.items[0].productId).toBe(second.id)
    expect(removed.data.totalQuantity).toBe(2)

    const cleared = await userApi.cartClear()
    expect(cleared.code).toBe(0)
    expect(cleared.data.items).toEqual([])
    expect(Number(cleared.data.totalAmount)).toBe(0)
    expect(cleared.data.totalQuantity).toBe(0)
  })

  test('[CART-006][P0][L1] 加购不存在/已下架商品返回 40401/40902 @p0 @l1 @m3', async ({ userApi, products }) => {
    const missing = await userApi.cartAdd(99999999, 1)
    expect(missing.status).toBe(404)
    expect(missing.code).toBe(40401)

    const offSale = await products.create({ status: 'OFF_SALE', stock: 10 })
    const rejected = await userApi.cartAdd(offSale.id, 1)
    expect(rejected.status, 'API.md §1.4：40902 映射 HTTP 409').toBe(409)
    expect(rejected.code).toBe(40902)
  })
})

test.describe('M3 购物车 · P1', () => {
  test('[CART-007][P1][L1] 加购数量边界：单次/累计库存上限、0、负数 @p1 @l1 @m3', async ({ userApi, products }) => {
    const single = await products.create({ stock: 10 })
    expect((await userApi.cartAdd(single.id, 1)).code).toBe(0)

    const exact = await products.create({ stock: 3 })
    expect((await userApi.cartAdd(exact.id, 3)).code, '数量=库存应允许').toBe(0)

    const small = await products.create({ stock: 2 })
    const over = await userApi.cartAdd(small.id, 3)
    expect(over.status, '单次加购超库存应 HTTP 409').toBe(409)
    expect(over.code).toBe(40903)

    const zero = await userApi.cartAdd(small.id, 0)
    expect.soft(zero.status, 'quantity=0 应 HTTP 400').toBe(400)
    expect.soft(zero.code).toBe(40000)

    const negative = await userApi.cartAdd(small.id, -1)
    expect.soft(negative.status, 'quantity=-1 应 HTTP 400').toBe(400)
    expect.soft(negative.code).toBe(40000)

    const cumulative = await userApi.cartAdd(single.id, 10)
    expect.soft(cumulative.status, '累计数量 1+10 超过库存 10，应 HTTP 409').toBe(409)
    expect.soft(cumulative.code, '累计数量不得突破库存（API.md 未定义累加语义，按库存约束推导）').toBe(40903)

    const empty = await products.create({ stock: 0 })
    const noStock = await userApi.cartAdd(empty.id, 1)
    expect(noStock.status).toBe(409)
    expect(noStock.code).toBe(40903)
  })

  test('[CART-008][P1][L1] 修改数量边界：0 删除、负数、超库存、缺 quantity @p1 @l1 @m3', async ({ userApi, products }) => {
    const product = await products.create({ stock: 10 })
    await userApi.cartAdd(product.id, 1)

    const five = await userApi.cartUpdate(product.id, 5)
    expect(five.code).toBe(0)
    expect(five.data.items[0].quantity).toBe(5)

    const over = await userApi.cartUpdate(product.id, 11)
    expect.soft(over.status, '修改到超过库存应 HTTP 409').toBe(409)
    expect.soft(over.code).toBe(40903)

    const negative = await userApi.cartUpdate(product.id, -1)
    expect.soft(negative.status, 'quantity=-1 应 HTTP 400 而不是静默删除').toBe(400)
    expect.soft(negative.code).toBe(40000)

    const missing = await userApi.cartUpdateRaw(product.id, {})
    expect.soft(missing.status, '缺少 quantity 应 HTTP 400').toBe(400)
    expect.soft(missing.code, '缺少 quantity 不应 500').toBe(40000)

    await userApi.cartAdd(product.id, 2)
    const zero = await userApi.cartUpdate(product.id, 0)
    expect(zero.code, 'quantity=0 语义为删除该行').toBe(0)
    expect(zero.data.items).toEqual([])
    expect(Number(zero.data.totalAmount)).toBe(0)

    const absent = await userApi.cartUpdate(product.id, 1)
    expect(absent.status, '修改购物车中不存在的商品应 404').toBe(404)
    expect(absent.code).toBe(40400)
  })

  test('[CART-009][P1][L1] 删除不存在条目、重复删除、清空空车 @p1 @l1 @m3', async ({ userApi, products }) => {
    const emptyClear = await userApi.cartClear()
    expect.soft(emptyClear.status, 'API.md §3.4：购物车为空时清空应 HTTP 409').toBe(409)
    expect.soft(emptyClear.code, 'API.md §3.4：购物车为空应返回 40905').toBe(40905)

    const first = await products.create({ stock: 5 })
    await userApi.cartAdd(first.id, 1)
    const removed = await userApi.cartRemove(first.id)
    expect(removed.code).toBe(0)
    expect(removed.data.items).toEqual([])

    const removedAgain = await userApi.cartRemove(first.id)
    expect.soft(removedAgain.status, '重复删除不应 500').toBeLessThan(500)
    expect(removedAgain.code).toBe(0)
    test.info().annotations.push({
      type: 'observed',
      description: `重复删除不存在条目返回 code=${removedAgain.code}；API.md 未定义该分支，按幂等成功固定`
    })

    const missing = await userApi.cartRemove(99999999)
    expect(missing.status, '删除不存在的 productId 不应 500').toBe(200)
    expect(missing.code).toBe(0)

    const second = await products.create({ stock: 5 })
    await userApi.cartAdd(first.id, 1)
    await userApi.cartAdd(second.id, 2)
    const cleared = await userApi.cartClear()
    expect(cleared.code).toBe(0)
    expect(cleared.data.items).toEqual([])
    expect(Number(cleared.data.totalAmount)).toBe(0)
    expect(cleared.data.totalQuantity).toBe(0)
  })

  test('[CART-010][P1][L5] 用户购物车相互隔离 @p1 @l5 @m3', async ({ freshUser, products }) => {
    const other = await registerFreshUser()
    try {
      const productA = await products.create({ stock: 10 })
      const productB = await products.create({ stock: 10 })

      await freshUser.client.cartAdd(productA.id, 2)
      await other.client.cartAdd(productB.id, 1)

      const viewA = await freshUser.client.cartView()
      const viewB = await other.client.cartView()
      expect(viewA.data.items.map((i: any) => i.productId)).toEqual([productA.id])
      expect(viewB.data.items.map((i: any) => i.productId)).toEqual([productB.id])

      // B 用 productId 操作购物车，只能影响自己的数据
      await other.client.cartRemove(productA.id)
      expect((await freshUser.client.cartView()).data.items.map((i: any) => i.productId)).toEqual([productA.id])

      await freshUser.client.cartClear()
      expect((await other.client.cartView()).data.items.map((i: any) => i.productId)).toEqual([productB.id])
    } finally {
      await other.client.dispose()
    }
  })
})

test.describe('M3 购物车 · P2', () => {
  test('[CART-011][P2][L3] 商品改价/改库存后：快照价不变、availableStock 刷新 @p2 @l3 @m3', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 5 })
    await userApi.cartAdd(product.id, 2)

    const updated = await adminApi.adminUpdateProduct(product.id, {
      name: product.name,
      description: product.description,
      price: 20,
      stock: 3,
      status: 'ON_SALE'
    })
    expect(updated.code).toBe(0)

    const cart = await userApi.cartView()
    expect(cart.code).toBe(0)
    expect(cart.data.items).toHaveLength(1)
    const item = cart.data.items[0]
    expect(Number(item.snapshotPrice), '加入购物车时的价格快照应保持不变').toBeCloseTo(10, 2)
    expect(Number(item.subtotal), '小计按快照价计算').toBeCloseTo(20, 2)
    expect(item.availableStock, 'availableStock 应读取商品最新库存').toBe(3)
    expect(Number(cart.data.totalAmount)).toBeCloseTo(20, 2)
    expect(cart.data.totalQuantity).toBe(2)

    const order = await userApi.createOrder({ fromCart: true, ...RECEIVER })
    expect(order.code).toBe(0)
    // API.md 未规定 fromCart 下单取价来源（快照价 vs 商品最新价）；当前实现按最新价 20 计算
    expect(Number(order.data.totalAmount), '当前实现按商品最新价计算订单金额').toBeCloseTo(40, 2)
    expect(Number(order.data.items[0].price), '订单明细记录商品最新价').toBeCloseTo(20, 2)
    expect((await userApi.productDetail(product.id)).data.stock, '按快照数量扣减最新库存 3-2').toBe(1)

    test.info().annotations.push({
      type: 'observed',
      description: '改价后购物车小计仍按快照价（20），但 fromCart 下单按商品最新价（40）；API.md 未定义取价来源，此处固化实现并标记价格口径风险'
    })
  })

  test('[CART-012][P2][L3] 加购后商品下架/删除：下单失败且不产生脏数据 @p2 @l3 @m3', async ({ userApi, adminApi, products }) => {
    const offSale = await products.create({ price: 10, stock: 10 })
    await userApi.cartAdd(offSale.id, 1)
    await adminApi.adminUpdateProduct(offSale.id, {
      name: offSale.name,
      description: offSale.description,
      price: 10,
      stock: 10,
      status: 'OFF_SALE'
    })

    const offSaleOrder = await userApi.createOrder({ fromCart: true, ...RECEIVER })
    expect.soft(offSaleOrder.status, '购物车含下架商品时下单应 HTTP 409').toBe(409)
    expect.soft(offSaleOrder.code).toBe(40902)
    expect((await userApi.cartView()).data.items.map((i: any) => i.productId), '失败下单不得清空购物车').toContain(
      offSale.id
    )
    expect((await userApi.listOrders()).data.total, '失败下单不得落库').toBe(0)

    await userApi.cartClear()
    const deleted = await products.create({ price: 10, stock: 10 })
    await userApi.cartAdd(deleted.id, 1)
    expect((await adminApi.adminDeleteProduct(deleted.id)).code).toBe(0)

    const deletedOrder = await userApi.createOrder({ fromCart: true, ...RECEIVER })
    expect.soft(deletedOrder.status, '购物车含已删除商品时下单应 HTTP 404').toBe(404)
    expect.soft(deletedOrder.code).toBe(40401)
    expect((await userApi.listOrders()).data.total, '失败下单不得落库').toBe(0)

    const cart = await userApi.cartView()
    expect(cart.code, '购物车仍可查询').toBe(0)
    expect(cart.data.items[0].productName, '已删除商品在购物车中显示占位名').toBe('(已下架)')
    expect(cart.data.items[0].availableStock, '已删除商品可用库存为 0').toBe(0)
  })

  test('[CART-013][P2][L4] 同用户并发加购同一商品：单行累加、数量守恒 @p2 @l4 @m3', async ({ userApi, products }) => {
    const product = await products.create({ price: 7.5, stock: 100 })
    const attempts = 10

    const results = await concurrently(attempts, () => userApi.cartAdd(product.id, 1))
    expect(results.every(r => !r.error), '并发加购不得出现网络异常').toBe(true)

    const responses = results.map(r => r.value!)
    const failures = responses.filter(r => r.status !== 200 || r.code !== 0)
    expect(failures.map(r => `${r.status}/${r.code}:${r.message}`), '并发加购应全部成功').toEqual([])

    const cart = await userApi.cartView()
    expect(cart.data.items, '同一商品不得产生重复购物车行').toHaveLength(1)
    const item = cart.data.items[0]
    expect(item.quantity, '数量应等于全部成功加购之和').toBe(attempts)
    expect(Number(item.subtotal)).toBeCloseTo(7.5 * attempts, 2)
    expect(cart.data.totalQuantity).toBe(attempts)
    expect(Number(cart.data.totalAmount)).toBeCloseTo(7.5 * attempts, 2)
  })

  test('[CART-014][P2][L5] 加购异常入参：类型错误/越界/额外字段均不 500 @p2 @l5 @m3', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const probes: Array<[string, any, number, number]> = [
      ['productId=abc', { productId: 'abc', quantity: 1 }, 400, 40000],
      ['productId=null', { productId: null, quantity: 1 }, 400, 40000],
      ['quantity=1.5', { productId: product.id, quantity: 1.5 }, 400, 40000],
      ['quantity=x', { productId: product.id, quantity: 'x' }, 400, 40000],
      ['quantity=2147483648', { productId: product.id, quantity: 2147483648 }, 400, 40000],
      ['productId 不存在', { productId: 99999999, quantity: 1 }, 404, 40401]
    ]

    for (const [label, payload, status, code] of probes) {
      const res = await userApi.cartAddRaw(payload)
      expect.soft(res.status, `${label} 应 HTTP ${status}`).toBe(status)
      expect.soft(res.code, `${label} 应返回 ${code}`).toBe(code)
      expect.soft(res.status, `${label} 不应 500`).toBeLessThan(500)
    }

    await userApi.cartClear()
    const massAssignment = await userApi.cartAddRaw({
      productId: product.id,
      quantity: 2,
      snapshotPrice: 0.01,
      subtotal: 0.02,
      userId: 1,
      id: 1
    })
    expect(massAssignment.code, '额外字段应被忽略').toBe(0)
    const item = massAssignment.data.items[0]
    expect(Number(item.snapshotPrice), '快照价必须取商品价格，不能被请求体覆盖').toBeCloseTo(10, 2)
    expect(Number(item.subtotal)).toBeCloseTo(20, 2)
    expect(item.quantity).toBe(2)
  })
})
