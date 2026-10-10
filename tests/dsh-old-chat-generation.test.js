import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { LlmRuntime, createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { LocalMediaStore } from '@eleckoi/dsh-product-data/media'
import { ConversationChangeFeed, ElecKoiConversationsApi, ElecKoiConversationLifecycle } from '@eleckoi/dsh-product-api'
import { TYPERT } from '@eleckoi/dsh-product-api/typert'
import { RequestPreviewStore } from '../packages/dsh-client-roleplay/src/host/request-preview.mjs'
import { SqliteDatabase } from '../packages/dsh-product-data/src/storage/sqlite/SqliteDatabase'
import { CharacterRepository } from '../packages/dsh-product-data/src/domain/personas/CharacterRepository'
import { ConversationRepository } from '../packages/dsh-product-data/src/domain/conversations/ConversationRepository'
import { MessageRepository } from '../packages/dsh-product-data/src/domain/conversations/MessageRepository'
import { readDshSessionLog } from '../packages/dsh-runtime/src/trajectory'
import * as sessionEditPlugin from '../packages/dsh-runtime/src/sessionEditPlugin'
import { installRoleplaySessionRuntime } from '../packages/dsh-client-roleplay/src/host/session-runtime.mjs'
import { writeSessionSnapshot } from '../packages/dsh-client-roleplay/src/host/session-snapshot.mjs'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(withOpening = true, { failPreparation = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-old-generation-'))
  cleanups.push(() => {
    const child = relative(tmpdir(), root)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected test cleanup path')
    rmSync(root, { recursive: true, force: true })
  })
  const env = {
    ELECKOI_DATABASE_PATH: join(root, 'product.sqlite3'),
    ELECKOI_MEDIA_ROOT: join(root, 'media'),
    ELECKOI_WORKSPACE_ROOT: join(root, 'workspace'),
    ELECKOI_PRESET_ROOT: join(root, 'presets'),
    ELECKOI_PRESET_TEMPLATE_PATH: resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml'),
    ELECKOI_SESSION_SNAPSHOT_ROOT: join(root, 'snapshots'),
    ELECKOI_SESSION_BRIDGE_ROOT: join(root, 'bridges'),
    DSH_HOME: join(root, 'dsh-home'),
    DSH_SESSION_ROOT: join(root, 'sessions')
  }
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]
    process.env[key] = value
    cleanups.push(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  mkdirSync(env.ELECKOI_WORKSPACE_ROOT)
  const database = new SqliteDatabase(env.ELECKOI_DATABASE_PATH)
  database.open()
  let conversationId, userId
  try {
    const conversations = new ConversationRepository(database, () => ({
      initialVariableStateJson: '{}', openingText: withOpening ? '合成开场白' : '',
      openingOptions: [], selectedOpeningId: ''
    }))
    new CharacterRepository(database, conversations, new LocalMediaStore(env.ELECKOI_MEDIA_ROOT)).create({
      id: 'synthetic-character', name: '合成角色', group: '',
      persona: { assistant_name: '合成角色', assistant_avatar: '', assistant_cover: '' }
    })
    conversationId = conversations.create({ metadata: {
      characterId: 'synthetic-character', characterPersona: { assistant_name: '合成角色' }
    } }).conversation.id
    const messages = new MessageRepository(database)
    userId = messages.create(conversationId, 'user', '合成旧输入', 'complete').id
    const reply = messages.create(conversationId, 'assistant', '合成旧回复', 'complete', undefined, conversationId)
    messages.bindHistoricalDshTurn(conversationId, reply.id, conversationId, 1)
    database.native.prepare(`INSERT INTO agent_setting_snapshots(conversationId,ownerType,ownerId,stateJson)
      VALUES (?,'turn',?,'[]')`).run(conversationId, userId)
    // A newly opened ledger cannot supply DSH-owned response bodies.
    expect(() => new MessageRepository(database).list(conversationId)).toThrow('会话日志无法读取')
    // Variable inspection uses the product ledger snapshots and remains
    // available even when a historical DSH transcript is unavailable.
    expect(new MessageRepository(database).listMetadata(conversationId).map((message) => message.id))
      .toEqual(expect.arrayContaining([userId, reply.id]))
  } finally { database.close() }

  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const sessionRoot = join(root, 'sessions')
  await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot, compression: 'none' })
  const session = Session.create(SessionId(conversationId))
  session.append('model/selection', { provider: 'removed-provider', model: 'old-model' })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('合成系统配置') }, { surfaceOp: 'append' })
  const input = createUserMessage({ content: [{ type: 'text', text: '合成旧输入' }], source: { kind: 'user' } })
  const userEvent = session.append('user/message', { ...input, id: userId }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({
    content: [{ type: 'text', text: '合成旧回复' }], source: { provider: 'test', model: 'test' }
  }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const handle = await ctx.sessionPersistence.create(session.header)
  await handle.append(session.snapshotEvents())
  await handle.flush()
  await handle.close()
  const followed = []
  const createAgent = current => {
    const scope = new Context()
    cleanups.push(() => scope.fiber.dispose())
    return { id: SessionId(conversationId), ctx: scope, session: current, status: 'idle',
      continueFromInput: id => {
        const input = current.deriveMessages().find(message => message.id === id)
        if (!input) throw new Error('Selected input is not retained')
        followed.push(input)
        return 2
      } }
  }
  let agent = createAgent(session)
  let globalModelSelection = { provider: 'test', model: 'test' }
  const flush = async () => {
    const logged = readDshSessionLog(sessionRoot, conversationId)
    const writer = await ctx.sessionPersistence.open(SessionId(conversationId), 'write')
    try { await writer.append(agent.session.snapshotEvents().slice(logged.events.length)); await writer.flush() }
    finally { await writer.close() }
  }
  const reload = () => {
    const log = readDshSessionLog(sessionRoot, conversationId)
    agent = createAgent(Session.create(SessionId(conversationId), log.events, log.header, log.inheritedEventCount))
  }
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin({ name: 'synthetic-generation-services',
    provide: ['agentDefaultModel', 'agents', 'eleckoiSessionHandles', 'eleckoiConversationChanges',
      'attachments', 'fileUploads', 'fs', 'sessions', 'sessionQuery', 'workspaceRegistry', 'sessionProjectionCache', 'credentials', 'settings'],
    apply(owner) {
      owner.provide('agentDefaultModel', {
        currentSelection: () => ({ ...globalModelSelection }),
        saveSelection: async (selection) => { globalModelSelection = { ...selection } }
      })
      owner.provide('agents', { get: () => agent })
      owner.provide('sessions', { get: () => agent.session })
      owner.provide('attachments', { imageLimits: { maxImageBytes: 1000000, maxImagesPerMessage: 4,
        maxMessageImageBytes: 4000000, maxImagePixels: 1000000, maxImageDimension: 1000, mediaTypes: ['image/png'] } })
      owner.provide('fileUploads', { registerAgentResolver: () => () => {} })
      owner.provide('fs', {})
      owner.provide('sessionQuery', {})
      owner.provide('workspaceRegistry', {})
      owner.provide('sessionProjectionCache', { write: async () => {} })
      owner.provide('credentials', { resolve: async () => ({ value: 'synthetic-key', source: 'test' }) })
      owner.provide('settings', { describe: () => [{ ns: 'eleckoi-client-models', value: { entries: {
        test: { parameters: { test: { temperature: 0.6, topP: 0.8 } } }
      } } }] })
      const changes = new ConversationChangeFeed()
      owner.provide('eleckoiConversationChanges', changes)
      owner.on('dispose', () => changes.close())
      owner.provide('eleckoiSessionHandles', { withClosed: async (_id, action) => {
        await flush()
        try { return await action() } finally { reload() }
      } })
    }
  })
  await ctx.plugin(productDataPlugin)
  await ctx.plugin(ElecKoiConversationLifecycle)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(piAi, { providers: { test: { api: 'openai-responses', baseURL: 'http://127.0.0.1:1/v1',
    apiKeyEnv: 'SYNTHETIC_KEY', models: [{ id: 'test', contextWindow: 100000, maxTokens: 8000 }] } } })
  writeSessionSnapshot(env.ELECKOI_SESSION_SNAPSHOT_ROOT, conversationId, { conversationId,
    model: { provider: 'removed-provider', model: 'old-model', temperature: 0.1, topP: 0.1 } })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionController, {})
  await ctx.plugin(sessionEditPlugin)
  let preparationCount = 0
  cleanups.push(installRoleplaySessionRuntime(ctx, {
    prepareForSession: async () => undefined,
    selectForSession: async () => {
      if (failPreparation && ++preparationCount === 1) throw new Error('Synthetic preparation failure')
    }
  }))
  cleanups.push(ctx.typert.register(TYPERT))
  await ctx.plugin(TypertGatewayService)
  const previews = new RequestPreviewStore()
  ctx.provide('eleckoiRequestPreviews', previews)
  cleanups.push(() => previews.close())
  await ctx.plugin(ElecKoiConversationsApi)
  const select = async (selection = { provider: 'test', model: 'test' }) => {
    globalModelSelection = { ...selection }
  }
  await select()
  return { ctx, env, conversationId, userEvent, sessionRoot, followed, select, flush, getAgent: () => agent }
}

function contextBridge(f) {
  return JSON.parse(readFileSync(join(f.env.ELECKOI_SESSION_BRIDGE_ROOT, f.conversationId,
    'eleckoi-conversation-context.json'), 'utf8'))
}

describe('old chat request preparation', { timeout: 30_000 }, () => {
  it.each([true, false])('prepares new input with bound old replies and opening=%s', async withOpening => {
    const f = await fixture(withOpening)
    const before = readDshSessionLog(f.sessionRoot, f.conversationId).events
    await expect(f.ctx.eleckoiRoleplaySessions.preparePrompt(f.conversationId, '合成新输入'))
      .resolves.toBe(f.conversationId)
    expect(contextBridge(f)).toMatchObject({ historyMode: 'prefix', currentUserInput: '合成新输入',
      history: withOpening ? [{ role: 'assistant', content: '合成开场白' }] : [] })
    expect(readDshSessionLog(f.sessionRoot, f.conversationId).events).toEqual(before)
  })

  it('rewinds an old native session and prepares and starts regeneration through Remote', async () => {
    const f = await fixture()
    await expect(f.ctx.typertGateway.invoke({ namespace: 'eleckoiConversations', method: 'regenerateMessage',
      args: { conversationId: f.conversationId, eventSeq: f.userEvent.seq,
        requestId: 'synthetic-regeneration', replacementMessage: '合成替换输入' } }))
      .resolves.toMatchObject({ runtimeSessionId: f.conversationId, prepared: true, operationId: expect.any(String) })
    expect(readDshSessionLog(f.sessionRoot, f.conversationId).events
      .filter(event => event.type === 'assistant/message')).toHaveLength(0)
    expect(contextBridge(f)).toMatchObject({ historyMode: 'prefix', currentUserInput: '合成替换输入',
      history: [{ role: 'assistant', content: '合成开场白' }] })
    expect(JSON.parse(readFileSync(join(f.env.ELECKOI_SESSION_SNAPSHOT_ROOT, `${f.conversationId}.json`), 'utf8')).model)
      .toMatchObject({ provider: 'test', model: 'test', temperature: 0.6, topP: 0.8 })
    await expect(f.ctx.typertGateway.invoke({ namespace: 'eleckoiConversations', method: 'startRegeneration',
      args: { conversationId: f.conversationId, requestId: 'synthetic-regeneration', cancelled: false } }))
      .resolves.toEqual({ accepted: true, turn: 2 })
    expect(f.followed).toHaveLength(1)
    expect(f.followed[0]).toMatchObject({ id: f.userEvent.data.id,
      content: [{ type: 'text', text: '合成替换输入' }], source: f.userEvent.data.source })
    const retained = readDshSessionLog(f.sessionRoot, f.conversationId).events.find(event => event.seq === f.userEvent.seq)
    expect(retained).toMatchObject({ seq: f.userEvent.seq, time: f.userEvent.time,
      data: { id: f.userEvent.data.id, source: f.userEvent.data.source } })
  })

  it('rejects an unavailable global model repeatedly without discarding messages', async () => {
    const f = await fixture()
    await f.select({ provider: 'unavailable-current', model: 'test' })
    const before = readFileSync(readDshSessionLog(f.sessionRoot, f.conversationId).path, 'utf8')
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(f.ctx.eleckoiConversationsApi.regenerateMessage(f.conversationId, f.userEvent.seq, `retry-${attempt}`))
        .rejects.toThrow('no adapter registered')
      expect(readFileSync(readDshSessionLog(f.sessionRoot, f.conversationId).path, 'utf8')).toBe(before)
    }
  })

  it('restores the log and runtime if preparation fails after rewinding', async () => {
    const f = await fixture(true, { failPreparation: true })
    const logPath = readDshSessionLog(f.sessionRoot, f.conversationId).path
    const beforeLog = readFileSync(logPath, 'utf8')
    const beforeState = f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId)
    const snapshotPath = join(f.env.ELECKOI_SESSION_SNAPSHOT_ROOT, `${f.conversationId}.json`)
    const beforeSnapshot = readFileSync(snapshotPath, 'utf8')
    await expect(f.ctx.eleckoiConversationsApi.regenerateMessage(f.conversationId, f.userEvent.seq, 'failed-retry'))
      .rejects.toThrow('Synthetic preparation failure')
    expect(readFileSync(logPath, 'utf8')).toBe(beforeLog)
    expect(readFileSync(snapshotPath, 'utf8')).toBe(beforeSnapshot)
    expect(f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId)).toEqual(beforeState)
    await expect(f.ctx.eleckoiConversationsApi.regenerateMessage(f.conversationId, f.userEvent.seq, 'next-retry'))
      .resolves.toMatchObject({ prepared: true })
  })
})
