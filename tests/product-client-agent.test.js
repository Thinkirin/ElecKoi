import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('Renderer Agent request tracking', () => {
  it('releases the composer immediately while cancellation continues in the background', async () => {
    const cancel = vi.fn(async () => ({ cancelled: true }))
    const { stopChatMessageSend } = await import('../apps/web/src/modules/chat/hooks/chatMessageSend.js')
    const activeRequest = {
      controller: { abort: vi.fn() },
      requestId: 'request-1',
    }
    const requestRef = { current: activeRequest }
    const setIsSending = vi.fn()
    const setStatus = vi.fn()

    expect(stopChatMessageSend({
      requestRef,
      setIsSending,
      setStatus,
      cancelRequest: cancel,
    })).toBe(true)
    expect(requestRef.current).toBeNull()
    expect(activeRequest.controller.abort).toHaveBeenCalledOnce()
    expect(setIsSending).toHaveBeenCalledWith(false)
    expect(cancel).toHaveBeenCalledWith('request-1')
    expect(setStatus).toHaveBeenCalledWith('已停止')
  })

  it('requests older chat pages through the DSH conversation model and keeps message sequence metadata', async () => {
    const model = {
      pageOlder: vi.fn(async (conversationId, beforeSequence) => {
        expect(conversationId).toBe('conversation-1')
        expect(beforeSequence).toBe(50)
        return {
        messages: [{
          id: 'message-1',
          conversationId: 'conversation-1',
          role: 'user',
          content: '较早消息',
          status: 'complete',
          createdAt: '2026-09-10T00:00:00.000Z',
          sequence: 10,
        }],
        hasMore: true,
        beforeSequence: 10,
      }
      }),
    }
    const { getChatMessages } = await import('../apps/web/src/modules/chat/api/chatApi.js')

    await expect(getChatMessages('conversation-1', { beforeSequence: 50, limit: 40, model })).resolves.toMatchObject({
      messages: [{ id: 'message-1', sequence: 10, content: '较早消息' }],
      has_more: true,
      before_sequence: 10,
    })
    await expect(getChatMessages('conversation-1', { beforeSequence: 50 })).rejects.toThrow('DSH 聊天服务尚未就绪')
  })

  it('submits messages only through the DSH conversation model', async () => {
    const { sendChatMessage } = await import('../apps/web/src/modules/chat/api/chatApi.js')
    const details = {
      conversation: { id: 'conversation-1', title: '测试', preview: '', createdAt: '', updatedAt: '' },
      metadata: {}, messages: [], hasMore: false, beforeSequence: null
    }
    const model = { send: vi.fn(async () => ({ details, cancelled: false })) }
    const image = { mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'pixel.png' }

    await expect(sendChatMessage({
      session_id: 'conversation-1', message: '你好', images: [image], files: ['receipt-1']
    }, 'request-1', { model })).resolves.toMatchObject({ session_id: 'conversation-1', cancelled: false })
    expect(model.send).toHaveBeenCalledWith({
      conversationId: 'conversation-1', requestId: 'request-1', text: '你好',
      images: [image], files: ['receipt-1']
    })
    await expect(sendChatMessage({ session_id: 'conversation-1', message: '你好' }, 'request-2'))
      .rejects.toThrow('DSH 聊天服务尚未就绪')
  })
})
