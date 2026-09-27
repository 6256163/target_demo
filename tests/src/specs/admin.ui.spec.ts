import { test, expect, uniq } from '../fixtures'
import { LoginPage } from '../pages/LoginPage'
import { AdminProductsPage } from '../pages/AdminProductsPage'

test.describe('后台商品管理 UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await new LoginPage(page).login(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASS || 'admin123')
  })

  test('管理员可新增商品并在列表中看到', async ({ page }) => {
    const admin = new AdminProductsPage(page)
    await admin.goto()
    const name = uniq('UI后台商品')
    await admin.createProduct(name, 39.9, 200)
    await admin.search(name)
    await admin.expectProductVisible(name)
  })

  test('普通用户看不到后台菜单', async ({ page }) => {
    await page.evaluate(() => localStorage.clear())
    await page.goto('/login')
    await new LoginPage(page).login(process.env.USER_NAME || 'tester', process.env.USER_PASS || '123456')
    await expect(page.getByTestId('menu-admin-products')).toHaveCount(0)
  })
})
