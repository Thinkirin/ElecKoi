// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { useChatSessions } from '../apps/web/src/modules/chat/hooks/useChatSessions.js'
import source from '../packages/dsh-client-conversations/src/client.js?raw'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function user(seq, text) {
  return { kind: 'user', anchorSeq: seq, data: { seq, time: seq,
    content: [{ type: 'text', text }], source: { kind: 'user' } },
    location: { kind: 'turn', turn: { turn: Math.ceil(seq / 4), status: 'closed' } } }
}

function tail(turn, seq, text) {
  const finalNode = { seq, time: seq, turn, step: 1, messageId: `reply-${turn}-${seq}`,
    blocks: [{ kind: 'text', text }] }
  return { kind: 'turn-tail', anchorSeq: seq + 1, data: { turn,
    closing: { status: 'settled', blocks: finalNode.blocks, finalNode } } }
}

function runtimeFixture({ firstTurn = false } = {}) {
  const conversation = { id: 'chat-1', title: '测试角色', runtimeSessionId: 'session-1' }
  const prefix = firstTurn ? [] : [['user-1', user(1, '前轮输入')], ['tail-1', tail(1, 3, '<FINAL>前轮回复</FINAL>')]]
  let nodes = new Map([...prefix, ['user-2', user(5, '本轮输入')],
    ['tail-2', tail(2, 7, '<FINAL>旧回复</FINAL>')],
    ['user-3', user(9, '后轮输入')], ['tail-3', tail(3, 11, '<FINAL>后轮回复</FINAL>')]])
  let running = false
  let removed = false
  let rewound = false
  let events = []
  let stats = {
    sessionStats: { turns: 3, steps: 3, decodeMs: 1000, decodeTokens: 120 },
    tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 120 },
    contextPressure: { projectedTokens: 1120, contextWindow: 10000 },
  }
  const statsListeners = new Set()
  const sessionListeners = new Set()
  const targetListeners = new Set()
  const eventListeners = new Set()
  const subscribe = listeners => listener => { listeners.add(listener); return () => listeners.delete(listener) }
  const publish = () => { for (const listener of [...targetListeners, ...sessionListeners, ...eventListeners]) listener() }
  let completePreparation
  let rejectPreparation
  let requestId
  let replacementMessage
  let inputLinks = []
  const inputLinkListeners = new Set()
  const session = {
    getSnapshot: () => ({ running, removed }),
    subscribe: subscribe(sessionListeners),
    cancel: vi.fn(async () => ({ ok: true })),
    projections: { faceOf: key => key === 'eleckoiInputContinuations'
      ? { getSnapshot: () => ({ links: inputLinks }), subscribe: subscribe(inputLinkListeners) }
      : { getSnapshot: () => stats[key], subscribe: subscribe(statsListeners) } },
  }
  const target = {
    getSnapshot: () => ({ nodes, order: [...nodes.keys()], timeline: { turns: new Map() } }),
    subscribe: subscribe(targetListeners),
  }
  const binding = { session, eventSource: {
    getSnapshot: () => ({ entries: events, hasMore: false }), subscribe: subscribe(eventListeners),
  } }
  const remote = {
    session: {},
    settings: {
      describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'eleckoi-client-conversations',
        value: { selection: { active_conversation_id: 'chat-1', preferred_sessions: {} } } }] } }),
      mutate: async () => ({ ok: true }),
    },
    eleckoiConversationModels: { current: async () => ({ ok: true,
      value: { provider: 'test-provider', model: 'test-model' } }) },
    eleckoiConversations: {
      changes: async function* (signal) {
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      },
      list: async () => ({ ok: true, value: [conversation] }),
      details: async () => ({ ok: true, value: { conversation, runtimeSessionId: 'session-1', messages: [] } }),
      regenerateMessage: vi.fn((_conversationId, eventSeq, id, replacement) => {
        expect(eventSeq).toBe(5)
        requestId = id
        replacementMessage = replacement
        return new Promise((resolve, reject) => {
          completePreparation = () => {
            rewound = true
            removed = true
            publish()
            resolve({ ok: true, value: { prepared: true } })
          }
          rejectPreparation = () => reject(new Error('测试回退失败'))
        })
      }),
      startRegeneration: vi.fn(async (_conversationId, id, cancelled) => {
        expect(id).toBe(requestId)
        if (cancelled) return { ok: true, value: { accepted: false } }
        inputLinks = [{ turn: 3, inputMessageId: 'synthetic-input-2', inputEventSeq: 5 }]
        for (const listener of inputLinkListeners) listener()
        events = [{ type: 'event', event: { type: 'turn/start', seq: 10, data: { turn: 3 } } }]
        running = true
        publish()
        return { ok: true, value: { accepted: true, turn: 3 } }
      }),
    },
  }
  const sessions = {
    list: { getSnapshot: () => ({ byId: { 'session-1': {} } }) }, refresh: async () => {},
    reloadHistory: vi.fn(async id => {
      expect(id).toBe('session-1')
      if (!rewound) return
      rewound = false
      nodes = new Map([...prefix, ['user-2', user(5, replacementMessage ?? '本轮输入')]])
      inputLinks = []
      removed = false
      events = []
      stats = {
        sessionStats: { turns: firstTurn ? 0 : 1, steps: firstTurn ? 0 : 1, decodeMs: 1000, decodeTokens: firstTurn ? 0 : 40 },
        tokenUsage: { uncachedInputTokens: firstTurn ? 0 : 30, cacheReadTokens: firstTurn ? 0 : 270, cacheWriteTokens: 0, outputTokens: firstTurn ? 0 : 40 },
        contextPressure: firstTurn ? {} : { projectedTokens: 340, contextWindow: 10000 },
      }
    }),
    retain: () => ({ sessionId: 'session-1', binding, ready: Promise.resolve(binding), release() {} }),
  }
  let registration
  let model
  let dispose
  runInNewContext(source, { Date, AbortController, setTimeout, clearTimeout, console,
    window: { __ModuleLoader__: { load: item => { registration = item } } } })
  dshClientPlugin(registration).apply({ remote, sessions, uiConversation: { binding: () => ({ target: () => target }) },
    provide: (_name, value) => { model = value }, effect: run => { dispose = run() }, on: () => () => {} })
  return {
    model, remote, sessions, dispose: () => dispose(),
    completePreparation: () => completePreparation(), rejectPreparation: () => rejectPreparation(),
    live(text) {
      nodes.set('live-3', { kind: 'assistant-step', data: { turn: 3, step: 1, status: 'running',
        blocks: [{ kind: 'text', text }] } })
      publish()
    },
    complete(text) {
      stats = {
        sessionStats: { turns: 2, steps: 2, decodeMs: 1000, decodeTokens: 80 },
        tokenUsage: { uncachedInputTokens: 60, cacheReadTokens: 540, cacheWriteTokens: 0, outputTokens: 80 },
        contextPressure: { projectedTokens: 680, contextWindow: 10000 },
      }
      for (const listener of statsListeners) listener()
      nodes.delete('live-3')
      nodes.set('tail-3', tail(3, 13, text))
      // Journal settlement can precede the control frame that clears running.
      publish()
      running = false
      events.push({ type: 'event', event: { type: 'turn/end', seq: 14, data: { turn: 3, reason: { kind: 'completed' } } } })
      publish()
    },
  }
}

describe('regeneration with the official Session client projection', () => {
  it('edits the retained user event before generating without unmounting its row', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const runtime = runtimeFixture()
    await runtime.model.open('chat-1')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let chat
    const props = { conversations: runtime.model, characters: [],
      modelConfigs: [{ id: 'test-provider', model: 'test-model' }],
      setStatus: vi.fn(), setActiveSectionState: vi.fn(), notify: vi.fn() }
    function Probe() {
      chat = useChatSessions(props)
      return <section>{chat.messages.map(message => <p key={message.renderKey || message.id}
        data-input-seq={message.role === 'user' ? message.sessionEventSeq : undefined}>
        {message.displayContent ?? message.content}</p>)}</section>
    }
    const selector = '[data-input-seq="5"]'
    try {
      await act(async () => { root.render(<Probe />); await flush() })
      const row = container.querySelector(selector)
      const original = chat.messages.find(message => message.sessionEventSeq === 5)
      let regenerating
      await act(async () => {
        regenerating = chat.regenerateReply({ targetMessageId: original.id, replacementMessage: '合成编辑后的输入' })
        await flush()
      })
      expect(container.querySelector(selector)).toBe(row)
      expect(row.textContent).toBe('本轮输入')
      await act(async () => { runtime.completePreparation(); await flush() })
      expect(runtime.remote.eleckoiConversations.regenerateMessage).toHaveBeenCalledWith(
        'chat-1', 5, expect.any(String), '合成编辑后的输入')
      expect(container.querySelector(selector)).toBe(row)
      expect(row.textContent).toBe('合成编辑后的输入')
      for (const text of ['内部处理', '<FINAL>合成新回复']) {
        await act(async () => runtime.live(text))
        expect(container.querySelectorAll(selector)).toHaveLength(1)
        expect(container.querySelector(selector)).toBe(row)
        expect(chat.messages.find(message => message.sessionEventSeq === 5)).toMatchObject({
          id: original.id, sessionEventSeq: original.sessionEventSeq, dshTurn: original.dshTurn,
          created_at: original.created_at, content: '合成编辑后的输入'
        })
      }
      await act(async () => { runtime.complete('<FINAL>合成新回复</FINAL>'); await regenerating })
      expect(container.querySelector(selector)).toBe(row)
      expect(chat.messages.at(-1).inputEventSeq).toBe(5)
      expect(props.notify).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      runtime.dispose()
      container.remove()
      vi.unstubAllGlobals()
    }
  })

  it('holds the complete statistics snapshot through a zero-step rewind and adopts the new official result', async () => {
    const runtime = runtimeFixture({ firstTurn: true })
    await runtime.model.open('chat-1')
    const previous = runtime.model.getStatsSnapshot()
    const updates = []
    const stop = runtime.model.subscribeStats(() => updates.push(runtime.model.getStatsSnapshot()))
    try {
      const regenerating = runtime.model.regenerate({ conversationId: 'chat-1', requestId: 'test-regeneration', eventSeq: 5 })
      await flush()
      expect(runtime.model.getStatsSnapshot()).toBe(previous)
      runtime.completePreparation()
      await flush()
      expect(runtime.model.getStatsSnapshot()).toBe(previous)
      runtime.live('<FINAL>新回复')
      await flush()
      expect(runtime.model.getStatsSnapshot()).toBe(previous)
      runtime.complete('<FINAL>新回复</FINAL>')
      await regenerating
      expect(updates.every(update => update.id === 'chat-1' && update.stats.sessionStats.steps > 0)).toBe(true)
      expect(runtime.model.getStatsSnapshot().stats.tokenUsage.outputTokens).toBe(80)
      runtime.model.activate('chat-2')
      expect(runtime.model.getStatsSnapshot()).toEqual({ id: '', stats: null })
    } finally { stop(); runtime.dispose() }
  })

  it.each(['complete', 'prepare-failed', 'cancelled'])('withdraws the old branch at admission and handles %s', async mode => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const runtime = runtimeFixture()
    await runtime.model.open('chat-1')
    const notify = vi.fn()
    const props = { conversations: runtime.model, characters: [],
      modelConfigs: [{ id: 'test-provider', model: 'test-model' }],
      setStatus: vi.fn(), setActiveSectionState: vi.fn(), notify }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let chat
    function Probe() {
      chat = useChatSessions(props)
      const { stats } = useSyncExternalStore(runtime.model.subscribeStats, runtime.model.getStatsSnapshot)
      return React.createElement('section', null,
        React.createElement('output', null, stats?.sessionStats?.steps > 0
          ? `${stats.sessionStats.steps}:${stats.tokenUsage.outputTokens}:${stats.contextPressure.projectedTokens}` : null),
        React.createElement('div', null, chat.messages.map(message =>
        React.createElement('p', { key: message.renderKey || message.id, 'data-role': message.role },
          message.displayContent ?? message.content))))
    }
    const text = () => [...container.querySelectorAll('p')].map(node => node.textContent)
    try {
      await act(async () => { root.render(React.createElement(Probe)); await flush() })
      expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入', '旧回复', '后轮输入', '后轮回复'])
      const statsRow = container.querySelector('output')
      for (let attempt = 0; attempt < (mode === 'complete' ? 2 : 1); attempt += 1) {
        const previousStats = statsRow.textContent
        let regenerating
        await act(async () => { regenerating = chat.regenerateReply({ targetMessageId: attempt === 0 ? 'reply-2-7' : chat.messages.at(-1).id }); await flush() })
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入'])
        expect(chat.isSending).toBe(true)
        expect(statsRow.textContent).toBe(previousStats)
        // A delayed refresh still contains the retiring reply and later turns.
        let refreshing
        await act(async () => { refreshing = runtime.model.refreshDetails(); await flush() })
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入'])
        expect(statsRow.textContent).toBe(previousStats)
        if (mode === 'prepare-failed') {
          await act(async () => { runtime.rejectPreparation(); await regenerating; await refreshing })
          expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入', '旧回复', '后轮输入', '后轮回复'])
          expect(notify).toHaveBeenCalledWith('error', '测试回退失败')
          expect(statsRow.textContent).toBe(previousStats)
          break
        }
        if (mode === 'cancelled') await act(async () => chat.stopSend())
        await act(async () => { runtime.completePreparation(); await refreshing; await flush() })
        if (mode === 'cancelled') {
          await act(async () => { await regenerating })
          expect(runtime.remote.eleckoiConversations.startRegeneration).toHaveBeenCalledWith('chat-1', expect.any(String), true)
          expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入'])
          expect(statsRow.textContent).toBe('1:40:340')
          break
        }
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入'])
        expect(statsRow.textContent).toBe(previousStats)
        await act(async () => runtime.live('内部处理<FIN'))
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入', ''])
        await act(async () => runtime.live('内部处理<FINAL>\n新版'))
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入', '新版'])
        const liveRow = container.querySelector('div').lastElementChild
        await act(async () => runtime.live('内部处理<FINAL>\n新版正文\n</FI'))
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入', '新版正文'])
        await act(async () => { runtime.complete('<FINAL>\n新版正文\n</FINAL>'); await regenerating })
        expect(text()).toEqual(['前轮输入', '前轮回复', '本轮输入', '新版正文'])
        expect(container.querySelector('div').lastElementChild).toBe(liveRow)
        expect(container.querySelector('output')).toBe(statsRow)
        expect(statsRow.textContent).toBe('2:80:680')
        expect(chat.runtimeSessionId).toBe('session-1')
      }
      expect(chat.isSending).toBe(false)
      expect(chat.sessionId).toBe('chat-1')
      await act(async () => runtime.model.activate(''))
      expect(runtime.model.getStatsSnapshot()).toEqual({ id: '', stats: null })
    } finally {
      await act(async () => root.unmount())
      runtime.dispose()
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
