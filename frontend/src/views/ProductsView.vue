<template>
  <div>
    <el-card data-testid="product-filter-card" style="margin-bottom:16px">
      <el-row :gutter="12">
        <el-col :span="8">
          <el-input v-model="query.keyword" placeholder="搜索商品名称" clearable
                    data-testid="input-keyword" @keyup.enter="load"/>
        </el-col>
        <el-col :span="6">
          <el-select v-model="query.categoryId" placeholder="全部分类" clearable
                     data-testid="select-category">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id"/>
          </el-select>
        </el-col>
        <el-col :span="4">
          <el-button type="primary" data-testid="btn-search" @click="load">搜索</el-button>
        </el-col>
      </el-row>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="6" v-for="p in products" :key="p.id" style="margin-bottom:16px">
        <el-card shadow="hover" class="product-card" :data-testid="`product-card-${p.id}`"
                 @click="$router.push(`/products/${p.id}`)">
          <div data-testid="product-name" style="font-weight:600;margin-bottom:6px">{{ p.name }}</div>
          <div class="muted" style="height:36px;overflow:hidden">{{ p.description }}</div>
          <div class="price">¥{{ p.price }}</div>
          <div class="muted">库存 {{ p.stock }}</div>
          <el-button type="primary" size="small" style="width:100%;margin-top:10px"
                     :data-testid="`btn-add-cart-${p.id}`" @click.stop="addToCart(p)">
            加入购物车
          </el-button>
        </el-card>
      </el-col>
    </el-row>

    <el-pagination style="margin-top:16px" background layout="prev, pager, next, total"
                   :current-page="query.page + 1" :page-size="query.size" :total="total"
                   data-testid="pagination" @current-change="onPageChange"/>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { productApi, cartApi } from '../api'

const query = reactive({ keyword: '', categoryId: null, page: 0, size: 12 })
const products = ref([])
const categories = ref([])
const total = ref(0)

async function load() {
  const [p, c] = await Promise.all([
    productApi.list({ ...query, categoryId: query.categoryId || undefined }),
    productApi.categories()
  ])
  products.value = p.data.content
  total.value = p.data.total
  categories.value = c.data
}

function onPageChange(page) {
  query.page = page - 1
  load()
}

async function addToCart(p) {
  try {
    await cartApi.add({ productId: p.id, quantity: 1 })
    ElMessage.success('已加入购物车')
  } catch (e) {
    ElMessage.error(e.message || '加入购物车失败')
  }
}

onMounted(load)
</script>
