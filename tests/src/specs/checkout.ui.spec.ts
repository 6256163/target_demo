import { test, expect } from '../fixtures'
import { LoginPage } from '../pages/LoginPage'
import { ProductsPage } from '../pages/ProductsPage'
import { CartPage, PaymentDialog } from '../pages/CartPage'
import { OrdersPage } from '../pages/OrdersPage'

test.describe('下单支付主流程 UI', () => {
  test.beforeEach(async ({ page, userApi }) => {
    await userApi.cartClear()
    await page.goto('/login')
    await new LoginPage(page).login(process.env.USER_NAME || 'tester', process.env.USER_PASS || '123456')
  })

  test('加购 -> 结算 -> 模拟支付成功 -> 订单变为已支付', async ({ page }) => {
    const products = new ProductsPage(page)
    await products.goto()
    await products.addToCart(1)

    const cart = new CartPage(page)
    await cart.goto()
    await cart.expectTotalQuantity(1)
    await cart.checkout()

    const dialog = new PaymentDialog(page)
    await dialog.pay('SUCCESS')
    await expect(page.getByTestId('pay-status')).toHaveText(/SUCCESS|PROCESSING/)
    await expect(page.getByTestId('pay-result')).toContainText('支付成功', { timeout: 20_000 })
    await dialog.close()

    const orders = new OrdersPage(page)
    await orders.goto()
    const firstRow = page.locator('[data-testid^="order-status-"]').first()
    await expect(firstRow).toContainText(/PAID|SHIPPED|DELIVERED/, { timeout: 30_000 })
  })

  test('模拟支付失败后订单显示 PAY_FAILED', async ({ page }) => {
    const products = new ProductsPage(page)
    await products.goto()
    await products.addToCart(4)

    const cart = new CartPage(page)
    await cart.goto()
    await cart.checkout()

    const dialog = new PaymentDialog(page)
    await dialog.pay('FAILED')
    await expect(page.getByTestId('pay-result')).toContainText('支付FAILED', { timeout: 20_000 })
    await dialog.close()

    const orders = new OrdersPage(page)
    await orders.goto()
    await expect(page.locator('[data-testid^="order-status-"]').first())
      .toContainText('PAY_FAILED', { timeout: 20_000 })
  })

  test('待支付订单可在列表页取消', async ({ page, adminApi, userApi }) => {
    const product = await adminApi.adminCreateProduct({
      name: `UI取消商品_${Date.now()}`, price: 15, stock: 30, status: 'ON_SALE'
    })
    const order = await userApi.createOrder({ items: [{ productId: product.data.id, quantity: 1 }] })

    const orders = new OrdersPage(page)
    await orders.goto()
    await orders.cancel(order.data.orderNo)
    await orders.expectStatus(order.data.orderNo, 'CANCELLED')
  })
})
