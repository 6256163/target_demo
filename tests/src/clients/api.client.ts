import { APIRequestContext, request } from '@playwright/test'

export interface ApiResult<T = any> {
  status: number
  code: number
  message: string
  data: T
  raw: any
  /** 响应头（键为小写），用于 CORS/Content-Type 断言 */
  headers: Record<string, string>
}

export interface RawOptions {
  data?: any
  headers?: Record<string, string>
  /** 覆盖默认 Authorization；false 表示不带鉴权头 */
  token?: string | false
}

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080'

function qs(params: Record<string, any> = {}): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

/** 轻量 API 客户端：所有接口统一返回 {status, code, data}，断言时优先用 code（业务错误码） */
export class ShopApiClient {
  private token = ''
  private refreshToken = ''

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

  getAccessToken(): string {
    return this.token
  }

  getRefreshToken(): string {
    return this.refreshToken
  }

  useToken(token: string): void {
    this.token = token
  }

  async dispose() {
    await this.ctx.dispose()
  }

  /** 原始请求：用于构造匿名、指定 token、非法 body 等场景 */
  async raw<T = any>(method: string, url: string, options: RawOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...(options.headers || {}) }
    if (options.token === false) {
      // 显式匿名
    } else if (typeof options.token === 'string') {
      headers.Authorization = `Bearer ${options.token}`
    } else {
      Object.assign(headers, this.authHeader())
    }
    return this.send<T>(method, url, { ...options, headers })
  }

  private async call<T = any>(method: string, url: string, options: any = {}): Promise<ApiResult<T>> {
    const headers = { ...(options.headers || {}), ...this.authHeader() }
    return this.send<T>(method, url, { ...options, headers })
  }

  private async send<T = any>(method: string, url: string, options: any): Promise<ApiResult<T>> {
    const resp = await this.ctx.fetch(url, { method, ...options })
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
      raw,
      headers: resp.headers()
    }
  }

  // ---------------- auth ----------------
  async login(username: string, password: string) {
    const res = await this.call('POST', '/api/auth/login', { data: { username, password } })
    if (res.code === 0 && res.data?.accessToken) {
      this.token = res.data.accessToken
      this.refreshToken = res.data.refreshToken || ''
    }
    return res
  }

  async register(username: string, password: string, email?: string, nickname?: string) {
    return this.call('POST', '/api/auth/register', { data: { username, password, email, nickname } })
  }

  async me() {
    return this.call('GET', '/api/auth/me')
  }

  async refresh(refreshToken: string) {
    const res = await this.call('POST', '/api/auth/refresh', { data: { refreshToken } })
    if (res.code === 0 && res.data?.accessToken) {
      this.token = res.data.accessToken
      this.refreshToken = res.data.refreshToken || ''
    }
    return res
  }

  // ---------------- catalog ----------------
  async listProducts(params: Record<string, any> = {}) {
    return this.call('GET', `/api/products${qs(params)}`)
  }

  async productDetail(id: number) {
    return this.call('GET', `/api/products/${id}`)
  }

  async hotProducts(limit?: number) {
    return this.call('GET', `/api/products/hot${qs({ limit })}`)
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

  async cartAddRaw(payload: any) {
    return this.call('POST', '/api/cart/items', { data: payload })
  }

  async cartUpdate(productId: number, quantity: number) {
    return this.call('PUT', `/api/cart/items/${productId}`, { data: { quantity } })
  }

  async cartUpdateRaw(productId: number, payload: any) {
    return this.call('PUT', `/api/cart/items/${productId}`, { data: payload })
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
    return this.call('GET', `/api/orders${qs(params)}`)
  }

  async cancelOrder(orderNo: string) {
    return this.call('POST', `/api/orders/${orderNo}/cancel`)
  }

  async orderStatus(orderNo: string) {
    return this.call('GET', `/api/orders/${orderNo}/status`)
  }

  // ---------------- payment ----------------
  async pay(payload: {
    orderNo: string
    payType?: string
    outcome?: string
    idempotencyKey?: string
  }) {
    return this.call('POST', '/api/payments', { data: payload })
  }

  async payRaw(payload: any) {
    return this.call('POST', '/api/payments', { data: payload })
  }

  async paymentDetail(tradeNo: string) {
    return this.call('GET', `/api/payments/${tradeNo}`)
  }

  async paymentList(orderNo: string) {
    return this.call('GET', `/api/payments${qs({ orderNo })}`)
  }

  async paymentCallback(tradeNo: string, status: string, callbackId?: string) {
    return this.call('POST', `/api/payments/${tradeNo}/callback${qs({ status, callbackId })}`)
  }

  async refund(tradeNo: string) {
    return this.call('POST', `/api/payments/${tradeNo}/refund`)
  }

  // ---------------- admin ----------------
  async adminProducts(params: Record<string, any> = {}) {
    return this.call('GET', `/api/admin/products${qs(params)}`)
  }

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

  async adminClearCache() {
    return this.call('DELETE', '/api/admin/products/cache')
  }

  async adminOrders(params: Record<string, any> = {}) {
    return this.call('GET', `/api/admin/orders${qs(params)}`)
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

  async paymentConfig() {
    return this.call('GET', '/api/admin/payment/config')
  }

  async updatePaymentConfig(payload: Record<string, any>) {
    return this.call('PUT', '/api/admin/payment/config', { data: payload })
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
