import { test, expect, uniq } from '../fixtures'
import { LoginPage } from '../pages/LoginPage'

test.describe('登录 UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('使用正确账号登录成功', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(process.env.USER_NAME || 'tester', process.env.USER_PASS || '123456')
    await login.expectLoggedIn(process.env.USER_NAME || 'tester')
    await expect(page).toHaveURL(/\/products/)
  })

  test('密码错误时提示错误信息且停留在登录页', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login('tester', 'wrong-password')
    await login.expectErrorVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('注册新用户后可正常登录', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    const username = uniq('uiuser')
    await login.register(username, '123456')
    await expect(page.locator('.el-message--success')).toBeVisible()

    await login.login(username, '123456')
    await login.expectLoggedIn(username)
  })
})
