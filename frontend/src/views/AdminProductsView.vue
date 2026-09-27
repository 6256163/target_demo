<template>
  <el-card data-testid="admin-products-card">
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <h3>商品管理</h3>
      <div>
        <el-input v-model="keyword" placeholder="关键字" style="width:180px;margin-right:8px"
                  data-testid="admin-input-keyword" @keyup.enter="load"/>
        <el-button data-testid="admin-btn-search" @click="load">搜索</el-button>
        <el-button type="primary" data-testid="admin-btn-create" @click="openCreate">新增商品</el-button>
      </div>
    </div>

    <el-table :data="products" style="width:100%" data-testid="admin-products-table">
      <el-table-column prop="id" label="ID" width="70"/>
      <el-table-column prop="name" label="名称" min-width="180"/>
      <el-table-column prop="price" label="价格" width="100"/>
      <el-table-column prop="stock" label="库存" width="100"/>
      <el-table-column prop="status" label="状态" width="110"/>
      <el-table-column label="操作" width="260">
        <template #default="{ row }">
          <el-button link type="primary" :data-testid="`admin-btn-edit-${row.id}`" @click="openEdit(row)">编辑</el-button>
          <el-button link :data-testid="`admin-btn-stock-${row.id}`" @click="adjustStock(row)">加库存</el-button>
          <el-button link type="danger" :data-testid="`admin-btn-delete-${row.id}`" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:16px" background layout="prev, pager, next, total"
                   :current-page="page + 1" :page-size="size" :total="total"
                   data-testid="admin-pagination" @current-change="onPageChange"/>

    <el-dialog :model-value="dialogVisible" :title="form.id ? '编辑商品' : '新增商品'" width="520px"
               data-testid="product-dialog" @close="dialogVisible = false">
      <el-form :model="form" label-width="90px">
        <el-form-item label="名称">
          <el-input v-model="form.name" data-testid="product-input-name"/>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" data-testid="product-input-desc"/>
        </el-form-item>
        <el-form-item label="价格">
          <el-input-number v-model="form.price" :min="0.01" :precision="2"
                           data-testid="product-input-price"/>
        </el-form-item>
        <el-form-item label="库存">
          <el-input-number v-model="form.stock" :min="0" data-testid="product-input-stock"/>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.categoryId" data-testid="product-select-category">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" data-testid="product-select-status">
            <el-option label="上架" value="ON_SALE"/>
            <el-option label="下架" value="OFF_SALE"/>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button data-testid="product-btn-cancel" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" data-testid="product-btn-save" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, productApi } from '../api'

const products = ref([])
const categories = ref([])
const keyword = ref('')
const page = ref(0)
const size = ref(10)
const total = ref(0)
const dialogVisible = ref(false)
const form = reactive({ id: null, name: '', description: '', price: 9.9, stock: 100, categoryId: null, status: 'ON_SALE' })

async function load() {
  const [p, c] = await Promise.all([
    adminApi.products({ keyword: keyword.value, page: page.value, size: size.value }),
    productApi.categories()
  ])
  products.value = p.data.content
  total.value = p.data.total
  categories.value = c.data
}

function onPageChange(p) {
  page.value = p - 1
  load()
}

function openCreate() {
  Object.assign(form, { id: null, name: `压测商品-${Date.now()}`, description: '自动化创建', price: 19.9, stock: 500, categoryId: categories.value[0]?.id, status: 'ON_SALE' })
  dialogVisible.value = true
}

function openEdit(row) {
  Object.assign(form, row)
  dialogVisible.value = true
}

async function save() {
  if (form.id) {
    await adminApi.updateProduct(form.id, form)
  } else {
    await adminApi.createProduct(form)
  }
  ElMessage.success('保存成功')
  dialogVisible.value = false
  load()
}

async function adjustStock(row) {
  const { value } = await ElMessageBox.prompt('输入库存增量（可为负）', '调整库存', { inputValue: '100' })
  await adminApi.adjustStock(row.id, Number(value))
  ElMessage.success('库存已调整')
  load()
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除 ${row.name}？`, '提示', { type: 'warning' })
  await adminApi.deleteProduct(row.id)
  ElMessage.success('已删除')
  load()
}

onMounted(load)
</script>
