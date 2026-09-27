import { test, expect, uniq } from '../fixtures'

test.describe('鉴权 API', () => {
  test('登录成功并返回 JWT 与角色', async ({ userApi }) => {
    const res = await userApi.me()
    expect(res.status).toBe(200)
    expect(res.code).toBe(0)
    expect(res.data.username).toBe(process.env.USER_NAME || 'tester')
    expect(res.data.role).toBe('USER')
  })

  test('密码错误返回 40101', async ({ api }) => {
    const res = await api.login('tester', 'wrong-password')
    expect(res.status).toBe(401)
    expect(res.code).toBe(40101)
  })

  test('未携带 token 访问受保护接口返回 401', async ({ api }) => {
    const res = await api.cartView()
    expect(res.status).toBe(401)
  })

  test('用户名重复注册返回 40901', async ({ api }) => {
    const res = await api.register('tester', '123456')
    expect(res.code).toBe(40901)
  })

  test('注册新用户后可用新账号登录', async ({ api }) => {
    const username = uniq('auto')
    const reg = await api.register(username, '123456', `${username}@shop.demo`)
    expect(reg.code).toBe(0)

    const login = await api.login(username, '123456')
    expect(login.code).toBe(0)
    expect(login.data.accessToken).toBeTruthy()
  })

  test('refresh token 可换取新的 access token', async ({ api }) => {
    const login = await api.login(process.env.USER_NAME || 'tester', process.env.USER_PASS || '123456')
    expect(login.code).toBe(0)
    const refreshed = await api.refresh(login.data.refreshToken)
    expect(refreshed.code).toBe(0)
    expect(refreshed.data.accessToken).toBeTruthy()
  })
})
