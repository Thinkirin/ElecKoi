import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { mvuMessageDisplayCompatibility } from '@eleckoi/compatibility-mvu'
import { MessageDisplayProjector } from '../packages/dsh-product-data/src/domain/conversations/MessageDisplayProjector'
import type { RegexRuleCollection } from '../packages/product-shared/src/contracts/regex/schemas'
import { detectRichMessagePresentation } from '../packages/product-shared/src/foundation/richMessage'

const source = readFileSync(new URL('../packages/dsh-client-conversations/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

interface Result {
  ok: boolean
  data?: Array<{ id: string }>
  error?: { message: string }
}

type ConversationChange =
  | { kind: 'snapshot' }
  | { kind: 'catalog'; conversationId: string; reason: 'created' | 'deleted' }
  | { kind: 'messages'; conversationId: string; reason: 'edited' | 'deleted' | 'regenerated'; messageIds: string[] }

function conversationChangeFeed() {
  type StreamState = {
    queue: ConversationChange[]
    done: boolean
    wake: (() => void) | undefined
  }
  const streams = new Set<StreamState>()
  let stopped = false
  return {
    open(signal?: AbortSignal): AsyncIterable<ConversationChange> {
      const state: StreamState = { queue: [{ kind: 'snapshot' }], done: false, wake: undefined }
      streams.add(state)
      const stop = () => {
        if (state.done) return
        state.done = true
        streams.delete(state)
        stopped = true
        state.wake?.()
        state.wake = undefined
      }
      if (signal?.aborted) stop()
      else signal?.addEventListener('abort', stop, { once: true })
      return (async function* () {
        try {
          while (!state.done) {
            if (state.queue.length > 0) {
              yield state.queue.shift()!
              continue
            }
            await new Promise<void>(resolve => { state.wake = resolve })
            state.wake = undefined
          }
        } finally {
          signal?.removeEventListener('abort', stop)
          stop()
        }
      })()
    },
    emit(change: ConversationChange) {
      for (const state of streams) {
        state.queue.push(change)
        state.wake?.()
        state.wake = undefined
      }
    },
    isStopped: () => stopped
  }
}

function conversationRemote(
  read: (name?: string, input?: unknown) => Promise<Result | unknown>,
  changes = conversationChangeFeed(),
  projectDisplay?: (conversationId: string, messages: any[]) => Promise<any[]>
) {
  return {
    eleckoiConversations: {
      changes: (signal?: AbortSignal) => changes.open(signal),
      list: async () => {
        const result = await read('query.conversations.list', {}) as Result
        return result?.ok
          ? { ok: true, value: result.data ?? [] }
          : result
      },
      details: async (conversationId: string, beforeSequence?: number, limit?: number) => {
        const name = beforeSequence === undefined ? 'query.conversations.details' : 'query.conversations.messages'
        const result = await read(name, { conversationId, beforeSequence, limit }) as Result
        return result?.ok ? { ok: true, value: result.data } : result
      },
      variableTimeline: async (conversationId: string) => {
        const result = await read('query.conversations.variable_timeline', { conversationId }) as Result
        return result?.ok ? { ok: true, value: result.data } : result
      },
      ...(projectDisplay ? {
        projectDisplay: async (conversationId: string, messages: any[]) => ({
          ok: true,
          value: await projectDisplay(conversationId, messages)
        })
      } : {})
    }
  }
}

function mountCatalog(
  request: (name?: string, input?: unknown) => Promise<Result | unknown>,
  runtime: {
    allowOtherQueries?: boolean
    requestAnimationFrame?: (callback: () => void) => number
    cancelAnimationFrame?: (id: number) => void
  } = {}
) {
  let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
  const changes = conversationChangeFeed()
  let cleanup = () => {}
  let catalog: {
    getSnapshot: () => { status: string; items: Array<{ id: string }>; error: string }
    subscribe: (listener: () => void) => () => void
    refresh: () => Promise<Array<{ id: string }>>
  } | undefined
  const read = (name?: string, input?: unknown) => {
    if (!runtime.allowOtherQueries) {
      expect(name).toBe('query.conversations.list')
      expect(input).toEqual({})
    }
    return request(name, input)
  }
  runInNewContext(source, {
    AbortController,
    requestAnimationFrame: runtime.requestAnimationFrame,
    cancelAnimationFrame: runtime.cancelAnimationFrame,
    window: {
      __ModuleLoader__: { load: (item: typeof registration) => { registration = item } }
    }
  })
  expect(registration?.id).toBe('@eleckoi/dsh-client-conversations')
  dshClientPlugin(registration!).apply({
    remote: conversationRemote(read, changes),
    provide: (name: string, value: typeof catalog) => {
      expect(name).toBe('eleckoiConversations')
      catalog = value
    },
    effect: (run: () => () => void) => { cleanup = run() },
    on: () => () => {}
  })
  if (!catalog) throw new Error('Conversation catalog was not provided')
  return {
    catalog,
    emit: (change: ConversationChange) => changes.emit(change),
    dispose: () => cleanup(),
    isStopped: changes.isStopped
  }
}

describe('DSH ElecKoi conversation client model', () => {
  it('projects opening regexes on load, refresh, selection, edits and rule changes without changing the original', async () => {
    let registration: any
    let catalog: any
    let cleanup = () => {}
    let rulesChanged: (...args: any[]) => void = () => {}
    let opening = { id: 'opening', role: 'assistant', content: '[ENTRY]\nFirst opening',
      variableStateJson: '{}', status: 'complete', createdAt: '2026-10-02T00:00:00.000Z',
      selectedOpeningId: 'entry-1', openingOptions: [
        { id: 'entry-1', content: '[ENTRY]\nFirst opening' },
        { id: 'entry-2', content: '[ENTRY]\nSecond opening' }
      ] }
    const details = () => ({ conversation: { id: 'chat-1' }, metadata: { characterId: 'character-1' },
      runtimeSessionId: '', messages: [{ ...opening }], hasMore: false, beforeSequence: null })
    const collection: RegexRuleCollection = {
      characterId: 'character-1', agentPresetId: '', agentPresetName: '', agentPresetRegexRevision: '0'.repeat(64),
      globalRules: [], agentPresetRules: [], characterRules: [{
        id: 'entry-panel', name: 'Entry panel', pattern: '/\\[ENTRY\\]/g',
        replacement: '<section class="entry-panel">{{char}}</section>',
        targets: ['AiOutput'], enabled: true, displayOnly: true, promptOnly: false, runOnEdit: false, order: 0
      }],
      versions: [{ id: 'version-1', name: 'Current', globalEnabledIds: [], agentPresetEnabledIds: [],
        characterEnabledIds: ['entry-panel'] }], activeVersionId: 'version-1', revision: 1
    }
    const projector = new MessageDisplayProjector(mvuMessageDisplayCompatibility)
    const projectDisplay = vi.fn(async (conversationId: string, messages: any[]) => messages.map(message => {
      const projected = projector.project({ ...message, conversationId }, collection,
        { characterName: 'Test assistant', userName: 'Test user' })
      return { id: message.id, sourceContent: message.content,
        displayContent: projected.displayContent ?? projected.content, variableStateJson: projected.variableStateJson }
    }))
    const remote = conversationRemote(async name => name === 'query.conversations.list'
      ? { ok: true, data: [{ id: 'chat-1' }] }
      : { ok: true, data: details() }, conversationChangeFeed(), projectDisplay)
    Object.assign(remote.eleckoiConversations, {
      selectOpening: async (_id: string, openingId: string) => {
        opening = { ...opening, content: opening.openingOptions.find(option => option.id === openingId)!.content,
          selectedOpeningId: openingId }
        return { ok: true, value: details() }
      },
      updateOpening: async (_id: string, content: string) => {
        opening = { ...opening, content }
        return { ok: true, value: details() }
      }
    })
    runInNewContext(source, { AbortController,
      window: { __ModuleLoader__: { load: (item: any) => { registration = item } } } })
    dshClientPlugin(registration).apply({ remote,
      eleckoiRegexRules: { subscribe: (listener: typeof rulesChanged) => {
        rulesChanged = listener
        return () => { rulesChanged = () => {} }
      } },
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {} })
    try {
      await settle()
      await catalog.open('chat-1')
      await settle()
      const displayed = () => catalog.getDetailsSnapshot().details.messages[0]
      expect(displayed().content).toBe('[ENTRY]\nFirst opening')
      expect(displayed().displayContent).toContain('<section class="entry-panel">Test assistant</section>')
      expect(detectRichMessagePresentation(displayed().displayContent, false)?.parts.some(part => part.kind === 'rich'))
        .toBe(true)
      const initialCalls = projectDisplay.mock.calls.length
      await catalog.refreshDetails()
      await settle()
      expect(displayed().displayContent).toContain('<section class="entry-panel">Test assistant</section>')
      expect(projectDisplay).toHaveBeenCalledTimes(initialCalls)
      await catalog.selectOpening('chat-1', 'entry-2')
      await settle()
      expect(displayed()).toMatchObject({ content: '[ENTRY]\nSecond opening', selectedOpeningId: 'entry-2' })
      expect(displayed().displayContent).toContain('Second opening')
      expect(displayed().displayContent).not.toContain('[ENTRY]')
      collection.characterRules[0]!.replacement = '<section class="entry-panel">Updated {{char}}</section>'
      collection.revision += 1
      rulesChanged('configuration', 'character-1', { status: 'ready' })
      await settle()
      expect(displayed().displayContent).toContain('Updated Test assistant')
      await catalog.updateOpening('chat-1', '[ENTRY]\nEdited opening')
      await settle()
      expect(displayed().content).toBe('[ENTRY]\nEdited opening')
      expect(displayed().displayContent).toContain('Updated Test assistant')
      expect(displayed().displayContent).toContain('Edited opening')
    } finally { cleanup() }
  })

  it('keeps prior message projections visible while a changed tail is being projected', async () => {
    let registration: any
    let catalog: any
    let cleanup = () => {}
    let messages = [{ id: 'assistant-1', role: 'assistant', content: '[PANEL] previous',
      variableStateJson: '{}', status: 'complete', createdAt: '2026-10-04T00:00:00.000Z' }]
    let deferProjection = false
    let finishProjection: ((results: any[]) => void) | undefined
    const project = (input: any[]) => input.map(message => ({
      id: message.id,
      sourceContent: message.content,
      displayContent: `<section>${message.content.replace('[PANEL] ', '')}</section>`,
      variableStateJson: message.variableStateJson,
    }))
    const projectDisplay = vi.fn(async (_conversationId: string, input: any[]) => {
      if (!deferProjection) return project(input)
      return new Promise<any[]>(resolve => { finishProjection = resolve })
    })
    const remote = conversationRemote(async name => name === 'query.conversations.list'
      ? { ok: true, data: [{ id: 'chat-1' }] }
      : { ok: true, data: { conversation: { id: 'chat-1' }, metadata: { characterId: 'character-1' },
        runtimeSessionId: '', messages, hasMore: false, beforeSequence: null } },
    conversationChangeFeed(), projectDisplay)
    runInNewContext(source, { AbortController,
      window: { __ModuleLoader__: { load: (item: any) => { registration = item } } } })
    dshClientPlugin(registration).apply({ remote,
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {} })
    try {
      await settle()
      await catalog.open('chat-1')
      expect(catalog.getDetailsSnapshot().details.messages[0].displayContent)
        .toBe('<section>previous</section>')

      messages = [...messages, { id: 'user-2', role: 'user', content: '你好',
        variableStateJson: '{}', status: 'complete', createdAt: '2026-10-04T00:01:00.000Z' }]
      deferProjection = true
      const refresh = catalog.refreshDetails()
      await settle()
      expect(catalog.getDetailsSnapshot().details.messages[0].displayContent)
        .toBe('<section>previous</section>')
      finishProjection?.(project(messages))
      await refresh
      expect(catalog.getDetailsSnapshot().details.messages.map((message: any) => message.displayContent))
        .toEqual(['<section>previous</section>', '<section>你好</section>'])
    } finally { cleanup() }
  })

  it.each(['delayed', 'fast', 'cancelled', 'failed', 'live-error', 'pre-turn-error'])('waits for the matching official request completion (%s)', async (mode) => {
    let registration: any
    let catalog: any
    let cleanup = () => {}
    const listeners = new Set<() => void>()
    let events: any[] = []
    let running = false
    let lastAgentError: string | null = null
    const failure = 'Synthetic API error (402): {"message":"request refused"}'
    const details = { conversation: { id: 'chat-1' }, runtimeSessionId: 'runtime-1', messages: [] }
    const finish = () => {
      running = false
      if (mode === 'live-error' || mode === 'pre-turn-error') lastAgentError = failure
      events = [
        { type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } },
        { type: 'event', event: { type: 'user/message', seq: 2, data: { source: { kind: 'user', rpcId: 'request-1' } } } },
        { type: 'event', event: { type: 'turn/end', seq: 3, data: { turn: 1,
          reason: mode === 'failed' ? { kind: 'error', error: { message: '模型服务不可用' } }
            : mode === 'cancelled' ? { kind: 'aborted', reason: 'user' } : { kind: 'completed' } } } },
      ]
      // The control error can precede journal completion or occur before user admission.
      if (mode === 'live-error') { running = true; events = events.slice(0, 2) }
      if (mode === 'pre-turn-error') events = []
      for (const listener of listeners) listener()
    }
    const session = {
      getSnapshot: () => ({ running, promptError: null, lastAgentError }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      prompt: vi.fn(async () => {
        if (mode === 'fast') finish()
        else { running = true; for (const listener of listeners) listener() }
        return { ok: true, value: { accepted: true } }
      }),
    }
    const binding = { session, eventSource: {
      getSnapshot: () => ({ entries: events, hasMore: false }), subscribe: session.subscribe,
    } }
    const changes = conversationChangeFeed()
    runInNewContext(source, { setTimeout, clearTimeout, Date, AbortController,
      window: { __ModuleLoader__: { load: (item: any) => { registration = item } } },
    })
    dshClientPlugin(registration).apply({
      remote: { session: {}, eleckoiConversations: {
        changes: (signal?: AbortSignal) => changes.open(signal),
        list: async () => ({ ok: true, value: [{ id: 'chat-1', runtimeSessionId: 'runtime-1' }] }),
        details: async () => ({ ok: true, value: details }),
        preparePrompt: async () => ({ ok: true, value: { runtimeSessionId: 'runtime-1' } }),
      } },
      sessions: { list: { getSnapshot: () => ({ byId: { 'runtime-1': {} } }) },
        refresh: async () => {}, reloadHistory: async () => {}, retain: () => ({ sessionId: 'runtime-1', binding, ready: Promise.resolve(binding), release() {} }) },
      uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => ({ legacy: { nodes: [], partial: null } }), subscribe: () => () => {} }) }) },
      provide: (_key: string, service: any) => { catalog = service },
      effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {},
    })
    try {
      await settle()
      await catalog.open('chat-1')
      let settled = false
      const sending = catalog.send({ conversationId: 'chat-1', requestId: 'request-1', text: '测试输入' })
      const observed = sending.then((value: unknown) => { settled = true; return value }, (error: unknown) => { settled = true; throw error })
      await settle()
      expect(session.prompt).toHaveBeenCalledWith([{ type: 'text', text: '测试输入' }], 'queue', undefined, 'request-1')
      if (mode !== 'fast') {
        expect(settled).toBe(false)
        const expectation = mode === 'failed' ? expect(observed).rejects.toThrow('模型服务不可用')
          : mode.endsWith('error') ? expect(observed).rejects.toThrow(failure)
          : expect(observed).resolves.toMatchObject({ cancelled: mode === 'cancelled' })
        finish()
        await expectation
        if (mode === 'failed' || mode.endsWith('error')) {
          expect(catalog.getStreamSnapshot()).toMatchObject({ status: 'error' })
          expect(catalog.activeRequests.size).toBe(0)
          expect(listeners.size).toBe(1)
        }
      } else {
        await expect(observed).resolves.toMatchObject({ cancelled: false })
      }
    } finally { cleanup() }
  })

  it.each(['delete-pair/send', 'delete-ai/send', 'delete-ai/regenerate'])('keeps the rewritten Session authoritative through the next complete request (%s)', async (scenario) => {
    let registration: any, catalog: any
    let cleanup = () => {}
    const changes = conversationChangeFeed()
    // Product details deliberately have no transcript rows. DSH is the only
    // source of both historical and newly generated message bodies.
    const details = { conversation: { id: 'chat-1' }, runtimeSessionId: 'runtime-1', messages: [], hasMore: false }
    const user = (seq: number, requestId: string) => ({ kind: 'user', anchorSeq: seq, data: {
      seq, time: seq, messageId: `input-${requestId}`, source: { kind: 'user', rpcId: requestId },
      content: [{ type: 'text', text: '重复的合成输入' }],
    } })
    const reply = (turn: number, seq: number, text: string) => ({ kind: 'turn-tail', anchorSeq: seq + 1, data: {
      turn, seq: seq + 1, closing: { blocks: [{ kind: 'text', text: `<FINAL>${text}</FINAL>` }],
        finalNode: { messageId: `reply-${turn}-${seq}`, seq, time: seq } },
    } })
    const prefix = new Map<string, any>([['user-2', user(2, 'prefix')], ['tail-1', reply(1, 5, '保留的回复')]])
    let nodes = new Map([...prefix, ['user-9', user(9, 'deleted')], ['tail-2', reply(2, 12, '要删除的回复')]])
    let turns = new Map<number, any>([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'closed' }]])
    let chat: any = { order: [...nodes.keys()], nodes, timeline: { turns } }
    let events: any[] = []
    let running = false, removed = false
    let pendingSubmissions: any[] = []
    const targetListeners = new Set<() => void>()
    const sessionListeners = new Set<() => void>()
    const subscribe = (listeners: Set<() => void>) => (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
    const publish = () => {
      chat = { order: [...nodes.keys()], nodes, timeline: { turns } }
      for (const listener of targetListeners) listener()
      for (const listener of sessionListeners) listener()
    }
    const retire = () => {
      removed = true
      for (const listener of sessionListeners) listener()
    }
    let activeRequestId = ''
    const begin = (requestId: string) => {
      activeRequestId = requestId
      running = true
      pendingSubmissions = [{ requestId, placement: 'transcript', time: 9, text: '重复的合成输入' }]
      publish()
    }
    const session = {
      getSnapshot: () => ({ running, removed, pendingSubmissions }), subscribe: subscribe(sessionListeners),
      prompt: vi.fn(async (_content: unknown, _mode: unknown, _signal: unknown, requestId: string) => {
        begin(requestId)
        return { ok: true, value: { accepted: true } }
      }),
    }
    const binding = { session, eventSource: {
      getSnapshot: () => ({ entries: events, hasMore: false }), subscribe: subscribe(sessionListeners),
    } }
    const target = { getSnapshot: () => chat, subscribe: subscribe(targetListeners) }
    const reloadHistory = vi.fn(async () => { removed = false; running = false; publish() })
    runInNewContext(source, { setTimeout, clearTimeout, Date, AbortController,
      window: { __ModuleLoader__: { load: (item: any) => { registration = item } } },
    })
    dshClientPlugin(registration).apply({
      remote: { session: {}, eleckoiConversations: {
        changes: (signal?: AbortSignal) => changes.open(signal),
        list: async () => ({ ok: true, value: [{ id: 'chat-1', runtimeSessionId: 'runtime-1' }] }),
        details: async () => ({ ok: true, value: details }),
        preparePrompt: async () => ({ ok: true, value: { runtimeSessionId: 'runtime-1' } }),
        deleteMessagesFrom: async (_id: string, eventSeq: number, role: string) => {
          expect(eventSeq).toBe(role === 'user' ? 9 : 12)
          nodes = new Map(prefix)
          if (role === 'assistant') nodes.set('user-9', user(9, 'deleted'))
          turns = new Map([[1, { turn: 1, status: 'closed' }]])
          retire()
          return { ok: true, value: { details, deletedMessageCount: role === 'user' ? 2 : 1 } }
        },
        regenerateMessage: async (_id: string, eventSeq: number) => {
          expect(eventSeq).toBe(9)
          nodes = new Map(prefix)
          nodes.set('user-9', user(9, 'deleted'))
          retire()
          return { ok: true, value: { prepared: true } }
        },
        startRegeneration: async (_id: string, requestId: string) => {
          begin(requestId)
          pendingSubmissions = []
          publish()
          return { ok: true, value: { accepted: true, turn: 2 } }
        },
      } },
      sessions: { list: { getSnapshot: () => ({ byId: { 'runtime-1': {} } }) },
        refresh: async () => {}, reloadHistory,
        retain: () => ({ sessionId: 'runtime-1', binding, ready: Promise.resolve(binding), release() {} }) },
      uiConversation: { binding: () => ({ target: () => target }) },
      provide: (_key: string, value: any) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {},
    })
    const messages = () => catalog.getDetailsSnapshot().details.messages
    try {
      await settle()
      await catalog.open('chat-1')
      expect(messages()).toHaveLength(4)
      const retiredSnapshot = chat
      const retiredCallbacks = [...targetListeners]
      const pair = scenario.startsWith('delete-pair')
      await catalog.deleteMessagesFrom('chat-1', pair ? 9 : 12, pair ? 'user' : 'assistant')
      expect(messages().map((message: any) => message.dshMessageId))
        .toEqual(pair ? ['input-prefix', 'reply-1-5'] : ['input-prefix', 'reply-1-5', 'input-deleted'])
      expect(catalog.getStreamSnapshot()).toMatchObject({ status: 'idle', content: '', nodeKey: '' })
      const reloadedSnapshot = chat
      const settledDetails = catalog.getDetailsSnapshot()
      chat = retiredSnapshot
      for (const callback of retiredCallbacks) callback()
      expect(catalog.getDetailsSnapshot()).toBe(settledDetails)
      chat = reloadedSnapshot
      for (let round = 0; round < 2; round++) {
        const requestId = `next-${round}`
        const regenerating = scenario.endsWith('regenerate')
        const expectedInputCount = regenerating ? 2 : messages().filter((message: any) => message.role === 'user').length + 1
        const request = regenerating
          ? catalog.regenerate({ conversationId: 'chat-1', requestId, eventSeq: 9 })
          : catalog.send({ conversationId: 'chat-1', requestId, text: '重复的合成输入' })
        await settle()
        expect(activeRequestId).toBe(requestId)
        expect(messages().some((message: any) => message.requestId === requestId)).toBe(!regenerating)
        expect(messages().filter((message: any) => message.role === 'user')).toHaveLength(expectedInputCount)
        // Rewound logs reuse event positions and turn numbers. Neither is a
        // permanent deletion tombstone or permission to hide later replies.
        const inputSeq = regenerating ? 9 : 15 + round * 10
        const turn = regenerating ? 2 : 3 + round
        const assistantSeq = inputSeq + 3
        if (!regenerating) nodes = new Map(nodes).set(`input-${requestId}`, user(inputSeq, requestId))
        pendingSubmissions = []
        turns = new Map(turns).set(turn, { turn, status: 'open' })
        events = [
          { type: 'event', event: { type: 'turn/start', seq: inputSeq - 1, data: { turn } } },
          { type: 'event', event: { type: 'user/message', seq: inputSeq, data: { source: { kind: 'user', rpcId: requestId } } } },
        ]
        publish()
        const inputCount = messages().filter((message: any) => message.role === 'user').length
        const assistantKey = `step-${turn}`
        nodes = new Map(nodes).set(assistantKey, { kind: 'assistant-step', data: {
          turn, step: inputSeq + 1, seq: assistantSeq, status: 'running',
          blocks: [{ kind: 'text', text: '<FINAL>新的合成回复' }],
        } })
        publish()
        expect(messages().filter((message: any) => message.role === 'user')).toHaveLength(inputCount)
        expect(messages().at(-1)).toMatchObject({ role: 'assistant', status: 'streaming', content: '新的合成回复' })
        running = false
        turns = new Map(turns).set(turn, { turn, status: 'closed' })
        nodes = new Map(nodes).set(`tail-${turn}`, reply(turn, assistantSeq, '新的合成回复'))
        events = [...events, { type: 'event', event: { type: 'turn/end', seq: assistantSeq + 1,
          data: { turn, reason: { kind: 'completed' } } } }]
        publish()
        await request
        expect(messages().filter((message: any) => message.role === 'user')).toHaveLength(inputCount)
        expect(messages().at(-1)).toMatchObject({ role: 'assistant', status: 'complete', dshTurn: turn })
        expect(messages().slice(0, 2).map((message: any) => message.dshMessageId)).toEqual(['input-prefix', 'reply-1-5'])
        await catalog.refreshDetails()
        expect(messages().at(-1).dshMessageId).toBe(`reply-${turn}-${assistantSeq}`)
      }
      expect(reloadHistory).toHaveBeenCalledTimes(scenario.endsWith('regenerate') ? 3 : 1)
      expect(catalog.activeRequests.size).toBe(0)
      expect(catalog.sessionMutations.size).toBe(0)
    } finally { cleanup() }
  })

  it('keeps the latest baseline when requests finish out of order and releases its listener', async () => {
    const pending: Array<(result: Result) => void> = []
    const mounted = mountCatalog(() => new Promise(resolve => pending.push(resolve)))
    await settle()
    expect(pending).toHaveLength(1)
    let changes = 0
    mounted.catalog.subscribe(() => { changes += 1 })
    const latest = mounted.catalog.refresh()
    expect(pending).toHaveLength(2)
    pending[1]!({ ok: true, data: [{ id: 'recent' }] })
    expect((await latest).map(item => item.id)).toEqual(['recent'])
    pending[0]!({ ok: true, data: [{ id: 'older' }] })
    await settle()
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['recent'])
    expect(changes).toBe(1)

    mounted.emit({ kind: 'catalog', conversationId: 'after-change', reason: 'created' })
    await settle()
    expect(pending).toHaveLength(3)
    pending[2]!({ ok: true, data: [{ id: 'after-change' }] })
    await settle()
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['after-change'])

    mounted.dispose()
    expect(mounted.isStopped()).toBe(true)
    mounted.emit({ kind: 'catalog', conversationId: 'ignored-after-dispose', reason: 'created' })
    expect(pending).toHaveLength(3)
  })

  it('reloads and rebinds rejected regeneration before another click', async () => {
    let registration: any, catalog: any
    let cleanup = () => {}
    let seq = 2
    let retained = 0
    const calls: number[] = []
    const details = { conversation: { id: 'chat-1' }, runtimeSessionId: 'runtime-1', messages: [] }
    const session = { getSnapshot: () => ({ running: false }), subscribe: () => () => {} }
    const binding = { session, eventSource: { getSnapshot: () => ({ entries: [], hasMore: false }) } }
    const changes = conversationChangeFeed()
    const reloadHistory = vi.fn(async () => { seq = 9 })
    runInNewContext(source, { setTimeout, clearTimeout, Date, AbortController,
      window: { __ModuleLoader__: { load: (item: any) => { registration = item } } },
    })
    dshClientPlugin(registration).apply({
      remote: { session: {}, eleckoiConversations: {
        changes: (signal?: AbortSignal) => changes.open(signal),
        list: async () => ({ ok: true, value: [{ id: 'chat-1', runtimeSessionId: 'runtime-1' }] }),
        details: async () => ({ ok: true, value: details }),
        regenerateMessage: async (_id: string, eventSeq: number) => {
          calls.push(eventSeq)
          return { ok: false, error: { message: '合成准备失败' } }
        },
      } },
      sessions: { list: { getSnapshot: () => ({ byId: { 'runtime-1': {} } }) },
        refresh: async () => {}, reloadHistory, retain: () => {
          retained++
          return { sessionId: 'runtime-1', binding, ready: Promise.resolve(binding), release() {} }
        } },
      uiConversation: { binding: () => ({ target: () => ({ subscribe: () => () => {}, getSnapshot: () => ({
        order: ['input'], nodes: new Map([['input', { kind: 'user', anchorSeq: seq, data: {
          seq, time: 10, content: [{ type: 'text', text: '合成输入' }], source: { kind: 'user' }
        } }]]), legacy: { nodes: [], partial: null },
      }) }) }) },
      provide: (_key: string, value: any) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {},
    })
    try {
      await settle()
      await catalog.open('chat-1')
      for (let attempt = 0; attempt < 2; attempt++) {
        const input = catalog.getDetailsSnapshot().details.messages[0]
        await expect(catalog.regenerate({ conversationId: 'chat-1', requestId: `retry-${attempt}`,
          eventSeq: input.sessionEventSeq })).rejects.toThrow('合成准备失败')
        expect(catalog.getDetailsSnapshot().details.messages[0].sessionEventSeq).toBe(9)
        expect(catalog.activeRequests.size).toBe(0)
        expect(catalog.sessionMutations.size).toBe(0)
      }
      expect(calls).toEqual([2, 9])
      expect(reloadHistory).toHaveBeenCalledTimes(2)
      expect(retained).toBeGreaterThanOrEqual(3)
    } finally { cleanup() }
  })

  it('keeps the last valid baseline when a later read fails', async () => {
    const responses: Result[] = [
      { ok: true, data: [{ id: 'saved' }] },
      { ok: false, error: { message: 'read failed' } }
    ]
    const mounted = mountCatalog(async () => responses.shift()!)
    await settle()
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['saved'])
    await expect(mounted.catalog.refresh()).rejects.toThrow('read failed')
    expect(mounted.catalog.getSnapshot().status).toBe('error')
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['saved'])
    mounted.dispose()
  })

  it('keeps the chosen history for each character across view changes', async () => {
    const mounted = mountCatalog(async () => ({ ok: true, data: [] }))
    const catalog = mounted.catalog as typeof mounted.catalog & {
      rememberSession: (characterId: string, sessionId: string) => void
      preferredSession: (characterId: string) => string
      forgetSession: (characterId: string, sessionId: string) => void
    }
    catalog.rememberSession('character-a', 'older-a')
    catalog.rememberSession('character-b', 'current-b')
    expect(catalog.preferredSession('character-a')).toBe('older-a')
    expect(catalog.preferredSession('character-b')).toBe('current-b')
    catalog.forgetSession('character-a', 'other-a')
    expect(catalog.preferredSession('character-a')).toBe('older-a')
    catalog.forgetSession('character-a', 'older-a')
    expect(catalog.preferredSession('character-a')).toBe('')
    mounted.dispose()
  })

  it('creates chats and updates openings through the product Remote service', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let sessionRefreshes = 0
    const created = {
      conversation: { id: 'created-chat', title: '新聊天' },
      metadata: {},
      runtimeSessionId: 'created-runtime',
      messages: [{ id: 'opening', role: 'assistant', content: '开场白', variableStateJson: '{}', status: 'complete' }],
      hasMore: false,
      beforeSequence: null
    }
    const calls: Array<{ method: string; args: unknown[] }> = []
    const changeFeed = conversationChangeFeed()
    const remote = {
      eleckoiConversations: {
        changes: (signal?: AbortSignal) => changeFeed.open(signal),
        list: async () => ({ ok: true, value: [{ id: 'created-chat', runtimeSessionId: 'created-runtime' }] }),
        create: async (...args: unknown[]) => { calls.push({ method: 'create', args }); return { ok: true, value: created } },
        delete: async (...args: unknown[]) => { calls.push({ method: 'delete', args }); return { ok: true, value: undefined } },
        selectOpening: async (...args: unknown[]) => { calls.push({ method: 'selectOpening', args }); return { ok: true, value: created } },
        updateOpening: async (...args: unknown[]) => { calls.push({ method: 'updateOpening', args }); return { ok: true, value: created } }
      }
    }
    runInNewContext(source, {
      AbortController,
      window: {
        __ModuleLoader__: { load: (item: typeof registration) => { registration = item } }
      }
    })
    let catalog: any
    dshClientPlugin(registration!).apply({
      remote,
      sessions: { refresh: async () => { sessionRefreshes += 1 }, list: { getSnapshot: () => ({ byId: {} }) } },
      uiConversation: {},
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    await settle()
    expect(await catalog.create({ title: '新聊天' })).toMatchObject({ conversation: { id: 'created-chat' } })
    expect(await catalog.selectOpening('created-chat', 'opening-2')).toMatchObject({ conversation: { id: 'created-chat' } })
    expect(await catalog.updateOpening('created-chat', '修改后的开场白')).toMatchObject({ conversation: { id: 'created-chat' } })
    await catalog.delete('created-chat')
    expect(calls).toEqual([
      { method: 'create', args: [{ title: '新聊天' }] },
      { method: 'selectOpening', args: ['created-chat', 'opening-2'] },
      { method: 'updateOpening', args: ['created-chat', '修改后的开场白'] },
      { method: 'delete', args: ['created-chat'] }
    ])
    expect(sessionRefreshes).toBe(2)
    cleanup()
  })

  it('projects official DSH Session history and live output into the roleplay model', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let targetListener = () => {}
    let sessionListener = () => {}
    let released = false
    const projectionListeners = new Map<string, () => void>()
    let pressure = { projectedTokens: 40, contextWindow: 100, pressureTokens: 50 }
    const breakdown = { sections: [] }
    const sessionStats = { turns: 1, steps: 2, llmMs: 30, toolMs: 4, ttftMs: 5, ttftSteps: 1, decodeMs: 20, decodeTokens: 8 }
    const tokenUsage = { uncachedInputTokens: 12, outputTokens: 8, cacheReadTokens: 3, cacheWriteTokens: 0 }
    let historyStatsAdjustment = { steps: 0, turns: 0 }
    let inputContinuations = { links: [] as Array<{ turn: number; inputMessageId: string; inputEventSeq: number }> }
    let running = false
    let pendingSubmissions: any[] = []
    const userNode = { kind: 'user', anchorSeq: 2, data: {
      kind: 'user', seq: 2, time: 10, content: [{ type: 'text', text: 'official user' }], source: { kind: 'user' }
    } }
    const finalNode = { kind: 'assistant', turn: 1, step: 4, seq: 5, time: 20,
      messageId: 'assistant-dsh', blocks: [{ kind: 'text', text: '<FINAL>official reply</FINAL>' }] }
    const turnTailNode = { kind: 'turn-tail', anchorSeq: 6, data: {
      turn: 1, seq: 6, time: 21, branchUnavailable: false,
      closing: { status: 'settled', turn: 1, step: 4, time: 20, blocks: finalNode.blocks, finalNode }
    } }
    let settledNodes = new Map<string, any>([
      ['user-2', userNode],
      ['turn-tail-1', turnTailNode]
    ])
    let targetSnapshot: any = {
      order: [...settledNodes.keys()], nodes: settledNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }
    const session = {
      projections: { faceOf: (key: string) => ({
        getSnapshot: () => key === 'contextPressure' ? pressure
          : key === 'eleckoiInputContinuations' ? inputContinuations
          : key === 'contextBreakdown' ? breakdown
            : key === 'sessionStats' ? sessionStats
              : key === 'eleckoiHistoryStatsAdjustment' ? historyStatsAdjustment : tokenUsage,
        subscribe: (listener: () => void) => {
          projectionListeners.set(key, listener)
          return () => { projectionListeners.delete(key) }
        }
      }) },
      getSnapshot: () => ({ running, pendingSubmissions }),
      subscribe: (listener: () => void) => { sessionListener = listener; return () => { sessionListener = () => {} } },
      cancel: async () => ({ ok: true, value: { accepted: true } }),
      loadOlder: vi.fn(async () => {
        const olderFinal = { kind: 'assistant', turn: 0, step: 1, seq: 1, time: 2,
          messageId: 'older-assistant-dsh', blocks: [{ kind: 'text', text: 'earlier reply' }] }
        settledNodes = new Map([
          ['user-0', { kind: 'user', anchorSeq: 0, data: {
            kind: 'user', seq: 0, time: 1, content: [{ type: 'text', text: 'earlier user' }], source: { kind: 'user' }
          } }],
          ['turn-tail-0', { kind: 'turn-tail', anchorSeq: 1, data: {
            turn: 0, seq: 2, time: 3, branchUnavailable: false,
            closing: { status: 'settled', turn: 0, step: 1, time: 2, blocks: olderFinal.blocks, finalNode: olderFinal }
          } }],
          ...settledNodes
        ])
        targetSnapshot = { ...targetSnapshot, order: [...settledNodes.keys()], nodes: settledNodes }
        hasMore = false
        targetListener()
      })
    }
    let hasMore = false
    let eventEntries: any[] = []
    const binding = {
      session,
      eventSource: { getSnapshot: () => ({ hasMore, entries: eventEntries }) }
    }
    const target = {
      getSnapshot: () => targetSnapshot,
      subscribe: (listener: () => void) => { targetListener = listener; return () => { targetListener = () => {} } }
    }
    const sessions = {
      list: { getSnapshot: () => ({ byId: { 'runtime-1': {} } }) },
      refresh: async () => {},
      retain: () => ({
        sessionId: 'runtime-1', binding, ready: Promise.resolve(binding),
        release: () => { released = true }
      })
    }
    const upload = vi.fn(async (_sessionId, _file, _name, _signal, onProgress) => {
      onProgress?.({ loaded: 12, total: 12 })
      return {
        ok: true,
        value: {
          receiptId: 'receipt-1',
          file: { attachmentId: 'sha256:file-1', name: 'notes.txt', bytes: 12 }
        }
      }
    })
    const bridge = {
      request: async (name: string, input?: any) => {
        if (name === 'query.conversations.messages') {
          expect(input.beforeSequence).toBe(3)
          return { ok: true, data: { hasMore: false, beforeSequence: 1, messages: [
            { id: 'older-user', role: 'user', sequence: 1, messageIndex: 0, dshMessageId: 'older-user-dsh' },
            { id: 'older-assistant', role: 'assistant', sequence: 2, messageIndex: 1, dshMessageId: 'older-assistant-dsh' },
          ] } }
        }
        if (name === 'query.conversations.details') return { ok: true, data: {
          conversation: { id: 'chat-1' }, runtimeSessionId: 'runtime-1', hasMore: false, beforeSequence: 1,
          runtimeVariableStateByTurn: { 1: '{"score":7}' },
          messages: [
            { id: 'product-user', role: 'user', sequence: 3, sessionEventSeq: 2, messageIndex: 17, content: 'official user', variableStateJson: '{}' },
            { id: 'product-assistant', role: 'assistant', sequence: 4, messageIndex: 22, dshMessageId: 'assistant-dsh', variableStateJson: '{}', displayContent: '<FINAL>official reply</FINAL>' },
            { id: 'metadata-user-extra', role: 'user', sequence: 6, variableStateJson: '{}' }
          ]
        } }
        return { ok: true, data: [] }
      }
    }
    const changeFeed = conversationChangeFeed()
    runInNewContext(source, {
      Date,
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    let catalog: any
    const imageUrl = vi.fn(async () => 'blob:session-image')
    dshClientPlugin(registration!).apply({
      remote: conversationRemote((name, input) => bridge.request(name!, input), changeFeed,
        async (conversationId, messages) => {
          expect(conversationId).toBe('chat-1')
          return messages.map(message => ({
            id: message.id,
            sourceContent: message.content,
            displayContent: message.role === 'assistant'
              ? `projected:${message.content.replace(/<\/?FINAL>/g, '').trim()}`
              : message.content,
            variableStateJson: message.variableStateJson
          }))
        }),
      sessions,
      uiConversation: { binding: () => ({ target: () => target }), imageUrl },
      fileUpload: { upload },
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    await settle()
    const opened = await catalog.open('chat-1')
    await settle()
    expect(opened.messages.map((message: any) => message.content)).toEqual(['official user', '<FINAL>official reply</FINAL>'])
    expect(catalog.getDetailsSnapshot().details.messages.map((message: any) => message.displayContent))
      .toEqual(['official user', 'projected:official reply'])
    expect(opened.messages.map((message: any) => message.messageIndex)).toEqual([0, 1])
    expect(opened.messages[1].variableStateJson).toBe('{"score":7}')
    expect(catalog.getDetailsSnapshot().details.messages).toMatchObject([
      { id: 'product-user', content: 'official user', runtimeSessionId: 'runtime-1' },
      { id: 'product-assistant', content: '<FINAL>official reply</FINAL>', dshMessageId: 'assistant-dsh' }
    ])
    // The relationship projection can hydrate after an unchanged chat tree.
    inputContinuations = { links: [{ turn: 1, inputMessageId: 'synthetic-input', inputEventSeq: 2 }] }
    projectionListeners.get('eleckoiInputContinuations')!()
    await settle()
    expect(catalog.getDetailsSnapshot().details.messages[1].inputEventSeq).toBe(2)
    pendingSubmissions = [{
      requestId: 'request-new', placement: 'transcript', time: 30, text: '你好', attachments: []
    }]
    sessionListener()
    const optimistic = catalog.getDetailsSnapshot().details.messages
    expect(optimistic.filter((message: any) => message.content === '你好')).toHaveLength(1)
    expect(optimistic.at(-1)).toMatchObject({
      id: 'dsh-pending-request-new', requestId: 'request-new', content: '你好', status: 'streaming'
    })
    const admittedUser = { kind: 'user', anchorSeq: 7, data: {
      kind: 'user', seq: 7, time: 31, content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user', rpcId: 'request-new' }
    } }
    targetSnapshot = { ...targetSnapshot,
      order: [...targetSnapshot.order, 'user-7'],
      nodes: new Map([...targetSnapshot.nodes, ['user-7', admittedUser]]) }
    targetListener()
    const admitted = catalog.getDetailsSnapshot().details.messages
    expect(admitted.filter((message: any) => message.content === '你好')).toHaveLength(1)
    expect(admitted.at(-1)).toMatchObject({
      id: 'dsh-pending-request-new', requestId: 'request-new', sessionEventSeq: 7, status: 'complete'
    })
    pendingSubmissions = []
    sessionListener()
    expect(catalog.getDetailsSnapshot().details.messages
      .filter((message: any) => message.content === '你好')).toHaveLength(1)
    targetSnapshot = {
      order: [...settledNodes.keys()], nodes: settledNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] },
    }
    targetListener()
    const stepNodes = new Map<string, any>([
      ['reasoning-1', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 1 } },
        data: { turn: 1, step: 1, status: 'complete', time: 12, blocks: [{ kind: 'reasoning', text: '检查资料' }] } }],
      ['assistant-before-tool', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 1 } },
        data: { turn: 1, step: 2, status: 'settled', time: 13, blocks: [{ kind: 'text', text: '我先检查资料。' }],
          finalNode: { kind: 'assistant', turn: 1, step: 2, seq: 13, time: 13,
            messageId: 'assistant-before-tool', blocks: [{ kind: 'text', text: '我先检查资料。' }] } } }],
      ['tool-1', { kind: 'tool-call', location: { kind: 'step', turn: { turn: 1 } },
        data: { root: { kind: 'tool-result', callId: 'probe-call', call: { name: 'read_file', argsRaw: '{}' },
          time: 14, content: [{ type: 'text', text: '资料已读取' }], subCalls: [] } } }],
    ])
    const finalAt25 = { ...finalNode, seq: 25 }
    const tailAt25 = { ...turnTailNode, anchorSeq: 26, data: { ...turnTailNode.data,
      seq: 26, closing: { ...turnTailNode.data.closing, finalNode: finalAt25 } } }
    settledNodes = new Map([
      ['user-2', userNode],
      ...stepNodes,
      ['turn-tail-1', tailAt25]
    ])
    targetSnapshot = {
      order: [...settledNodes.keys()], nodes: settledNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] },
    }
    targetListener()
    const transcript = catalog.getDetailsSnapshot().details.messages
    expect(transcript).toHaveLength(2)
    expect(transcript.map((message: any) => message.messageIndex)).toEqual([0, 1])
    expect(transcript[1]).toMatchObject({ id: 'product-assistant', content: '<FINAL>official reply</FINAL>', sessionEventSeq: 25,
      process: [{ kind: 'reasoning', detail: '检查资料' }, { kind: 'tool', detail: '资料已读取' }] })
    await catalog.refreshDetails()
    expect(catalog.getDetailsSnapshot().details.messages).toHaveLength(2)
    expect(catalog.getDetailsSnapshot().details.messages[1].process).toHaveLength(2)
    hasMore = true
    targetListener()
    const olderPage = await catalog.pageOlder('chat-1', 2)
    expect(session.loadOlder).toHaveBeenCalledOnce()
    expect(olderPage.messages.map((message: any) => message.content)).toEqual(['earlier user', 'earlier reply', 'official user', '<FINAL>official reply</FINAL>'])
    expect(olderPage.messages.map((message: any) => message.messageIndex)).toEqual([0, 1, 2, 3])
    expect(olderPage.hasMore).toBe(false)
    expect(olderPage.replace).toBe(true)
    const file = { name: 'notes.txt', size: 12 }
    const progress = vi.fn()
    await expect(catalog.uploadFile('chat-1', file, { onProgress: progress })).resolves.toEqual({
      id: 'receipt-1',
      receiptId: 'receipt-1',
      attachmentId: 'sha256:file-1',
      name: 'notes.txt',
      bytes: 12
    })
    expect(upload).toHaveBeenCalledWith('runtime-1', file, 'notes.txt', undefined, progress)
    expect(progress).toHaveBeenCalledWith({ loaded: 12, total: 12 })
    const image = { attachmentId: 'sha256:image-1', name: 'sample.png', mediaType: 'image/png' }
    await expect(catalog.readImage('chat-1', image)).resolves.toBe('blob:session-image')
    expect(imageUrl).toHaveBeenCalledWith('runtime-1', image)
    expect(catalog.getStatsSnapshot()).toEqual({ id: 'chat-1', stats: {
      sessionStats, tokenUsage, contextPressure: pressure, contextBreakdown: breakdown
    } })
    const previousStats = catalog.getStatsSnapshot()
    pressure = { ...pressure, projectedTokens: 60 }
    projectionListeners.get('contextPressure')?.()
    expect(catalog.getStatsSnapshot()).not.toBe(previousStats)
    expect(catalog.getStatsSnapshot().stats.contextPressure.projectedTokens).toBe(60)

    historyStatsAdjustment = { steps: 1, turns: 1 }
    projectionListeners.get('eleckoiHistoryStatsAdjustment')?.()
    expect(catalog.getStatsSnapshot().stats.sessionStats).toEqual({ ...sessionStats, steps: 1, turns: 0 })
    const adjustedStats = catalog.getStatsSnapshot().stats
    catalog.publishStats('chat-1', adjustedStats)
    expect(catalog.getStatsSnapshot().stats.sessionStats).toEqual({ ...sessionStats, steps: 1, turns: 0 })
    expect(catalog.getStatsSnapshot().stats.tokenUsage).toEqual(tokenUsage)
    historyStatsAdjustment = { steps: 0, turns: 0 }
    projectionListeners.get('eleckoiHistoryStatsAdjustment')?.()

    running = true
    const liveNodes = new Map<string, any>([
      ['assistant-live', {
        kind: 'assistant-step',
        location: { kind: 'step', turn: { turn: 2 }, step: { step: 1 } },
        data: { turn: 2, step: 1, status: 'running', time: 30, blocks: [
          { kind: 'reasoning', text: '先读取资料' }
        ] }
      }]
    ])
    const allLiveNodes = new Map([...settledNodes, ...liveNodes])
    targetSnapshot = {
      order: [...allLiveNodes.keys()], nodes: allLiveNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'open' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }
    targetListener()
    expect(catalog.getStreamSnapshot()).toMatchObject({
      status: 'running', messageId: '', content: '',
      renderKey: 'dsh-reply-runtime-1-2', dshTurn: 2,
      process: [{ kind: 'reasoning', status: 'running', detail: '先读取资料' }]
    })
    let streamPublications = 0
    const stopStreamObserver = catalog.subscribeStream(() => { streamPublications += 1 })
    const completionStreamStates: string[] = []
    const completionChatStates: string[] = []
    const stopDetailsObserver = catalog.subscribeDetails(() => {
      const messages = catalog.getDetailsSnapshot().details?.messages || []
      if (messages.at(-1)?.content === '<FINAL>\n第一段正文。\n</FINAL>') {
        completionStreamStates.push(catalog.getStreamSnapshot().status)
      }
    })
    const stopChatObserver = catalog.subscribeChat(() => {
      const snapshot = catalog.getChatSnapshot()
      const messages = snapshot.details.details?.messages || []
      if (messages.at(-1)?.content === '<FINAL>\n第一段正文。\n</FINAL>') {
        completionChatStates.push(snapshot.stream.status)
      }
    })
    const unchangedStreamPublications = streamPublications
    sessionListener()
    targetListener()
    expect(streamPublications).toBe(unchangedStreamPublications)
    const settledDetailsDuringStream = catalog.getDetailsSnapshot()
    allLiveNodes.set('assistant-live', {
      ...allLiveNodes.get('assistant-live'),
      data: { ...allLiveNodes.get('assistant-live').data, status: 'settled', blocks: [
        { kind: 'reasoning', text: '先读取资料' }, { kind: 'text', text: '准备工具调用<FIN' }
      ] }
    })
    allLiveNodes.set('tool-live', {
      kind: 'tool-call',
      location: { kind: 'step', turn: { turn: 2 }, step: { step: 1 } },
      data: { root: {
        phase: 'start', callId: 'call-1', name: 'read_file', argsRaw: '{"path":"notes.txt"}',
        turn: 2, step: 1, time: 31, subCalls: []
      } }
    })
    targetSnapshot = { ...targetSnapshot, order: [...allLiveNodes.keys()] }
    targetListener()
    sessionListener()
    const detailsWithTool = catalog.getDetailsSnapshot()
    expect(detailsWithTool).not.toBe(settledDetailsDuringStream)
    expect(detailsWithTool.details.messages.map((message: any) => message.content)).toContain('official user')
    expect(detailsWithTool.details.messages.at(-1)).toMatchObject({
      role: 'assistant', status: 'streaming', process: [
        { kind: 'reasoning', status: 'complete', detail: '先读取资料' },
        { kind: 'tool', status: 'running', toolName: 'read_file' }
      ]
    })
    expect(catalog.getStreamSnapshot()).toMatchObject({
      status: 'running', messageId: '', content: '', runId: 'runtime-1',
      renderKey: 'dsh-reply-runtime-1-2', dshTurn: 2,
      process: [
        { kind: 'reasoning', status: 'complete', detail: '先读取资料' },
        { kind: 'tool', status: 'running', toolName: 'read_file' }
      ]
    })

    // `turn/end` can publish a tail before its closing assistant is attached.
    // That intermediate official snapshot must not make the visible stream
    // row disappear.
    const incompleteTailNodes = new Map([...allLiveNodes, ['turn-tail-2', {
      kind: 'turn-tail', anchorSeq: 32, data: {
        turn: 2, seq: 32, time: 41, branchUnavailable: true, closing: null
      }
    }]])
    targetSnapshot = {
      order: [...incompleteTailNodes.keys()], nodes: incompleteTailNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'closed' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }
    running = false
    targetListener()
    sessionListener()
    expect(catalog.getStreamSnapshot().status).toBe('running')

    // An interrupted turn has the same incomplete tail shape as the normal
    // delayed-final snapshot, but the official end reason must release the
    // live stream immediately instead of leaving the chat locked.
    eventEntries = [{ type: 'event', event: {
      type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: 'user' } }
    } }]
    targetListener()
    sessionListener()
    expect(catalog.getStreamSnapshot().status).toBe('idle')
    eventEntries = []
    running = true
    targetSnapshot = {
      order: [...allLiveNodes.keys()], nodes: allLiveNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'open' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }

    allLiveNodes.set('assistant-live', {
      ...allLiveNodes.get('assistant-live'),
      data: {
        ...allLiveNodes.get('assistant-live').data,
        status: 'running',
        blocks: [
          { kind: 'reasoning', text: '先读取资料' },
          { kind: 'text', text: '准备工具调用<FINAL>\n第一段</FIN' }
        ]
      }
    })
    targetListener()
    expect(catalog.getDetailsSnapshot()).not.toBe(detailsWithTool)
    expect(catalog.getDetailsSnapshot().details.messages.at(-1)).toMatchObject({
      role: 'assistant', status: 'streaming', content: '第一段'
    })
    expect(catalog.getStreamSnapshot()).toMatchObject({
      status: 'running', messageId: '', content: '第一段', runId: 'runtime-1',
      renderKey: 'dsh-reply-runtime-1-2'
    })

    allLiveNodes.set('assistant-live', {
      ...allLiveNodes.get('assistant-live'),
      data: {
        ...allLiveNodes.get('assistant-live').data,
        blocks: [
          { kind: 'reasoning', text: '先读取资料' },
          { kind: 'text', text: '准备工具调用<FINAL>\n第一段正文。\n</FINAL>' }
        ]
      }
    })
    targetListener()
    expect(catalog.getDetailsSnapshot().details.messages.at(-1)).toMatchObject({
      role: 'assistant', status: 'streaming', content: '第一段正文。'
    })
    expect(catalog.getStreamSnapshot()).toMatchObject({
      status: 'running', messageId: '', content: '第一段正文。', runId: 'runtime-1'
    })

    // The assistant can already contain final-marked text while the Session
    // has not published a turn-tail at all. Ending the Session here must also
    // keep the live row until the durable detail arrives.
    running = false
    targetSnapshot = {
      order: [...allLiveNodes.keys()], nodes: allLiveNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'closed' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }
    targetListener()
    sessionListener()
    expect(catalog.getStreamSnapshot().status).toBe('running')
    running = true
    targetSnapshot = {
      order: [...allLiveNodes.keys()], nodes: allLiveNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'open' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }

    const liveFinalNode = { kind: 'assistant', turn: 2, step: 1, seq: 31, time: 40,
      messageId: 'assistant-live-final', blocks: [{ kind: 'text', text: '<FINAL>\n第一段正文。\n</FINAL>' }] }
    const completedNodes = new Map([...settledNodes, ['turn-tail-2', {
      kind: 'turn-tail', anchorSeq: 32, data: {
        turn: 2, seq: 32, time: 41, branchUnavailable: false,
        closing: { status: 'settled', turn: 2, step: 1, time: 40,
          blocks: liveFinalNode.blocks, finalNode: liveFinalNode }
      }
    }]])
    targetSnapshot = {
      order: [...completedNodes.keys()], nodes: completedNodes,
      timeline: { turns: new Map([[1, { turn: 1, status: 'closed' }], [2, { turn: 2, status: 'closed' }]]) },
      legacy: { nodes: [], partial: null, runningCalls: [] }
    }
    targetListener()
    expect(catalog.getDetailsSnapshot().details.messages.at(-1)).toMatchObject({
      content: '<FINAL>\n第一段正文。\n</FINAL>', displayContent: '第一段正文。'
    })
    expect(catalog.getStreamSnapshot().status).toBe('idle')
    expect(completionStreamStates.at(-1)).toBe('idle')
    expect(completionChatStates.at(-1)).toBe('idle')

    running = false
    sessionListener()
    stopDetailsObserver()
    stopChatObserver()
    expect(catalog.getStreamSnapshot().status).toBe('idle')

    // A new turn must not reuse the preceding reply or its activity.
    running = true
    targetSnapshot = { ...targetSnapshot, timeline: { turns: new Map([
      [2, { turn: 2, status: 'closed' }], [3, { turn: 3, status: 'open' }]
    ]) } }
    sessionListener()
    expect(catalog.getStreamSnapshot()).toMatchObject({
      status: 'running', messageId: '', content: '', process: [], dshTurn: 3
    })
    const toolOnlyNodes = new Map([...completedNodes, ['tool-only', {
      kind: 'tool-call', location: { kind: 'step', turn: { turn: 3 }, step: { step: 1 } },
      data: { root: { phase: 'start', callId: 'search-1', name: 'web_search', argsRaw: '{}',
        turn: 3, step: 1, time: 50, subCalls: [] } }
    }]])
    targetSnapshot = { ...targetSnapshot, order: [...toolOnlyNodes.keys()], nodes: toolOnlyNodes }
    targetListener()
    expect(catalog.getStreamSnapshot()).toMatchObject({
      status: 'running', messageId: '', content: '',
      renderKey: 'dsh-reply-runtime-1-3', dshTurn: 3,
      process: [{ id: 'search-1', kind: 'tool', status: 'running', toolName: 'web_search' }]
    })
    expect(catalog.getStreamSnapshot().process).toHaveLength(1)
    cleanup()
    stopStreamObserver()
    expect(released).toBe(true)
    expect(projectionListeners.size).toBe(0)
    expect(catalog.getStatsSnapshot()).toEqual({ id: '', stats: null })
  })

  it('keeps the active conversation detail when earlier opens finish later', async () => {
    type Details = { conversation: { id: string }; messages: Array<{ id: string }> }
    const detail = (id: string, messageId: string): Details => ({ conversation: { id }, messages: [{ id: messageId }] })
    const pending: Array<{ id: string; resolve: (result: { ok: boolean; data: Details }) => void }> = []
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    const changeFeed = conversationChangeFeed()
    let cleanup = () => {}
    let catalog: {
      getDetailsSnapshot: () => { id: string; status: string; details: Details | null }
      subscribeDetails: (listener: () => void) => () => void
      open: (id: string) => Promise<Details | null>
    } | undefined
    const bridge = {
      request: (name: string, input: { conversationId?: string }) => name === 'query.conversations.list'
        ? Promise.resolve({ ok: true, data: [{ id: 'first' }, { id: 'second' }] })
        : new Promise<{ ok: boolean; data: Details }>(resolve => {
          expect(name).toBe('query.conversations.details')
          pending.push({ id: input.conversationId!, resolve })
        }),
    }
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      remote: conversationRemote((name, input) => bridge.request(name!, input as { conversationId?: string }), changeFeed),
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await settle()
    let changes = 0
    catalog.subscribeDetails(() => { changes += 1 })
    const first = catalog.open('first')
    const second = catalog.open('second')
    expect(pending.map(item => item.id)).toEqual(['first', 'second'])
    pending[1]!.resolve({ ok: true, data: detail('second', 'latest') })
    expect((await second)?.messages[0]?.id).toBe('latest')
    pending[0]!.resolve({ ok: true, data: detail('first', 'stale') })
    expect(await first).toBeNull()
    expect(catalog.getDetailsSnapshot().details?.conversation.id).toBe('second')

    changeFeed.emit({ kind: 'catalog', conversationId: 'second', reason: 'created' })
    await settle()
    expect(pending[2]?.id).toBe('second')
    pending[2]!.resolve({ ok: true, data: detail('second', 'updated') })
    await settle()
    expect(catalog.getDetailsSnapshot().details?.messages[0]?.id).toBe('updated')
    expect(changes).toBe(4)
    cleanup()
    expect(changeFeed.isStopped()).toBe(true)
  })

  it('clears a deleted active conversation before requesting its details again', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    const changes = conversationChangeFeed()
    let cleanup = () => {}
    let exists = true
    const detailRequests: string[] = []
    let catalog: {
      open: (id: string) => Promise<unknown>
      getDetailsSnapshot: () => { id: string; status: string; error: string }
    } | undefined
    const bridge = {
      request: async (name: string, input: { conversationId?: string }) => {
        if (name === 'query.conversations.list') {
          return { ok: true, data: exists ? [{ id: 'only-chat' }] : [] }
        }
        if (name === 'query.conversations.details') {
          detailRequests.push(input.conversationId!)
          return exists
            ? { ok: true, data: { conversation: { id: 'only-chat' }, messages: [] } }
            : { ok: false, error: { message: '找不到对应的聊天存档。' } }
        }
        throw new Error(`Unexpected query: ${name}`)
      },
    }
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      remote: conversationRemote((name, input) => bridge.request(name!, input as { conversationId?: string }), changes),
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await settle()
    await catalog.open('only-chat')
    expect(catalog.getDetailsSnapshot()).toMatchObject({ id: 'only-chat', status: 'ready', error: '' })

    exists = false
    changes.emit({ kind: 'catalog', conversationId: 'only-chat', reason: 'deleted' })
    await settle()
    expect(detailRequests).toEqual(['only-chat'])
    expect(catalog.getDetailsSnapshot()).toMatchObject({ id: '', status: 'idle', error: '' })
    cleanup()
  })

  it('retains loaded history while a destructive refresh is pending', async () => {
    type Details = {
      conversation: { id: string }
      runtimeSessionId: string
      messages: Array<{ id: string; sequence: number }>
      hasMore: boolean
      beforeSequence: number | null
    }
    const detail = (id: string, sequences: number[], hasMore = true): Details => ({
      conversation: { id },
      runtimeSessionId: `runtime-${id}`,
      messages: sequences.map(sequence => ({ id: `${id}-${sequence}`, sequence })),
      hasMore,
      beforeSequence: sequences[0] ?? null
    })
    const responses = [detail('first', [3, 4]), detail('first', [3, 4, 5]), detail('first', [5]), detail('second', [8], false)]
    let resolvePage: ((result: unknown) => void) | undefined
    const changes = conversationChangeFeed()
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalog: {
      getDetailsSnapshot: () => { id: string; details: Details | null; runtimeSessionId?: string }
      open: (id: string) => Promise<Details | null>
      pageOlder: (id: string, beforeSequence: number) => Promise<unknown>
      invalidateDetails: (id: string) => void
      activate: (id: string) => void
    } | undefined
    const bridge = {
      request: (name: string) => {
        if (name === 'query.conversations.list') return Promise.resolve({ ok: true, data: [{ id: 'first' }, { id: 'second' }] })
        if (name === 'query.conversations.details') return Promise.resolve({ ok: true, data: responses.shift() })
        if (name === 'query.conversations.messages') return new Promise(resolve => { resolvePage = resolve })
        throw new Error(`Unexpected query: ${name}`)
      },
    }
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      remote: conversationRemote((name) => bridge.request(name!), changes),
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await settle()
    await catalog.open('first')
    expect(await catalog.pageOlder('second', 3)).toBeNull()
    expect(await catalog.pageOlder('first', 2)).toBeNull()
    const older = catalog.pageOlder('first', 3)
    resolvePage!({ ok: true, data: {
      messages: [1, 2].map(sequence => ({ id: `first-${sequence}`, sequence })),
      hasMore: false, beforeSequence: 1
    } })
    await older
    changes.emit({ kind: 'catalog', conversationId: 'first', reason: 'created' })
    await settle()
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(catalog.getDetailsSnapshot().details?.beforeSequence).toBe(1)

    catalog.invalidateDetails('first')
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(catalog.getDetailsSnapshot().runtimeSessionId).toBe('runtime-first')
    await settle()
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([1, 2, 3, 4, 5])
    const stalePage = catalog.pageOlder('first', 5)
    catalog.activate('second')
    expect(catalog.getDetailsSnapshot().runtimeSessionId).toBe('')
    await catalog.open('second')
    resolvePage!({ ok: true, data: { messages: [{ id: 'first-4', sequence: 4 }], hasMore: false, beforeSequence: 4 } })
    expect(await stalePage).toBeNull()
    expect(catalog.getDetailsSnapshot().id).toBe('second')
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([8])
    cleanup()
  })

  it('returns the selected history while another refresh of the same history is pending', async () => {
    type Details = { conversation: { id: string }; messages: Array<{ id: string }> }
    const pending: Array<(result: { ok: boolean; data: Details }) => void> = []
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let catalog: {
      open: (id: string) => Promise<Details | null>
      refreshDetails: () => Promise<Details>
      getDetailsSnapshot: () => { id: string; details: Details | null }
    } | undefined
    let cleanup = () => {}
    const request = (name: string) => {
      if (name === 'query.conversations.list') return Promise.resolve({ ok: true, data: [] })
      expect(name).toBe('query.conversations.details')
      return new Promise(resolve => pending.push(resolve))
    }
    runInNewContext(source, {
      AbortController,
      window: {
        __ModuleLoader__: { load: (item: typeof registration) => { registration = item } }
      }
    })
    dshClientPlugin(registration!).apply({
      remote: conversationRemote((name) => request(name!), conversationChangeFeed()),
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await settle()
    const opening = catalog.open('older-history')
    const refresh = catalog.refreshDetails()
    const detail = { conversation: { id: 'older-history' }, messages: [{ id: 'older-message' }] }
    pending[0]!({ ok: true, data: detail })
    expect((await opening)?.conversation.id).toBe('older-history')
    pending[1]!({ ok: true, data: detail })
    await refresh
    expect(catalog.getDetailsSnapshot().details?.conversation.id).toBe('older-history')
    cleanup()
  })

  it('refreshes the open variable timeline and drops results after it closes', async () => {
    type Timeline = { floors: Array<{ id: string }> }
    const pending: Array<(result: { ok: boolean; data: Timeline }) => void> = []
    const changes = conversationChangeFeed()
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalog: {
      getTimelineSnapshot: () => { id: string; status: string; timeline: Timeline | null }
      openTimeline: (id: string) => Promise<Timeline | null>
      closeTimeline: (id: string) => void
    } | undefined
    const bridge = {
      request: (name: string) => name === 'query.conversations.variable_timeline'
        ? new Promise<{ ok: boolean; data: Timeline }>(resolve => pending.push(resolve))
        : Promise.resolve({ ok: true, data: [{ id: 'first' }] }),
    }
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      remote: conversationRemote((name) => bridge.request(name!), changes),
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await settle()
    const opened = catalog.openTimeline('first')
    pending[0]!({ ok: true, data: { floors: [{ id: 'floor-1' }] } })
    expect((await opened)?.floors[0]?.id).toBe('floor-1')
    changes.emit({ kind: 'catalog', conversationId: 'first', reason: 'created' })
    await settle()
    pending[1]!({ ok: true, data: { floors: [{ id: 'floor-2' }] } })
    await settle()
    expect(catalog.getTimelineSnapshot().timeline?.floors[0]?.id).toBe('floor-2')

    const stale = catalog.openTimeline('first')
    catalog.closeTimeline('first')
    pending[2]!({ ok: true, data: { floors: [{ id: 'stale' }] } })
    expect(await stale).toBeNull()
    expect(catalog.getTimelineSnapshot().status).toBe('idle')
    cleanup()
    expect(changes.isStopped()).toBe(true)
  })

})
