import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { mapChatDetails } from '../apps/web/src/modules/chat/api/chatApi.js'

const source = readFileSync(new URL('../packages/dsh-client-conversations/src/client.js', import.meta.url), 'utf8')

async function fixture() {
  const listeners = new Map()
  const controls = { openState: 'open', running: false, removed: false, pendingSubmissions: [] }
  const identities = { inputs: [], links: [] }
  const inbox = { 'next-turn': [], 'next-step': [] }
  const session = {
    getSnapshot: () => controls,
    subscribe: listener => { listeners.set('session', listener); return () => {} },
    projections: { faceOf: key => ({
      getSnapshot: () => key === 'eleckoiInputContinuations' ? identities : key === 'inbox' ? inbox : undefined,
      subscribe: listener => { listeners.set(key, listener); return () => {} },
    }) },
  }
  // The visible page intentionally has no user node. Permission comes from
  // the complete input projection, not the paginated transcript.
  const target = { getSnapshot: () => ({ nodes: new Map(), order: [], timeline: { turns: new Map() } }),
    subscribe: listener => { listeners.set('target', listener); return () => {} } }
  const binding = { session, eventSource: { getSnapshot: () => ({ hasMore: true, entries: [] }) } }
  const conversation = { id: 'synthetic-chat', runtimeSessionId: 'synthetic-session' }
  const details = { conversation, metadata: {}, runtimeSessionId: conversation.runtimeSessionId,
    messages: [{ id: 'opening', role: 'assistant', content: '合成开场', status: 'complete',
      selectedOpeningId: 'entry-a', openingOptions: [{ id: 'entry-a', content: '合成开场' }, { id: 'entry-b', content: '合成备用开场' }] }],
    hasMore: false, beforeSequence: null }
  let registration, model, cleanup
  runInNewContext(source, { AbortController, window: { __ModuleLoader__: { load: value => { registration = value } } } })
  dshClientPlugin(registration).apply({
    remote: { eleckoiConversations: {
      changes: async function* (signal) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) },
      list: async () => ({ ok: true, value: [conversation] }),
      details: async () => ({ ok: true, value: details }),
    } },
    sessions: { list: { getSnapshot: () => ({ byId: { 'synthetic-session': {} } }) },
      retain: () => ({ sessionId: conversation.runtimeSessionId, binding, ready: Promise.resolve(binding), release() {} }) },
    uiConversation: { binding: () => ({ target: () => target }) },
    provide: (_name, value) => { model = value }, effect: run => { cleanup = run() }, on: () => () => {},
  })
  await model.open(conversation.id)
  return { model, controls, identities, inbox, cleanup,
    publish: key => listeners.get(key)?.(),
    allowed: () => mapChatDetails(model.getDetailsSnapshot().details).messages[0].canChangeOpening }
}

describe('opening permissions from complete DSH projections', () => {
  it('locks the opening immediately on pending submission, running and queue changes', async () => {
    const f = await fixture()
    try {
      expect(f.allowed()).toBe(true)
      f.controls.pendingSubmissions = [{ requestId: 'synthetic-request' }]
      f.publish('session')
      expect(f.allowed()).toBe(false)
      f.controls.pendingSubmissions = []
      f.controls.running = true
      f.publish('session')
      expect(f.allowed()).toBe(false)
      f.controls.running = false
      f.inbox['next-turn'].push({ id: 'synthetic-input' })
      f.publish('inbox')
      expect(f.allowed()).toBe(false)
      f.inbox['next-turn'] = []
      f.publish('inbox')
      expect(f.allowed()).toBe(true)
    } finally { f.cleanup() }
  })

  it('stays locked for unloaded user inputs, edits and regeneration on the same event identity', async () => {
    const f = await fixture()
    try {
      f.identities.inputs.push({ turn: 1, eventSeq: 2, messageId: 'synthetic-input' })
      f.publish('eleckoiInputContinuations')
      expect(f.allowed()).toBe(false)
      f.identities.links.push({ turn: 2, inputEventSeq: 2, inputMessageId: 'synthetic-input' })
      f.publish('eleckoiInputContinuations')
      await f.model.refreshDetails()
      expect(f.allowed()).toBe(false)
      expect(f.model.getDetailsSnapshot().details.messages.map(message => message.id)).toEqual(['opening'])
    } finally { f.cleanup() }
  })

  it('does not enable controls while Session history is opening', async () => {
    const f = await fixture()
    try {
      f.controls.openState = 'loading'
      f.publish('session')
      expect(f.allowed()).toBe(false)
      f.controls.openState = 'open'
      f.publish('session')
      expect(f.allowed()).toBe(true)
    } finally { f.cleanup() }
  })
})
