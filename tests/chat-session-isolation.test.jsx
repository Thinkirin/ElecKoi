// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useChatSessions } from '../apps/web/src/modules/chat/hooks/useChatSessions.js'

describe('conversation display ownership', () => {
  it('keeps the selected conversation and its opening together during repeated switches and delayed display projection', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const conversations = ['a', 'b'].map(key => ({
      id: `conversation-${key}`, title: `会话 ${key.toUpperCase()}`,
      runtimeSessionId: `session-${key}`, metadata: { characterId: `synthetic-${key}` },
    }))
    const catalog = { status: 'ready', items: conversations, error: '' }
    const makeDetails = (key, projected) => {
      const conversation = conversations.find(item => item.id === `conversation-${key}`)
      const content = `合成开场 ${key.toUpperCase()}`
      const displayContent = projected
        ? `<!-- eleckoi:rich-replacement:start --><section>合成展示 ${key.toUpperCase()}</section><!-- eleckoi:rich-replacement:end -->`
        : content
      return {
        conversation, metadata: conversation.metadata, runtimeSessionId: conversation.runtimeSessionId,
        messages: [{ id: 'opening', conversationId: conversation.id, runtimeSessionId: conversation.runtimeSessionId,
          role: 'assistant', content, displayContent, status: 'complete', sequence: 0 }],
        hasMore: false, beforeSequence: null,
      }
    }
    let snapshot
    const listeners = new Set()
    const publish = (key, projected) => {
      const details = makeDetails(key, projected)
      snapshot = {
        details: { id: details.conversation.id, status: 'ready', details },
        stream: { id: details.conversation.id, status: 'idle', content: '', process: [] },
      }
      for (const listener of listeners) listener()
    }
    publish('a', true)
    const model = {
      getSnapshot: () => catalog, subscribe: () => () => {},
      getDetailsSnapshot: () => snapshot.details, getChatSnapshot: () => snapshot,
      subscribeChat: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      refresh: async () => catalog.items,
      readModelSelection: async () => ({ provider: '', model: '' }),
      open: async id => {
        publish(id === 'conversation-a' ? 'a' : 'b', false)
        return snapshot.details.details
      },
    }
    const props = { conversations: model, characters: [], modelConfigs: [],
      setStatus: vi.fn(), setActiveSectionState: vi.fn(), notify: vi.fn() }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let chat
    function Probe() {
      chat = useChatSessions(props)
      return <div>
        <h1>{chat.currentTitle}</h1>
        {chat.messages.map(item => <p key={item.renderKey || item.id}>{item.displayContent}</p>)}
      </div>
    }
    try {
      await act(async () => root.render(<Probe />))
      expect(container.querySelector('p').textContent).toContain('合成展示 A')
      for (const key of ['b', 'a', 'b', 'a']) {
        await act(async () => chat.loadChat(`conversation-${key}`))
        expect(container.querySelector('h1').textContent).toBe(`会话 ${key.toUpperCase()}`)
        expect(container.querySelector('p').textContent).toBe(`合成开场 ${key.toUpperCase()}`)
        // Display projection arrives after the raw Session/product snapshot.
        await act(async () => publish(key, true))
        expect(container.querySelector('p').textContent).toBe(makeDetails(key, true).messages[0].displayContent)
        expect(chat.messages[0].conversationId).toBe(chat.sessionId)
        expect(chat.messages[0].runtimeSessionId).toBe(chat.runtimeSessionId)
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
