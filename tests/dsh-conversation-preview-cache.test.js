import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionProjectionCache, { projectionCacheDomainSpec } from '@deepseek-ai/dsh-session-projection-cache'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { retireRequestContextCache } from '../packages/dsh-client-roleplay/src/host/request-cache-retirement.mjs'
import { ElecKoiConversationsApi } from '../packages/dsh-product-api/lib/types/index.js'
const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
describe('bounded conversation catalog and retired request caches', () => {
  it('refreshes the catalog through one official list and never inspects each Session', async () => {
    const inspect = vi.fn(() => { throw new Error('不得读取正文') })
    const list = vi.fn(async () => ({ items: [{ sessionId: 'session-0', projections: { values: { eleckoiConversationPreview: '合成最新消息' } } }] }))
    const records = Array.from({ length: 50 }, (_, i) => ({ id: String(i), runtimeSessionId: `session-${i}`, preview: '合成开场' }))
    const items = await ElecKoiConversationsApi.prototype.list.call({
      productData: { readConversationCatalog: () => records }, ownerContext: { sessionController: { inspect, list } }
    }, new AbortController().signal)
    expect(list).toHaveBeenCalledOnce()
    expect(inspect).not.toHaveBeenCalled()
    expect(items[0].preview).toBe('合成最新消息')
    expect(items[1].preview).toBe('合成开场')
  })

  it('removes old derived request cache rows through the official atomic update while retaining unrelated metadata', async () => {
    let record = { identity: { createdAt: 1 }, rows: {
      eleckoiRequestContexts: { ver: 1, seq: 0, val: { contexts: { 0: ['合成重复缓存'] } } },
      eleckoiRequestInput: { ver: 1, seq: 0, val: { instructions: '合成过期变换' } },
      title: { ver: 1, seq: 0, val: '合成标题' }
    } }
    const update = vi.fn(async (_id, fn) => { record = fn(record); return record })
    const ctx = { storageDomain: { get: () => ({ table: () => ({ entries: () => [['synthetic', record]], update }) }) } }
    await retireRequestContextCache(ctx)
    expect(record.rows).toEqual({ title: { ver: 1, seq: 0, val: '合成标题' } })
    await retireRequestContextCache(ctx)
    expect(update).toHaveBeenCalledOnce()
  })

  it('persists cache retirement through the official storage backend and survives a fresh open', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-cache-retirement-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const open = async () => {
      const ctx = new Context()
      cleanups.push(() => ctx.fiber.dispose())
      await ctx.plugin(Storage)
      for (const [plugin, config] of [[StorageJson, { root }], [StorageDomain, { backend: 'json' }]]) {
        const { name, inject, apply, Config } = plugin
        await ctx.plugin({ name, inject, apply, Config }, config)
      }
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60000 })
      return { ctx, table: ctx.storageDomain.get(projectionCacheDomainSpec.name).table('sessions') }
    }
    const first = await open()
    const id = SessionId('synthetic-cache')
    const record = { identity: { createdAt: 1 }, rows: {
      eleckoiRequestContexts: { ver: 1, seq: 0, val: { contexts: { 0: ['合成重复缓存'] } } },
      eleckoiRequestInput: { ver: 1, seq: 0, val: { instructions: '合成过期变换' } },
      title: { ver: 1, seq: 0, val: '合成标题' }
    } }
    await first.table.put(id, record)
    await retireRequestContextCache(first.ctx)
    await first.ctx.fiber.dispose()
    const second = await open()
    expect(second.table.get(id)).toEqual({ identity: record.identity, rows: { title: record.rows.title } })
    await retireRequestContextCache(second.ctx)
    expect(second.table.get(id).rows.title.val).toBe('合成标题')
  }, 20000)
})
