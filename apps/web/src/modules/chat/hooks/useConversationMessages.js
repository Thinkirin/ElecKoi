import { useRef, useState } from "react";
import { detectRichMessagePresentation } from "@shared/foundation/richMessage";

function sameMessageIdentity(current, incoming) {
  if (!current || !incoming || current.role !== incoming.role) return false;
  // Message ids such as "opening" are local to a conversation. Reuse of
  // display state, row keys and process items must stay inside that owner.
  if (current.conversationId !== incoming.conversationId) return false;
  if (current.runtimeSessionId && incoming.runtimeSessionId
    && current.runtimeSessionId !== incoming.runtimeSessionId) return false;
  if (current.id && current.id === incoming.id) return true;
  if (current.role === 'user' && current.requestId && current.requestId === incoming.requestId) return true;
  if (!current.runtimeSessionId || current.runtimeSessionId !== incoming.runtimeSessionId) return false;
  return Boolean((current.dshMessageId && current.dshMessageId === incoming.dshMessageId)
    || (current.renderKey && current.renderKey === incoming.renderKey));
}

function preserveSettledDisplayDuringRewind(previous, incoming) {
  if (previous?.role !== 'assistant' || incoming?.role !== 'assistant') return {};
  // This helper is only called after reconciliation matched the same durable
  // message id. The transient DSH projection can normalize the source text
  // (and therefore change content/display lengths) while keeping that id.
  // Matching on content here would let that intermediate snapshot replace a
  // settled rich display with its raw fallback for one render.
  if (!previous.id || String(previous.id) !== String(incoming.id)) return {};
  const previousDisplay = previous.displayContent;
  const incomingDisplay = incoming.displayContent;
  // During regeneration DSH can briefly publish an already-settled assistant
  // step without its projected frontend/regex display. Keep the last rich
  // projection until the durable snapshot catches up; otherwise the card is
  // replaced by raw source for one render.
  if (typeof previousDisplay !== 'string' || previousDisplay === previous.content) return {};
  if (!detectRichMessagePresentation(previousDisplay, false)?.parts?.some((part) => part.kind === 'rich')) return {};
  if (typeof incomingDisplay !== 'string') return {};
  if (detectRichMessagePresentation(incomingDisplay, false)?.parts?.some((part) => part.kind === 'rich')) return {};
  if (incomingDisplay.length >= previousDisplay.length) return {};
  return {
    displayContent: previousDisplay,
    ...(incoming.pending ? { pending: previous.pending, status: previous.status } : {}),
  };
}

function preserveAttachmentRenderKeys(current = [], incoming = []) {
  return incoming.map((image, index) => {
    const previous = current.find((candidate) => (
      candidate?.attachmentId && candidate.attachmentId === image?.attachmentId
    )) || current[index];
    const renderKey = previous?.renderKey || previous?.localId || previous?.attachmentId;
    return renderKey ? { ...image, renderKey } : image;
  });
}

export function mergeProcessItems(current = [], incoming = []) {
  const order = [];
  const byId = new Map();
  for (const item of [...current, ...incoming]) {
    if (!item?.id) continue;
    if (!byId.has(item.id)) order.push(item.id);
    const previous = byId.get(item.id);
    if (!previous) {
      byId.set(item.id, item);
      continue;
    }
    const incomingTerminal = item.status !== 'running';
    const previousTerminal = previous.status !== 'running';
    const keepPreviousStatus = previousTerminal && !incomingTerminal;
    const reasoning = item.kind === 'reasoning' || item.toolName === 'reasoning';
    byId.set(item.id, {
      ...previous,
      ...item,
      ...(keepPreviousStatus ? {
        status: previous.status,
        completedAtMillis: previous.completedAtMillis,
      } : {}),
      ...(reasoning ? {
        summary: longerText(previous.summary, item.summary),
        detail: longerText(previous.detail, item.detail),
      } : {}),
    });
  }
  return order.map((id) => byId.get(id));
}

function longerText(left, right) {
  const first = typeof left === 'string' ? left : '';
  const second = typeof right === 'string' ? right : '';
  return second.length >= first.length ? second : first;
}

export function preserveMessageRenderKeys(currentMessages = [], incomingMessages = [], pendingMessage = null) {
  const current = pendingMessage ? [...currentMessages, pendingMessage] : currentMessages;
  const matches = new Map();

  incomingMessages.forEach((message, index) => {
    const existing = current.find((candidate) => ![...matches.values()].includes(candidate)
      && sameMessageIdentity(candidate, message));
    if (!existing) return;
    matches.set(index, existing);
  });

  return incomingMessages.map((message, index) => {
    const previous = matches.get(index);
    if (!previous) return message;
    const renderKey = previous.renderKey || previous.id;
    return {
      ...message,
      ...(renderKey ? { renderKey } : {}),
      ...preserveSettledDisplayDuringRewind(previous, message),
      process: mergeProcessItems(previous.process || [], message.process || []),
      inputImageAttachments: preserveAttachmentRenderKeys(
        previous.inputImageAttachments || [],
        message.inputImageAttachments || [],
      ),
    };
  });
}

export function preservePendingUser(currentMessages, incomingMessages, pendingUser) {
  if (!pendingUser || pendingUser.role !== "user") return incomingMessages;
  if (incomingMessages.some(message => sameMessageIdentity(pendingUser, message))) return incomingMessages;
  const previous = currentMessages.find(message => message.id === pendingUser.id);
  if (!previous) return incomingMessages;
  const previousIndex = currentMessages.indexOf(previous);
  const insertAt = Math.min(Math.max(previousIndex, 0), incomingMessages.length);
  return [
    ...incomingMessages.slice(0, insertAt),
    { ...previous, ...pendingUser },
    ...incomingMessages.slice(insertAt),
  ];
}

export function useConversationMessages() {
  const [messages, setMessages] = useState([]);
  const scrollRef = useRef(null);
  const [historyPage, setHistoryPage] = useState({ hasMore: false, beforeSequence: null });
  const [scrollRequest, setScrollRequest] = useState({ revision: 0, behavior: "auto" });
  const displayedMessages = messages;

  function requestScrollToEnd(behavior = "smooth") {
    setScrollRequest((current) => ({ revision: current.revision + 1, behavior }));
  }

  function setMessagesWithScroll(nextMessages, behavior = null, page = {}) {
    // Keep the mounted row identity while an optimistic/streaming assistant
    // message is replaced by the durable DSH message at turn completion.
    // Empty arrays are intentional clears (session switch/reset) and must not
    // retain the previous conversation.
    setMessages((current) => nextMessages.length
      ? preserveMessageRenderKeys(current, nextMessages)
      : nextMessages);
    setHistoryPage({
      hasMore: Boolean(page.hasMore),
      beforeSequence: page.beforeSequence ?? null,
    });
    if (behavior) requestScrollToEnd(behavior);
  }

  function reconcileMessages(nextMessages, page = {}) {
    setMessages((current) => {
      const merged = preserveMessageRenderKeys(current, nextMessages);
      return preservePendingUser(current, merged, page.preservePendingUser);
    });
    setHistoryPage({
      hasMore: Boolean(page.hasMore),
      beforeSequence: page.beforeSequence ?? null,
    });
  }

  function prependMessages(olderMessages, page = {}) {
    setMessages((current) => {
      const existing = new Set(current.map((message) => message.id));
      const uniqueOlder = olderMessages.filter((message) => !existing.has(message.id));
      return uniqueOlder.length ? [...uniqueOlder, ...current] : current;
    });
    setHistoryPage({
      hasMore: Boolean(page.hasMore),
      beforeSequence: page.beforeSequence ?? null,
    });
  }

  return {
    messages,
    displayedMessages,
    setMessages,
    setMessagesWithScroll,
    reconcileMessages,
    prependMessages,
    historyPage,
    requestScrollToEnd,
    scrollRequest,
    scrollRef,
  };
}
