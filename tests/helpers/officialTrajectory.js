import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as store from '@deepseek-ai/dsh-client-store'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import * as cordis from '@deepseek-ai/cordis'

const modules = {
  react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM,
  '@deepseek-ai/dsh-client-store': store,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
  '@deepseek-ai/dsh-client-ui-slots': slots,
  '@deepseek-ai/cordis': cordis,
}

// Exercise the installed Client bundles and their actual plugin registrations.
// Private engine inspection is confined to this test loader.
function loadClient(name, exposed = '') {
  const source = readFileSync(resolve(`node_modules/@deepseek-ai/${name}/lib/client.js`), 'utf8')
  if (source.split('return module.exports;').length !== 2) throw new Error('Unexpected Client bundle boundary')
  let registration
  runInNewContext(source.replace('return module.exports;', `return { ...module.exports${exposed} };`), {
    window: { __ModuleLoader__: { load: value => { registration = value } } },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  return registration.factory(name => {
    if (!(name in modules)) throw new Error(`Unexpected Client dependency: ${name}`)
    return modules[name]
  })
}

const conversation = loadClient('dsh-client-ui-conversation', ', ConversationNodeAssembler, inspectSystemPrompt, inspectRequestPrompt')
const trajectory = loadClient('dsh-client-ui-trajectory')

export function officialTrajectoryFixture() {
  const definitions = new Map()
  const views = new Map()
  trajectory.apply({
    effect() {}, locale: { bind: () => key => key },
    uiConversation: {
      events: { register: definition => definitions.set(definition.kind, definition) },
      views: { register: definition => views.set(definition.target, definition) },
      inspectSystemPrompt: conversation.inspectSystemPrompt,
      inspectRequestPrompt: conversation.inspectRequestPrompt,
    },
    uiSession: { provide() {} }, slots: { inject() {} },
  })
  const engine = new conversation.ConversationNodeAssembler(
    { entries: () => [...definitions.values()], fallbackEntry: () => undefined },
    { entries: () => [...views.values()] },
  )
  engine.activateTarget('trajectory')
  return {
    definitions,
    replace(events, hasMore = false) {
      engine.replaceWindow(events.map(event => ({ type: 'durable', event })), hasMore)
      engine.flush()
      return engine.snapshot('trajectory')
    },
    append(event) {
      engine.append({ type: event.type === 'assistant/live-chunk' ? 'transient' : 'durable', event })
      engine.flush()
      return engine.snapshot('trajectory')
    },
    prepend(events) {
      engine.prepend(events.map(event => ({ type: 'durable', event })), false)
      engine.flush()
      return engine.snapshot('trajectory')
    },
  }
}

export const trajectoryAssistantDefinition = officialTrajectoryFixture().definitions.get('trajectory-assistant-step')

export function officialChatFixture() {
  const chat = loadClient('dsh-client-ui-chat', ', registerConversationNodes')
  const definitions = new Map()
  const views = new Map()
  let fallback
  chat.registerConversationNodes({ uiConversation: {
    events: {
      register: definition => definitions.set(definition.kind, definition),
      registerFallback: definition => { fallback = definition },
    },
    views: { register: definition => views.set(definition.target, definition) },
    groups: { register() {} },
  } })
  const engine = new conversation.ConversationNodeAssembler(
    { entries: () => [...definitions.values()], fallbackEntry: () => fallback },
    { entries: () => [...views.values()] },
  )
  engine.activateTarget('chat')
  return {
    replace(events) {
      engine.replaceWindow(events.map(event => ({ type: 'durable', event })), false)
      engine.flush()
      return engine.snapshot('chat')
    },
    append(event) {
      engine.append({ type: event.type === 'assistant/live-chunk' ? 'transient' : 'durable', event })
      engine.flush()
      return engine.snapshot('chat')
    },
  }
}
