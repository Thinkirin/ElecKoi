import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  createChat: vi.fn(),
  getChat: vi.fn(),
  sendChatMessage: vi.fn()
}))
const images = vi.hoisted(() => ({ encodeImageDraft: vi.fn() }))

vi.mock('../apps/web/src/modules/chat/api/chatApi.js', () => api)
vi.mock('../apps/web/src/modules/chat/hooks/useChatInputImages.js', () => images)

import { runChatMessageSend } from '../apps/web/src/modules/chat/hooks/chatMessageSend.js'

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  images.encodeImageDraft.mockReset()
})

describe('chat message send cancellation', () => {
  it('shows a visible error when no usable chat model is configured', async () => {
    const setStatus = vi.fn()
    const notify = vi.fn()

    await runChatMessageSend({
      event: { preventDefault: vi.fn() },
      input: '你好',
      inputImagesRef: { current: [] },
      inputFilesRef: { current: [] },
      isSending: false,
      modelConfig: null,
      setStatus,
      notify,
    })

    const message = '未配置可用的对话模型，请先前往“模型配置”添加模型和 API 密钥。'
    expect(setStatus).toHaveBeenCalledWith(message)
    expect(notify).toHaveBeenCalledWith('error', message)
    expect(api.createChat).not.toHaveBeenCalled()
    expect(api.sendChatMessage).not.toHaveBeenCalled()
  })

  it('never dispatches a request that was stopped while local preparation was pending', async () => {
    let finishEncoding
    images.encodeImageDraft.mockImplementation(() => new Promise((resolve) => { finishEncoding = resolve }))
    const requestRef = { current: null }

    const sending = runChatMessageSend({
      event: { preventDefault: vi.fn() },
      input: '测试停止',
      inputImagesRef: { current: [{ localId: 'image-1', mediaType: 'image/png', bytes: 12, name: 'test.png' }] },
      inputFilesRef: { current: [] },
      isSending: false,
      modelConfig: { id: 'model-1', model: 'test-model' },
      modelSupportsImages: true,
      setStatus: vi.fn(),
      requestRef,
      setIsSending: vi.fn(),
      sessionId: 'conversation-1',
      chatCharacter: { character_id: 'character-1' },
      setSessionId: vi.fn(),
      replaceChatMessages: vi.fn(),
      setChatCharacter: vi.fn(),
      normalizeLatestChatCharacter: vi.fn(),
      refreshSessionsOnly: vi.fn(),
      setInput: vi.fn(),
      clearInputImages: vi.fn(),
      clearInputFiles: vi.fn(),
      requestScrollToEnd: vi.fn(),
      reconcileChatMessages: vi.fn(),
      conversationModel: {},
    })

    await vi.waitFor(() => expect(images.encodeImageDraft).toHaveBeenCalledOnce())
    const stoppedRequest = requestRef.current
    requestRef.current = null
    stoppedRequest.controller.abort()
    finishEncoding({ mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'test.png' })
    await sending

    expect(api.sendChatMessage).not.toHaveBeenCalled()
  })

  it('rehydrates the durable cancelled reply after the local request is released', async () => {
    let finishReply
    api.sendChatMessage.mockImplementation(() => new Promise((resolve) => { finishReply = resolve }))
    const requestRef = { current: null }
    const reconcileChatMessages = vi.fn()

    const sending = runChatMessageSend({
      event: { preventDefault: vi.fn() },
      input: '测试取消回填',
      inputImagesRef: { current: [] },
      inputFilesRef: { current: [] },
      isSending: false,
      modelConfig: { id: 'model-1', model: 'test-model' },
      modelSupportsImages: false,
      setStatus: vi.fn(),
      requestRef,
      setIsSending: vi.fn(),
      sessionId: 'conversation-1',
      chatCharacter: { character_id: 'character-1' },
      setSessionId: vi.fn(),
      replaceChatMessages: vi.fn(),
      setChatCharacter: vi.fn(),
      normalizeLatestChatCharacter: vi.fn(),
      refreshSessionsOnly: vi.fn(),
      setInput: vi.fn(),
      clearInputImages: vi.fn(),
      clearInputFiles: vi.fn(),
      requestScrollToEnd: vi.fn(),
      reconcileChatMessages,
      conversationModel: {},
    })

    await vi.waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledOnce())
    requestRef.current = null
    const chat = { id: 'conversation-1', messages: [{ id: 'assistant-cancelled', content: '部分正文' }] }
    finishReply({ cancelled: true, chat })
    await sending

    expect(reconcileChatMessages).toHaveBeenCalledWith(chat)
  })

  it('does not let an old cancelled reply replace a newer active request', async () => {
    let finishReply
    api.sendChatMessage.mockImplementation(() => new Promise((resolve) => { finishReply = resolve }))
    const requestRef = { current: null }
    const reconcileChatMessages = vi.fn()

    const sending = runChatMessageSend({
      event: { preventDefault: vi.fn() }, input: '旧请求', inputImagesRef: { current: [] }, inputFilesRef: { current: [] }, isSending: false,
      modelConfig: { id: 'model-1', model: 'test-model' }, modelSupportsImages: false, setStatus: vi.fn(),
      requestRef, setIsSending: vi.fn(), sessionId: 'conversation-1', chatCharacter: { character_id: 'character-1' },
      setSessionId: vi.fn(), replaceChatMessages: vi.fn(), setChatCharacter: vi.fn(), normalizeLatestChatCharacter: vi.fn(),
      refreshSessionsOnly: vi.fn(), setInput: vi.fn(), clearInputImages: vi.fn(), clearInputFiles: vi.fn(),
      requestScrollToEnd: vi.fn(), reconcileChatMessages, conversationModel: {}
    })

    await vi.waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledOnce())
    requestRef.current = { requestId: 'new-request' }
    finishReply({ cancelled: true, chat: { id: 'conversation-1', messages: [] } })
    await sending

    expect(reconcileChatMessages).not.toHaveBeenCalled()
  })

  it('reconciles durable history when image preparation rejects before persistence', async () => {
    images.encodeImageDraft.mockResolvedValue({ mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'test.png' })
    const durableChat = { id: 'conversation-1', messages: [] }
    api.getChat.mockResolvedValue({ chat: durableChat })
    api.sendChatMessage.mockRejectedValue(new Error('图片处理失败，请重新添加。'))
    const requestRef = { current: null }
    const reconcileChatMessages = vi.fn()
    const notify = vi.fn()

    await runChatMessageSend({
      event: { preventDefault: vi.fn() },
      input: '看看图片',
      inputImagesRef: { current: [{ localId: 'image-1', mediaType: 'image/png', bytes: 12, name: 'test.png', file: {} }] },
      inputFilesRef: { current: [] },
      isSending: false,
      modelConfig: { id: 'model-1', model: 'test-model' },
      modelSupportsImages: true,
      setStatus: vi.fn(),
      requestRef,
      setIsSending: vi.fn(),
      sessionId: 'conversation-1',
      chatCharacter: { character_id: 'character-1' },
      setSessionId: vi.fn(),
      replaceChatMessages: vi.fn(),
      setChatCharacter: vi.fn(),
      normalizeLatestChatCharacter: vi.fn((chat) => chat),
      refreshSessionsOnly: vi.fn(),
      setInput: vi.fn(),
      clearInputImages: vi.fn(),
      clearInputFiles: vi.fn(),
      requestScrollToEnd: vi.fn(),
      reconcileChatMessages,
      notify,
      conversationModel: {},
    })

    expect(api.getChat).toHaveBeenCalledWith('conversation-1', { model: {} })
    expect(reconcileChatMessages).toHaveBeenCalledWith(durableChat)
    expect(notify).toHaveBeenCalledWith('error', '图片处理失败，请重新添加。')
  })

  it('passes official file upload receipts to the same DSH conversation', async () => {
    const conversationModel = {}
    api.sendChatMessage.mockResolvedValue({
      cancelled: false,
      session_id: 'conversation-1',
      chat: { id: 'conversation-1', messages: [] },
    })

    await runChatMessageSend({
      event: { preventDefault: vi.fn() },
      input: '读取文件',
      inputImagesRef: { current: [] },
      inputFilesRef: { current: [{
        id: 'receipt-1', receiptId: 'receipt-1', attachmentId: 'sha256:file-1', name: 'notes.txt', bytes: 12,
      }] },
      isSending: false,
      modelConfig: { id: 'model-1', model: 'test-model' },
      modelSupportsImages: false,
      setStatus: vi.fn(),
      requestRef: { current: null },
      setIsSending: vi.fn(),
      sessionId: 'conversation-1',
      chatCharacter: { character_id: 'character-1' },
      setSessionId: vi.fn(),
      setChatCharacter: vi.fn(),
      normalizeLatestChatCharacter: vi.fn((chat) => chat),
      refreshSessionsOnly: vi.fn(),
      setInput: vi.fn(),
      clearInputImages: vi.fn(),
      clearInputFiles: vi.fn(),
      requestScrollToEnd: vi.fn(),
      reconcileChatMessages: vi.fn(),
      conversationModel,
    })

    expect(api.sendChatMessage).toHaveBeenCalledWith({
      message: '读取文件', images: [], files: ['receipt-1'], session_id: 'conversation-1',
    }, expect.stringMatching(/^chat-/), { model: conversationModel, signal: expect.any(AbortSignal) })
  })
})
