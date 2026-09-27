<template>
  <div>
    <el-card data-testid="cart-card">
      <h3>我的购物车</h3>
      <el-table :data="items" style="width:100%" data-testid="cart-table">
        <el-table-column prop="productName" label="商品" data-testid="col-product"/>
        <el-table-column prop="snapshotPrice" label="单价" width="120"/>
        <el-table-column label="数量" width="180">
          <template #default="{ row }">
            <el-input-number v-model="row.quantity" :min="1" size="small"
                             :data-testid="`cart-qty-${row.productId}`"
                             @change="(val) => updateQty(row.productId, val)"/>
          </template>
        </el-table-column>
        <el-table-column prop="subtotal" label="小计" width="120"/>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button link type="danger" :data-testid="`cart-remove-${row.productId}`"
                       @click="remove(row.productId)">删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top:16px;display:flex;align-items:center;justify-content:space-between">
        <div>
          合计：<span class="price" data-testid="cart-total">¥{{ total }}</span>
          （<span data-testid="cart-count">{{ count }}</span> 件）
        </div>
        <div>
          <el-button data-testid="btn-cart-clear" @click="clear">清空</el-button>
          <el-button type="primary" data-testid="btn-checkout" :disabled="!items.length" @click="checkout">
            结算下单
          </el-button>
        </div>
      </div>
    </el-card>

    <PaymentDialog :visible="payVisible" :order-no="currentOrderNo" :amount="currentAmount"
                   @close="payVisible = false" @paid="onPaid"/>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { cartApi, orderApi } from '../api'
import PaymentDialog from '../components/PaymentDialog.vue'

const router = useRouter()
const items = ref([])
const total = ref('0.00')
const count = ref(0)
const payVisible = ref(false)
const currentOrderNo = ref('')
const currentAmount = ref(0)

async function reload() {
  const resp = await cartApi.view()
  items.value = resp.data.items
  total.value = resp.data.totalAmount
  count.value = resp.data.totalQuantity
}

async function updateQty(productId, quantity) {
  await cartApi.update(productId, quantity)
  await reload()
}

async function remove(productId) {
  await cartApi.remove(productId)
  await reload()
}

async function clear() {
  await cartApi.clear()
  await reload()
}

async function checkout() {
  const resp = await orderApi.create({
    fromCart: true,
    receiverName: '自动化买家',
    receiverPhone: '13900000001',
    receiverAddress: '测试地址 001 号'
  })
  currentOrderNo.value = resp.data.orderNo
  currentAmount.value = resp.data.payAmount
  payVisible.value = true
  ElMessage.success('下单成功，请完成支付')
}

function onPaid() {
  payVisible.value = false
  router.push('/orders')
}

onMounted(reload)
</script>
