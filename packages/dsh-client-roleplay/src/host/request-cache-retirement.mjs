import { checkpointRecord, projectionCacheDomainSpec } from '@deepseek-ai/dsh-session-projection-cache'

/** Retire only the obsolete derived row, retaining every other official checkpoint. */
export async function retireRequestContextCache(ctx) {
  const retired = ['eleckoiRequestContexts', 'eleckoiRequestInput']
  const domain = ctx.storageDomain.get(projectionCacheDomainSpec.name)
  if (!domain) throw new Error('官方 Session 投影缓存域尚未打开。')
  const table = domain.table('sessions')
  for (const [id, record] of table.entries()) {
    if (!retired.some(key => Object.hasOwn(checkpointRecord.parse(record).rows, key))) continue
    await table.update(id, current => {
      const parsed = checkpointRecord.parse(current)
      const rows = Object.fromEntries(Object.entries(parsed.rows).filter(([key]) => !retired.includes(key)))
      return { ...parsed, rows }
    })
  }
}
