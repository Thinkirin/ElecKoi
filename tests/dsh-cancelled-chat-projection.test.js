import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { officialChatFixture } from './helpers/officialTrajectory.js'
import { interruptedTurnClosers, ToolCallRecovery } from '@deepseek-ai/dsh-session'
import { turnOutcomesProjection } from '../packages/dsh-client-roleplay/src/host/turn-outcomes-projection.mjs'

const source = readFileSync(new URL('../packages/dsh-client-conversations/src/client.js', import.meta.url), 'utf8')

function observable(snapshot) {
  const listeners = new Set()
  return { getSnapshot: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    publish() { for (const listener of listeners) listener() },
  }
}

async function fixture() {
  const official = officialChatFixture()
  let chat = official.replace([])
  let running = false
  let removed = false
  const events = []
  let outcomes = turnOutcomesProjection.init()
  let seq = 0
  const target = observable(() => chat)
  const eventSource = observable(() => ({ entries: events, hasMore: false }))
  const outcomesFace = observable(() => outcomes)
  const preparation = Promise.withResolvers()
  let rewindSeq
  let fixtureApi
  const session = { ...observable(() => ({ running, removed })),
    projections: { faceOf: key => key === 'eleckoiTurnOutcomes' ? outcomesFace : observable(() => undefined) },
  }
  const binding = { session, eventSource }
  let registration, model, dispose
  runInNewContext(source, { Date, AbortController, setTimeout, clearTimeout,
    window: { __ModuleLoader__: { load: item => { registration = item } } } })
  dshClientPlugin(registration).apply({
    remote: { session: {}, eleckoiConversations: {
      changes: async function* (signal) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) },
      list: async () => ({ ok: true, value: [{ id: 'synthetic-chat', runtimeSessionId: 'synthetic-session' }] }),
      details: async () => ({ ok: true, value: { conversation: { id: 'synthetic-chat' }, runtimeSessionId: 'synthetic-session', messages: [] } }),
      regenerateMessage: (_id, eventSeq) => { rewindSeq = eventSeq; return preparation.promise },
      startRegeneration: async () => {
        fixtureApi.setRunning(true)
        fixtureApi.append('turn/start', { turn: 3 })
        fixtureApi.append('step/start', { turn: 3, step: 1 })
        return { ok: true, value: { accepted: true, turn: 3 } }
      },
    } },
    sessions: { list: observable(() => ({ byId: { 'synthetic-session': {} } })),
      refresh: async () => {},
      reloadHistory: async () => {
        const retained = events.map(entry => entry.event).filter(event => event.seq <= rewindSeq)
        retained.push(...interruptedTurnClosers(retained))
        events.splice(0, events.length, ...retained.map(event => ({ type: 'event', event })))
        outcomes = retained.reduce(turnOutcomesProjection.apply, turnOutcomesProjection.init())
        seq = retained.at(-1).seq
        chat = official.replace(retained)
        removed = false
      },
      retain: () => ({ sessionId: 'synthetic-session', binding, ready: Promise.resolve(binding), release() {} }),
    },
    uiConversation: { binding: () => ({ target: () => target }) },
    provide: (_name, value) => { model = value }, effect: run => { dispose = run() }, on: () => () => {},
  })
  await model.open('synthetic-chat')
  fixtureApi = { model, dispose: () => dispose(),
    lastSeq: () => seq,
    setRunning(value) { running = value; session.publish() },
    completePreparation() {
      removed = true
      session.publish()
      preparation.resolve({ ok: true, value: { prepared: true } })
    },
    recoverTools() {
      const recovery = new ToolCallRecovery()
      for (const entry of events) recovery.observe(entry.event)
      for (const event of recovery.results()) this.append(event.type, event.data, {
        surfaceOp: event.surfaceOp, sourceEventSeqs: event.sourceEventSeqs,
      })
    },
    append(type, data, extra = {}) {
      const event = { type, data, seq: ++seq, time: seq, ...extra }
      if (type !== 'assistant/live-chunk') {
        events.push({ type: 'event', event })
        outcomes = turnOutcomesProjection.apply(outcomes, event)
      }
      chat = official.append(event)
      target.publish(); eventSource.publish(); outcomesFace.publish()
      return chat
    },
  }
  return fixtureApi
}

describe('cancelled official Chat projection', () => {
  it.each(['reasoning-only', 'partial-final'])('retains an earlier interrupted %s floor throughout a later regeneration', async content => {
    const f = await fixture()
    const messages = () => f.model.getDetailsSnapshot().details.messages
    let stop
    try {
      f.setRunning(true)
      f.append('turn/start', { turn: 1 })
      f.append('step/start', { turn: 1, step: 1 })
      f.append('user/message', { id: 'synthetic-input-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '合成输入一' }] }, { surfaceOp: 'append' })
      f.append('assistant/message', { turn: 1, step: 1, stream: [], interrupted: true, message: {
        id: 'synthetic-interrupted-1', role: 'assistant', source: { provider: 'synthetic', model: 'synthetic' },
        content: content === 'reasoning-only'
          ? [{ type: 'reasoning', text: '合成中断过程' }]
          : [{ type: 'text', text: '<FINAL>合成中断正文' }],
      } }, { surfaceOp: 'append' })
      f.append('step/end', { turn: 1, step: 1 })
      f.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
      f.setRunning(false)
      const interrupted = messages().find(message => message.role === 'assistant')
      expect(interrupted.status).toBe('cancelled')

      f.setRunning(true)
      f.append('turn/start', { turn: 2 })
      f.append('step/start', { turn: 2, step: 1 })
      f.append('user/message', { id: 'synthetic-input-2', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '合成输入二' }] }, { surfaceOp: 'append' })
      const inputSeq = f.lastSeq()
      f.append('assistant/message', { turn: 2, step: 1, stream: [], message: {
        id: 'synthetic-assistant-2', role: 'assistant', source: { provider: 'synthetic', model: 'synthetic' },
        content: [{ type: 'text', text: '<FINAL>合成待重生成回复</FINAL>' }],
      } }, { surfaceOp: 'append' })
      f.append('step/end', { turn: 2, step: 1 })
      f.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      f.setRunning(false)
      const snapshots = []
      stop = f.model.subscribeChat(() => snapshots.push(messages()))
      const request = f.model.regenerate({ conversationId: 'synthetic-chat', requestId: 'synthetic-regeneration', eventSeq: inputSeq })
      await Promise.resolve()
      expect.soft(messages().find(message => message.renderKey === interrupted.renderKey))
        .toMatchObject({ sequence: interrupted.sequence, status: 'cancelled', process: interrupted.process })
      expect.soft(messages().some(message => message.displayContent === '合成待重生成回复')).toBe(false)
      f.completePreparation()
      await new Promise(resolve => setTimeout(resolve, 0))
      f.append('assistant/message', { turn: 3, step: 1, stream: [], message: {
        id: 'synthetic-assistant-3', role: 'assistant', source: { provider: 'synthetic', model: 'synthetic' },
        content: [{ type: 'text', text: '<FINAL>合成重生成回复</FINAL>' }],
      } }, { surfaceOp: 'append' })
      f.append('step/end', { turn: 3, step: 1 })
      f.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
      f.setRunning(false)
      await request
      expect(snapshots.every(snapshot => snapshot.some(message => message.renderKey === interrupted.renderKey
        && message.sequence === interrupted.sequence && message.status === 'cancelled'))).toBe(true)
      expect(messages().at(-1).displayContent).toBe('合成重生成回复')
    } finally { stop?.(); f.dispose() }
  })

  it.each(['preparing', 'started'])('does not revive %s tools or the interrupted old floor when the next turn starts', async stage => {
    const f = await fixture()
    try {
      f.setRunning(true)
      f.append('turn/start', { turn: 1 })
      f.append('step/start', { turn: 1, step: 1 })
      f.append('user/message', { id: 'synthetic-input-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '合成输入一' }] }, { surfaceOp: 'append' })
      f.append('assistant/live-chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } })
      f.append('assistant/live-chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '合成处理过程' } })
      for (const [index, name] of ['synthetic_read_settings', 'synthetic_read_variables'].entries()) {
        f.append('assistant/live-chunk', { turn: 1, step: 1,
          chunk: { type: 'tool-call-delta', index: index + 1, id: `synthetic-call-${index}`, name, argumentsDelta: '{}' } })
      }
      expect(f.model.getDetailsSnapshot().details.messages.at(-1).process.filter(item => item.kind === 'tool')).toHaveLength(2)
      if (stage === 'started') {
        f.append('assistant/message', { turn: 1, step: 1, stream: [], message: {
          id: 'synthetic-assistant-1', role: 'assistant', source: { provider: 'synthetic', model: 'synthetic' },
          content: [{ type: 'reasoning', text: '合成处理过程' }, ...['synthetic_read_settings', 'synthetic_read_variables']
            .map((name, index) => ({ type: 'tool-call', id: `synthetic-call-${index}`, name, arguments: '{}' }))],
        } }, { surfaceOp: 'append' })
        for (const [index, name] of ['synthetic_read_settings', 'synthetic_read_variables'].entries()) {
          f.append('tool/call', { turn: 1, step: 1, callId: `synthetic-call-${index}`, name, arguments: '{}' })
        }
        f.append('tool/result', { turn: 1, step: 1, message: { id: 'synthetic-tool-result', role: 'tool',
          toolCallId: 'synthetic-call-0', source: { kind: 'tool', callId: 'synthetic-call-0' },
          content: [{ type: 'text', text: '合成完成结果' }],
        } }, { surfaceOp: 'append' })
        f.recoverTools()
      }
      f.append('step/end', { turn: 1, step: 1 })
      const stopped = f.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
      if (stage === 'preparing') expect([...stopped.nodes.values()].filter(node => node.kind === 'tool-call'))
        .toMatchObject([{ visibility: 'hidden' }, { visibility: 'hidden' }])
      f.setRunning(false)
      const cancelled = f.model.getDetailsSnapshot().details.messages.find(message => message.role === 'assistant')
      expect.soft(cancelled.status).toBe('cancelled')
      expect.soft(cancelled.process.some(item => item.status === 'running')).toBe(false)
      if (stage === 'started') expect(cancelled.process.filter(item => item.kind === 'tool'))
        .toMatchObject([{ id: 'synthetic-call-0', status: 'complete' }, { id: 'synthetic-call-1', status: 'error' }])

      f.setRunning(true)
      expect.soft(f.model.getStreamSnapshot().status === 'running'
        && f.model.getStreamSnapshot().dshTurn === 1).toBe(false)
      f.append('turn/start', { turn: 2 })
      f.append('step/start', { turn: 2, step: 1 })
      f.append('user/message', { id: 'synthetic-input-2', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '合成输入二' }] }, { surfaceOp: 'append' })
      const nextInputSeq = f.lastSeq()
      f.append('assistant/live-chunk', { turn: 2, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
      f.append('assistant/live-chunk', { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '<FINAL>合成新回复' } })
      const messages = f.model.getDetailsSnapshot().details.messages
      expect.soft(messages.find(message => message.dshTurn === 1 && message.role === 'assistant'))
        .toMatchObject({ status: 'cancelled', process: cancelled.process })
      expect.soft(messages.filter(message => message.status === 'streaming'))
        .toMatchObject([{ role: 'assistant', dshTurn: 2 }])
      expect(messages.findIndex(message => message.role === 'assistant' && message.dshTurn === 1))
        .toBeLessThan(messages.findIndex(message => message.sessionEventSeq === nextInputSeq))
    } finally { f.dispose() }
  })
})
