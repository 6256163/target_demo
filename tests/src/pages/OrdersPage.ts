import { Page, expect } from '@playwright/test'

export class OrdersPage {
  constructor(private page: Page) {
  }

  async goto() {
    await this.page.goto('/orders')
    await this.page.getByTestId('orders-card').waitFor()
  }

  async expectStatus(orderNo: string, status: string, timeout = 30_000) {
    const tag = this.page.getByTestId(`order-status-${orderNo}`)
    await expect(tag).toContainText(status, { timeout })
  }

  async openPayment(orderNo: string) {
    await this.page.getByTestId(`btn-pay-${orderNo}`).click()
    await this.page.getByTestId('payment-dialog').waitFor()
  }

  async cancel(orderNo: string) {
    await this.page.getByTestId(`btn-cancel-${orderNo}`).click()
    await this.page.waitForTimeout(800)
  }
}
