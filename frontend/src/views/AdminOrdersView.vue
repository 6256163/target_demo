<template>
  <el-card data-testid="admin-orders-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3>订单管理</h3>
      <div>
        <el-select v-model="status" placeholder="全部状态" clearable style="width:180px;margin-right:8px"
                   data-testid="admin-select-status" @change="load">
          <el-option v-for="s in statuses" :key="s" :label="s" :value="s"/>
        </el-select>
        <el-button data-testid="admin-btn-refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="muted" style="margin-bottom:12px" data-testid="admin-order-stats">
      <span v-for="(v, k) in stats" :key="k" style="margin-right:12px">{{ k }}: {{ v }}</span>
    </div>

    <el-table :data="orders" style="width:100%" data-testid="admin-orders-table">
      <el-table-column prop="orderNo" label="订单号" width="200"/>
      <el-table-column prop="userId" label="用户ID" width="100"/>
      <el-table-column prop="payAmount" label="金额" width="110"/>
      <el-table-column label="状态" width="130">
        <template #default="{ row }">
          <el-tag :data-testid="`admin-order-status-${row.orderNo}`">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="190"/>
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button link type="primary" :data-testid="`admin-btn-ship-${row.orderNo}`"
                     :disabled="row.status !== 'PAID'" @click="ship(row.orderNo)">发货
          </el-button>
          <el-button link :data-testid="`admin-btn-deliver-${row.orderNo}`"
                     :disabled="row.status !== 'SHIPPED'" @click="deliver(row.orderNo)">签收
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:16px" background layout="prev, pager, next, total"
                   :current-page="page + 1" :page-size="size" :total="total"
                   data-testid="admin-orders-pagination" @current-change="onPageChange"/>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '../api'

const orders = ref([])
const stats = ref({})
const statuses = ['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']
const status = ref(null)
const page = ref(0)
const size = ref(10)
const total = ref(0)

async function load() {
  const [o, s] = await Promise.all([
    adminApi.orders({ status: status.value || undefined, page: page.value, size: size.value }),
    adminApi.stats()
  ])
  orders.value = o.data.content
  total.value = o.data.total
  stats.value = s.data
}

function onPageChange(p) {
  page.value = p - 1
  load()
}

async function ship(orderNo) {
  await adminApi.ship(orderNo)
  ElMessage.success('已发货')
  load()
}

async function deliver(orderNo) {
  await adminApi.deliver(orderNo)
  ElMessage.success('已签收')
  load()
}

onMounted(load)
</script>
