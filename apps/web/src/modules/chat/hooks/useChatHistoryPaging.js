import { useRef, useState } from "react";
import { getChatMessages } from "../api/chatApi.js";

export function useChatHistoryPaging({ sessionId, historyPage, prependMessages, reconcileMessages, setStatus, conversations }) {
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const requestRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  async function loadOlderMessages() {
    const requestSessionId = sessionIdRef.current;
    const beforeSequence = historyPage.beforeSequence;
    if (!requestSessionId || !historyPage.hasMore || beforeSequence === null || requestRef.current) return;
    requestRef.current = true;
    setIsLoadingOlderMessages(true);
    try {
      const page = await getChatMessages(requestSessionId, { beforeSequence, limit: 50, model: conversations });
      if (!page) return;
      if (sessionIdRef.current !== requestSessionId) return;
      const applyPage = page.replace ? reconcileMessages : prependMessages;
      applyPage(page.messages || [], {
        hasMore: page.has_more,
        beforeSequence: page.before_sequence,
      });
    } catch {
      if (sessionIdRef.current === requestSessionId) {
        setStatus("加载更早消息失败");
      }
    } finally {
      requestRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }

  return { isLoadingOlderMessages, loadOlderMessages };
}
