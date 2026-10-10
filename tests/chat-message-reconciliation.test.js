import { describe, expect, it } from 'vitest'
import { mergeProcessItems, preserveMessageRenderKeys, preservePendingUser } from '../apps/web/src/modules/chat/hooks/useConversationMessages.js'

describe('chat message reconciliation', () => {
  it.each([
    ['conversation', 'conversation-b', 'session-a'],
    ['runtime Session', 'conversation-a', 'session-b'],
  ])('does not carry an opening display across a different %s', (_scope, conversationId, runtimeSessionId) => {
    const current = [{
      id: 'opening', conversationId: 'conversation-a', runtimeSessionId: 'session-a',
      role: 'assistant', content: '合成开场 A',
      displayContent: '<!-- eleckoi:rich-replacement:start --><section>合成展示 A</section><!-- eleckoi:rich-replacement:end -->',
      renderKey: 'opening-a', process: [{ id: 'process-a', status: 'complete' }],
    }]
    const incoming = [{
      id: 'opening', conversationId, runtimeSessionId,
      role: 'assistant', content: '合成开场 B', displayContent: '合成开场 B',
    }]

    expect(preserveMessageRenderKeys(current, incoming)).toEqual(incoming)
  })

  it('does not match a reused request id outside its conversation', () => {
    const current = [{ id: 'local-a', conversationId: 'conversation-a', requestId: 'request-1', role: 'user' }]
    const incoming = [{ id: 'user-b', conversationId: 'conversation-b', requestId: 'request-1', role: 'user' }]
    expect(preserveMessageRenderKeys(current, incoming)).toEqual(incoming)
  })

  it('keeps optimistic image and streaming reply nodes mounted when durable ids arrive', () => {
    const current = [{
      id: 'local-1',
      requestId: 'request-1',
      role: 'user',
      content: '这是谁',
      inputImageAttachments: [{ localId: 'draft-image-1', dataUrl: 'data:image/png;base64,draft' }]
    }]
    const pending = { id: 'pending-1', runtimeSessionId: 'session-1', renderKey: 'dsh-reply-session-1-1', role: 'assistant', content: '识别结果', pending: true }
    const incoming = [{
      id: 'user-1',
      requestId: 'request-1',
      sequence: 1,
      role: 'user',
      content: '这是谁',
      inputImageAttachments: [{ attachmentId: 'sha256:image-1', mediaType: 'image/png' }]
    }, {
      id: 'assistant-1',
      runtimeSessionId: 'session-1', renderKey: 'dsh-reply-session-1-1',
      sequence: 2,
      role: 'assistant',
      content: '识别结果',
      pending: false
    }]

    expect(preserveMessageRenderKeys(current, incoming, pending)).toEqual([
      expect.objectContaining({
        id: 'user-1',
        renderKey: 'local-1',
        inputImageAttachments: [expect.objectContaining({
          attachmentId: 'sha256:image-1',
          renderKey: 'draft-image-1'
        })]
      }),
      expect.objectContaining({ id: 'assistant-1', renderKey: 'dsh-reply-session-1-1', pending: false })
    ])
  })

  it('does not reuse an optimistic user key for a different durable message', () => {
    const current = [{ id: 'local-1', role: 'user', content: '第一条', inputImageAttachments: [] }]
    const incoming = [{ id: 'user-2', role: 'user', content: '第二条', inputImageAttachments: [] }]

    expect(preserveMessageRenderKeys(current, incoming)).toEqual(incoming)
  })

  it('preserves the same user row identity when its durable content is edited', () => {
    const previous = [{ id: 'user-one', sessionEventSeq: 12, role: 'user', content: '合成输入' }]
    const incoming = [{ ...previous[0], content: '合成编辑输入' }]
    expect(preserveMessageRenderKeys(previous, incoming)).toMatchObject(incoming)
    expect(preservePendingUser(previous, incoming, previous[0])).toEqual(incoming)
  })

  it('keeps live process events when the durable reply arrives one update behind', () => {
    const pending = {
      id: 'pending-1',
      runtimeSessionId: 'session-1', renderKey: 'dsh-reply-session-1-1',
      role: 'assistant',
      content: '完成',
      pending: true,
      process: [
        { id: 'reasoning-1', kind: 'reasoning', status: 'complete', detail: '完整思考' },
        { id: 'tool-1', kind: 'tool', status: 'complete', summary: '已读取' },
        { id: 'tool-2', kind: 'tool', status: 'complete', summary: '已搜索' },
      ],
    }
    const incoming = [{
      id: 'assistant-1',
      runtimeSessionId: 'session-1', renderKey: 'dsh-reply-session-1-1',
      role: 'assistant',
      content: '完成',
      status: 'complete',
      process: [
        { id: 'reasoning-1', kind: 'reasoning', status: 'running', detail: '完整' },
        { id: 'tool-1', kind: 'tool', status: 'complete', summary: '已读取' },
      ],
    }]

    const [message] = preserveMessageRenderKeys([], incoming, pending)
    expect(message.renderKey).toBe('dsh-reply-session-1-1')
    expect(message.process.map((item) => item.id)).toEqual(['reasoning-1', 'tool-1', 'tool-2'])
    expect(message.process[0]).toMatchObject({ status: 'complete', detail: '完整思考' })
  })

  it('keeps a settled rich display while rewind briefly reopens the same assistant step', () => {
    const current = [{
      id: 'assistant-rich',
      role: 'assistant',
      content: '<FINAL>card source</FINAL>',
      displayContent: '<!-- eleckoi:rich-replacement:start --><section>card</section><!-- eleckoi:rich-replacement:end -->',
      status: 'complete',
      pending: false,
      renderKey: 'dsh-reply-turn-2',
    }]
    const reopened = [{
      ...current[0],
      displayContent: current[0].content,
      status: 'complete',
      pending: false,
    }]

    expect(preserveMessageRenderKeys(current, reopened)[0]).toMatchObject({
      displayContent: current[0].displayContent,
      status: 'complete',
      pending: false,
      renderKey: 'dsh-reply-turn-2',
    })
  })

  it('keeps the rich display when the transient projection normalizes source text', () => {
    const current = [{
      id: 'assistant-rich-normalized',
      role: 'assistant',
      content: '<FINAL>card source with markers</FINAL>',
      displayContent: '<!-- eleckoi:rich-replacement:start --><section>card</section><!-- eleckoi:rich-replacement:end -->',
      status: 'complete',
      pending: false,
    }]
    const transientProjection = [{
      id: 'assistant-rich-normalized',
      role: 'assistant',
      content: '<FINAL>card source</FINAL>',
      displayContent: 'card source',
      status: 'complete',
      pending: false,
    }]

    expect(preserveMessageRenderKeys(current, transientProjection)[0]).toMatchObject({
      content: transientProjection[0].content,
      displayContent: current[0].displayContent,
      status: 'complete',
      pending: false,
    })
  })

  it('adds newly persisted process events without dropping live-only events', () => {
    const merged = mergeProcessItems(
      [{ id: 'live', kind: 'tool', status: 'complete' }],
      [{ id: 'saved', kind: 'tool', status: 'complete' }],
    )
    expect(merged.map((item) => item.id)).toEqual(['live', 'saved'])
  })

  it('never pairs equal user text or unrelated assistants by role', () => {
    const current = [
      { id: 'local-1', requestId: 'request-old', role: 'user', content: '重复输入' },
      { id: 'live-old', runtimeSessionId: 'session-1', renderKey: 'dsh-reply-session-1-1', role: 'assistant', pending: true, process: [{ id: 'old-trace' }] },
    ]
    const incoming = [
      { id: 'user-new', requestId: 'request-new', role: 'user', content: '重复输入' },
      { id: 'reply-new', runtimeSessionId: 'session-1', renderKey: 'dsh-reply-session-1-2', role: 'assistant', content: '回复' },
    ]
    expect(preserveMessageRenderKeys(current, incoming)).toEqual(incoming)
    expect(preservePendingUser(current, incoming, current[0])).toEqual([current[0], ...incoming])
  })
})
