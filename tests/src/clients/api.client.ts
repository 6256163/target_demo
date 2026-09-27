import { APIRequestContext, request } from '@playwright/test'

export interface ApiResult<T = any> {
  status: number
  code: number
  message: string
  data: T
  raw: any
}

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080'

/** 轻量 API 客户端：所有接口统一返回 {status, code, data}，断言时优先用 code（业务错误码） */
export class ShopApiClient {
  private token = ''

  constructor(private ctx: APIRequestContext) {
  }

  static async create(baseURL: string = BASE_URL): Promise<ShopApiClient> {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: { 'Content-Type': 'application/json' }
    })
    return new ShopApiClient(ctx)
  }

  static async loginAs(username: string, password: string, baseURL: string = BASE_URL): Promise<ShopApiClient> {
    const client = await ShopApiClient.create(baseURL)
    const res = await client.login(username, password)
    if (res.code !== 0) {
      throw new Error(`登录失败 ${username}: ${res.message}`)
    }
    return client
  }

  authHeader(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {}
  }

  async dispose() {
    await this.ctx.dispose()
  }

  private async call<T>(method: string, url: string, options: any = {}): Promise<ApiResult<T>> {
    const headers = { ...(options.headers || {}), ...this.authHeader() }
    const resp = await this.ctx.fetch(url, { method, ...options, headers })
    const text = await resp.text()
    let raw: any = null
    try {
      raw = text ? JSON.parse(text) : null
    } catch {
      raw = text
    }
    return {
      status: resp.status(),
      code: raw?.code ?? -1,
      message: raw?.message ?? '',
      data: raw?.data,
      raw
    }
  }

  // ---------------- auth ----------------
  async login(username: string, password: string) {
    const res = await this.call('POST', '/api/auth/login', { data: { username, password } })
    if (res.code === 0 && res.data?.accessToken) {
      this.token = res.data.accessToken
    }
    return res
  }

  async register(username: string, password: string, email?: string) {
    return this.call('POST', '/api/auth/register', { data: { username, password, email } })
  }

  async me() {
    return this.call('GET', '/api/auth/me')
  }

  async refresh(refreshToken: string) {
    return this.call('POST', '/api/auth/refresh', { data: { refreshToken } })
  }

  // ---------------- catalog ----------------
  async listProducts(params: Record<string, any> = {}) {
    return this.call('GET', `/api/products?${new URLSearchParams(params).toString()}`)
  }

  async productDetail(id: number) {
    return this.call('GET', `/api/products/${id}`)
  }

  async categories() {
    return this.call('GET', '/api/categories')
  }

  // ---------------- cart ----------------
  async cartView() {
    return this.call('GET', '/api/cart')
  }

  async cartAdd(productId: number, quantity = 1) {
    return this.call('POST', '/api/cart/items', { data: { productId, quantity } })
  }

  async cartUpdate(productId: number, quantity: number) {
    return this.call('PUT', `/api/cart/items/${productId}`, { data: { quantity } })
  }

  async cartRemove(productId: number) {
    return this.call('DELETE', `/api/cart/items/${productId}`)
  }

  async cartClear() {
    return this.call('DELETE', '/api/cart')
  }

  // ---------------- order ----------------
  async createOrder(payload: any) {
    return this.call('POST', '/api/orders', { data: payload })
  }

  async getOrder(orderNo: string) {
    return this.call('GET', `/api/orders/${orderNo}`)
  }

  async listOrders(params: Record<string, any> = {}) {
    return this.call('GET', `/api/orders?${new URLSearchParams(params).toString()}`)
  }

  async cancelOrder(orderNo: string) {
    return this.call('POST', `/api/orders/${orderNo}/cancel`)
  }

  async orderStatus(orderNo: string) {
    return this.call('GET', `/api/orders/${orderNo}/status`)
  }

  // ---------------- payment ----------------
  async pay(payload: { orderNo: string, payType?: string, outcome?: string }) {
    return this.call('POST', '/api/payments', { data: payload })
  }

  async paymentDetail(tradeNo: string) {
    return this.call('GET', `/api/payments/${tradeNo}`)
  }

  async paymentCallback(tradeNo: string, status: string, callbackId?: string) {
    const q = new URLSearchParams({ status })
    if (callbackId) q.set('callbackId', callbackId)
    return this.call('POST', `/api/payments/${tradeNo}/callback?${q.toString()}`)
  }

  async refund(tradeNo: string) {
    return this.call('POST', `/api/payments/${tradeNo}/refund`)
  }

  async paymentConfig() {
    return this.call('GET', '/api/admin/payment/config')
  }

  async updatePaymentConfig(payload: Record<string, any>) {
    return this.call('PUT', '/api/admin/payment/config', { data: payload })
  }

  // ---------------- admin ----------------
  async adminCreateProduct(payload: Record<string, any>) {
    return this.call('POST', '/api/admin/products', { data: payload })
  }

  async adminUpdateProduct(id: number, payload: Record<string, any>) {
    return this.call('PUT', `/api/admin/products/${id}`, { data: payload })
  }

  async adminDeleteProduct(id: number) {
    return this.call('DELETE', `/api/admin/products/${id}`)
  }

  async adminAdjustStock(id: number, delta: number) {
    return this.call('PATCH', `/api/admin/products/${id}/stock`, { data: { delta } })
  }

  async adminOrders(params: Record<string, any> = {}) {
    return this.call('GET', `/api/admin/orders?${new URLSearchParams(params).toString()}`)
  }

  async adminShip(orderNo: string) {
    return this.call('POST', `/api/admin/orders/${orderNo}/ship`)
  }

  async adminDeliver(orderNo: string) {
    return this.call('POST', `/api/admin/orders/${orderNo}/deliver`)
  }

  async adminStats() {
    return this.call('GET', '/api/admin/orders/stats')
  }

  // ---------------- 轮询辅助（MQ 异步链路） ----------------
  async waitForPaymentStatus(tradeNo: string, expected: string[], timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let last = ''
    while (Date.now() < deadline) {
      const res = await this.paymentDetail(tradeNo)
      last = res.data?.status
      if (expected.includes(last)) return last
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error(`支付单 ${tradeNo} 在 ${timeoutMs}ms 内未到达 ${expected.join('/')}，当前=${last}`)
  }

  async waitForOrderStatus(orderNo: string, expected: string[], timeoutMs = 30_000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let last = ''
    while (Date.now() < deadline) {
      const res = await this.getOrder(orderNo)
      last = res.data?.status
      if (expected.includes(last)) return last
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error(`订单 ${orderNo} 在 ${timeoutMs}ms 内未到达 ${expected.join('/')}，当前=${last}`)
  }
}
