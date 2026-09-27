import { Page, expect } from '@playwright/test'

export class ProductsPage {
  constructor(private page: Page) {
  }

  async goto() {
    await this.page.goto('/products')
    await this.page.getByTestId('product-filter-card').waitFor()
  }

  async search(keyword: string) {
    await this.page.getByTestId('input-keyword').fill(keyword)
    await this.page.getByTestId('btn-search').click()
    await this.page.waitForTimeout(500)
  }

  async addToCart(productId: number) {
    await this.page.getByTestId(`btn-add-cart-${productId}`).click()
    await expect(this.page.locator('.el-message--success')).toBeVisible()
  }

  async openDetail(productId: number) {
    await this.page.getByTestId(`product-card-${productId}`).click()
    await this.page.getByTestId('product-detail').waitFor()
  }

  productCount() {
    return this.page.locator('[data-testid^="product-card-"]').count()
  }
}
