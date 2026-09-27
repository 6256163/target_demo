import { Page, expect } from '@playwright/test'

export class LoginPage {
  constructor(private page: Page) {
  }

  async goto() {
    await this.page.goto('/login')
    await this.page.getByTestId('login-card').waitFor()
  }

  async login(username: string, password: string) {
    await this.page.getByTestId('input-username').fill(username)
    await this.page.getByTestId('input-password').fill(password)
    await this.page.getByTestId('btn-login').click()
  }

  async expectLoggedIn(username: string) {
    await expect(this.page.getByTestId('current-user')).toContainText(username)
  }

  async expectErrorVisible() {
    await expect(this.page.locator('.el-message--error')).toBeVisible()
  }

  async register(username: string, password: string) {
    await this.page.getByTestId('login-tabs').getByText('注册').click()
    await this.page.getByTestId('input-reg-username').fill(username)
    await this.page.getByTestId('input-reg-password').fill(password)
    await this.page.getByTestId('btn-register').click()
  }
}
