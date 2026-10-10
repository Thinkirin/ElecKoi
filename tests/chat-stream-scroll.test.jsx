// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView, chatFixture, userNode, turnNode } from './helpers/officialChatView.jsx'
import { MessageList } from './helpers/officialMarkdown.jsx'
import { selectRoleplayChatSeat, selectRoleplayPendingInput } from '../apps/web/src/modules/chat/model/chatViewSeats.js'

let observers
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  observers = new Set()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback }
    observe() { observers.add(this.callback) }
    disconnect() { observers.delete(this.callback) }
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function mountChat(sessionId = 'session-render', fixture = chatFixture(sessionId)) {
  const scroller = document.createElement('div')
  scroller.dataset.conversationScroll = ''
  document.body.append(scroller)
  let height = 1000
  Object.defineProperties(scroller, {
    clientHeight: { get: () => 200 }, scrollHeight: { get: () => height },
    scrollTop: { writable: true, value: 800 },
  })
  scroller.scrollTo = ({ top }) => { scroller.scrollTop = top }
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200 })
  const root = createRoot(scroller)
  let messages = []
  const rowProps = {
    conversationId: 'chat-test', layoutMode: 'roleplay', profile: { reply_spacing: 10, turn_spacing: 10 },
    avatarShape: 'portrait', userName: '用户', assistantName: '合成角色',
    userAvatar: '', assistantAvatar: '', showRoleplayTimestamp: true, showRoleplayFloor: true,
    runtimeSessionId: sessionId, onRegenerate: vi.fn(),
  }
  const renderSlot = (name, owner, options) => {
    if (name === 'conversation.chat.node') {
      const seat = selectRoleplayChatSeat(messages, sessionId, owner.node)
      return seat ? <MessageList {...rowProps} messages={messages} seat={seat} officialNode />
        : seat === undefined ? options?.fallback ?? null : null
    }
    if (name === 'conversation.chat.pending-input') return <MessageList {...rowProps} messages={messages}
      seat={selectRoleplayPendingInput(messages, sessionId, owner.input)} />
    return options?.fallback ?? null
  }
  return { fixture, scroller, root,
    async render(nextMessages = messages, next = {}) {
      messages = nextMessages
      await act(async () => { fixture.update(next); root.render(<ChatView {...fixture.props} renderSlot={renderSlot} />) })
    },
    async grow() { await act(async () => { height += 40; for (const callback of observers) callback([]) }) },
    async move(top, end = false) { await act(async () => {
      scroller.dispatchEvent(new Event('wheel'))
      scroller.scrollTop = top
      scroller.dispatchEvent(new Event('scroll'))
      if (end) scroller.dispatchEvent(new Event('scrollend'))
    }) },
    async close() { await act(async () => root.unmount()); expect(fixture.listeners.size).toBe(0) },
  }
}

describe('official ChatView with roleplay presentation', () => {
  it('does not insert a history-loading row into the message flow during resync', async () => {
    const fixture = chatFixture()
    const input = userNode('input-stable', 3, 'request-stable')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        fixture.update({ order: [input.key], nodes: new Map([[input.key, input]]) })
        root.render(<ChatView {...fixture.props} />)
      })
      const row = host.querySelector('[data-chat-node-key="input-stable"]')
      const before = host.querySelector('[data-chat-column]').childElementCount
      await act(async () => fixture.update({ session: { ...fixture.state.session, openState: 'loading' } }))
      expect(host.textContent).not.toContain('chat.loadingHistory')
      expect(host.querySelector('[data-chat-column]').childElementCount).toBe(before)
      expect(host.querySelector('[data-chat-node-key="input-stable"]')).toBe(row)
      await act(async () => fixture.update({ session: { ...fixture.state.session, openState: 'error',
        openError: { message: 'synthetic failure', code: 'TEST' } } }))
      expect(host.textContent).toContain('chat.loadError')
    } finally { await act(async () => root.unmount()) }
  })

  it('portals the official running timer into a stable composer seat across regenerated turns', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10000)
    const fixture = chatFixture()
    fixture.props.t = (key, values) => key + (values ? JSON.stringify(values) : '')
    const host = document.createElement('div')
    const runningSeat = document.createElement('div')
    runningSeat.dataset.chatRunningSeat = ''
    const composer = document.createElement('div')
    composer.dataset.composer = ''
    document.body.append(host, runningSeat, composer)
    const root = createRoot(host)
    const input = userNode('input-1', 3, 'original-request')
    const opened = turn => {
      const node = turnNode(`control-${turn}`, turn)
      node.location.turn.start = { time: Date.now() }
      return node
    }
    const publish = async turn => {
      const node = opened(turn)
      await act(async () => {
        fixture.update({ order: [input.key, node.key], nodes: new Map([[input.key, input], [node.key, node]]),
          rail: [{ anchorKey: node.key, turn: node.location.turn }], session: { ...fixture.state.session, running: true } })
        root.render(<ChatView {...fixture.props} runningStatusTarget={runningSeat} />)
      })
    }
    try {
      await publish(2)
      expect(host.querySelector('[data-chat-running]')).toBeNull()
      expect(runningSeat.querySelector('[data-chat-running]')).not.toBeNull()
      await act(async () => vi.advanceTimersByTime(2100))
      expect(runningSeat.textContent).toContain('chat.deepDivingFor')
      const timer = runningSeat.textContent
      await act(async () => {
        fixture.update({ session: { ...fixture.state.session, running: false } })
      })
      expect(runningSeat.textContent).toBe('')
      await publish(3)
      await act(async () => vi.advanceTimersByTime(3200))
      expect(runningSeat.textContent).not.toBe(timer)
      expect(runningSeat.nextElementSibling).toBe(composer)
      expect(host.querySelector('[data-chat-node-key="input-1"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('retires only the matching echo when the durable input arrives before product metadata', async () => {
    const chat = mountChat()
    const pending = { requestId: 'request-one', placement: 'transcript', time: 1, text: '合成输入', attachments: [] }
    const control = turnNode('control-1', 1)
    try {
      await chat.render([], { order: [control.key], nodes: new Map([[control.key, control]]),
        session: { ...chat.fixture.state.session, running: true, pendingSubmissions: [pending] } })
      expect(chat.scroller.textContent.match(/合成输入/g)).toHaveLength(1)
      const input = userNode('input-1', 1, pending.requestId)
      await chat.render([], { order: [input.key, control.key], nodes: new Map([[input.key, input], [control.key, control]]) })
      expect(chat.scroller.textContent.match(/合成输入/g)).toHaveLength(1)
      expect(chat.scroller.querySelector('[data-chat-node-key="input-1"]')).not.toBeNull()
      await chat.render([], { session: { ...chat.fixture.state.session, pendingSubmissions: [] } })
      expect(chat.scroller.textContent.match(/合成输入/g)).toHaveLength(1)
    } finally { await chat.close() }
  })

  it('keeps the same AI seat through streaming settlement and deletion followed by regeneration', async () => {
    const chat = mountChat()
    const input = userNode('input-1', 1, 'request-one')
    const control = turnNode('control-1', 1)
    const user = { id: 'product-input', runtimeSessionId: 'session-render', sessionEventSeq: 1, role: 'user', content: '合成输入', created_at: '2026-01-01T00:00:00.000Z' }
    const reply = { id: 'reply-live', runtimeSessionId: 'session-render', renderKey: 'dsh-reply-session-render-1', role: 'assistant', pending: true, content: '合成回复', created_at: '2026-01-01T00:00:01.000Z' }
    try {
      await chat.render([user, reply], { order: [input.key, control.key], nodes: new Map([[input.key, input], [control.key, control]]) })
      const aiRow = chat.scroller.querySelector('[data-chat-node-key="control-1"] .message-flow-row')
      await chat.render([user, { ...reply, id: 'reply-durable', pending: false, sessionEventSeq: 9 }], {
        nodes: new Map([[input.key, input], [control.key, turnNode(control.key, 1, 'closed')]]) })
      expect(chat.scroller.querySelector('[data-chat-node-key="control-1"] .message-flow-row')).toBe(aiRow)
      expect(chat.scroller.textContent).toContain('合成回复')
      expect(chat.scroller.querySelector('[data-chat-node-key="control-1"] time').dateTime).toBe(reply.created_at)
      expect(chat.scroller.querySelector('[data-chat-node-key="control-1"]').textContent).toContain('#1')
      await chat.render([user], { order: [input.key], nodes: new Map([[input.key, input]]) })
      expect(chat.scroller.textContent).not.toContain('合成回复')
      await chat.render([user, { ...reply, content: '重新生成正文' }], {
        order: [input.key, control.key], nodes: new Map([[input.key, input], [control.key, control]]) })
      await chat.render([user, { ...reply, content: '重新生成正文', pending: false }], {
        nodes: new Map([[input.key, input], [control.key, turnNode(control.key, 1, 'closed')]]) })
      expect(chat.scroller.textContent).toContain('合成输入')
      expect(chat.scroller.textContent).toContain('重新生成正文')
      await chat.render([], { order: [], nodes: new Map() })
      expect(chat.scroller.textContent).not.toContain('重新生成正文')
      const nextInput = userNode('input-2', 10, 'request-two', 2, '下一条输入')
      const nextControl = turnNode('control-2', 2)
      const nextReply = { ...reply, renderKey: 'dsh-reply-session-render-2', content: '下一条回复' }
      await chat.render([nextReply], { order: [nextInput.key, nextControl.key],
        nodes: new Map([[nextInput.key, nextInput], [nextControl.key, nextControl]]) })
      await chat.render([{ ...nextReply, pending: false }])
      expect(chat.scroller.textContent).toContain('下一条输入')
      expect(chat.scroller.textContent).toContain('下一条回复')
    } finally { await chat.close() }
  })

  it('uses official 500ms sampling, protects unsampled reading during growth, and resumes for new input', async () => {
    vi.useFakeTimers()
    const chat = mountChat()
    try {
      await chat.render()
      await chat.move(520)
      await chat.grow()
      expect(chat.scroller.scrollTop).toBe(520)
      await act(async () => vi.advanceTimersByTime(499))
      expect(chat.scroller.querySelector('[data-chat-following-tail]')).not.toBeNull()
      await act(async () => vi.advanceTimersByTime(1))
      expect(chat.scroller.querySelector('[data-chat-following-tail]')).toBeNull()
      await chat.grow()
      expect(chat.scroller.scrollTop).toBe(520)
      const input = userNode('input-new', 1, 'request-new')
      await chat.render([], { order: [input.key], nodes: new Map([[input.key, input]]) })
      expect(chat.scroller.querySelector('[data-chat-following-tail]')).not.toBeNull()
      expect(chat.scroller.scrollTop).toBe(880)
    } finally { await chat.close() }
  })

  it('retains official 25px tolerance and flushes sampling at native scrollend', async () => {
    vi.useFakeTimers()
    const chat = mountChat()
    try {
      await chat.render()
      await chat.move(775, true)
      expect(chat.scroller.querySelector('[data-chat-following-tail]')).not.toBeNull()
      await chat.move(774, true)
      expect(chat.scroller.querySelector('[data-chat-following-tail]')).toBeNull()
      const button = chat.scroller.querySelector('[aria-label="chat.toBottom"]')
      expect(button).not.toBeNull()
      await act(async () => button.click())
      expect(chat.scroller.querySelector('[data-chat-following-tail]')).not.toBeNull()
      expect(chat.scroller.scrollTop).toBe(800)
    } finally { await chat.close() }
  })

  it('preserves the official first-row anchor when an older page is prepended', async () => {
    const chat = mountChat()
    const current = userNode('current-input', 20, 'request-current')
    const older = userNode('older-input', 1, 'request-older')
    const positions = new Map([[current.key, 200], [older.key, 200]])
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = (positions.get(this.dataset.chatAnchorKey) ?? 0) - chat.scroller.scrollTop
      return { top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 }
    })
    const loadOlder = vi.fn()
    chat.fixture.props.loadOlder = loadOlder
    try {
      await chat.render([], { order: [current.key], nodes: new Map([[current.key, current]]),
        session: { ...chat.fixture.state.session, hasMore: true } })
      await chat.move(120, true)
      await act(async () => chat.scroller.querySelector('[data-chat-column] > div > button').click())
      expect(loadOlder).toHaveBeenCalledOnce()
      positions.set(current.key, 400)
      await chat.render([], { order: [older.key, current.key], nodes: new Map([[older.key, older], [current.key, current]]) })
      expect(chat.scroller.scrollTop).toBe(320)
      expect(chat.fixture.saved).toMatchObject({ anchorKey: current.key, anchorTop: 80, scrollTop: 320 })
    } finally { await chat.close(); geometry.mockRestore() }
  })

  it('restores Session-owned reading memory without inheriting another Session position', async () => {
    const first = mountChat('session-a')
    const input = userNode('input-a', 1, 'request-a')
    try {
      await first.render([], { order: [input.key], nodes: new Map([[input.key, input]]) })
      await first.move(320, true)
      expect(first.fixture.saved.scrollTop).toBe(320)
    } finally { await first.close() }
    const second = mountChat('session-b')
    try { await second.render(); expect(second.scroller.scrollTop).toBe(800) }
    finally { await second.close() }
    const restored = mountChat('session-a', first.fixture)
    try {
      await restored.render([], { order: [], nodes: new Map() })
      expect(restored.scroller.scrollTop).toBe(320)
      expect(restored.scroller.querySelector('[data-chat-following-tail]')).toBeNull()
    } finally { await restored.close() }
    expect(observers.size).toBe(0)
  })

  it('uses exact Session/Turn identities even with identical content and keeps Inbox timestamps absent', () => {
    const node = turnNode('control', 1)
    const messages = [{ runtimeSessionId: 'session-other', renderKey: 'dsh-reply-session-render-1', role: 'assistant', content: '相同内容' }]
    expect(selectRoleplayChatSeat(messages, 'session-render', node)).toBeNull()
    expect(selectRoleplayChatSeat(messages, 'session-render', turnNode('control', 2))).toBeNull()
    const pending = selectRoleplayPendingInput([], 'session-render', {
      id: 'inbox-input', source: { kind: 'user', rpcId: 'request-inbox' }, content: [{ type: 'text', text: '待处理输入' }],
    })
    expect(pending.item.created_at).toBeUndefined()
    expect(pending.item.content).toBe('待处理输入')
    const image = { attachmentId: 'image-synthetic', name: '合成图片', width: 20, height: 20 }
    const user = userNode('image-input', 1, 'request-image')
    user.data.content.push({ type: 'image', attachment: image })
    expect(selectRoleplayChatSeat([], 'session-render', user).item.inputImageAttachments).toEqual([image])
    const echo = selectRoleplayPendingInput([], 'session-render', {
      requestId: 'request-local', placement: 'transcript', time: 1, text: '',
      attachments: [{ type: 'image', value: { previewUrl: 'blob:synthetic', width: 20, height: 20 } }],
    })
    expect(echo.item.inputImageAttachments[0]).toMatchObject({ attachmentId: 'pending-request-local-0', previewUrl: 'blob:synthetic', width: 20 })
  })
})
