<template>
  <el-card v-if="product" data-testid="product-detail">
    <el-row :gutter="24">
      <el-col :span="10">
        <div style="height:280px;background:#f2f3f5;display:flex;align-items:center;justify-content:center">
          <span class="muted">商品图片占位</span>
        </div>
      </el-col>
      <el-col :span="14">
        <h2 data-testid="detail-name">{{ product.name }}</h2>
        <div class="muted" style="margin:8px 0">{{ product.description }}</div>
        <div class="price" data-testid="detail-price">¥{{ product.price }}</div>
        <div class="muted">库存：<span data-testid="detail-stock">{{ product.stock }}</span></div>
        <div class="muted">缓存命中：<span data-testid="detail-cached">{{ product.cached }}</span></div>

        <div style="margin:16px 0">
          <el-input-number v-model="quantity" :min="1" :max="product.stock"
                           data-testid="input-quantity"/>
        </div>
        <el-button type="primary" data-testid="btn-add-cart" @click="addToCart">加入购物车</el-button>
        <el-button type="danger" data-testid="btn-buy-now" @click="buyNow">立即下单</el-button>
      </el-col>
    </el-row>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productApi, cartApi, orderApi } from '../api'

const route = useRoute()
const router = useRouter()
const product = ref(null)
const quantity = ref(1)

onMounted(async () => {
  const resp = await productApi.detail(route.params.id)
  product.value = resp.data
})

async function addToCart() {
  await cartApi.add({ productId: product.value.id, quantity: quantity.value })
  ElMessage.success('已加入购物车')
  router.push('/cart')
}

async function buyNow() {
  const resp = await orderApi.create({
    items: [{ productId: product.value.id, quantity: quantity.value }],
    receiverName: '自动化买家',
    receiverPhone: '13900000001',
    receiverAddress: '测试地址 001 号'
  })
  ElMessage.success('下单成功')
  router.push({ name: 'orders', query: { orderNo: resp.data.orderNo } })
}
</script>
