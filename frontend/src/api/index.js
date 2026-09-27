import http from './http'

export const authApi = {
  login: (data) => http.post('/auth/login', data),
  register: (data) => http.post('/auth/register', data),
  me: () => http.get('/auth/me')
}

export const productApi = {
  list: (params) => http.get('/products', { params }),
  detail: (id) => http.get(`/products/${id}`),
  categories: () => http.get('/categories'),
  hot: (limit = 10) => http.get('/products/hot', { params: { limit } })
}

export const cartApi = {
  view: () => http.get('/cart'),
  add: (data) => http.post('/cart/items', data),
  update: (productId, quantity) => http.put(`/cart/items/${productId}`, { quantity }),
  remove: (productId) => http.delete(`/cart/items/${productId}`),
  clear: () => http.delete('/cart')
}

export const orderApi = {
  create: (data) => http.post('/orders', data),
  detail: (orderNo) => http.get(`/orders/${orderNo}`),
  mine: (params) => http.get('/orders', { params }),
  cancel: (orderNo) => http.post(`/orders/${orderNo}/cancel`),
  status: (orderNo) => http.get(`/orders/${orderNo}/status`)
}

export const paymentApi = {
  pay: (data) => http.post('/payments', data),
  detail: (tradeNo) => http.get(`/payments/${tradeNo}`),
  list: (orderNo) => http.get('/payments', { params: { orderNo } }),
  callback: (tradeNo, status, callbackId) => http.post(`/payments/${tradeNo}/callback`, null, {
    params: { status, callbackId }
  }),
  refund: (tradeNo) => http.post(`/payments/${tradeNo}/refund`),
  config: () => http.get('/admin/payment/config'),
  updateConfig: (data) => http.put('/admin/payment/config', data)
}

export const adminApi = {
  products: (params) => http.get('/admin/products', { params }),
  createProduct: (data) => http.post('/admin/products', data),
  updateProduct: (id, data) => http.put(`/admin/products/${id}`, data),
  deleteProduct: (id) => http.delete(`/admin/products/${id}`),
  adjustStock: (id, delta) => http.patch(`/admin/products/${id}/stock`, { delta }),
  orders: (params) => http.get('/admin/orders', { params }),
  ship: (orderNo) => http.post(`/admin/orders/${orderNo}/ship`),
  deliver: (orderNo) => http.post(`/admin/orders/${orderNo}/deliver`),
  stats: () => http.get('/admin/orders/stats')
}
