import { test, expect, runId, uniq } from '../fixtures'
import { concurrently, percentile, timed } from '../support/perf'

test.describe('M2 商品与分类', () => {
  test('[CAT-001][P0][L1] 商品列表默认分页结构自洽 @p0 @l1 @m2', async ({ api }) => {
    const res = await api.listProducts()

    expect(res.status).toBe(200)
    expect(res.code).toBe(0)
    expect(res.data.page).toBe(0)
    expect(res.data.size, 'API.md §1.3：默认 size=20').toBe(20)
    expect(res.data.content.length).toBeLessThanOrEqual(20)
    expect(res.data.total).toBeGreaterThanOrEqual(res.data.content.length)
    expect(res.data.totalPages).toBe(Math.ceil(res.data.total / 20))
    expect(res.data.last).toBe(0 >= res.data.totalPages - 1)
  })

  test('[CAT-002][P0][L1] 商品详情字段/精度正确，不存在返回 404/40401 @p0 @l1 @m2', async ({ api, products }) => {
    const product = await products.create({ price: 23.45, stock: 77 })

    const detail = await api.productDetail(product.id)
    expect(detail.code).toBe(0)
    expect(detail.data.id).toBe(product.id)
    expect(detail.data.name).toBe(product.name)
    expect(typeof detail.data.price, 'price 应为数值').toBe('number')
    expect(Number(detail.data.price)).toBeCloseTo(23.45, 2)
    expect(detail.data.stock).toBe(77)
    expect(['ON_SALE', 'OFF_SALE']).toContain(detail.data.status)
    expect(typeof detail.data.cached, 'API.md §2：cached 为 Boolean').toBe('boolean')

    const missing = await api.productDetail(99999999)
    expect(missing.status, 'API.md §1.4：40401 映射 HTTP 404').toBe(404)
    expect(missing.code).toBe(40401)
  })

  test('[CAT-003][P0][L1] 分类列表非空且字段完整 @p0 @l1 @m2', async ({ api }) => {
    const res = await api.categories()

    expect(res.code).toBe(0)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data.length).toBeGreaterThan(0)
    for (const item of res.data) {
      expect(typeof item.id).toBe('number')
      expect(typeof item.name).toBe('string')
      expect(item.name.length).toBeGreaterThan(0)
      expect(typeof item.sortOrder, 'API.md §2：CategoryResponse 含 sortOrder').toBe('number')
    }
  })

  test('[CAT-004][P0][L1] 热销商品默认 10 条、limit 生效且 id 唯一 @p0 @l1 @m2', async ({ api }) => {
    const total = (await api.listProducts({ size: 1 })).data.total
    const expectedDefault = Math.min(10, total)

    const byDefault = await api.hotProducts()
    expect(byDefault.code).toBe(0)
    expect(byDefault.data.length, 'API.md §3.2：limit 默认 10').toBe(expectedDefault)
    expect(new Set(byDefault.data.map((p: any) => p.id)).size).toBe(byDefault.data.length)

    const limited = await api.hotProducts(5)
    expect(limited.code).toBe(0)
    expect(limited.data.length).toBeLessThanOrEqual(5)
    for (const p of limited.data) {
      expect(p).toHaveProperty('id')
      expect(p).toHaveProperty('name')
      expect(p).toHaveProperty('price')
      expect(p).toHaveProperty('stock')
      expect(p).toHaveProperty('status')
    }
  })

  test('[CAT-005][P0][L1] 关键字搜索命中且无结果时返回空页 @p0 @l1 @m2', async ({ api, products }) => {
    const product = await products.create({ name: uniq('搜索关键字商品') })

    const hit = await api.listProducts({ keyword: product.name, size: 20 })
    expect(hit.code).toBe(0)
    expect(hit.data.content.some((p: any) => p.id === product.id)).toBe(true)

    const miss = await api.listProducts({ keyword: `no_such_${runId}` })
    expect(miss.code).toBe(0)
    expect(miss.data.content).toEqual([])
    expect(miss.data.total).toBe(0)
  })

  test('[CAT-006][P0][L3] 商品详情 Redis 缓存：清缓存后未命中、二次命中 @p0 @l3 @m2', async ({ api, adminApi, products }) => {
    const product = await products.create()

    const cleared = await adminApi.adminClearCache()
    expect(cleared.code).toBe(0)

    const first = await api.productDetail(product.id)
    expect(first.code).toBe(0)
    expect(first.data.cached, '清缓存后首次请求应回源 DB').toBe(false)

    const second = await api.productDetail(product.id)
    expect(second.code).toBe(0)
    expect(second.data.cached, '第二次请求应命中 Redis').toBe(true)

    await adminApi.adminClearCache()
    const third = await api.productDetail(product.id)
    expect(third.code).toBe(0)
    expect(third.data.cached, '再次清缓存后应重新回源').toBe(false)
  })
})

test.describe('M2 商品与分类 · P1', () => {
  test('[CAT-007][P1][L1] 分页边界：默认 20、size 极值、page 超界/负数 @p1 @l1 @m2', async ({ api }) => {
    const base = await api.listProducts()
    expect(base.code).toBe(0)
    expect(base.data.size, 'API.md §1.3：默认 size=20').toBe(20)

    const one = await api.listProducts({ page: 0, size: 1 })
    expect(one.data.size).toBe(1)
    expect(one.data.content.length).toBeLessThanOrEqual(1)

    const hundred = await api.listProducts({ size: 100 })
    expect(hundred.data.size).toBe(100)

    const huge = await api.listProducts({ size: 10000 })
    expect(huge.status, 'size=10000 不应报错').toBe(200)
    expect(huge.data.size).toBeLessThanOrEqual(10000)
    test.info().annotations.push({
      type: 'observed',
      description: `size=10000 时实现收敛为 ${huge.data.size}（API.md 未定义上限）`
    })

    const zero = await api.listProducts({ size: 0 })
    expect.soft(zero.status, 'size=0 应 HTTP 400').toBe(400)
    expect.soft(zero.code, 'size=0 应返回 40000，不应 500').toBe(40000)

    const negative = await api.listProducts({ size: -1 })
    expect.soft(negative.status, 'size=-1 应 HTTP 400').toBe(400)
    expect.soft(negative.code, 'size=-1 应返回 40000，不应 500').toBe(40000)

    const beyond = await api.listProducts({ page: (base.data.totalPages || 1) + 5, size: 20 })
    expect(beyond.code).toBe(0)
    expect(beyond.data.content, 'page 超界应返回空页').toEqual([])
    expect(beyond.data.last, 'page 超界 last=true').toBe(true)

    const negPage = await api.listProducts({ page: -5 })
    expect(negPage.status, 'page=-5 不应 500').toBe(200)
    expect(negPage.data.page, '页码应从 0 起，不应为负').toBeGreaterThanOrEqual(0)
  })

  test('[CAT-008][P1][L1] keyword 特殊输入：中文/大小写/通配符/注入串 @p1 @l1 @m2', async ({ api, products }) => {
    const tag = `KW${runId}${Math.random().toString(36).slice(2, 6)}`
    const chinese = await products.create({ name: `中文搜索${tag}商品` })
    const ascii = await products.create({ name: `MixedCase${tag}Product` })

    const cnHit = await api.listProducts({ keyword: `中文搜索${tag}` })
    expect(cnHit.code).toBe(0)
    expect(cnHit.data.content.some((p: any) => p.id === chinese.id), '中文子串应命中').toBe(true)

    const caseHit = await api.listProducts({ keyword: `mixedcase${tag}product` })
    expect(caseHit.code).toBe(0)
    expect(caseHit.data.content.some((p: any) => p.id === ascii.id), '关键字匹配应大小写不敏感').toBe(true)

    const injection = await api.listProducts({ keyword: `' OR 1=1--` })
    expect(injection.status, '注入串不应导致 500').toBe(200)
    expect(injection.data.total, '注入串不应返回全量数据').toBe(0)

    const percent = await api.listProducts({ keyword: '%', size: 1 })
    expect.soft(
      percent.data.total,
      'API.md 未声明 keyword 支持 SQL 通配符，% 应按普通字符处理，不应命中全量'
    ).toBe(0)

    const underscore = await api.listProducts({ keyword: '_', size: 1 })
    expect(underscore.status, '_ 不应导致 500').toBe(200)
    test.info().annotations.push({
      type: 'observed',
      description: `keyword=_ 命中 total=${underscore.data.total}；keyword=% 命中 total=${percent.data.total}（实现未转义 LIKE 通配符）`
    })
  })

  test('[CAT-009][P1][L1] categoryId 过滤：存在/不存在/非数字/负数 @p1 @l1 @m2', async ({ api, products }) => {
    const product = await products.create({ categoryId: 1 })

    const filtered = await api.listProducts({ categoryId: 1, size: 100 })
    expect(filtered.code).toBe(0)
    expect(filtered.data.total).toBeGreaterThanOrEqual(1)
    expect(
      filtered.data.content.every((p: any) => p.categoryId === 1),
      '返回结果必须全部属于该分类'
    ).toBe(true)

    const inCategory = await api.listProducts({ keyword: product.name, categoryId: 1 })
    expect(inCategory.data.content.map((p: any) => p.id)).toContain(product.id)

    const missing = await api.listProducts({ categoryId: 99999999 })
    expect(missing.code).toBe(0)
    expect(missing.data.content).toEqual([])
    expect(missing.data.total).toBe(0)
    expect(missing.data.last).toBe(true)

    const invalid = await api.listProducts({ categoryId: 'abc' })
    expect.soft(invalid.status, '非数字 categoryId 应 HTTP 400').toBe(400)
    expect.soft(invalid.code, '非数字 categoryId 应返回 40000，不应 500').toBe(40000)

    const negative = await api.listProducts({ categoryId: -1 })
    expect(negative.status, '负数 categoryId 不应 500').toBe(200)
    expect(negative.data.total).toBe(0)
  })

  test('[CAT-010][P1][L1] keyword + categoryId 组合过滤且 total 与 content 一致 @p1 @l1 @m2', async ({ api, products }) => {
    const keyword = `CB${runId}${Math.random().toString(36).slice(2, 6)}`
    const inCat1 = await products.create({ name: `${keyword}甲`, categoryId: 1 })
    const inCat2 = await products.create({ name: `${keyword}乙`, categoryId: 2 })

    const combo = await api.listProducts({ keyword, categoryId: 1, size: 100 })
    expect(combo.code).toBe(0)
    expect(combo.data.total).toBe(1)
    expect(combo.data.content).toHaveLength(1)
    expect(combo.data.content[0].id).toBe(inCat1.id)
    expect(combo.data.content[0].categoryId).toBe(1)
    expect(combo.data.total, 'total 应与当前页 content 一致').toBe(combo.data.content.length)
    expect(combo.data.content.map((p: any) => p.id)).not.toContain(inCat2.id)

    const keywordOnly = await api.listProducts({ keyword, size: 100 })
    expect(keywordOnly.data.total).toBe(2)
    expect(keywordOnly.data.content.map((p: any) => p.id).sort()).toEqual([inCat1.id, inCat2.id].sort())
  })

  test('[CAT-011][P1][L1] OFF_SALE 商品可见性基线（API.md 未定义） @p1 @l1 @m2', async ({ api, products }) => {
    const offSale = await products.create({ status: 'OFF_SALE', stock: 5 })

    const list = await api.listProducts({ keyword: offSale.name })
    const detail = await api.productDetail(offSale.id)

    expect(list.code).toBe(0)
    expect(list.data.content.map((p: any) => p.id), '当前实现用户端列表未过滤 OFF_SALE').toContain(offSale.id)
    expect(detail.code, '当前实现详情接口未校验 status').toBe(0)
    expect(detail.data.status).toBe('OFF_SALE')

    test.info().annotations.push({
      type: 'observed',
      description: 'API.md 未定义 OFF_SALE 商品在用户端列表/详情是否可见；实现为可见且可加购被 40902 拒绝，作为基线固定'
    })
  })

  test('[CAT-012][P1][L0] 商品/分类响应 Schema 与金额精度 @p1 @l0 @m2', async ({ api, products }) => {
    const product = await products.create({ price: 23.45, stock: 12, categoryId: 1 })

    const detail = await api.productDetail(product.id)
    expect(detail.code).toBe(0)
    expect(typeof detail.data.id).toBe('number')
    expect(typeof detail.data.name).toBe('string')
    expect(['string', 'object'], 'description 应为 string 或 null').toContain(typeof detail.data.description)
    expect(typeof detail.data.price).toBe('number')
    expect(Number(detail.data.price)).toBeCloseTo(23.45, 2)
    expect(Number.isInteger(detail.data.stock)).toBe(true)
    expect(['string', 'object'], 'imageUrl 应为 string 或 null').toContain(typeof detail.data.imageUrl)
    expect(detail.data.categoryId).toBe(1)
    expect(['ON_SALE', 'OFF_SALE']).toContain(detail.data.status)
    expect(typeof detail.data.cached, 'API.md §2：cached 为 Boolean').toBe('boolean')

    const list = await api.listProducts({ keyword: product.name })
    const item = list.data.content.find((p: any) => p.id === product.id)
    expect(item).toBeTruthy()
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'name', 'description', 'price', 'stock', 'imageUrl', 'categoryId', 'status', 'cached'].sort()
    )

    const categories = await api.categories()
    expect(categories.code).toBe(0)
    for (const category of categories.data) {
      expect(typeof category.id).toBe('number')
      expect(typeof category.name).toBe('string')
      expect(category.description === null || typeof category.description).toBe('string')
      expect(Number.isInteger(category.sortOrder), 'API.md §2：CategoryResponse.sortOrder 为 Integer').toBe(true)
    }
  })
})

test.describe('M2 商品与分类 · P2', () => {
  test('[CAT-013][P2][L3] 不存在商品重复请求：稳定 404，缓存穿透不劣化 @p2 @l3 @m2', async ({ api }) => {
    const missingId = 900000000 + Math.floor(Math.random() * 99_000_000)

    const statuses: number[] = []
    const codes: number[] = []
    const durations: number[] = []
    for (let i = 0; i < 30; i++) {
      const res = await timed(() => api.productDetail(missingId))
      durations.push(res.ms)
      statuses.push(res.value.status)
      codes.push(res.value.code)
    }

    expect(new Set(statuses), '30 次请求必须稳定返回 404').toEqual(new Set([404]))
    expect(new Set(codes), '30 次请求必须稳定返回 40401').toEqual(new Set([40401]))

    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
    const first = avg(durations.slice(0, 5))
    const last = avg(durations.slice(-5))
    expect(last, `第 26~30 次平均 ${last.toFixed(1)}ms 不应显著劣于前 5 次 ${first.toFixed(1)}ms`).toBeLessThan(
      first * 3 + 200
    )
    expect(percentile(durations, 95), '本地空值缓存下 P95 应 < 1000ms').toBeLessThan(1000)

    test.info().annotations.push({
      type: 'observed',
      description: `不存在商品 30 次请求 P95=${percentile(durations, 95)}ms，前 5 次均值=${first.toFixed(1)}ms，后 5 次均值=${last.toFixed(1)}ms`
    })
  })

  test('[CAT-014][P2][L6] 50 并发列表/详情：错误率 0，P95 达标 @p2 @l6 @m2', async ({ api, products }) => {
    const product = await products.create({ price: 19.99, stock: 50 })

    const results = await concurrently(50, index =>
      index % 2 === 0
        ? api.listProducts({ page: 0, size: 20 })
        : api.productDetail(product.id)
    )

    expect(results.every(r => !r.error), '50 并发不得出现网络异常').toBe(true)
    const durations = results.map(r => r.ms)
    const failures = results.filter(r => {
      const res = r.value!
      return res.status !== 200 || res.code !== 0
    })
    expect(failures.map(f => `${f.value?.status}/${f.value?.code}`), '50 并发全部应 200/0').toEqual([])

    const lists = results.filter((_, i) => i % 2 === 0).map(r => r.value!)
    for (const list of lists) {
      expect(list.data.page).toBe(0)
      expect(list.data.size).toBe(20)
      expect(list.data.totalPages).toBe(Math.ceil(list.data.total / list.data.size))
    }

    const details = results.filter((_, i) => i % 2 === 1).map(r => r.value!)
    for (const detail of details) {
      expect(detail.data.id).toBe(product.id)
      expect(Number(detail.data.price)).toBeCloseTo(19.99, 2)
    }

    const p95 = percentile(durations, 95)
    expect(p95, `50 并发 P95=${p95}ms 应 < 1000ms（本地目标 <200ms）`).toBeLessThan(1000)

    test.info().annotations.push({
      type: 'observed',
      description: `50 并发列表/详情 P95=${p95}ms，最大=${Math.max(...durations)}ms；API.md 未定义性能阈值，本地目标 <200ms`
    })
  })
})
