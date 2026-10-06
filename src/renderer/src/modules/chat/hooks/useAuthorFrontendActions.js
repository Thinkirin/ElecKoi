import { useEffect, useRef } from 'react';
import { getChat } from '../api/chatApi.js';

function publicError(error, fallback) {
  const message = typeof error === 'string' ? error : error?.message;
  return message?.trim() || fallback;
}

export function useAuthorFrontendActions({
  sessionId,
  setIsSending,
  setStatus,
  reconcileChatMessages,
  replaceChatMessages,
  conversations,
  setChatCharacter,
  normalizeLatestChatCharacter,
  refreshSessionsOnly,
  requestScrollToEnd,
  loadChat,
  input,
  inputImages,
  setInput,
  sendMessage,
  requestRef,
}) {
  const pendingRunRef = useRef(null);
  const inputRef = useRef(input);
  const hasInputImagesRef = useRef(Boolean(inputImages?.length));
  const sendMessageRef = useRef(sendMessage);
  const loadChatRef = useRef(loadChat);
  inputRef.current = input;
  hasInputImagesRef.current = Boolean(inputImages?.length);
  sendMessageRef.current = sendMessage;
  loadChatRef.current = loadChat;

  useEffect(() => {
    let attached, stop = () => {};
    const connect = event => {
      const runtime = event?.detail || window.__ElecKoiClientCompatibility;
      if (!runtime?.registerConversationNavigation || runtime.conversations !== conversations || runtime === attached) return;
      stop(); attached = runtime;
      stop = runtime.registerConversationNavigation(async id => {
        await loadChatRef.current(id);
        const snapshot = conversations.getDetailsSnapshot();
        if (snapshot.id !== id || snapshot.status !== 'ready') throw Object.assign(new Error('聊天选择没有完成，请停止生成或重新打开会话。'), { code: 'APPLICATION_OWNER_NOT_ACTIVE' });
        return snapshot.details;
      });
    };
    connect(); window.addEventListener('eleckoi:shared-runtime', connect);
    return () => { window.removeEventListener('eleckoi:shared-runtime', connect); stop(); };
  }, [conversations]);

  useEffect(() => {
    const refreshActiveChat = async (targetSessionId, resetWindow = false) => {
      if (!targetSessionId || targetSessionId !== sessionId) return;
      const data = await getChat(targetSessionId, { model: conversations });
      if (resetWindow) {
        replaceChatMessages(data.chat);
        conversations?.invalidateDetails(targetSessionId);
      } else {
        reconcileChatMessages(data.chat);
      }
      setChatCharacter(normalizeLatestChatCharacter(data.chat));
      await refreshSessionsOnly({ keepSection: true });
    };
    const onAuthorAction = (event) => {
      const detail = event.detail || {};
      if (detail.conversationId !== sessionId) return;
      const resetWindow = [
        'openings.select',
        'messages.deleteFrom',
        'messages.regenerate',
        'messages.editAndRegenerate',
      ].includes(detail.method);
      if ([
        'chat.send',
        'messages.deleteFrom',
        'messages.regenerate',
        'messages.editAndRegenerate',
      ].includes(detail.method) && detail.result?.runId) {
        pendingRunRef.current = { conversationId: detail.conversationId, resetWindow };
        setIsSending(true);
        requestScrollToEnd('auto');
      }
      if (['chat.create', 'chat.open', 'chat.delete'].includes(detail.method) && detail.result?.chat?.id) {
        loadChat(detail.result.chat.id).then(() => refreshSessionsOnly({ keepSection: true }))
          .catch((error) => setStatus(publicError(error, '切换聊天失败')));
        return;
      }
      refreshActiveChat(detail.conversationId, resetWindow).catch((error) => setStatus(publicError(error, '刷新聊天失败')));
    };
    const onAuthorInputRequest = (event) => {
      const detail = event.detail || {};
      if (detail.conversationId !== sessionId || typeof detail.claim !== 'function') return;
      const operation = detail.claim();
      const text = typeof detail.params?.text === 'string' ? detail.params.text : '';
      if (detail.method === 'input.get') {
        operation.resolve({ text: inputRef.current });
      } else if (detail.method === 'input.set') {
        inputRef.current = text;
        setInput(text);
        operation.resolve({ text });
      } else if (detail.method === 'input.append') {
        const next = `${inputRef.current}${text}`;
        inputRef.current = next;
        setInput(next);
        operation.resolve({ text: next });
      } else if (detail.method === 'input.clear') {
        inputRef.current = '';
        setInput('');
        operation.resolve({ text: '' });
      } else if (detail.method === 'input.send') {
        const submitted = Boolean(inputRef.current.trim()) || hasInputImagesRef.current;
        if (submitted) void sendMessageRef.current({ preventDefault() {} }, inputRef.current);
        operation.resolve({ submitted });
      } else {
        operation.reject(Object.assign(new Error('未知的输入框操作'), { code: 'METHOD_NOT_FOUND' }));
      }
    };
    let previousStream = conversations?.getStreamSnapshot?.() || null;
    const onStreamChanged = () => {
      const current = conversations?.getStreamSnapshot?.();
      if (!current || current.id !== sessionId) {
        previousStream = current || null;
        return;
      }
      if (current.status === 'running') {
        setIsSending(true);
        // Stream publication updates busy state, not reader ownership.
        // Explicit submissions request tail following in onAuthorAction.
      }
      const terminal = previousStream?.id === sessionId
        && previousStream.status === 'running'
        && current.status !== 'running';
      previousStream = current;
      if (!terminal) return;
      const pending = pendingRunRef.current;
      pendingRunRef.current = null;
      // Product-owned sends keep the optimistic transcript and busy state
      // until their own request promise has reconciled the durable result.
      // Only externally started runs are settled by this observer.
      if (!requestRef?.current) setIsSending(false);
      if (current.status === 'error') setStatus(current.error || '生成失败');
      refreshActiveChat(sessionId, pending?.resetWindow === true)
        .catch((error) => setStatus(publicError(error, '刷新聊天失败')));
    };
    window.addEventListener('eleckoi:author-action', onAuthorAction);
    window.addEventListener('eleckoi:author-input-request', onAuthorInputRequest);
    const disposeStream = conversations?.subscribeStream?.(onStreamChanged) || (() => {});
    return () => {
      window.removeEventListener('eleckoi:author-action', onAuthorAction);
      window.removeEventListener('eleckoi:author-input-request', onAuthorInputRequest);
      disposeStream();
    };
  }, [sessionId]);
}
