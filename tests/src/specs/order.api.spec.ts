import { test, expect, uniq, registerFreshUser } from '../fixtures'
import { concurrently } from '../support/perf'
import { ShopApiClient } from '../clients/api.client'

const RECEIVER = {
  receiverName: '张三',
  receiverPhone: '13800000000',
  receiverAddress: '北京市朝阳区测试路 1 号'
}

function directOrder(client: ShopApiClient, items: Array<{ productId: number, quantity: number }>, extra: Record<string, any> = {}) {
  return client.createOrder({ items, ...RECEIVER, ...extra })
}

test.describe('M4 订单与状态机', () => {
  test('[ORD-001][P0][L1] 直接下单：初始状态/金额/收货信息/库存预扣 @p0 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 100 })

    const res = await directOrder(userApi, [{ productId: product.id, quantity: 2 }], { remark: uniq('备注') })

    expect(res.status).toBe(200)
    expect(res.code).toBe(0)
    expect(res.data.status, 'API.md §3.5：初始状态 PENDING_PAYMENT').toBe('PENDING_PAYMENT')
    expect(Number(res.data.totalAmount)).toBeCloseTo(20, 2)
    expect(Number(res.data.payAmount)).toBeCloseTo(20, 2)
    expect(res.data.totalQuantity).toBe(2)
    expect(res.data.receiverName).toBe(RECEIVER.receiverName)
    expect(res.data.receiverPhone).toBe(RECEIVER.receiverPhone)
    expect(res.data.receiverAddress).toBe(RECEIVER.receiverAddress)
    expect(res.data.remark).toContain('备注')
    expect(res.data.orderNo).toBeTruthy()
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].productId).toBe(product.id)
    expect(Number(res.data.items[0].price)).toBeCloseTo(10, 2)
    expect(Number(res.data.items[0].subtotal)).toBeCloseTo(20, 2)

    const after = await userApi.productDetail(product.id)
    expect(after.data.stock, '下单应预扣库存').toBe(98)
  })

  test('[ORD-002][P0][L1] 购物车下单使用全部商品并在下单后清空 @p0 @l1 @m4', async ({ userApi, products }) => {
    const first = await products.create({ price: 5, stock: 50 })
    const second = await products.create({ price: 7.5, stock: 50 })
    await userApi.cartAdd(first.id, 2)
    await userApi.cartAdd(second.id, 1)

    const res = await userApi.createOrder({ fromCart: true, ...RECEIVER })

    expect(res.code).toBe(0)
    expect(res.data.status).toBe('PENDING_PAYMENT')
    expect(res.data.items).toHaveLength(2)
    expect(res.data.totalQuantity).toBe(3)
    expect(Number(res.data.totalAmount)).toBeCloseTo(17.5, 2)
    expect(Number(res.data.payAmount)).toBeCloseTo(17.5, 2)

    // API.md 未写明下单后是否清空购物车；源码会清空，先固定为契约，Phase 0 补文档
    const cart = await userApi.cartView()
    expect(cart.data.items, 'fromCart 下单后购物车应清空，避免重复下单').toEqual([])
  })

  test('[ORD-003][P0][L1] 订单详情与创建结果一致 @p0 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 33.3, stock: 20 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 3 }])
    expect(created.code).toBe(0)

    const detail = await userApi.getOrder(created.data.orderNo)

    expect(detail.code).toBe(0)
    expect(detail.data.orderNo).toBe(created.data.orderNo)
    expect(detail.data.status).toBe('PENDING_PAYMENT')
    expect(Number(detail.data.totalAmount)).toBeCloseTo(99.9, 2)
    expect(detail.data.totalQuantity).toBe(3)
    expect(detail.data.items).toHaveLength(1)
    expect(detail.data.items[0].productId).toBe(product.id)
    expect(Number(detail.data.items[0].price)).toBeCloseTo(33.3, 2)
    expect(Number(detail.data.items[0].subtotal)).toBeCloseTo(99.9, 2)
  })

  test('[ORD-004][P0][L1] 我的订单列表分页/状态过滤/只含本人订单 @p0 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ stock: 20 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    expect(created.code).toBe(0)

    const all = await userApi.listOrders({ page: 0, size: 10 })
    expect(all.code).toBe(0)
    expect(all.data.page).toBe(0)
    expect(all.data.size).toBe(10)
    expect(all.data.total).toBe(1)
    expect(all.data.content.map((o: any) => o.orderNo)).toEqual([created.data.orderNo])

    const filtered = await userApi.listOrders({ status: 'PENDING_PAYMENT' })
    expect(filtered.code).toBe(0)
    expect(filtered.data.content.map((o: any) => o.orderNo)).toContain(created.data.orderNo)

    const invalid = await userApi.listOrders({ status: 'NOT_A_STATUS' })
    expect(invalid.status, '非法枚举应返回 4xx，不应 500').toBeLessThan(500)
  })

  test('[ORD-005][P0][L1] 取消待支付订单后状态 CANCELLED 且库存回滚 @p0 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ stock: 100 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 3 }])
    expect((await userApi.productDetail(product.id)).data.stock).toBe(97)

    const cancelled = await userApi.cancelOrder(created.data.orderNo)

    expect(cancelled.code).toBe(0)
    expect(cancelled.data.status).toBe('CANCELLED')
    expect((await userApi.productDetail(product.id)).data.stock, '取消订单应回滚库存').toBe(100)
  })

  test('[ORD-006][P0][L1] 库存不足下单返回 409/40903 且无订单落库 @p0 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ stock: 1 })

    const res = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])

    expect(res.status, 'API.md §1.4：40903 映射 HTTP 409').toBe(409)
    expect(res.code).toBe(40903)
    expect((await userApi.productDetail(product.id)).data.stock, '失败下单不得扣库存').toBe(1)
    expect((await userApi.listOrders()).data.total, '失败下单不得落库').toBe(0)
  })

  test('[ORD-007][P0][L2] 支付成功履约链路 PAID→SHIPPED→DELIVERED 且库存守恒 @p0 @l2 @m4', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
    const orderNo = created.data.orderNo

    const paid = await userApi.pay({ orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    const afterPay = await userApi.waitForOrderStatus(orderNo, ['PAID', 'SHIPPED'])

    if (afterPay === 'PAID') {
      const shipped = await adminApi.adminShip(orderNo)
      expect(shipped.code).toBe(0)
      expect(shipped.data.status).toBe('SHIPPED')
    }

    const delivered = await adminApi.adminDeliver(orderNo)
    expect(delivered.code).toBe(0)
    expect(delivered.data.status).toBe('DELIVERED')
    expect((await userApi.productDetail(product.id)).data.stock, '最终库存=初始-qty').toBe(8)
  })

  test('[ORD-008][P0][L2] 支付失败/超时订单进入 PAY_FAILED 且库存回滚、超时可重付 @p0 @l2 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })

    const failedOrder = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
    const failedPay = await userApi.pay({ orderNo: failedOrder.data.orderNo, outcome: 'FAILED' })
    expect(failedPay.code).toBe(0)
    await userApi.waitForPaymentStatus(failedPay.data.tradeNo, ['FAILED'])
    expect((await userApi.getOrder(failedOrder.data.orderNo)).data.status).toBe('PAY_FAILED')
    expect((await userApi.productDetail(product.id)).data.stock, '支付失败应回滚库存').toBe(10)

    const timeoutOrder = await directOrder(userApi, [{ productId: product.id, quantity: 3 }])
    const timeoutPay = await userApi.pay({ orderNo: timeoutOrder.data.orderNo, outcome: 'TIMEOUT' })
    expect(timeoutPay.code).toBe(0)
    await userApi.waitForPaymentStatus(timeoutPay.data.tradeNo, ['TIMEOUT'])
    expect((await userApi.getOrder(timeoutOrder.data.orderNo)).data.status).toBe('PAY_FAILED')
    expect((await userApi.productDetail(product.id)).data.stock, '支付超时应回滚库存').toBe(10)

    const retry = await userApi.pay({ orderNo: timeoutOrder.data.orderNo, outcome: 'SUCCESS' })
    expect(retry.code, '超时后应允许重新支付').toBe(0)
    await userApi.waitForPaymentStatus(retry.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(timeoutOrder.data.orderNo, ['PAID'])
    expect((await userApi.productDetail(product.id)).data.stock, '重付成功后库存=10-3').toBe(7)
  })
})

function expectLocalDateTime(value: any, label: string) {
  expect(typeof value, `${label} 应为字符串`).toBe('string')
  expect(value, `${label} 应为无时区的 LocalDateTime`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/)
}

test.describe('M4 订单与状态机 · P1', () => {
  test('[ORD-009][P1][L1] 下单参数校验：items/qty/productId/超长收货信息 @p1 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 20 })

    const invalid: Array<[string, any]> = [
      ['items 为空数组', { items: [] }],
      ['items 缺失', {}],
      ['quantity=0', { items: [{ productId: product.id, quantity: 0 }] }],
      ['quantity=-1', { items: [{ productId: product.id, quantity: -1 }] }],
      ['productId 缺失', { items: [{ quantity: 1 }] }]
    ]
    for (const [label, payload] of invalid) {
      const res = await userApi.createOrder({ ...RECEIVER, ...payload })
      expect.soft(res.status, `${label} 应 HTTP 400`).toBe(400)
      expect.soft(res.code, `${label} 应返回 40000`).toBe(40000)
    }

    const missing = await directOrder(userApi, [{ productId: 99999999, quantity: 1 }])
    expect(missing.status, '商品不存在应 HTTP 404').toBe(404)
    expect(missing.code).toBe(40401)

    const scarce = await products.create({ stock: 1 })
    const short = await directOrder(userApi, [{ productId: scarce.id, quantity: 2 }])
    expect(short.status, '库存不足应 HTTP 409').toBe(409)
    expect(short.code).toBe(40903)

    const overlong = await userApi.createOrder({
      items: [{ productId: product.id, quantity: 1 }],
      receiverName: '名'.repeat(300),
      receiverPhone: '1'.repeat(100),
      receiverAddress: '址'.repeat(600),
      remark: '备'.repeat(300)
    })
    expect.soft(
      overlong.status,
      'API.md 未限制收货信息长度，超长输入应 4xx 或被截断，不应 500'
    ).toBeLessThan(500)
  })

  test('[ORD-010][P1][L1] 同一商品重复行：按行建明细、金额与库存正确 @p1 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 20 })

    const res = await directOrder(userApi, [
      { productId: product.id, quantity: 1 },
      { productId: product.id, quantity: 2 }
    ])

    expect(res.code).toBe(0)
    expect(res.data.items, 'API.md 未定义重复行合并规则，当前实现保留两行').toHaveLength(2)
    expect(res.data.items.map((i: any) => i.productId)).toEqual([product.id, product.id])
    expect(res.data.totalQuantity).toBe(3)
    expect(Number(res.data.totalAmount)).toBeCloseTo(30, 2)
    expect((await userApi.productDetail(product.id)).data.stock, '库存按明细行合计扣减').toBe(17)

    const detail = await userApi.getOrder(res.data.orderNo)
    expect(detail.data.items).toHaveLength(2)
    expect(Number(detail.data.totalAmount)).toBeCloseTo(30, 2)
  })

  test('[ORD-011][P1][L1] 订单号不存在/格式非法/注入串返回 40402 @p1 @l1 @m4', async ({ userApi, products }) => {
    const product = await products.create({ stock: 5 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    expect(created.code).toBe(0)

    for (const orderNo of [`NO_SUCH_${uniq('order')}`, 'abc-not-a-real-order', `' OR '1'='1`]) {
      const res = await userApi.raw('GET', `/api/orders/${encodeURIComponent(orderNo)}`)
      expect.soft(res.status, `订单号 ${orderNo} 应 HTTP 404`).toBe(404)
      expect.soft(res.code, `订单号 ${orderNo} 应返回 40402`).toBe(40402)
      expect.soft(res.data, '不存在的订单不得返回数据').toBeUndefined()
    }

    const status = await userApi.raw('GET', `/api/orders/${encodeURIComponent(`NO_SUCH_${runIdSuffix()}`)}/status`)
    expect(status.status).toBe(404)
    expect(status.code).toBe(40402)

    const current = await userApi.orderStatus(created.data.orderNo)
    expect(current.code).toBe(0)
    expect(current.data.orderNo).toBe(created.data.orderNo)
    expect(current.data.status).toBe('PENDING_PAYMENT')
  })

  test('[ORD-012][P1][L5] 订单越权：他人详情/取消/状态/列表均不可访问 @p1 @l5 @m4', async ({ userApi, adminApi, products }) => {
    const other = await registerFreshUser()
    try {
      const product = await products.create({ stock: 10 })
      const created = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
      const orderNo = created.data.orderNo

      const detail = await other.client.getOrder(orderNo)
      expect.soft(detail.status, '他人订单详情应 HTTP 403').toBe(403)
      expect.soft(detail.code).toBe(40300)
      expect.soft(detail.data, '越权响应不得泄露订单数据').toBeUndefined()

      const cancel = await other.client.cancelOrder(orderNo)
      expect.soft(cancel.status, '他人订单取消应 HTTP 403').toBe(403)
      expect.soft(cancel.code).toBe(40300)
      expect((await userApi.getOrder(orderNo)).data.status, '越权取消不得改变订单状态').toBe('PENDING_PAYMENT')

      const status = await other.client.orderStatus(orderNo)
      expect.soft(status.status, '他人订单状态轮询应 HTTP 403').toBe(403)
      expect.soft(status.code).toBe(40300)

      const list = await other.client.listOrders({ size: 100 })
      expect(list.code).toBe(0)
      expect(list.data.content.map((o: any) => o.orderNo)).not.toContain(orderNo)

      const adminView = await adminApi.getOrder(orderNo)
      expect(adminView.code, '源码 assertOwnership 对管理员放行（API.md 未文档化）').toBe(0)
      test.info().annotations.push({
        type: 'observed',
        description: '管理员可读取任意用户订单详情（源码 assertOwnership 放行），API.md 未文档化管理端该行为'
      })
    } finally {
      await other.client.dispose()
    }
  })

  test('[ORD-013][P1][L1] 非法状态取消：PAID/SHIPPED/DELIVERED/CANCELLED/PAY_FAILED @p1 @l1 @m4', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 100 })

    const paidOrder = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
    const paid = await userApi.pay({ orderNo: paidOrder.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(paidOrder.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])
    const before = (await userApi.getOrder(paidOrder.data.orderNo)).data.status
    const cancelPaid = await userApi.cancelOrder(paidOrder.data.orderNo)
    expect.soft(cancelPaid.status, `状态 ${before} 不允许取消，应 HTTP 409`).toBe(409)
    expect.soft(cancelPaid.code, `状态 ${before} 取消应返回 40904`).toBe(40904)
    expect((await userApi.getOrder(paidOrder.data.orderNo)).data.status).toBe(before)

    expect((await adminApi.adminShip(paidOrder.data.orderNo)).code).toBe(0)
    await userApi.waitForOrderStatus(paidOrder.data.orderNo, ['SHIPPED', 'DELIVERED'])
    expect((await adminApi.adminDeliver(paidOrder.data.orderNo)).data.status).toBe('DELIVERED')
    const cancelDelivered = await userApi.cancelOrder(paidOrder.data.orderNo)
    expect.soft(cancelDelivered.status, 'DELIVERED 状态取消应 HTTP 409').toBe(409)
    expect.soft(cancelDelivered.code).toBe(40904)

    const cancelledOrder = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    expect((await userApi.cancelOrder(cancelledOrder.data.orderNo)).data.status).toBe('CANCELLED')
    const cancelAgain = await userApi.cancelOrder(cancelledOrder.data.orderNo)
    expect.soft(cancelAgain.status, '重复取消应 HTTP 409').toBe(409)
    expect.soft(cancelAgain.code).toBe(40904)

    const failedOrder = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    const failed = await userApi.pay({ orderNo: failedOrder.data.orderNo, outcome: 'FAILED' })
    await userApi.waitForPaymentStatus(failed.data.tradeNo, ['FAILED'])
    await userApi.waitForOrderStatus(failedOrder.data.orderNo, ['PAY_FAILED'])
    const cancelFailed = await userApi.cancelOrder(failedOrder.data.orderNo)
    expect.soft(cancelFailed.status, 'PAY_FAILED 状态取消应 HTTP 409').toBe(409)
    expect.soft(cancelFailed.code).toBe(40904)
  })

  test('[ORD-014][P1][L2] 已取消/已支付订单再次支付被拒绝且不重复扣款 @p1 @l2 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })

    const cancelledOrder = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
    expect((await userApi.cancelOrder(cancelledOrder.data.orderNo)).code).toBe(0)
    const onCancelled = await userApi.pay({ orderNo: cancelledOrder.data.orderNo, outcome: 'SUCCESS' })
    expect.soft(onCancelled.status, 'API.md §3.6：订单状态不允许支付应 HTTP 409').toBe(409)
    expect.soft(onCancelled.code, 'API.md §3.6：应返回 40904（当前实现 40906 时此处为红）').toBe(40904)
    expect.soft((await userApi.paymentList(cancelledOrder.data.orderNo)).data, '被拒绝的支付不得落库').toEqual([])
    expect.soft((await userApi.productDetail(product.id)).data.stock, '重新支付不得扣库存').toBe(10)

    const paidOrder = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    const paid = await userApi.pay({ orderNo: paidOrder.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(paidOrder.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])
    const before = (await userApi.getOrder(paidOrder.data.orderNo)).data.status

    const repay = await userApi.pay({ orderNo: paidOrder.data.orderNo, outcome: 'SUCCESS' })
    expect.soft(repay.status, '已支付订单不得再次支付').toBe(409)
    expect.soft(repay.code, '已支付订单再次支付应返回 40904').toBe(40904)
    expect.soft((await userApi.paymentList(paidOrder.data.orderNo)).data, '不得生成第二张支付单').toHaveLength(1)
    expect.soft((await userApi.getOrder(paidOrder.data.orderNo)).data.status).toBe(before)
    expect.soft((await userApi.productDetail(product.id)).data.stock, '库存只扣一次（10-1）').toBe(9)
  })

  test('[ORD-015][P1][L2] 管理端非法发货/收货：未支付发货、重复发货、非法收货 @p1 @l2 @m4', async ({ userApi, adminApi, products }) => {
    const product = await products.create({ price: 10, stock: 20 })

    const unpaid = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    const shipUnpaid = await adminApi.adminShip(unpaid.data.orderNo)
    expect.soft(shipUnpaid.status, '未支付订单发货应 HTTP 409').toBe(409)
    expect.soft(shipUnpaid.code, '未支付订单发货应返回 40904').toBe(40904)
    expect.soft((await userApi.getOrder(unpaid.data.orderNo)).data.status).toBe('PENDING_PAYMENT')

    const deliverUnpaid = await adminApi.adminDeliver(unpaid.data.orderNo)
    expect.soft(deliverUnpaid.status, '未支付订单确认收货应 HTTP 409').toBe(409)
    expect.soft(deliverUnpaid.code).toBe(40904)
    expect.soft((await userApi.getOrder(unpaid.data.orderNo)).data.status).toBe('PENDING_PAYMENT')

    const order = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)
    await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(order.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])

    const ship = await adminApi.adminShip(order.data.orderNo)
    expect(ship.code).toBe(0)
    expect(['SHIPPED', 'DELIVERED'], '发货后状态只能前进到 SHIPPED/DELIVERED').toContain(ship.data.status)

    const deliver = await adminApi.adminDeliver(order.data.orderNo)
    expect(deliver.code).toBe(0)
    expect(deliver.data.status).toBe('DELIVERED')

    const shipAgain = await adminApi.adminShip(order.data.orderNo)
    expect.soft(shipAgain.status, 'DELIVERED 后重复发货应 HTTP 409').toBe(409)
    expect.soft(shipAgain.code).toBe(40904)

    const deliverAgain = await adminApi.adminDeliver(order.data.orderNo)
    expect.soft(deliverAgain.status, '重复确认收货应 HTTP 409').toBe(409)
    expect.soft(deliverAgain.code).toBe(40904)

    const cancelled = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    expect((await userApi.cancelOrder(cancelled.data.orderNo)).code).toBe(0)
    const shipCancelled = await adminApi.adminShip(cancelled.data.orderNo)
    expect.soft(shipCancelled.status, '已取消订单发货应 HTTP 409').toBe(409)
    expect.soft(shipCancelled.code).toBe(40904)
    expect.soft((await userApi.getOrder(cancelled.data.orderNo)).data.status).toBe('CANCELLED')
  })

  test('[ORD-016][P1][L0] 订单响应 Schema 与时间格式 @p1 @l0 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 12.34, stock: 10 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 2 }], { remark: uniq('备注') })
    expect(created.code).toBe(0)

    const order = created.data
    const expectedKeys = [
      'id', 'orderNo', 'status', 'totalAmount', 'payAmount', 'totalQuantity',
      'receiverName', 'receiverPhone', 'receiverAddress', 'remark', 'items', 'createdAt', 'updatedAt'
    ]
    expect(Object.keys(order).sort()).toEqual([...expectedKeys].sort())
    expect(typeof order.id).toBe('number')
    expect(typeof order.orderNo).toBe('string')
    expect(['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']).toContain(order.status)
    expect(Number(order.totalAmount)).toBeCloseTo(24.68, 2)
    expect(Number(order.payAmount)).toBeCloseTo(24.68, 2)
    expect(order.totalQuantity).toBe(2)
    expect(order.receiverName).toBe(RECEIVER.receiverName)
    expect(order.receiverPhone).toBe(RECEIVER.receiverPhone)
    expect(order.receiverAddress).toBe(RECEIVER.receiverAddress)
    expect(order.remark).toContain('备注')
    expectLocalDateTime(order.createdAt, 'createdAt')
    expectLocalDateTime(order.updatedAt, 'updatedAt')

    expect(order.items).toHaveLength(1)
    const item = order.items[0]
    expect(Object.keys(item).sort()).toEqual(['id', 'productId', 'productName', 'price', 'quantity', 'subtotal'].sort())
    expect(item.productId).toBe(product.id)
    expect(item.productName).toBe(product.name)
    expect(Number(item.price)).toBeCloseTo(12.34, 2)
    expect(item.quantity).toBe(2)
    expect(Number(item.subtotal)).toBeCloseTo(24.68, 2)

    const status = await userApi.orderStatus(order.orderNo)
    expect(status.code).toBe(0)
    expect(Object.keys(status.data).sort()).toEqual(['orderNo', 'status', 'updatedAt'])
    expect(status.data.orderNo).toBe(order.orderNo)
    expect(status.data.status).toBe('PENDING_PAYMENT')
    expectLocalDateTime(status.data.updatedAt, 'status.updatedAt')

    const cancelled = await userApi.cancelOrder(order.orderNo)
    expect(cancelled.code).toBe(0)
    expect(cancelled.data.status).toBe('CANCELLED')
    expect(
      cancelled.data.updatedAt.localeCompare(order.updatedAt),
      '状态变化后 updatedAt 不应早于创建时间（LocalDateTime 字符串按字典序比较）'
    ).toBeGreaterThanOrEqual(0)
    expect(Number(cancelled.data.totalAmount), '状态变化不应改动金额').toBeCloseTo(24.68, 2)
  })

  test('[ORD-021][P1][L2] 超时未支付自动关单并回滚库存 @p1 @l2 @m4', async ({ userApi, products }) => {
    test.skip(
      process.env.SHORT_ORDER_TIMEOUT !== '1',
      '需要短超时环境（ORDER_PAY_TIMEOUT_MS<=5000 且 SHORT_ORDER_TIMEOUT=1）才能执行自动关单'
    )

    const product = await products.create({ price: 10, stock: 5 })
    const created = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
    expect(created.code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(3)

    const status = await userApi.waitForOrderStatus(created.data.orderNo, ['CANCELLED'], 120_000)
    expect(status).toBe('CANCELLED')
    expect((await userApi.productDetail(product.id)).data.stock, '自动关单应回滚库存').toBe(5)
    expect((await userApi.paymentList(created.data.orderNo)).data, '未支付订单不应产生支付单').toEqual([])

    const polled = await userApi.orderStatus(created.data.orderNo)
    expect(polled.data.status).toBe('CANCELLED')

    test.info().annotations.push({
      type: 'observed',
      description: 'API.md 未描述自动关单；源码仅将订单置 CANCELLED，未生成/关闭支付单（CLOSED 未实现）'
    })
  })

  test('[ORD-022][P1][L1] fromCart=true 同时传 items 时只使用购物车商品 @p1 @l1 @m4', async ({ userApi, products }) => {
    const cartProduct = await products.create({ price: 5, stock: 10 })
    const directProduct = await products.create({ price: 7, stock: 10 })
    await userApi.cartAdd(cartProduct.id, 2)

    const res = await userApi.createOrder({
      fromCart: true,
      items: [{ productId: directProduct.id, quantity: 5 }],
      ...RECEIVER
    })

    expect(res.code).toBe(0)
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].productId).toBe(cartProduct.id)
    expect(res.data.totalQuantity).toBe(2)
    expect(Number(res.data.totalAmount)).toBeCloseTo(10, 2)
    expect(Number(res.data.payAmount)).toBeCloseTo(10, 2)
    expect((await userApi.productDetail(cartProduct.id)).data.stock).toBe(8)
    expect((await userApi.productDetail(directProduct.id)).data.stock, 'items 被忽略，不得扣库存').toBe(10)
    expect((await userApi.cartView()).data.items).toEqual([])
  })

  test('[ORD-023][P1][L1] fromCart=true 且购物车为空 @p1 @l1 @m4', async ({ userApi }) => {
    const res = await userApi.createOrder({ fromCart: true, ...RECEIVER })

    expect.soft(res.status, 'API.md §3.5：fromCart=true 且购物车为空应 HTTP 409').toBe(409)
    expect.soft(res.code, 'API.md §3.5：空购物车下单应返回 40905').toBe(40905)
    expect.soft((await userApi.listOrders()).data.total, '失败下单不得落库').toBe(0)
  })
})

function runIdSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

test.describe('M4 订单与状态机 · P2', () => {
  test('[ORD-017][P2][L3] 四路径库存守恒：取消/失败/超时/退款精确回滚 @p2 @l3 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 100 })
    const baseline = 100
    const qty = 2

    const cancelled = await directOrder(userApi, [{ productId: product.id, quantity: qty }])
    expect(cancelled.code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock).toBe(baseline - qty)
    expect((await userApi.cancelOrder(cancelled.data.orderNo)).code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock, '取消应精确回滚').toBe(baseline)
    const cancelAgain = await userApi.cancelOrder(cancelled.data.orderNo)
    expect(cancelAgain.code).toBe(40904)
    expect((await userApi.productDetail(product.id)).data.stock, '重复取消不得重复回滚').toBe(baseline)

    const failedOrder = await directOrder(userApi, [{ productId: product.id, quantity: qty }])
    expect(failedOrder.code).toBe(0)
    const failedPay = await userApi.pay({ orderNo: failedOrder.data.orderNo, outcome: 'FAILED' })
    await userApi.waitForPaymentStatus(failedPay.data.tradeNo, ['FAILED'])
    await userApi.waitForOrderStatus(failedOrder.data.orderNo, ['PAY_FAILED'])
    expect((await userApi.productDetail(product.id)).data.stock, '支付失败应回滚').toBe(baseline)

    const timeoutOrder = await directOrder(userApi, [{ productId: product.id, quantity: qty }])
    expect(timeoutOrder.code).toBe(0)
    const timeoutPay = await userApi.pay({ orderNo: timeoutOrder.data.orderNo, outcome: 'TIMEOUT' })
    await userApi.waitForPaymentStatus(timeoutPay.data.tradeNo, ['TIMEOUT'])
    await userApi.waitForOrderStatus(timeoutOrder.data.orderNo, ['PAY_FAILED'])
    expect((await userApi.productDetail(product.id)).data.stock, '支付超时应回滚').toBe(baseline)

    const refundOrder = await directOrder(userApi, [{ productId: product.id, quantity: qty }])
    expect(refundOrder.code).toBe(0)
    const refundPay = await userApi.pay({ orderNo: refundOrder.data.orderNo, outcome: 'SUCCESS' })
    await userApi.waitForPaymentStatus(refundPay.data.tradeNo, ['SUCCESS'])
    await userApi.waitForOrderStatus(refundOrder.data.orderNo, ['PAID', 'SHIPPED', 'DELIVERED'])
    const refunded = await userApi.refund(refundPay.data.tradeNo)
    expect(refunded.code).toBe(0)
    expect((await userApi.productDetail(product.id)).data.stock, '退款应回滚').toBe(baseline)
    const refundAgain = await userApi.refund(refundPay.data.tradeNo)
    expect(refundAgain.code).toBe(40906)
    expect((await userApi.productDetail(product.id)).data.stock, '重复退款不得重复回滚').toBe(baseline)
  })

  test('[ORD-018][P2][L4] 并发下单同一商品：成功数=库存，不超卖 @p2 @l4 @m4', async ({ userApi, products }) => {
    const stock = 5
    const attempts = 10
    const product = await products.create({ price: 10, stock })

    const results = await concurrently(attempts, () =>
      directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    )
    expect(results.every(r => !r.error), '并发下单不得出现网络异常').toBe(true)

    const responses = results.map(r => r.value!)
    const successes = responses.filter(r => r.code === 0)
    const failures = responses.filter(r => r.code !== 0)

    expect(successes, `库存 ${stock}，成功下单数必须等于库存`).toHaveLength(stock)
    expect(failures).toHaveLength(attempts - stock)
    for (const failure of failures) {
      expect.soft(failure.status, '失败订单应 HTTP 409').toBe(409)
      expect.soft([40903, 40900], '失败原因只能是库存不足/并发冲突').toContain(failure.code)
    }

    const detail = await userApi.productDetail(product.id)
    expect(detail.data.stock, '最终库存必须为 0，不能超卖或为负').toBe(0)

    const orders = await userApi.listOrders({ size: 100 })
    expect(orders.data.total).toBe(stock)
    expect(orders.data.content.every((o: any) => o.status !== 'CANCELLED'), '并发下单不应产生异常取消').toBe(true)
  })

  test('[ORD-019][P2][L4] 取消与支付并发：终态唯一，无“取消且扣款” @p2 @l4 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await directOrder(userApi, [{ productId: product.id, quantity: 2 }])
    expect(order.code).toBe(0)

    const [cancel, pay] = await Promise.all([
      userApi.cancelOrder(order.data.orderNo),
      userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    ])
    expect([cancel.status, pay.status].every(s => s < 500), `取消/支付均不得 500（cancel=${cancel.code}, pay=${pay.code}）`).toBe(true)

    let paymentStatus = ''
    if (pay.code === 0) {
      paymentStatus = await userApi.waitForPaymentStatus(pay.data.tradeNo, ['SUCCESS', 'FAILED', 'TIMEOUT'])
    }

    const finalStatus = (await userApi.getOrder(order.data.orderNo)).data.status
    const stock = (await userApi.productDetail(product.id)).data.stock

    if (finalStatus === 'CANCELLED') {
      expect(cancel.code, '订单已取消则取消接口必须成功').toBe(0)
      expect(paymentStatus, '已取消订单不得同时存在成功支付').not.toBe('SUCCESS')
      expect(stock, '取消后库存回到初始值').toBe(10)
    } else {
      expect(cancel.code, `订单终态 ${finalStatus} 时取消必须被拒绝`).not.toBe(0)
      expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain(finalStatus)
      expect(paymentStatus).toBe('SUCCESS')
      expect(stock, '支付成功库存=10-2').toBe(8)
    }
  })

  test('[ORD-020][P2][L6] 状态轮询收敛：无长期 PAYING/PROCESSING @p2 @l6 @m4', async ({ userApi, products }) => {
    const product = await products.create({ price: 10, stock: 10 })
    const order = await directOrder(userApi, [{ productId: product.id, quantity: 1 }])
    expect(order.code).toBe(0)

    const start = Date.now()
    const paid = await userApi.pay({ orderNo: order.data.orderNo, outcome: 'SUCCESS' })
    expect(paid.code).toBe(0)

    const paymentStatus = await userApi.waitForPaymentStatus(paid.data.tradeNo, ['SUCCESS'], 30_000)
    expect(paymentStatus).toBe('SUCCESS')

    const statusDurations: number[] = []
    const statuses: string[] = []
    let stable = 0
    let previous = ''
    while (Date.now() - start < 30_000) {
      const pollStart = Date.now()
      const res = await userApi.orderStatus(order.data.orderNo)
      statusDurations.push(Date.now() - pollStart)
      expect(res.status, '状态轮询不得 500').toBeLessThan(500)
      expect(res.code).toBe(0)
      const status = res.data.status
      statuses.push(status)
      if (status === previous) stable++
      else stable = 0
      previous = status
      if (['PAID', 'SHIPPED', 'DELIVERED'].includes(status) && stable >= 2) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    const elapsed = Date.now() - start
    expect(elapsed, '支付成功到订单进入履约态应在 30s 内收敛').toBeLessThan(30_000)
    expect(['PAID', 'SHIPPED', 'DELIVERED']).toContain(previous)
    expect(statuses, '轮询过程中不得出现 PAYING 之后回退').not.toContain('CANCELLED')
    expect(statusDurations.every(ms => ms < 2000), '单次状态查询应 < 2s').toBe(true)

    test.info().annotations.push({
      type: 'observed',
      description: `支付→履约态收敛 ${elapsed}ms，订单最终 ${previous}；单次状态查询最大 ${Math.max(...statusDurations)}ms`
    })
  })
})
