import { reactive, computed } from 'vue'

const state = reactive({
  token: localStorage.getItem('accessToken') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null')
})

export function setSession(payload, role) {
  state.token = payload.accessToken
  state.user = {
    id: payload.userId,
    username: payload.username,
    role: role || payload.role
  }
  localStorage.setItem('accessToken', payload.accessToken)
  localStorage.setItem('user', JSON.stringify(state.user))
}

export function clearSession() {
  state.token = ''
  state.user = null
  localStorage.removeItem('accessToken')
  localStorage.removeItem('user')
}

export function useAuth() {
  return {
    user: computed(() => state.user),
    isLogin: computed(() => !!state.token),
    isAdmin: computed(() => state.user?.role === 'ADMIN')
  }
}
