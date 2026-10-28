import { test, expect, credentials, uniqueUsername, runId } from '../fixtures'
import { ShopApiClient } from '../clients/api.client'
import { decodeJwt, detectJwtSecret, noneAlgToken, signJwt, tamperPayload } from '../support/jwt'
import { concurrently } from '../support/perf'

test.describe('M1 认证与鉴权', () => {
  test('[AUTH-001][P0][L1] 正确账号登录返回 JWT 与角色 @p0 @l1 @m1', async ({ api }) => {
    const res = await api.login(credentials.USER.name, credentials.USER.pass)

    expect(res.status, '登录成功应返回 HTTP 200').toBe(200)
    expect(res.code, '登录成功 code=0').toBe(0)
    expect(res.data.accessToken, 'accessToken 非空').toBeTruthy()
    expect(res.data.refreshToken, 'refreshToken 非空').toBeTruthy()
    expect(res.data.tokenType).toBe('Bearer')
    expect(res.data.expiresIn, 'API.md §3.1：expiresIn 单位为秒，默认 3600').toBe(3600)
    expect(res.data.role).toBe('USER')
    expect(res.data.username).toBe(credentials.USER.name)
  })

  test('[AUTH-002][P0][L1] 密码错误登录返回 40101 且不返回 token @p0 @l1 @m1', async ({ api }) => {
    const res = await api.login(credentials.USER.name, 'definitely-wrong-password')

    expect(res.status, 'API.md §1.4：40101 映射 HTTP 401').toBe(401)
    expect(res.code).toBe(40101)
    expect(res.data?.accessToken, '失败响应不得泄露 token').toBeUndefined()
    expect(res.data?.refreshToken).toBeUndefined()
  })

  test('[AUTH-003][P0][L1] 不存在用户与密码错误响应一致，不泄露用户是否存在 @p0 @l1 @m1', async ({ api }) => {
    const wrongPassword = await api.login(credentials.USER.name, 'definitely-wrong-password')
    const noSuchUser = await api.login(uniqueUsername('nobody'), 'definitely-wrong-password')

    expect(noSuchUser.status).toBe(401)
    expect(noSuchUser.code).toBe(40101)
    expect(noSuchUser.message, '两种情况应返回相同文案，避免用户名枚举').toBe(wrongPassword.message)
    expect(noSuchUser.data?.accessToken).toBeUndefined()
  })

  test('[AUTH-004][P0][L1] 匿名访问受保护接口统一返回 401/40100 @p0 @l1 @m1', async ({ api }) => {
    const probes = [
      ['GET /api/auth/me', await api.me()],
      ['GET /api/cart', await api.cartView()],
      ['GET /api/orders', await api.listOrders()],
      ['GET /api/payments?orderNo=any-order', await api.paymentList('any-order')]
    ] as const

    for (const [label, res] of probes) {
      expect.soft(res.status, `${label} 匿名访问应返回 401（API.md §1.1/§3.1）`).toBe(401)
      expect.soft(res.code, `${label} 匿名访问应返回 40100`).toBe(40100)
      expect.soft(res.data, `${label} 鉴权失败不得返回业务数据`).toBeUndefined()
    }
  })

  test('[AUTH-005][P0][L1] 注册新用户后角色正确且可登录访问 me @p0 @l1 @m1', async ({ api }) => {
    const username = uniqueUsername('reg')
    const reg = await api.register(username, 'Passw0rd!', `${username}@shop.demo`)

    expect(reg.status).toBe(200)
    expect(reg.code).toBe(0)
    expect(reg.data.username).toBe(username)
    expect(reg.data.role, 'API.md §3.1：注册默认角色 USER').toBe('USER')
    // API.md 未定义初始余额；源码 AuthService 默认 10000.00，先用实现基线固定，Phase 0 可再确认
    expect(Number(reg.data.balance)).toBeCloseTo(10000, 2)

    const login = await api.login(username, 'Passw0rd!')
    expect(login.code).toBe(0)
    const me = await api.me()
    expect(me.code).toBe(0)
    expect(me.data.username).toBe(username)
  })

  test('[AUTH-006][P0][L1] 重复用户名注册返回 409/40901 且不覆盖原账号 @p0 @l1 @m1', async ({ api }) => {
    const username = uniqueUsername('dup')
    const first = await api.register(username, 'Passw0rd!', `${username}@shop.demo`)
    expect(first.code).toBe(0)

    const second = await api.register(username, 'OtherPass1!', `${username}+2@shop.demo`)
    expect(second.status, 'API.md §1.4：40901 映射 HTTP 409').toBe(409)
    expect(second.code).toBe(40901)

    const login = await api.login(username, 'Passw0rd!')
    expect(login.code, '重复注册不得覆盖原密码').toBe(0)
  })

  test('[AUTH-007][P0][L1] 当前用户信息字段完整且不含敏感字段 @p0 @l1 @m1', async ({ freshUser }) => {
    const res = await freshUser.client.me()

    expect(res.code).toBe(0)
    expect(res.data.id).toBe(freshUser.userId)
    expect(res.data.username).toBe(freshUser.username)
    expect(res.data.role).toBe('USER')
    expect(res.data).toHaveProperty('balance')

    const keys = Object.keys(res.data)
    for (const forbidden of ['password', 'passwordHash', 'secret', 'accessToken', 'refreshToken']) {
      expect(keys, `响应不得包含敏感字段 ${forbidden}`).not.toContain(forbidden)
    }
  })

  test('[AUTH-008][P0][L1] refreshToken 可换取新令牌且新 access 可访问 me @p0 @l1 @m1', async ({ api }) => {
    const login = await api.login(credentials.USER.name, credentials.USER.pass)
    expect(login.code).toBe(0)

    const refreshed = await api.refresh(login.data.refreshToken)
    expect(refreshed.status).toBe(200)
    expect(refreshed.code).toBe(0)
    expect(refreshed.data.accessToken).toBeTruthy()
    expect(refreshed.data.refreshToken).toBeTruthy()
    expect(refreshed.data.tokenType).toBe('Bearer')

    const probe = await api.raw('GET', '/api/auth/me', { token: refreshed.data.accessToken })
    expect(probe.status, '刷新后的 accessToken 应可访问受保护接口').toBe(200)
    expect(probe.data.username).toBe(credentials.USER.name)

    const secondRefresh = await api.raw('POST', '/api/auth/refresh', {
      data: { refreshToken: refreshed.data.refreshToken },
      token: false
    })
    expect(secondRefresh.code, '刷新后的 refreshToken 应可继续换取令牌').toBe(0)

    // API.md 未要求旧 refreshToken 立即失效；此处仅记录，不做断言
    const oldRefreshReuse = await api.raw('POST', '/api/auth/refresh', {
      data: { refreshToken: login.data.refreshToken },
      token: false
    })
    test.info().annotations.push({
      type: 'observed',
      description: `旧 refreshToken 复用 code=${oldRefreshReuse.code}（文档未定义是否失效）runId=${runId}`
    })
  })
})

const PASSWORD = 'Passw0rd!'

const NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function sizedName(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += NAME_ALPHABET[Math.floor(Math.random() * NAME_ALPHABET.length)]
  }
  return out
}

/** 短用户名随机空间小，重复时重试，避免把 40901 误判为边界缺陷 */
async function registerUniqueName(client: ShopApiClient, len: number) {
  let res = await client.register(sizedName(len), PASSWORD)
  for (let attempt = 0; attempt < 4 && res.code === 40901; attempt++) {
    res = await client.register(sizedName(len), PASSWORD)
  }
  return res
}

test.describe('M1 认证与鉴权 · P1', () => {
  test('[AUTH-009][P1][L1] 注册参数边界：username/password/email/nickname @p1 @l1 @m1', async ({ api }) => {
    const tooShort = await api.register(sizedName(2), PASSWORD)
    expect.soft(tooShort.status, 'username 长度 2 应 HTTP 400').toBe(400)
    expect.soft(tooShort.code).toBe(40000)
    expect.soft(tooShort.message, '错误信息应能定位 username 字段').toContain('username')

    const borderline = await registerUniqueName(api, 3)
    expect(borderline.code, 'username 长度 3 属于合法下界').toBe(0)

    const maxName = await registerUniqueName(api, 64)
    expect(maxName.code, 'username 长度 64 属于合法上界').toBe(0)

    const tooLong = await api.register(sizedName(65), PASSWORD)
    expect.soft(tooLong.status, 'username 长度 65 应 HTTP 400').toBe(400)
    expect.soft(tooLong.code).toBe(40000)
    expect.soft(tooLong.message).toContain('username')

    for (const [len, expectedStatus, expectedCode] of [[5, 400, 40000], [6, 200, 0], [128, 200, 0], [129, 400, 40000]] as const) {
      const res = await api.register(sizedName(20), 'p'.repeat(len))
      expect.soft(res.status, `password 长度 ${len} 应 HTTP ${expectedStatus}`).toBe(expectedStatus)
      expect.soft(res.code, `password 长度 ${len} 应返回 code=${expectedCode}`).toBe(expectedCode)
      if (expectedCode === 40000) {
        expect.soft(res.message).toContain('password')
      }
    }

    const badEmail = await api.register(sizedName(20), PASSWORD, 'not-an-email')
    expect.soft(badEmail.status, '非法 email 应 HTTP 400').toBe(400)
    expect.soft(badEmail.code).toBe(40000)
    expect.soft(badEmail.message).toContain('email')

    const longNick = await api.register(sizedName(20), PASSWORD, `${runId}@shop.demo`, 'n'.repeat(65))
    expect.soft(longNick.status, 'nickname 长度 65 应 HTTP 400').toBe(400)
    expect.soft(longNick.code).toBe(40000)
    expect.soft(longNick.message).toContain('nickname')

    const maxNick = await api.register(sizedName(20), PASSWORD, `${runId}@shop.demo`, 'n'.repeat(64))
    expect(maxNick.code, 'nickname 长度 64 属于合法上界').toBe(0)
  })

  test('[AUTH-010][P1][L1] 登录参数缺失/空串/超长均不出现 500 @p1 @l1 @m1', async ({ api }) => {
    const probes: Array<[string, any]> = [
      ['缺少全部字段', {}],
      ['空字符串', { username: '', password: '' }],
      ['缺 password', { username: uniqueUsername('lg') }],
      ['username 65', { username: 'u'.repeat(65), password: 'x' }],
      ['password 129', { username: uniqueUsername('lp'), password: 'x'.repeat(129) }]
    ]

    for (const [label, payload] of probes) {
      const res = await api.raw('POST', '/api/auth/login', { data: payload, token: false })
      expect.soft(res.status, `${label} 应为 400，不应 500`).toBe(400)
      expect.soft(res.code, `${label} 应返回 40000`).toBe(40000)
      expect.soft(res.data?.accessToken, `${label} 不得返回 token`).toBeUndefined()
    }

    const unknown = await api.login(uniqueUsername('nobody'), 'wrong-password')
    expect.soft(unknown.status, '合法格式但凭证错误仍应为 401').toBe(401)
    expect.soft(unknown.code).toBe(40101)
  })

  test('[AUTH-011][P1][L1] 用户名规范化：大小写/中文/特殊字符/首尾空格 @p1 @l1 @m1', async ({ api }) => {
    const seed = `${runId}${Math.random().toString(36).slice(2, 6)}`
    const mixed = `Mixed${seed}`
    expect((await api.register(mixed, PASSWORD)).code).toBe(0)

    expect((await api.login(mixed, PASSWORD)).code, '按注册原样登录应成功').toBe(0)
    expect((await api.login(mixed.toUpperCase(), PASSWORD)).code, 'MySQL 大小写不敏感排序规则下大写登录应命中').toBe(0)
    expect((await api.login(mixed.toLowerCase(), PASSWORD)).code, '小写登录应命中同一账号').toBe(0)

    const dupCase = await api.register(mixed.toUpperCase(), PASSWORD, `${seed}@shop.demo`)
    expect(dupCase.status, '仅大小写不同的用户名应判定为重复').toBe(409)
    expect(dupCase.code).toBe(40901)

    const chinese = `用户${seed}`
    expect((await api.register(chinese, PASSWORD)).code, '中文用户名应可注册').toBe(0)
    expect((await api.login(chinese, PASSWORD)).code, '中文用户名应可登录').toBe(0)

    const special = `u+${seed}.tag`
    expect((await api.register(special, PASSWORD)).code, '特殊字符用户名应可注册').toBe(0)
    expect((await api.login(special, PASSWORD)).code, '特殊字符用户名应可登录').toBe(0)

    const padded = `  ws${seed}  `
    expect((await api.register(padded, PASSWORD)).code, '首尾空格用户名当前可注册').toBe(0)
    const exact = await api.login(padded, PASSWORD)
    const trimmed = await api.login(padded.trim(), PASSWORD)
    const trimmedAgain = await api.login(padded.trim(), PASSWORD)
    expect(exact.code, '按注册原样（含空格）应可登录').toBe(0)
    expect(trimmedAgain.code, '同一输入两次结果必须稳定').toBe(trimmed.code)
    test.info().annotations.push({
      type: 'observed',
      description: `首尾空格用户名：exact=${exact.code} trimmed=${trimmed.code}（API.md 未定义 trim 规则，仅固定行为稳定性）`
    })
    expect((await api.register(padded, PASSWORD)).code, '完全相同（含空格）应判定重复').toBe(40901)
  })

  test('[AUTH-012][P1][L5] JWT 篡改：改 role/uid、改签名、alg=none 均被拒绝 @p1 @l5 @m1', async ({ api, freshUser }) => {
    const token = freshUser.client.getAccessToken()

    const tamperedRole = await api.raw('GET', '/api/admin/products', { token: tamperPayload(token, { role: 'ADMIN' }) })
    expect.soft(tamperedRole.status, '修改 payload 后签名失效，应 401').toBe(401)
    expect.soft(tamperedRole.code).toBe(40100)
    expect.soft(tamperedRole.data).toBeUndefined()

    const tamperedUid = await api.raw('GET', '/api/auth/me', { token: tamperPayload(token, { uid: 1, role: 'ADMIN' }) })
    expect.soft(tamperedUid.status, '篡改 uid/role 不得通过鉴权').toBe(401)
    expect.soft(tamperedUid.code).toBe(40100)

    const noneToken = await api.raw('GET', '/api/admin/products', { token: noneAlgToken(token) })
    expect.soft(noneToken.status, 'alg=none 必须被拒绝').toBe(401)
    expect.soft(noneToken.code).toBe(40100)

    const forgedPayload = decodeJwt(token)
    const wrongSecret = signJwt('attacker-secret-key-not-used-by-server-0123456789', {
      ...forgedPayload,
      role: 'ADMIN',
      uid: 1
    })
    const forged = await api.raw('GET', '/api/admin/products', { token: wrongSecret })
    expect.soft(forged.status, '使用错误密钥重签的 token 必须被拒绝').toBe(401)
    expect.soft(forged.code).toBe(40100)

    const original = await api.raw('GET', '/api/admin/products', { token })
    expect(original.status, '未篡改的 USER token 只能得到 403，不能被提权').toBe(403)
    expect(original.code).toBe(40300)
  })

  test('[AUTH-013][P1][L5] accessToken 过期返回 401，refresh 后可继续访问 @p1 @l5 @m1', async ({ api, freshUser }) => {
    const secret = await detectJwtSecret(api, {
      sub: freshUser.username,
      uid: freshUser.userId,
      role: 'USER',
      typ: 'access'
    })
    test.skip(!secret, '无法探测后端实际 JWT 密钥（可通过 JWT_SECRET 指定），跳过过期令牌用例')

    const now = Math.floor(Date.now() / 1000)
    const expired = signJwt(secret!, {
      sub: freshUser.username,
      uid: freshUser.userId,
      role: 'USER',
      typ: 'access',
      iat: now - 7200,
      exp: now - 3600
    })
    const denied = await api.raw('GET', '/api/auth/me', { token: expired })
    expect.soft(denied.status, '过期 accessToken 应 401').toBe(401)
    expect.soft(denied.code).toBe(40100)
    expect(denied.data).toBeUndefined()

    const refreshed = await api.refresh(freshUser.client.getRefreshToken())
    expect(refreshed.code, '未过期的 refreshToken 应可换取新令牌').toBe(0)
    const probe = await api.raw('GET', '/api/auth/me', { token: refreshed.data.accessToken })
    expect(probe.status).toBe(200)
    expect(probe.data.username).toBe(freshUser.username)
  })

  test('[AUTH-014][P1][L5] refreshToken 与 accessToken 不得混用 @p1 @l5 @m1', async ({ api }) => {
    const login = await api.login(credentials.USER.name, credentials.USER.pass)
    expect(login.code).toBe(0)

    const asAccess = await api.raw('GET', '/api/auth/me', { token: login.data.refreshToken })
    expect.soft(asAccess.status, 'refreshToken 不应能作为 accessToken 访问受保护接口').toBe(401)
    expect.soft(asAccess.code).toBe(40100)

    const asAdmin = await api.raw('GET', '/api/admin/products', { token: login.data.refreshToken })
    expect.soft(asAdmin.status, 'refreshToken 不得获得任何管理权限').not.toBe(200)

    const asRefresh = await api.raw('POST', '/api/auth/refresh', {
      data: { refreshToken: login.data.accessToken },
      token: false
    })
    expect.soft(asRefresh.status, 'accessToken 不应能当 refreshToken 使用').toBe(401)
    expect.soft([40000, 40100], 'accessToken 当 refreshToken 使用应 40000/40100').toContain(asRefresh.code)
  })

  test('[AUTH-017][P1][L1] JWT claims 与 TTL 符合约定 @p1 @l1 @m1', async ({ api }) => {
    const login = await api.login(credentials.USER.name, credentials.USER.pass)
    expect(login.code).toBe(0)
    expect(login.data.expiresIn, 'API.md §3.1：expiresIn 为秒').toBe(3600)

    const access = decodeJwt(login.data.accessToken)
    expect(access.sub, 'access.sub=用户名').toBe(login.data.username)
    expect(access.role, 'access.role=角色').toBe(login.data.role)
    expect(access.uid, 'access.uid=用户 ID').toBe(login.data.userId)
    expect(access.typ).toBe('access')
    expect(access.exp - access.iat, 'access TTL≈3600s').toBeGreaterThanOrEqual(3595)
    expect(access.exp - access.iat).toBeLessThanOrEqual(3605)
    expect(Math.abs(access.iat - Date.now() / 1000), 'iat 应为当前时间').toBeLessThan(60)

    const refresh = decodeJwt(login.data.refreshToken)
    expect(refresh.sub, 'refresh.sub=用户名').toBe(login.data.username)
    expect(refresh.uid).toBe(login.data.userId)
    expect(refresh.typ).toBe('refresh')
    expect(refresh.exp - refresh.iat, 'refresh TTL≈86400s').toBeGreaterThanOrEqual(86395)
    expect(refresh.exp - refresh.iat).toBeLessThanOrEqual(86405)

    const adminLogin = await api.login(credentials.ADMIN.name, credentials.ADMIN.pass)
    expect(decodeJwt(adminLogin.data.accessToken).role, '管理员 token claim role=ADMIN').toBe('ADMIN')
  })
})

test.describe('M1 认证与鉴权 · P2', () => {
  test('[AUTH-015][P2][L5] 注册 mass assignment：role/balance/id 被忽略 @p2 @l5 @m1', async ({ api }) => {
    const username = uniqueUsername('mass')
    const payload = {
      username,
      password: PASSWORD,
      email: `${username}@shop.demo`,
      role: 'ADMIN',
      balance: 999999.99,
      id: 1,
      userId: 1
    }

    const res = await api.raw('POST', '/api/auth/register', { data: payload, token: false })
    expect(res.status).toBe(200)
    expect(res.code).toBe(0)
    expect(res.data.username).toBe(username)
    expect(res.data.role, 'role 必须由服务端固定为 USER').toBe('USER')
    expect(Number(res.data.balance), 'balance 必须为用户默认 10000.00').toBeCloseTo(10000, 2)
    expect(res.data.id, 'id 必须由数据库生成，不能被请求体覆盖').toBeGreaterThan(2)
    expect(res.data).not.toHaveProperty('password')

    const login = await api.login(username, PASSWORD)
    expect(login.code).toBe(0)
    expect(login.data.role, '登录返回角色也必须是 USER').toBe('USER')
    expect(decodeJwt(login.data.accessToken).role).toBe('USER')

    const me = await api.me()
    expect(me.code).toBe(0)
    expect(me.data.role).toBe('USER')
    expect(Number(me.data.balance)).toBeCloseTo(10000, 2)

    const forbidden = await api.adminProducts()
    expect(forbidden.status, 'mass assignment 后不得获得管理权限').toBe(403)
    expect(forbidden.code).toBe(40300)
  })

  test('[AUTH-016][P2][L1] 并发注册同一用户名：仅 1 个成功，其余 40901 @p2 @l1 @m1', async ({ api }) => {
    const username = uniqueUsername('race')
    const attempts = 8

    const results = await concurrently(attempts, () =>
      api.raw('POST', '/api/auth/register', {
        data: { username, password: PASSWORD, email: `${username}@shop.demo` },
        token: false
      })
    )

    const responses = results.map(r => r.value!)
    expect(results.every(r => !r.error), '并发请求不得出现网络异常').toBe(true)
    const successes = responses.filter(r => r.code === 0)
    expect(successes, '同一用户名只能有 1 次注册成功').toHaveLength(1)
    expect(successes[0].status).toBe(200)

    const duplicates = responses.filter(r => r.code !== 0)
    expect(duplicates).toHaveLength(attempts - 1)
    for (const duplicate of duplicates) {
      expect.soft(duplicate.status, '重复注册应 HTTP 409').toBe(409)
      expect.soft(duplicate.code, '重复注册应返回 40901').toBe(40901)
    }

    const login = await api.login(username, PASSWORD)
    expect(login.code, '注册成功的账号应可正常登录').toBe(0)
    expect(login.data.username).toBe(username)
  })
})
