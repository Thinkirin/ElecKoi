import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as Cordis from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

import { TYPERT_REMOTE } from '@eleckoi/dsh-product-api/remote'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { RequestPreviewStore } from '../packages/dsh-client-roleplay/src/host/request-preview.mjs'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
function clientPlugin(path, modules, expose = false) {
  let entry
  const source = readFileSync(path, 'utf8')
  runInNewContext(expose ? source.replace('return { inject:', 'return { ConversationCatalog, inject:') : source, {
    window: { __ModuleLoader__: { load(value) { entry = value } } },
    crypto: globalThis.crypto, AbortController, AbortSignal, Error, setTimeout, clearTimeout,
  })
  return entry.factory(name => {
    if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected client dependency: ${name}`)
    return modules[name]
  })
}

describe('request preview through the official Client Remote', () => {
  it('invokes the generated namespace from the real Cordis consumer scope', async () => {
    const ctx = new Cordis.Context()
    const items = [{ order: 1, messageId: 'synthetic-input', role: 'user', kind: 'user',
      title: '合成输入', source: '合成来源', anchor: '', content: '合成上下文' }]
    const call = vi.fn(async () => ({ ok: true, value: { id: 'synthetic-request', items } }))
    const previews = new RequestPreviewStore()
    const session = Session.create(SessionId('synthetic-session'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '合成输入' }] }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    const open = vi.fn((_base, _endpoint, _payload, signal) => previews.stream(session.id, signal))
    const controller = new AbortController()
    let observing
    try {
      await ctx.plugin(TypertRegistry)
      ctx.provide('connection', {
        rpc: { call, open },
        registerGenerationSource: () => () => {}, start: () => ({ stop() {} }),
      })
      await ctx.plugin(clientPlugin(require.resolve('@deepseek-ai/dsh-api-gateway/client'), { '@deepseek-ai/cordis': Cordis }))
      await ctx.remote.$mount(TYPERT_REMOTE)
      const client = clientPlugin(new URL('../packages/dsh-client-conversations/src/client.js', import.meta.url), {
        react: { lazy: () => () => null }
      }, true)
      let catalog
      await ctx.plugin({ inject: client.inject.filter(name => name === 'remote' || name === 'remote.eleckoiConversations'), apply(consumer) {
        catalog = new client.ConversationCatalog(consumer.remote)
      } })
      const signal = new AbortController().signal
      await expect(catalog.readRequestPreview('synthetic-conversation', 'synthetic-request', signal)).resolves.toEqual({ id: 'synthetic-request', items })
      expect(call).toHaveBeenCalledExactlyOnceWith('/api', 'eleckoiConversations/requestPreview',
        { args: { conversationId: 'synthetic-conversation', requestId: 'synthetic-request' } }, expect.any(AbortSignal))
      const frames = []
      let first, update
      const initial = new Promise(resolve => { first = resolve })
      const next = new Promise(resolve => { update = resolve })
      observing = catalog.observeRequestPreviews('synthetic-conversation', value => {
        frames.push(value)
        if (frames.length === 1) first()
        else update()
      }, controller.signal)
      await initial
      const options = { provider: 'synthetic', model: 'synthetic', messages: session.deriveMessages() }
      const captured = previews.capture(session, options, [], { round: 1, turn: 1, step: 1 })
      await next
      expect(frames).toEqual([[], [captured]])
      expect(open).toHaveBeenCalledExactlyOnceWith('/api', 'eleckoiConversations/requestPreviews',
        { args: { conversationId: 'synthetic-conversation' } }, expect.any(AbortSignal), expect.any(Object))
      controller.abort()
      await observing
      expect(open.mock.calls[0][3].aborted).toBe(true)
      previews.capture(session, options, [], { round: 1, turn: 1, step: 1 })
      expect(previews.list(session.id)).toHaveLength(2)
    } finally { controller.abort(); await observing?.catch(() => {}); previews.close(); await ctx.fiber.dispose() }
  })
})
