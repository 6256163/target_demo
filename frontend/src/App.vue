<template>
  <div>
    <header class="app-header" v-if="showNav">
      <div class="app-logo" data-testid="nav-logo" @click="$router.push('/products')">SHOP DEMO · 压测靶场</div>

      <el-menu :default-active="activeIndex" mode="horizontal" :router="true" :ellipsis="false"
               data-testid="main-menu">
        <el-menu-item index="/products" data-testid="menu-products">商品</el-menu-item>
        <el-menu-item index="/cart" data-testid="menu-cart">
          购物车<el-badge v-if="cartCount" :value="cartCount" class="item" style="margin-left:6px"/>
        </el-menu-item>
        <el-menu-item index="/orders" data-testid="menu-orders">我的订单</el-menu-item>
        <template v-if="isAdmin">
          <el-menu-item index="/admin/products" data-testid="menu-admin-products">商品管理</el-menu-item>
          <el-menu-item index="/admin/orders" data-testid="menu-admin-orders">订单管理</el-menu-item>
          <el-menu-item index="/admin/payment" data-testid="menu-admin-payment">支付配置</el-menu-item>
        </template>
      </el-menu>

      <div style="display:flex;align-items:center;gap:12px">
        <span data-testid="current-user">{{ currentUser }}</span>
        <el-button size="small" data-testid="btn-logout" @click="logout">退出</el-button>
      </div>
    </header>

    <div class="app-body">
      <router-view @cart-change="loadCartCount"/>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth, clearSession } from './stores/auth'
import { cartApi } from './api'

const route = useRoute()
const router = useRouter()
const { user, isAdmin } = useAuth()

const cartCount = ref(0)
const showNav = computed(() => route.name !== 'login')
const currentUser = computed(() => user.value?.username || '未登录')
const activeIndex = computed(() => route.path)

async function loadCartCount() {
  if (!localStorage.getItem('accessToken')) return
  try {
    const resp = await cartApi.view()
    cartCount.value = resp.data?.totalQuantity || 0
  } catch (e) {
    cartCount.value = 0
  }
}

function logout() {
  clearSession()
  router.push('/login')
}

onMounted(loadCartCount)
watch(() => route.fullPath, loadCartCount)
</script>
