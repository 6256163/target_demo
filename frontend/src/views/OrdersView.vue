<template>
  <div>
    <el-card data-testid="orders-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3>我的订单</h3>
        <el-select v-model="status" placeholder="全部状态" clearable style="width:180px"
                   data-testid="select-order-status" @change="load">
          <el-option v-for="s in statuses" :key="s" :label="s" :value="s"/>
        </el-select>
      </div>

      <el-table :data="orders" style="width:100%" data-testid="orders-table">
        <el-table-column prop="orderNo" label="订单号" width="200"/>
        <el-table-column prop="payAmount" label="金额" width="120"/>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" :data-testid="`order-status-${row.orderNo}`">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="200"/>
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <el-button link type="primary" :data-testid="`btn-pay-${row.orderNo}`"
                       v-if="['PENDING_PAYMENT', 'PAY_FAILED', 'PAYING'].includes(row.status)"
                       @click="openPay(row)">支付
            </el-button>
            <el-button link type="danger" :data-testid="`btn-cancel-${row.orderNo}`"
                       v-if="['PENDING_PAYMENT', 'PAYING'].includes(row.status)"
                       @click="cancel(row.orderNo)">取消
            </el-button>
            <el-button link :data-testid="`btn-refresh-${row.orderNo}`" @click="load">刷新</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination style="margin-top:16px" background layout="prev, pager, next, total"
                     :current-page="page + 1" :page-size="size" :total="total"
                     data-testid="orders-pagination" @current-change="onPageChange"/>
    </el-card>

    <PaymentDialog :visible="payVisible" :order-no="currentOrderNo" :amount="currentAmount"
                   @close="payVisible = false" @paid="onPaid"/>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { orderApi } from '../api'
import PaymentDialog from '../components/PaymentDialog.vue'

const route = useRoute()
const orders = ref([])
const statuses = ['PENDING_PAYMENT', 'PAYING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAY_FAILED']
const status = ref(null)
const page = ref(0)
const size = ref(10)
const total = ref(0)
const payVisible = ref(false)
const currentOrderNo = ref('')
const currentAmount = ref(0)
let timer = null

async function load() {
  const resp = await orderApi.mine({ status: status.value || undefined, page: page.value, size: size.value })
  orders.value = resp.data.content
  total.value = resp.data.total
}

function onPageChange(p) {
  page.value = p - 1
  load()
}

function statusTag(s) {
  return { PAID: 'success', SHIPPED: 'success', DELIVERED: 'success', CANCELLED: 'info', PAY_FAILED: 'danger' }[s] || 'warning'
}

function openPay(row) {
  currentOrderNo.value = row.orderNo
  currentAmount.value = row.payAmount
  payVisible.value = true
}

async function cancel(orderNo) {
  try {
    await orderApi.cancel(orderNo)
    ElMessage.success('订单已取消')
  } catch (e) {
    ElMessage.error(e.message || '取消失败')
  }
  load()
}

function onPaid() {
  payVisible.value = false
  load()
}

onMounted(() => {
  load()
  if (route.query.orderNo) {
    currentOrderNo.value = route.query.orderNo
    payVisible.value = true
  }
  // 订单状态经 MQ 异步流转，页面定时刷新
  timer = setInterval(load, 3000)
})

onUnmounted(() => timer && clearInterval(timer))
</script>
