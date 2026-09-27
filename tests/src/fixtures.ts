import { test as base, expect } from '@playwright/test'
import { ShopApiClient } from '../clients/api.client'

type Fixtures = {
  api: ShopApiClient
  userApi: ShopApiClient
  adminApi: ShopApiClient
}

const USER = {
  name: process.env.USER_NAME || 'tester',
  pass: process.env.USER_PASS || '123456'
}
const ADMIN = {
  name: process.env.ADMIN_USER || 'admin',
  pass: process.env.ADMIN_PASS || 'admin123'
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const client = await ShopApiClient.create()
    await use(client)
    await client.dispose()
  },
  userApi: async ({}, use) => {
    const client = await ShopApiClient.loginAs(USER.name, USER.pass)
    await use(client)
    await client.dispose()
  },
  adminApi: async ({}, use) => {
    const client = await ShopApiClient.loginAs(ADMIN.name, ADMIN.pass)
    await use(client)
    await client.dispose()
  }
})

export { expect }

export const credentials = { USER, ADMIN }

/** 生成唯一标识，保证并发/重复执行时数据不冲突 */
export function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
