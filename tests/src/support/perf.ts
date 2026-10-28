/** 轻量性能辅助：本地 API 用例用，避免引入额外依赖 */

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T, ms: number }> {
  const start = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - start }
}

/** 并发执行 n 次，不因单个失败中断；返回结果与单次耗时 */
export async function concurrently<T>(
  n: number,
  fn: (index: number) => Promise<T>
): Promise<Array<{ value?: T, error?: unknown, ms: number }>> {
  return Promise.all(
    Array.from({ length: n }, async (_, index) => {
      const start = Date.now()
      try {
        return { value: await fn(index), ms: Date.now() - start }
      } catch (error) {
        return { error, ms: Date.now() - start }
      }
    })
  )
}

/** 简单断言辅助：把数组里的值按出现次数统计 */
export function countBy<T>(values: T[]): Map<T, number> {
  const map = new Map<T, number>()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return map
}
