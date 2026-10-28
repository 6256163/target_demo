import { test, expect, uniq } from '../fixtures'
import { percentile, timed } from '../support/perf'

const RECEIVER = {
  receiverName: '王五',
  receiverPhone: '13700000000',
  receiverAddress: '广州市天河区测试路 3 号'
}

test.describe('M6 管理端', () => {
  test('[ADM-001][P0][L1] 新建商品默认 ON_SALE，普通用户调用 403 @p0 @l1 @m6', async ({ adminApi, freshUser, products }) => {
    const name = uniq('管理端新建商品')
    const created = await adminApi.adminCreateProduct({ name, price: 88.8, stock: 300 })

    expect(created.status).toBe(200)
    expect(created.code).toBe(0)
    expect(created.data.name).toBe(name)
    expect(Number(created.data.price)).toBeCloseTo(88.8, 2)
    expect(created.data.stock).toBe(300)
    expect(created.data.status, 'API.md §2.2：status 默认 ON_SALE').toBe('ON_SALE')
    products.createdIds.push(created.data.id)

    const forbidden = await freshUser.client.adminCreateProduct({ name: uniq('非法'), price: 1, stock: 1 })
    expect(forbidden.status, 'API.md §1.1：/api/admin/** 需 ROLE_ADMIN').toBe(403)
    expect(forbidden.code).toBe(40300)
  })

  test('[ADM-002][P0][L1] 更新商品字段生效，不存在返回 404/40401 @p0 @l1 @m6', async ({ adminApi, products }) => {
    const product = await products.create({ price: 88.8, stock: 300 })

    const updated = await adminApi.adminUpdateProduct(product.id, {
      name: product.name,
      description: '更新后的描述',
      price: 66.6,
      stock: 200,
      status: 'OFF_SALE'
    })

    expect(updated.code).toBe(0)
    expect(Number(updated.data.price)).toBeCloseTo(66.6, 2)
    expect(updated.data.stock).toBe(200)
    expect(updated.data.status).toBe('OFF_SALE')
    expect(updated.data.description).toBe('更新后的描述')

    const missing = await adminApi.adminUpdateProduct(99999999, { name: 'x', price: 1, stock: 1 })
    expect(missing.status).toBe(404)
    expect(missing.code).toBe(40401)
  })

  test('[ADM-003][P0][L1] 删除商品后用户端不可见，历史订单明细快照仍可查 @p0 @l1 @m6', async ({ adminApi, userApi, products }) => {
    const product = await products.create({ price: 18, stock: 10 })
    const order = await userApi.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    expect(order.code).toBe(0)

    const deleted = await adminApi.adminDeleteProduct(product.id)
    expect(deleted.code).toBe(0)
    expect(deleted.data, 'API.md §3.7：DELETE 返回 Boolean true').toBe(true)

    const detail = await userApi.productDetail(product.id)
    expect(detail.status).toBe(404)
    expect(detail.code).toBe(40401)

    const orderDetail = await userApi.getOrder(order.data.orderNo)
    expect(orderDetail.code, '历史订单不应因商品删除而丢失').toBe(0)
    expect(orderDetail.data.items[0].productName).toBe(product.name)
    expect(Number(orderDetail.data.items[0].price)).toBeCloseTo(18, 2)
  })

  test('[ADM-004][P0][L1] 调整库存正负 delta 生效，扣成负数返回 409/40903 @p0 @l1 @m6', async ({ adminApi, products }) => {
    const product = await products.create({ stock: 10 })

    const added = await adminApi.adminAdjustStock(product.id, 5)
    expect(added.code).toBe(0)
    expect(added.data.stock).toBe(15)

    const reduced = await adminApi.adminAdjustStock(product.id, -10)
    expect(reduced.code).toBe(0)
    expect(reduced.data.stock).toBe(5)

    const negative = await adminApi.adminAdjustStock(product.id, -100)
    expect(negative.status, 'API.md §1.4：40903 映射 HTTP 409').toBe(409)
    expect(negative.code).toBe(40903)
    expect((await adminApi.productDetail(product.id)).data.stock, '失败调整不得改库存').toBe(5)

    const missing = await adminApi.adminAdjustStock(99999999, 1)
    expect(missing.status).toBe(404)
    expect(missing.code).toBe(40401)
  })

  test('[ADM-005][P0][L1] 管理端订单列表分页/状态过滤，普通用户 403 @p0 @l1 @m6', async ({ adminApi, userApi, products }) => {
    const product = await products.create({ stock: 10 })
    const order = await userApi.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    expect(order.code).toBe(0)

    const list = await adminApi.adminOrders({ page: 0, size: 100, status: 'PENDING_PAYMENT' })
    expect(list.code).toBe(0)
    expect(list.data.page).toBe(0)
    expect(list.data.size).toBe(100)
    const found = list.data.content.find((o: any) => o.orderNo === order.data.orderNo)
    expect(found, '管理端应能查到用户订单').toBeTruthy()
    expect(found.status).toBe('PENDING_PAYMENT')
    expect(Number(found.payAmount)).toBeCloseTo(10, 2)

    const forbidden = await userApi.adminOrders()
    expect(forbidden.status).toBe(403)
    expect(forbidden.code).toBe(40300)
  })

  test('[ADM-006][P0][L1] 订单统计包含各状态计数且与 totalOrders 自洽 @p0 @l1 @m6', async ({ adminApi, userApi, products }) => {
    const product = await products.create({ stock: 10 })
    const order = await userApi.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    expect(order.code).toBe(0)

    const stats = await adminApi.adminStats()
    expect(stats.code).toBe(0)

    const statuses = ['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']
    for (const status of statuses) {
      expect(stats.data, `统计应包含 ${status}`).toHaveProperty(status)
      expect(typeof stats.data[status]).toBe('number')
      expect(stats.data[status]).toBeGreaterThanOrEqual(0)
    }
    expect(stats.data).toHaveProperty('totalOrders')
    expect(stats.data.totalOrders).toBeGreaterThanOrEqual(1)

    const sum = statuses.reduce((acc, s) => acc + stats.data[s], 0)
    expect(sum, '各状态计数之和应等于 totalOrders').toBe(stats.data.totalOrders)
    expect(stats.data.PENDING_PAYMENT).toBeGreaterThanOrEqual(1)
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

test.describe('M6 管理端 · P1', () => {
  test('[ADM-007][P1][L1] 管理端商品列表：分页/关键字/分类过滤且含下架商品 @p1 @l1 @m6', async ({ api, adminApi, products }) => {
    const categoryId = 100000 + Math.floor(Math.random() * 800000)
    const keyword = uniq('adm7')
    const onSale = await products.create({ name: `${keyword}在售`, status: 'ON_SALE', categoryId })
    const offSale = await products.create({ name: `${keyword}下架`, status: 'OFF_SALE', categoryId })

    const page0 = await adminApi.adminProducts({ keyword, categoryId, page: 0, size: 1 })
    expect(page0.code).toBe(0)
    expect(page0.data.total).toBe(2)
    expect(page0.data.totalPages).toBe(2)
    expect(page0.data.last).toBe(false)
    expect(page0.data.content).toHaveLength(1)

    const page1 = await adminApi.adminProducts({ keyword, categoryId, page: 1, size: 1 })
    expect(page1.code).toBe(0)
    expect(page1.data.last).toBe(true)
    expect(page1.data.content).toHaveLength(1)

    const all = await adminApi.adminProducts({ keyword, categoryId, size: 100 })
    expect(all.data.content.map((p: any) => p.id).sort()).toEqual([onSale.id, offSale.id].sort())
    const offItem = all.data.content.find((p: any) => p.id === offSale.id)
    expect(offItem.status, '管理端列表应包含并保留 OFF_SALE 状态').toBe('OFF_SALE')

    const userVisible = await api.listProducts({ keyword, categoryId, size: 100 })
    expect(userVisible.data.total, '当前实现用户端未过滤 OFF_SALE（API.md 未定义）').toBe(2)
    test.info().annotations.push({
      type: 'observed',
      description: '管理端商品列表与用户端使用同一查询，均未按 status 过滤；OFF_SALE 在用户端列表可见'
    })
  })

  test('[ADM-008][P1][L1] 清除商品缓存生效且不影响其他商品 @p1 @l1 @m6', async ({ adminApi, products }) => {
    const first = await products.create()
    const second = await products.create()

    const coldRead = await adminApi.productDetail(first.id)
    expect(coldRead.code).toBe(0)
    expect(coldRead.data.cached, '首次详情请求应回源 DB').toBe(false)
    expect((await adminApi.productDetail(first.id)).data.cached, '二次请求应命中缓存').toBe(true)

    const cleared = await adminApi.adminClearCache()
    expect(cleared.code).toBe(0)
    expect(cleared.data, 'API.md §3.7：清缓存返回 true').toBe(true)

    const afterClear = await adminApi.productDetail(first.id)
    expect.soft(afterClear.data.cached, 'API.md §3.7：清缓存后应重新回源').toBe(false)

    expect((await adminApi.productDetail(second.id)).data.cached).toBe(false)
    expect((await adminApi.productDetail(second.id)).data.cached).toBe(true)

    await adminApi.adminUpdateProduct(first.id, {
      name: first.name,
      description: first.description,
      price: 11,
      stock: first.stock,
      status: 'ON_SALE'
    })
    expect.soft((await adminApi.productDetail(first.id)).data.cached, '更新商品应失效该商品缓存').toBe(false)
    expect((await adminApi.productDetail(second.id)).data.cached, '其他商品缓存不受影响').toBe(true)
  })

  test('[ADM-009][P1][L1] 发货/确认收货：PAID→SHIPPED→DELIVERED，重复迁移 40904 @p1 @l1 @m6', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await userApi.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])

    const shipped = await adminApi.adminShip(order.data.orderNo)
    expect(shipped.code).toBe(0)
    expect(['SHIPPED', 'DELIVERED'], '发货后状态应为 SHIPPED（自动发货竞态下可为 DELIVERED）').toContain(shipped.data.status)

    const delivered = await adminApi.adminDeliver(order.data.orderNo)
    expect(delivered.code).toBe(0)
    expect(delivered.data.status).toBe('DELIVERED')
    expect((await userApi.getOrder(order.data.orderNo)).data.status).toBe('DELIVERED')

    const shipAgain = await adminApi.adminShip(order.data.orderNo)
    expect.soft(shipAgain.status, '重复发货应 HTTP 409').toBe(409)
    expect.soft(shipAgain.code, '重复发货应返回 40904').toBe(40904)

    const deliverAgain = await adminApi.adminDeliver(order.data.orderNo)
    expect.soft(deliverAgain.status, '重复确认收货应 HTTP 409').toBe(409)
    expect.soft(deliverAgain.code, '重复确认收货应返回 40904').toBe(40904)
    expect((await userApi.productDetail(product.id)).data.stock, '履约过程不得改动库存').toBe(9)
  })

  test('[ADM-010][P1][L1] 支付配置读写与范围校验，结束后恢复 @p1 @l1 @m6', async ({ adminApi }) => {
    const snapshotRes = await adminApi.paymentConfig()
    expect(snapshotRes.code).toBe(0)
    const snapshot = snapshotRes.data
    for (const key of ['failureRate', 'timeoutRate', 'minDelayMs', 'maxDelayMs', 'asyncEnabled']) {
      expect(snapshot, `配置响应应包含 ${key}`).toHaveProperty(key)
    }

    const restore = async () => {
      const res = await adminApi.updatePaymentConfig(configPayload(snapshot))
      expect(res.code, '恢复原始支付配置应成功').toBe(0)
    }

    try {
      const updated = await adminApi.updatePaymentConfig({
        failureRate: 0.11,
        timeoutRate: 0.07,
        minDelayMs: 1,
        maxDelayMs: 2,
        asyncEnabled: false
      })
      expect(updated.code).toBe(0)
      expect(updated.data.failureRate).toBe(0.11)
      expect(updated.data.timeoutRate).toBe(0.07)
      expect(updated.data.minDelayMs).toBe(1)
      expect(updated.data.maxDelayMs).toBe(2)
      expect(updated.data.asyncEnabled).toBe(false)

      const persisted = await adminApi.paymentConfig()
      expect(persisted.data.failureRate).toBe(0.11)
      expect(persisted.data.asyncEnabled).toBe(false)
      await restore()

      const failureRateHigh = await adminApi.updatePaymentConfig({ ...configPayload(snapshot), failureRate: 1.5 })
      expect.soft(failureRateHigh.status, 'failureRate=1.5 超出 0~1，应 HTTP 400').toBe(400)
      expect.soft(failureRateHigh.code).toBe(40000)
      await restore()

      const failureRateLow = await adminApi.updatePaymentConfig({ ...configPayload(snapshot), failureRate: -0.1 })
      expect.soft(failureRateLow.status, 'failureRate=-0.1 应 HTTP 400').toBe(400)
      expect.soft(failureRateLow.code).toBe(40000)
      await restore()

      const timeoutRateHigh = await adminApi.updatePaymentConfig({ ...configPayload(snapshot), timeoutRate: 1.5 })
      expect.soft(timeoutRateHigh.status, 'timeoutRate=1.5 应 HTTP 400').toBe(400)
      expect.soft(timeoutRateHigh.code).toBe(40000)
      await restore()

      const negativeDelay = await adminApi.updatePaymentConfig({ ...configPayload(snapshot), minDelayMs: -1 })
      expect.soft(negativeDelay.status, 'minDelayMs=-1 应 HTTP 400').toBe(400)
      expect.soft(negativeDelay.code).toBe(40000)
      await restore()

      const invertedDelay = await adminApi.updatePaymentConfig({ ...configPayload(snapshot), minDelayMs: 5000, maxDelayMs: 100 })
      expect.soft(invertedDelay.status, 'minDelayMs>maxDelayMs 应 HTTP 400').toBe(400)
      expect.soft(invertedDelay.code).toBe(40000)
      await restore()
    } finally {
      await restore()
      const after = await adminApi.paymentConfig()
      expect(after.data.failureRate, '用例结束后配置必须回到快照值').toBe(snapshot.failureRate)
      expect(after.data.timeoutRate).toBe(snapshot.timeoutRate)
      expect(after.data.minDelayMs).toBe(snapshot.minDelayMs)
      expect(after.data.maxDelayMs).toBe(snapshot.maxDelayMs)
      expect(after.data.asyncEnabled).toBe(snapshot.asyncEnabled)
    }
  })

  test('[ADM-011][P1][L5] 管理端垂直越权矩阵：USER 403、匿名 401 @p1 @l5 @m6', async ({ adminApi, freshUser, products }) => {
    const product = await products.create({ price: 5, stock: 5 })
    const user = freshUser.client
    const configSnapshot = (await adminApi.paymentConfig()).data

    const productPayload = { name: uniq('越权商品'), price: 1, stock: 1 }
    const probes: Array<[string, Promise<any>]> = [
      ['GET /api/admin/products', user.adminProducts()],
      ['POST /api/admin/products', user.adminCreateProduct(productPayload)],
      ['PUT /api/admin/products/{id}', user.adminUpdateProduct(product.id, productPayload)],
      ['DELETE /api/admin/products/{id}', user.adminDeleteProduct(product.id)],
      ['PATCH /api/admin/products/{id}/stock', user.adminAdjustStock(product.id, 1)],
      ['DELETE /api/admin/products/cache', user.adminClearCache()],
      ['GET /api/admin/orders', user.adminOrders()],
      ['POST /api/admin/orders/{orderNo}/ship', user.adminShip('no-such-order')],
      ['POST /api/admin/orders/{orderNo}/deliver', user.adminDeliver('no-such-order')],
      ['GET /api/admin/orders/stats', user.adminStats()],
      ['GET /api/admin/payment/config', user.paymentConfig()],
      ['PUT /api/admin/payment/config', user.updatePaymentConfig({ failureRate: 0 })]
    ]

    for (const [label, pending] of probes) {
      const res = await pending
      expect.soft(res.status, `${label} USER 调用应 HTTP 403`).toBe(403)
      expect.soft(res.code, `${label} USER 调用应返回 40300`).toBe(40300)
    }

    const anonymous: Array<[string, Promise<any>]> = [
      ['GET /api/admin/products', user.raw('GET', '/api/admin/products', { token: false })],
      ['GET /api/admin/orders/stats', user.raw('GET', '/api/admin/orders/stats', { token: false })],
      ['GET /api/admin/payment/config', user.raw('GET', '/api/admin/payment/config', { token: false })]
    ]
    for (const [label, pending] of anonymous) {
      const res = await pending
      expect.soft(res.status, `${label} 匿名调用应 HTTP 401`).toBe(401)
      expect.soft(res.code, `${label} 匿名调用应返回 40100`).toBe(40100)
    }

    const config = await adminApi.paymentConfig()
    expect(config.code).toBe(0)
    expect(config.data.failureRate, '越权 PUT 不得修改配置').toBe(configSnapshot.failureRate)
    expect(config.data.asyncEnabled).toBe(configSnapshot.asyncEnabled)
    expect((await adminApi.productDetail(product.id)).data.stock, '越权 PATCH 不得修改库存').toBe(5)
  })

  test('[ADM-012][P1][L0] 管理端响应 Schema：商品/订单/统计/配置 @p1 @l0 @m6', async ({ adminApi, userApi, products }) => {
    const product = await products.create({
      price: 66.6,
      stock: 20,
      description: '管理端 Schema 校验',
      imageUrl: 'https://example.com/p.png',
      categoryId: 1
    })

    const productKeys = ['id', 'name', 'description', 'price', 'stock', 'imageUrl', 'categoryId', 'status', 'cached']
    expect(Object.keys(product).sort()).toEqual([...productKeys].sort())
    expect(typeof product.id).toBe('number')
    expect(typeof product.price).toBe('number')
    expect(Number.isInteger(product.stock)).toBe(true)
    expect(typeof product.cached, '管理端 ProductResponse 也应为 Boolean cached').toBe('boolean')

    const order = await userApi.createOrder({ items: [{ productId: product.id, quantity: 2 }], ...RECEIVER })
    expect(order.code).toBe(0)
    // 管理端列表为无排序全量分页，历史订单较多，需逐页查找
    let listed: any
    for (let page = 0; page < 50; page++) {
      const pageRes = await adminApi.adminOrders({ page, size: 100 })
      expect(pageRes.code).toBe(0)
      listed = pageRes.data.content.find((o: any) => o.orderNo === order.data.orderNo)
      if (listed || pageRes.data.last) break
    }
    expect(listed, '管理端应能查到该订单').toBeTruthy()
    expect(Object.keys(listed).sort(), '管理端订单 Schema 应与用户端一致').toEqual(Object.keys(order.data).sort())
    for (const key of ['id', 'orderNo', 'status', 'totalAmount', 'payAmount', 'totalQuantity', 'items', 'createdAt', 'updatedAt']) {
      expect(listed).toHaveProperty(key)
    }

    const stats = await adminApi.adminStats()
    expect(stats.code).toBe(0)
    const statuses = ['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']
    for (const status of statuses) {
      expect(typeof stats.data[status], `统计 ${status} 应为数字`).toBe('number')
    }
    expect(typeof stats.data.totalOrders).toBe('number')

    const config = await adminApi.paymentConfig()
    expect(Object.keys(config.data).sort()).toEqual(
      ['failureRate', 'timeoutRate', 'minDelayMs', 'maxDelayMs', 'asyncEnabled'].sort()
    )
    expect(typeof config.data.failureRate).toBe('number')
    expect(typeof config.data.timeoutRate).toBe('number')
    expect(Number.isInteger(config.data.minDelayMs)).toBe(true)
    expect(Number.isInteger(config.data.maxDelayMs)).toBe(true)
    expect(typeof config.data.asyncEnabled).toBe('boolean')
  })

  test('[ADM-015][P1][L1] 商品字段校验：name/price/stock 必填，status 仅 ON_SALE/OFF_SALE @p1 @l1 @m6', async ({ adminApi, products }) => {
    const createdIds: number[] = []
    try {
      const blankName = await adminApi.adminCreateProduct({ name: '', price: 1, stock: 1 })
      expect.soft(blankName.status, 'name 为空应 HTTP 400').toBe(400)
      expect.soft(blankName.code).toBe(40000)
      expect.soft(blankName.message).toContain('name')

      const missingName = await adminApi.adminCreateProduct({ price: 1, stock: 1 })
      expect.soft(missingName.status, 'name 缺失应 HTTP 400').toBe(400)
      expect.soft(missingName.code).toBe(40000)

      const zeroPrice = await adminApi.adminCreateProduct({ name: uniq('零价'), price: 0, stock: 1 })
      expect.soft(zeroPrice.status, 'price=0 应 HTTP 400').toBe(400)
      expect.soft(zeroPrice.code).toBe(40000)
      expect.soft(zeroPrice.message).toContain('price')

      const negativePrice = await adminApi.adminCreateProduct({ name: uniq('负价'), price: -1, stock: 1 })
      expect.soft(negativePrice.status, 'price=-1 应 HTTP 400').toBe(400)
      expect.soft(negativePrice.code).toBe(40000)

      const missingStock = await adminApi.adminCreateProduct({ name: uniq('缺库存'), price: 1 })
      expect.soft(missingStock.status, 'stock 缺失应 HTTP 400').toBe(400)
      expect.soft(missingStock.code).toBe(40000)
      expect.soft(missingStock.message).toContain('stock')

      const invalidStatus = await adminApi.adminCreateProduct({ name: uniq('非法状态'), price: 1, stock: 1, status: 'BAD' })
      if (invalidStatus.code === 0) createdIds.push(invalidStatus.data.id)
      expect.soft(invalidStatus.status, 'status=BAD 应 HTTP 400').toBe(400)
      expect.soft(invalidStatus.code, 'status 仅允许 ON_SALE/OFF_SALE').toBe(40000)

      const lowercaseStatus = await adminApi.adminCreateProduct({ name: uniq('小写状态'), price: 1, stock: 1, status: 'on_sale' })
      if (lowercaseStatus.code === 0) createdIds.push(lowercaseStatus.data.id)
      expect.soft(lowercaseStatus.status, 'status 枚举应大小写敏感').toBe(400)
      expect.soft(lowercaseStatus.code).toBe(40000)

      const existing = await products.create({ price: 2, stock: 2 })
      const invalidUpdate = await adminApi.adminUpdateProduct(existing.id, {
        name: existing.name,
        price: 2,
        stock: 2,
        status: 'INVALID'
      })
      expect.soft(invalidUpdate.status, '更新时非法 status 应 HTTP 400').toBe(400)
      expect.soft(invalidUpdate.code).toBe(40000)

      const lowBoundary = await adminApi.adminCreateProduct({ name: uniq('最低价'), price: 0.01, stock: 0 })
      expect(lowBoundary.code, 'price=0.01、stock=0 属于合法边界').toBe(0)
      if (lowBoundary.code === 0) createdIds.push(lowBoundary.data.id)
    } finally {
      for (const id of createdIds.reverse()) {
        await adminApi.adminDeleteProduct(id).catch(() => undefined)
      }
    }
  })
})

test.describe('M6 管理端 · P2', () => {
  test('[ADM-013][P2][L3] 管理端变更后缓存/列表/详情一致 @p2 @l3 @m6', async ({ adminApi, api, products }) => {
    const product = await products.create({ price: 10, stock: 10, name: uniq('缓存一致') })

    expect((await api.productDetail(product.id)).data.cached, '首次详情应回源').toBe(false)
    expect((await api.productDetail(product.id)).data.cached, '二次详情应命中缓存').toBe(true)

    const updated = await adminApi.adminUpdateProduct(product.id, {
      name: product.name,
      description: product.description,
      price: 30,
      stock: 7,
      status: 'ON_SALE'
    })
    expect(updated.code).toBe(0)
    const afterUpdate = await api.productDetail(product.id)
    expect(Number(afterUpdate.data.price)).toBeCloseTo(30, 2)
    expect(afterUpdate.data.stock).toBe(7)
    expect(afterUpdate.data.cached, '更新后首次详情应回源（缓存被失效）').toBe(false)
    expect((await api.productDetail(product.id)).data.cached).toBe(true)

    const adjusted = await adminApi.adminAdjustStock(product.id, 3)
    expect(adjusted.code).toBe(0)
    const afterAdjust = await api.productDetail(product.id)
    expect(afterAdjust.data.stock).toBe(10)
    expect(afterAdjust.data.cached, '调库存后首次详情应回源').toBe(false)

    const list = await api.listProducts({ keyword: product.name, size: 10 })
    const listed = list.data.content.find((p: any) => p.id === product.id)
    expect(listed, '列表应返回更新后的商品').toBeTruthy()
    expect(Number(listed.price)).toBeCloseTo(30, 2)
    expect(listed.stock).toBe(10)

    const removed = await adminApi.adminDeleteProduct(product.id)
    expect(removed.code).toBe(0)
    expect((await api.productDetail(product.id)).code, '删除后详情应 40401').toBe(40401)
    const afterDeleteList = await api.listProducts({ keyword: product.name, size: 10 })
    expect(afterDeleteList.data.content.map((p: any) => p.id)).not.toContain(product.id)
  })

  test('[ADM-014][P2][L6] 订单统计：计数自洽、变更可见、响应时间达标 @p2 @l6 @m6', async ({ adminApi, userApi, products }) => {
    const statuses = ['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']
    const before = await adminApi.adminStats()
    expect(before.code).toBe(0)
    for (const status of statuses) {
      expect(Number.isInteger(before.data[status]), `${status} 计数应为整数`).toBe(true)
      expect(before.data[status]).toBeGreaterThanOrEqual(0)
    }
    expect(Number.isInteger(before.data.totalOrders)).toBe(true)
    const sum = statuses.reduce((acc, status) => acc + before.data[status], 0)
    expect(sum, '各状态计数之和应等于 totalOrders').toBe(before.data.totalOrders)

    const product = await products.create({ price: 10, stock: 5 })
    const order = await userApi.createOrder({ items: [{ productId: product.id, quantity: 1 }], ...RECEIVER })
    expect(order.code).toBe(0)

    const after = await adminApi.adminStats()
    expect(after.data.totalOrders, '新建订单后 totalOrders 应 +1').toBe(before.data.totalOrders + 1)
    expect(after.data.PENDING_PAYMENT).toBe(before.data.PENDING_PAYMENT + 1)

    const durations: number[] = []
    for (let i = 0; i < 10; i++) {
      const { value, ms } = await timed(() => adminApi.adminStats())
      expect(value.code).toBe(0)
      durations.push(ms)
    }
    const p95 = percentile(durations, 95)
    expect(p95, `统计接口 P95=${p95}ms 应 < 1000ms`).toBeLessThan(1000)
    test.info().annotations.push({
      type: 'observed',
      description: `GET /api/admin/orders/stats 10 次调用 P95=${p95}ms，最大=${Math.max(...durations)}ms`
    })
  })
})
