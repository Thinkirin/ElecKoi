import { AUTHOR_CONVERSATION_EVENT_NAMES } from '@eleckoi/author-sdk';

export const authorConversationEventNames = AUTHOR_CONVERSATION_EVENT_NAMES;

const subscriptionsByModel = new WeakMap();

function jsonObject(source) {
  try {
    const value = JSON.parse(source || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export async function publicAuthorMessage(message, loadImage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    displayContent: message.displayContent ?? message.content,
    variableState: jsonObject(message.variableStateJson),
    status: message.status,
    createdAt: message.createdAt,
    turnId: message.turnId ?? '',
    speakerId: message.speakerId ?? '',
    speakerName: message.speakerName ?? '',
    speakerAvatar: message.speakerAvatar ?? '',
    sequence: message.sequence ?? null,
    responseIndex: message.responseIndex ?? null,
    process: message.process ?? [],
    attachments: await Promise.all((message.inputImageAttachments ?? []).map(async (attachment) => ({
      id: attachment.attachmentId,
      type: 'image',
      url: await loadImage(message.conversationId, attachment),
      mimeType: attachment.mediaType,
      name: attachment.name || '图片',
      size: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      duration: null,
      metadata: attachment.originalDimensions ? { originalDimensions: attachment.originalDimensions } : {},
    }))),
    openingOptions: (message.openingOptions ?? []).map((option) => ({
      id: option.id,
      title: option.title,
      content: option.content,
      ...(option.displayContent == null ? {} : { displayContent: option.displayContent }),
      initialVariableState: jsonObject(option.initialVariableStateJson),
    })),
    selectedOpeningId: message.selectedOpeningId ?? '',
  };
}

export async function publicAuthorEvent(name, payload, loadImage) {
  return name === 'agent.run.finished'
    ? { ...payload, message: await publicAuthorMessage(payload.message, loadImage) }
    : payload;
}

function matchingDetails(model, conversationId) {
  const snapshot = model.getDetailsSnapshot?.();
  return snapshot?.id === conversationId ? snapshot : null;
}

function matchingStream(model, conversationId) {
  const snapshot = model.getStreamSnapshot?.();
  return snapshot?.id === conversationId ? snapshot : null;
}

function matchingStats(model, conversationId) {
  const snapshot = model.getStatsSnapshot?.();
  return snapshot?.id === conversationId ? snapshot : null;
}

function messageSignature(message) {
  return JSON.stringify([
    message?.id,
    message?.role,
    message?.content,
    message?.displayContent,
    message?.status,
    message?.selectedOpeningId,
  ]);
}

function changedMessages(previous, current) {
  const before = previous?.details?.messages || [];
  const after = current?.details?.messages || [];
  if (!previous || previous.status !== 'ready' || current?.status !== 'ready') return null;
  if (before.length === after.length && before.every((item, index) => messageSignature(item) === messageSignature(after[index]))) {
    return null;
  }
  const beforeById = new Map(before.map((message) => [message.id, message]));
  const afterById = new Map(after.map((message) => [message.id, message]));
  const added = after.filter((message) => !beforeById.has(message.id)).map((message) => message.id);
  const removed = before.filter((message) => !afterById.has(message.id)).map((message) => message.id);
  const edited = after.filter((message) => {
    const old = beforeById.get(message.id);
    return old && messageSignature(old) !== messageSignature(message);
  }).map((message) => message.id);
  if (removed.length && added.length) return { reason: 'regenerated', messageIds: [...removed, ...added] };
  if (removed.length) return { reason: 'deleted', messageIds: removed };
  if (added.length) return { reason: 'sent', messageIds: added };
  return { reason: 'edited', messageIds: edited };
}

function generationStats(snapshot) {
  const values = snapshot?.stats || {};
  const session = values.sessionStats || {};
  const usage = values.tokenUsage || {};
  const breakdown = values.contextBreakdown || {};
  return {
    turns: Number(session.turns) || 0,
    steps: Number(session.steps) || 0,
    llmMs: Number(session.llmMs) || 0,
    toolMs: Number(session.toolMs) || 0,
    ttftMs: Number(session.ttftMs) || 0,
    ttftSteps: Number(session.ttftSteps) || 0,
    decodeMs: Number(session.decodeMs) || 0,
    decodeTokens: Number(session.decodeTokens) || 0,
    tokenUsage: {
      uncachedInputTokens: Number(usage.uncachedInputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
      cacheReadTokens: Number(usage.cacheReadTokens) || 0,
      cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
    },
    contextPressure: { ...(values.contextPressure || {}) },
    contextBreakdown: {
      systemTokens: Number(breakdown.systemTokens) || 0,
      toolsTokens: Number(breakdown.toolsTokens) || 0,
      messageTokens: Number(breakdown.messageTokens) || 0,
    },
  };
}

function createSubscription(model, conversationId) {
  const listeners = new Set();
  let previousDetails = matchingDetails(model, conversationId);
  let previousStream = matchingStream(model, conversationId);
  let previousStats = matchingStats(model, conversationId);

  let eventQueue = Promise.resolve();
  const emit = (name, payload) => {
    eventQueue = eventQueue.catch(() => {}).then(async () => {
      const event = { name, payload: await publicAuthorEvent(
        name,
        payload,
        (ownerId, attachment) => model.readImage(ownerId, attachment),
      ) };
      for (const listener of listeners) listener(event);
    });
    void eventQueue.catch(() => {});
  };

  const onDetails = () => {
    const current = matchingDetails(model, conversationId);
    if (!current) return;
    const change = changedMessages(previousDetails, current);
    previousDetails = current;
    if (change) emit('messages.changed', { conversationId, ...change });
  };

  const onStream = () => {
    const current = matchingStream(model, conversationId);
    if (!current) return;
    const previous = previousStream;
    previousStream = current;
    const wasRunning = previous?.status === 'running';
    const isRunning = current.status === 'running';
    if (isRunning && !wasRunning) emit('agent.state.changed', { conversationId, state: 'starting' });
    if (isRunning) {
      const previousContent = wasRunning ? previous.content || '' : '';
      const delta = String(current.content || '').startsWith(previousContent)
        ? String(current.content || '').slice(previousContent.length)
        : String(current.content || '');
      if (delta) emit('agent.output.delta', {
        conversationId,
        runId: current.runId,
        messageId: current.messageId,
        sequence: current.sequence,
        delta,
      });
      const previousItems = new Map((previous?.process || []).map((item) => [item.id, JSON.stringify(item)]));
      for (const item of current.process || []) {
        if (previousItems.get(item.id) !== JSON.stringify(item)) emit('agent.process.updated', {
          conversationId,
          runId: current.runId,
          messageId: current.messageId,
          item,
        });
      }
      emit('agent.state.changed', { conversationId, state: 'streaming' });
      return;
    }
    if (!wasRunning) return;
    if (current.status === 'error') {
      emit('agent.run.failed', {
        conversationId,
        runId: previous.runId,
        messageId: previous.messageId,
        code: 'RUNTIME_UNAVAILABLE',
        message: current.error || '生成失败',
      });
      emit('agent.state.changed', { conversationId, state: 'error', detail: current.error || '生成失败' });
      return;
    }
    const details = matchingDetails(model, conversationId)?.details;
    const message = details?.messages?.findLast((item) => item.role === 'assistant');
    if (message) emit('agent.run.finished', { conversationId, runId: previous.runId, message });
    emit('agent.state.changed', { conversationId, state: 'idle' });
  };

  const onStats = () => {
    const current = matchingStats(model, conversationId);
    if (!current) return;
    const next = generationStats(current);
    const before = previousStats ? generationStats(previousStats) : null;
    previousStats = current;
    if (before && JSON.stringify(before) === JSON.stringify(next)) return;
    const stream = matchingStream(model, conversationId);
    const details = matchingDetails(model, conversationId);
    emit('agent.generation.stats', {
      conversationId,
      runId: stream?.runId || details?.runtimeSessionId || '',
      stats: next,
    });
  };

  const disposers = [
    model.subscribeDetails?.(onDetails),
    model.subscribeStream?.(onStream),
    model.subscribeStats?.(onStats),
  ].filter(Boolean);

  return {
    listeners,
    dispose() { for (const dispose of disposers) dispose(); },
  };
}

export function subscribeAuthorConversationEvents(model, conversationId, listener) {
  if (!model || !conversationId) return () => {};
  let byConversation = subscriptionsByModel.get(model);
  if (!byConversation) {
    byConversation = new Map();
    subscriptionsByModel.set(model, byConversation);
  }
  let entry = byConversation.get(conversationId);
  if (!entry) {
    entry = createSubscription(model, conversationId);
    byConversation.set(conversationId, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size) return;
    entry.dispose();
    byConversation.delete(conversationId);
  };
}
