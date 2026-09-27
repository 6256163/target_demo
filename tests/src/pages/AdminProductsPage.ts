import { Page, expect } from '@playwright/test'

export class AdminProductsPage {
  constructor(private page: Page) {
  }

  async goto() {
    await this.page.goto('/admin/products')
    await this.page.getByTestId('admin-products-card').waitFor()
  }

  async createProduct(name: string, price: number, stock: number) {
    await this.page.getByTestId('admin-btn-create').click()
    await this.page.getByTestId('product-dialog').waitFor()
    await this.page.getByTestId('product-input-name').fill(name)
    await this.page.getByTestId('product-input-price').locator('input').fill(String(price))
    await this.page.getByTestId('product-input-stock').locator('input').fill(String(stock))
    await this.page.getByTestId('product-btn-save').click()
    await expect(this.page.locator('.el-message--success')).toBeVisible()
  }

  async search(keyword: string) {
    await this.page.getByTestId('admin-input-keyword').fill(keyword)
    await this.page.getByTestId('admin-btn-search').click()
    await this.page.waitForTimeout(600)
  }

  async expectProductVisible(name: string) {
    await expect(this.page.getByTestId('admin-products-table')).toContainText(name)
  }

  async deleteProduct(id: number) {
    await this.page.getByTestId(`admin-btn-delete-${id}`).click()
    await this.page.locator('.el-message-box__btns .el-button--primary').click()
    await this.page.waitForTimeout(600)
  }
}
