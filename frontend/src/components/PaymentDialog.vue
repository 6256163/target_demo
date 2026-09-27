<template>
  <el-dialog :model-value="visible" title="模拟支付" width="460px" :close-on-click-modal="false"
             data-testid="payment-dialog" @close="emit('close')">
    <div v-if="orderNo">
      <div style="margin-bottom:12px">
        订单号：<b data-testid="pay-order-no">{{ orderNo }}</b>
      </div>
      <div style="margin-bottom:12px">
        应付金额：<b class="price" data-testid="pay-amount">¥{{ amount }}</b>
      </div>

      <el-form label-width="90px">
        <el-form-item label="支付方式">
          <el-select v-model="payType" data-testid="select-pay-type" style="width:100%">
            <el-option label="支付宝" value="ALIPAY"/>
            <el-option label="微信" value="WECHAT"/>
            <el-option label="银行卡" value="CARD"/>
            <el-option label="余额" value="BALANCE"/>
          </el-select>
        </el-form-item>
        <el-form-item label="模拟结果">
          <el-select v-model="outcome" data-testid="select-outcome" style="width:100%">
            <el-option label="随机（按失败率）" value="RANDOM"/>
            <el-option label="成功" value="SUCCESS"/>
            <el-option label="失败" value="FAILED"/>
            <el-option label="超时" value="TIMEOUT"/>
          </el-select>
        </el-form-item>
      </el-form>

      <el-alert v-if="result" :type="resultType" :title="result" :closable="false"
                data-testid="pay-result" style="margin-bottom:12px"/>

      <div class="muted" style="margin-bottom:8px">
        支付单状态：<span data-testid="pay-status">{{ paymentStatus || '-' }}</span>
      </div>
    </div>

    <template #footer>
      <el-button data-testid="btn-pay-cancel" @click="emit('close')">关闭</el-button>
      <el-button type="primary" data-testid="btn-confirm-pay" :loading="paying" @click="pay">
        确认支付
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { paymentApi, orderApi } from '../api'

const props = defineProps({
  visible: Boolean,
  orderNo: String,
  amount: { type: [Number, String], default: 0 }
})
const emit = defineEmits(['close', 'paid'])

const payType = ref('ALIPAY')
const outcome = ref('SUCCESS')
const paying = ref(false)
const paymentStatus = ref('')
const result = ref('')
const resultType = ref('info')

let timer = null

watch(() => props.visible, (v) => {
  if (v) {
    result.value = ''
    paymentStatus.value = ''
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
})

async function pay() {
  paying.value = true
  result.value = ''
  try {
    const resp = await paymentApi.pay({
      orderNo: props.orderNo,
      payType: payType.value,
      outcome: outcome.value
    })
    const tradeNo = resp.data.tradeNo
    paymentStatus.value = resp.data.status

    // 轮询支付结果
    timer = setInterval(async () => {
      const detail = await paymentApi.detail(tradeNo)
      paymentStatus.value = detail.data.status
      if (['SUCCESS', 'FAILED', 'TIMEOUT', 'REFUNDED'].includes(detail.data.status)) {
        clearInterval(timer)
        timer = null
        paying.value = false
        result.value = `支付${detail.data.status}：${detail.data.gatewayMessage || ''}`
        resultType.value = detail.data.status === 'SUCCESS' ? 'success' : 'error'
        if (detail.data.status === 'SUCCESS') {
          emit('paid')
        }
      }
    }, 800)
  } catch (e) {
    paying.value = false
    ElMessage.error(e.message || '支付发起失败')
  }
}
</script>
