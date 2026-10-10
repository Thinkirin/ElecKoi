import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { apply as installSessionStats } from '@deepseek-ai/dsh-session-stats'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { recoverSessionHistory } from '../packages/dsh-runtime/src/sessionHistoryRecovery'
import { readDshSessionLog } from '../packages/dsh-runtime/src/trajectory'
import { rewindDshSession } from '../packages/dsh-runtime/src/sessionRewind'
import { legacyFixtureRequest } from './helpers/legacyRequestContext.js'
import { projectProductHistory } from '../packages/dsh-client-roleplay/src/host/conversation-context.mjs'

import { refreshSessionProjections } from '../packages/dsh-runtime/src/sessionProjectionRefresh'
import { historyStatsProjection } from '../packages/dsh-client-roleplay/src/host/history-stats-projection.mjs'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(alreadyNative = false, lateSystemHead = false) {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-history-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  cleanups.push(() => ctx.fiber.dispose())
  const session = Session.create(SessionId('synthetic-history'))
  const events = []
  const append = (...args) => { const event = session.append(...args); events.push(event); return event }
  if (alreadyNative) append('user/message', createUserMessage({
    content: [{ type: 'text', text: '合成历史输入' }], source: { kind: 'user' }
  }), { surfaceOp: 'append' })
  append('agent/inbox/spliced', { target: 'next-turn', start: 0,
    inserted: [createUserMessage({ content: [{ type: 'text', text: '合成当前输入' }], source: { kind: 'user' } })] })
  append('turn/start', { turn: 1 })
  const step = append('step/start', { turn: 1, step: 1 })
  if (lateSystemHead) append('system/message', { turn: 1, step: 1, message: createSystemMessage('合成系统配置') }, { surfaceOp: 'append' })
  append('user/message', createUserMessage({
    content: [{ type: 'text', text: '合成当前输入' }], source: { kind: 'user' }
  }), { surfaceOp: 'append' })
  append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'ELECKOI_REQUEST_PROJECTION_V2\n' + JSON.stringify({
      plan: [], history: [{ role: 'assistant', content: '合成开场白' }, { role: 'user', content: '合成历史输入' }]
    }) }], source: { kind: 'plugin:eleckoi-request-projection' }
  }), { surfaceOp: 'append' })
  const context = legacyFixtureRequest(session.deriveMessages())
  append('eleckoi/request-context', { requestSeq: step.seq, context }, { ignorable: true })
  append('step/end', { turn: 1, step: 1 })
  append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const handle = await ctx.sessionPersistence.create(session.header)
  await handle.append(events)
  await handle.flush()
  await handle.close()
  const path = readDshSessionLog(root, session.id).path
  const archive = { tables: {
    agent_conversations: [{ id: 'synthetic-chat', activeBranchId: 'branch', runtimeThreadId: session.id }],
    agent_branch_turns: ['opening', 'historical-user', 'current-user'].map((turnId, sequence) => ({ branchId: 'branch', turnId, sequence })),
    agent_turns: [
      { id: 'opening', kind: 'opening' },
      { id: 'historical-user', kind: 'user', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'current-user', kind: 'user', createdAt: '2026-01-01T00:01:00.000Z' }
    ],
    agent_responses: [{ id: 'response', turnId: 'current-user', runtimeThreadId: session.id, dshTurn: 1 }]
  } }
  return { root, path, session, archive, context }
}

async function reopen(f) {
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root: f.root, compression: 'none' })
  try {
    const handle = await ctx.sessionPersistence.open(f.session.id, 'read')
    try { return { ...await handle.read(), header: handle.header } } finally { await handle.close() }
  } finally { await ctx.fiber.dispose() }
}

describe('old unanswered history recovery', { timeout: 30_000 }, () => {
  it('restores native input, preserves actual request context and counts, and reopens with the official backend', async () => {
    const f = await fixture()
    const before = readFileSync(f.path, 'utf8')
    expect(await recoverSessionHistory(f.root, f.session.id, f.archive)).toBe(1)
    const stored = await reopen(f)
    const restored = Session.create(f.session.id, stored.events, stored.header)
    const users = restored.deriveMessages().filter(message => message.source.kind === 'user')
    expect(users.map(message => message.content[0].text)).toEqual(['合成历史输入', '合成当前输入'])
    expect(users[0].id).toBe('historical-user')
    expect(stored.header.id).toBe(f.session.id)
    expect(stored.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(stored.events.filter(event => event.type === 'step/start')).toHaveLength(1)
    const request = stored.events.find(event => event.type === 'eleckoi/request-context')
    expect(stored.events[request.data.requestSeq].type).toBe('step/start')
    expect(request.data.context).toEqual(f.context)
    expect(legacyFixtureRequest(restored.deriveMessages())).toEqual(f.context)
    const backup = readdirSync(join(f.path, '..')).find(name => name.includes('.history-') && name.endsWith('.bak'))
    expect(readFileSync(join(f.path, '..', backup), 'utf8')).toBe(before)
    const recovered = readFileSync(f.path, 'utf8')
    expect(await recoverSessionHistory(f.root, f.session.id, f.archive)).toBe(0)
    expect(readFileSync(f.path, 'utf8')).toBe(recovered)
  })

  it('does not duplicate an input already present in native history', async () => {
    const f = await fixture(true)
    const before = readFileSync(f.path, 'utf8')
    expect(await recoverSessionHistory(f.root, f.session.id, f.archive)).toBe(0)
    expect(readFileSync(f.path, 'utf8')).toBe(before)
  })

  it('preserves the same protected system head when the old first step created it after turn/start', async () => {
    const f = await fixture(false, true)
    const original = (await reopen(f)).events.find(event => event.type === 'system/message')
    expect(await recoverSessionHistory(f.root, f.session.id, f.archive)).toBe(1)
    const stored = await reopen(f)
    const head = stored.events.find(event => event.type === 'system/message')
    expect(head.data).toEqual(original.data)
    expect(head.time).toBe(original.time)
    const firstTurn = stored.events.findIndex(event => event.type === 'turn/start')
    expect(stored.events.indexOf(head)).toBeGreaterThan(firstTurn)
    const current = stored.events.find(event => event.type === 'user/message' && event.data.content[0].text === '合成当前输入')
    rewindDshSession(f.root, f.session.id, 1, current.seq)
    const rewound = await reopen(f)
    expect(rewound.events.filter(event => event.surfaceOp).map(event => event.type)).toEqual(['system/message', 'user/message'])
    expect(rewound.events.filter(event => event.type === 'step/end')).toHaveLength(1)
    expect(rewound.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('keeps recovered input in subsequent prefix-mode requests without duplication', async () => {
    const f = await fixture()
    await recoverSessionHistory(f.root, f.session.id, f.archive)
    const stored = await reopen(f)
    const session = Session.create(f.session.id, stored.events, stored.header)
    const users = session.deriveMessages().filter(message => message.source.kind === 'user')
    const next = createUserMessage({ content: [{ type: 'text', text: '合成后续输入' }], source: { kind: 'user' } })
    const messages = projectProductHistory([...users, next], {
      historyMode: 'prefix', history: [{ role: 'assistant', content: '合成开场白' }]
    })
    expect(messages.map(message => message.content[0].text)).toEqual([
      '合成开场白', '合成历史输入', '合成当前输入', '合成后续输入'
    ])
  })

  it('counts only actual requests after retaining the old system configuration and regenerating', async () => {
    const f = await fixture(false, true)
    await recoverSessionHistory(f.root, f.session.id, f.archive)
    const ctx = new Context()
    try {
      const registry = new SessionProjectionRegistry(ctx)
      installSessionStats({ sessionProjections: registry })
      registry.register(historyStatsProjection)

      const stored = await reopen(f)
      const original = Session.create(f.session.id, stored.events, stored.header)
      const originalStats = registry.snapshot(original).values
      expect(originalStats.sessionStats).toMatchObject({ steps: 1, turns: 1 })
      expect(originalStats.eleckoiHistoryStatsAdjustment).toEqual({ steps: 0, turns: 0 })
      const current = stored.events.find(event => event.type === 'user/message' && event.data.content[0].text === '合成当前输入')
      rewindDshSession(f.root, f.session.id, 1, current.seq)
      const retained = await reopen(f)
      const regenerated = Session.create(f.session.id, retained.events, retained.header)
      const baseline = registry.snapshot(regenerated).values
      expect(baseline.sessionStats).toMatchObject({ steps: 1, turns: 1 })
      expect(baseline.eleckoiHistoryStatsAdjustment).toEqual({ steps: 1, turns: 1 })
      expect(baseline.eleckoiRequestContexts).toBeUndefined()
      regenerated.append('turn/start', { turn: 2 })
      const step = regenerated.append('step/start', { turn: 2, step: 1 })
      regenerated.append('user/message', createUserMessage({
        content: [{ type: 'text', text: '合成重新生成输入' }], source: { kind: 'user' }
      }), { surfaceOp: 'append' })
      regenerated.append('eleckoi/request-context', { requestSeq: step.seq, context: f.context }, { ignorable: true })
      regenerated.append('step/end', { turn: 2, step: 1 })
      regenerated.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      const stats = registry.snapshot(regenerated).values
      expect(stats.sessionStats.steps - stats.eleckoiHistoryStatsAdjustment.steps).toBe(1)
      expect(stats.sessionStats.turns - stats.eleckoiHistoryStatsAdjustment.turns).toBe(1)
      expect(stats.eleckoiRequestContexts).toBeUndefined()
      expect(regenerated.snapshotEvents().findLast(event => event.type === 'eleckoi/request-context').data.context).toEqual(f.context)
      const regeneratedLog = regenerated.snapshotEvents()
      const unchanged = Session.create(f.session.id, regeneratedLog, regenerated.header)
      expect(registry.snapshot(unchanged).values).toEqual(stats)
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses recovery while the official writer lease is held', async () => {
    const f = await fixture()
    const ctx = new Context()
    await ctx.plugin(JsonlSessionPersistence, { root: f.root, compression: 'none' })
    try {
      const handle = await ctx.sessionPersistence.open(f.session.id, 'write')
      try {
        const before = readFileSync(f.path, 'utf8')
        await expect(recoverSessionHistory(f.root, f.session.id, f.archive)).rejects.toThrow()
        expect(readFileSync(f.path, 'utf8')).toBe(before)
      } finally { await handle.close() }
    } finally { await ctx.fiber.dispose() }
  })

  it('rebuilds cached projections from zero rather than retaining old sequence watermarks', async () => {
    const f = await fixture()
    await recoverSessionHistory(f.root, f.session.id, f.archive)
    const ctx = new Context()
    await ctx.plugin(JsonlSessionPersistence, { root: f.root, compression: 'none' })
    try {
      const registry = new SessionProjectionRegistry(ctx)

      let snapshot
      await refreshSessionProjections({
        sessionPersistence: ctx.sessionPersistence,
        sessionProjections: registry,
        sessionProjectionCache: { write: async session => { snapshot = registry.snapshot(session) } }
      }, f.session.id)
      const restored = await reopen(f)
      expect(snapshot.values.eleckoiRequestContexts).toBeUndefined()
      expect(restored.events.findLast(event => event.type === 'eleckoi/request-context').data.context).toEqual(f.context)
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses ambiguous metadata without touching the original', async () => {
    const f = await fixture()
    f.archive.tables.agent_responses.push({ turnId: 'historical-user', runtimeThreadId: f.session.id, dshTurn: 99 })
    const before = readFileSync(f.path, 'utf8')
    await expect(recoverSessionHistory(f.root, f.session.id, f.archive)).rejects.toThrow('无法唯一对应')
    expect(readFileSync(f.path, 'utf8')).toBe(before)
  })

  it('preserves recovered history when regenerating the first native turn', async () => {
    const f = await fixture()
    await recoverSessionHistory(f.root, f.session.id, f.archive)
    const log = readDshSessionLog(f.root, f.session.id)
    const current = log.events.find(event => event.type === 'user/message' && event.data.content[0].text === '合成当前输入')
    rewindDshSession(f.root, f.session.id, 1, current.seq)
    const stored = await reopen(f)
    expect(stored.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(stored.events.find(event => event.type === 'user/message').data.content[0].text).toBe('合成历史输入')
    expect(stored.header.id).toBe(f.session.id)
  })

  it('cuts at the recovered input itself when deleting or regenerating that input', async () => {
    const f = await fixture()
    await recoverSessionHistory(f.root, f.session.id, f.archive)
    const stored = await reopen(f)
    const historical = stored.events.find(event => event.type === 'user/message' && event.data.id === 'historical-user')
    rewindDshSession(f.root, f.session.id, 1, historical.seq)
    expect((await reopen(f)).events).toHaveLength(0)
    expect(await recoverSessionHistory(f.root, f.session.id, f.archive)).toBe(0)
  })
})
