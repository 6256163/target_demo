import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import ProductsView from '../views/ProductsView.vue'
import ProductDetailView from '../views/ProductDetailView.vue'
import CartView from '../views/CartView.vue'
import OrdersView from '../views/OrdersView.vue'
import AdminProductsView from '../views/AdminProductsView.vue'
import AdminOrdersView from '../views/AdminOrdersView.vue'
import AdminPaymentConfigView from '../views/AdminPaymentConfigView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  { path: '/', redirect: '/products' },
  { path: '/products', name: 'products', component: ProductsView },
  { path: '/products/:id', name: 'product-detail', component: ProductDetailView },
  { path: '/cart', name: 'cart', component: CartView },
  { path: '/orders', name: 'orders', component: OrdersView },
  { path: '/admin/products', name: 'admin-products', component: AdminProductsView, meta: { admin: true } },
  { path: '/admin/orders', name: 'admin-orders', component: AdminOrdersView, meta: { admin: true } },
  { path: '/admin/payment', name: 'admin-payment', component: AdminPaymentConfigView, meta: { admin: true } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('accessToken')
  const role = JSON.parse(localStorage.getItem('user') || 'null')?.role
  if (to.name !== 'login' && !token) {
    return next({ name: 'login', query: { redirect: to.fullPath } })
  }
  if (to.meta.admin && role !== 'ADMIN') {
    return next({ name: 'products' })
  }
  next()
})

export default router
