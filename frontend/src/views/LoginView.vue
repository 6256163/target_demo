<template>
  <div class="login-wrap" style="max-width:420px;margin:80px auto">
    <el-card data-testid="login-card">
      <h2 style="text-align:center;margin-bottom:24px">SHOP DEMO 登录</h2>
      <el-tabs v-model="tab" data-testid="login-tabs">
        <el-tab-pane label="登录" name="login">
          <el-form ref="loginFormRef" :model="loginForm" :rules="rules" label-position="top">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="loginForm.username" data-testid="input-username" autocomplete="username"/>
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input v-model="loginForm.password" type="password" data-testid="input-password"
                        autocomplete="current-password" @keyup.enter="doLogin"/>
            </el-form-item>
            <el-button type="primary" style="width:100%" data-testid="btn-login" :loading="loading" @click="doLogin">
              登录
            </el-button>
            <div class="muted" style="margin-top:12px">
              演示账号：tester / 123456，管理员：admin / admin123
            </div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="注册" name="register">
          <el-form :model="regForm" :rules="rules" ref="regFormRef" label-position="top">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="regForm.username" data-testid="input-reg-username"/>
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input v-model="regForm.password" type="password" data-testid="input-reg-password"/>
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="regForm.email" data-testid="input-reg-email"/>
            </el-form-item>
            <el-button style="width:100%" data-testid="btn-register" :loading="loading" @click="doRegister">
              注册
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../api'
import { setSession } from '../stores/auth'

const router = useRouter()
const tab = ref('login')
const loading = ref(false)

const loginForm = reactive({ username: 'tester', password: '123456' })
const regForm = reactive({ username: '', password: '123456', email: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function doLogin() {
  loading.value = true
  try {
    const resp = await authApi.login(loginForm)
    setSession(resp.data)
    ElMessage.success('登录成功')
    await router.push('/products')
  } catch (e) {
    ElMessage.error(e.message || '登录失败')
  } finally {
    loading.value = false
  }
}

async function doRegister() {
  loading.value = true
  try {
    await authApi.register(regForm)
    ElMessage.success('注册成功，请登录')
    tab.value = 'login'
    loginForm.username = regForm.username
    loginForm.password = regForm.password
  } catch (e) {
    ElMessage.error(e.message || '注册失败')
  } finally {
    loading.value = false
  }
}
</script>
