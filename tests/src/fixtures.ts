import { test as base, expect } from '@playwright/test'
import { ShopApiClient } from './clients/api.client'

export interface ProductSeed {
  name: string
  description?: string
  price: number
  stock: number
  status?: 'ON_SALE' | 'OFF_SALE'
  categoryId?: number
  imageUrl?: string
}

export interface ProductFactory {
  create(overrides?: Partial<ProductSeed>): Promise<any>
  createdIds: number[]
}

export interface FreshUser {
  client: ShopApiClient
  username: string
  password: string
  userId: number
  registerResponse: any
}

type Fixtures = {
  api: ShopApiClient
  userApi: ShopApiClient
  adminApi: ShopApiClient
  freshUser: FreshUser
  products: ProductFactory
}

const USER = {
  name: process.env.USER_NAME || 'tester',
  pass: process.env.USER_PASS || '123456'
}
const ADMIN = {
  name: process.env.ADMIN_USER || 'admin',
  pass: process.env.ADMIN_PASS || 'admin123'
}

export const credentials = { USER, ADMIN }

/** 每次运行唯一，避免与上一次运行/并行 worker 冲突 */
export const runId = process.env.RUN_ID || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

let seq = 0

/** 生成唯一标识，保证并发/重复执行时数据不冲突 */
export function uniq(prefix: string): string {
  return `${prefix}_${runId}_${++seq}`
}

export function uniqueUsername(prefix = 'u'): string {
  return uniq(prefix).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40)
}

/** 注册一个干净用户；用于隔离购物车、订单、余额 */
export async function registerFreshUser(password = 'Passw0rd!'): Promise<FreshUser> {
  const client = await ShopApiClient.create()
  const username = uniqueUsername()
  const registerResponse = await client.register(username, password, `${username}@shop.demo`)
  if (registerResponse.code !== 0) {
    await client.dispose()
    throw new Error(`注册测试用户失败 ${username}: ${registerResponse.code} ${registerResponse.message}`)
  }
  const login = await client.login(username, password)
  if (login.code !== 0) {
    await client.dispose()
    throw new Error(`新用户登录失败 ${username}: ${login.code} ${login.message}`)
  }
  return {
    client,
    username,
    password,
    userId: login.data.userId,
    registerResponse
  }
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const client = await ShopApiClient.create()
    await use(client)
    await client.dispose()
  },
  freshUser: async ({}, use) => {
    const user = await registerFreshUser()
    await use(user)
    await user.client.dispose()
  },
  userApi: async ({ freshUser }, use) => {
    await use(freshUser.client)
  },
  adminApi: async ({}, use) => {
    const client = await ShopApiClient.loginAs(ADMIN.name, ADMIN.pass)
    await use(client)
    await client.dispose()
  },
  products: async ({ adminApi }, use) => {
    const createdIds: number[] = []
    const factory: ProductFactory = {
      createdIds,
      async create(overrides: Partial<ProductSeed> = {}) {
        const seed: ProductSeed = {
          name: uniq('商品'),
          description: '自动化用例专用商品',
          price: 10,
          stock: 100,
          status: 'ON_SALE',
          ...overrides
        }
        const res = await adminApi.adminCreateProduct(seed)
        if (res.code !== 0) {
          throw new Error(`创建测试商品失败: ${res.code} ${res.message}`)
        }
        createdIds.push(res.data.id)
        return res.data
      }
    }
    await use(factory)
    for (const id of [...createdIds].reverse()) {
      await adminApi.adminDeleteProduct(id).catch(() => undefined)
    }
  }
})

export { expect }
