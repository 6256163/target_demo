import { test, expect } from '../fixtures'
import { LoginPage } from '../pages/LoginPage'
import { ProductsPage } from '../pages/ProductsPage'
import { CartPage } from '../pages/CartPage'

/** UI 用例依赖登录态，通过登录接口写入 localStorage 避免每次都走表单 */
async function loginViaUI(page: any) {
  await page.goto('/login')
  const login = new LoginPage(page)
  await login.login(process.env.USER_NAME || 'tester', process.env.USER_PASS || '123456')
  await login.expectLoggedIn(process.env.USER_NAME || 'tester')
}

test.describe('商品浏览与购物车 UI', () => {
  test.beforeEach(async ({ page, userApi }) => {
    await userApi.cartClear()
    await loginViaUI(page)
  })

  test('商品列表展示并支持关键字搜索', async ({ page }) => {
    const products = new ProductsPage(page)
    await products.goto()
    expect(await products.productCount()).toBeGreaterThan(0)

    await products.search('商品-0001')
    const names = await page.locator('[data-testid="product-name"]').allTextContents()
    expect(names.some((n: string) => n.includes('商品-0001'))).toBeTruthy()
  })

  test('加入购物车后购物车数量正确并可修改数量', async ({ page }) => {
    const products = new ProductsPage(page)
    await products.goto()
    await products.addToCart(1)

    const cart = new CartPage(page)
    await cart.goto()
    await cart.expectTotalQuantity(1)
    await cart.setQuantity(1, 3)
    await cart.expectTotalQuantity(3)
  })

  test('购物车可删除商品并清空', async ({ page }) => {
    const products = new ProductsPage(page)
    await products.goto()
    await products.addToCart(2)

    const cart = new CartPage(page)
    await cart.goto()
    await cart.remove(2)
    await cart.expectTotalQuantity(0)
  })

  test('商品详情页可加购', async ({ page }) => {
    const products = new ProductsPage(page)
    await products.goto()
    await products.openDetail(3)
    await page.getByTestId('input-quantity').locator('input').fill('2')
    await page.getByTestId('btn-add-cart').click()

    const cart = new CartPage(page)
    await cart.goto()
    await cart.expectTotalQuantity(2)
  })
})
