import { Page, expect } from '@playwright/test'

export class CartPage {
  constructor(private page: Page) {
  }

  async goto() {
    await this.page.goto('/cart')
    await this.page.getByTestId('cart-card').waitFor()
  }

  async expectTotalQuantity(qty: number) {
    await expect(this.page.getByTestId('cart-count')).toHaveText(String(qty))
  }

  async setQuantity(productId: number, quantity: number) {
    const input = this.page.getByTestId(`cart-qty-${productId}`).locator('input')
    await input.fill(String(quantity))
    await input.press('Enter')
    await this.page.waitForTimeout(600)
  }

  async remove(productId: number) {
    await this.page.getByTestId(`cart-remove-${productId}`).click()
    await this.page.waitForTimeout(600)
  }

  async checkout() {
    await this.page.getByTestId('btn-checkout').click()
    await this.page.getByTestId('payment-dialog').waitFor()
  }
}

export class PaymentDialog {
  constructor(private page: Page) {
  }

  async pay(outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'RANDOM' = 'SUCCESS') {
    await this.page.getByTestId('select-outcome').click()
    await this.page.locator('.el-select-dropdown__item').filter({ hasText: outcomeLabel(outcome) }).first().click()
    await this.page.getByTestId('btn-confirm-pay').click()
  }

  async expectResult(text: string | RegExp) {
    await expect(this.page.getByTestId('pay-result')).toContainText(text)
  }

  async close() {
    await this.page.getByTestId('btn-pay-cancel').click()
  }
}

function outcomeLabel(outcome: string): string {
  return {
    SUCCESS: '成功',
    FAILED: '失败',
    TIMEOUT: '超时',
    RANDOM: '随机'
  }[outcome] || '成功'
}
