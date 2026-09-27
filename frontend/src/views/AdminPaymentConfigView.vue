<template>
  <el-card data-testid="payment-config-card">
    <h3>Mock 支付网关配置</h3>
    <div class="muted" style="margin-bottom:16px">
      调整失败率 / 超时率 / 响应延迟，用于性能测试时构造不同的下游耗时与错误分布。
    </div>

    <el-form :model="form" label-width="140px" style="max-width:520px">
      <el-form-item label="随机失败率">
        <el-slider v-model="form.failureRate" :min="0" :max="1" :step="0.01"
                   data-testid="config-failure-rate"/>
        <span style="margin-left:12px" data-testid="config-failure-rate-text">{{ form.failureRate }}</span>
      </el-form-item>
      <el-form-item label="随机超时率">
        <el-slider v-model="form.timeoutRate" :min="0" :max="1" :step="0.01"
                   data-testid="config-timeout-rate"/>
        <span style="margin-left:12px">{{ form.timeoutRate }}</span>
      </el-form-item>
      <el-form-item label="最小延迟(ms)">
        <el-input-number v-model="form.minDelayMs" :min="0" data-testid="config-min-delay"/>
      </el-form-item>
      <el-form-item label="最大延迟(ms)">
        <el-input-number v-model="form.maxDelayMs" :min="0" data-testid="config-max-delay"/>
      </el-form-item>
      <el-form-item label="异步(MQ)处理">
        <el-switch v-model="form.asyncEnabled" data-testid="config-async"/>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" data-testid="config-btn-save" @click="save">保存配置</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup>
import { reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { paymentApi } from '../api'

const form = reactive({
  failureRate: 0.05,
  timeoutRate: 0.03,
  minDelayMs: 300,
  maxDelayMs: 2000,
  asyncEnabled: true
})

async function load() {
  const resp = await paymentApi.config()
  Object.assign(form, resp.data)
}

async function save() {
  await paymentApi.updateConfig({ ...form })
  ElMessage.success('配置已保存')
}

onMounted(load)
</script>
