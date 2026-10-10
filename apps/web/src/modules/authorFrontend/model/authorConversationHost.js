import {
  AUTHOR_API_STAGE,
  AUTHOR_API_VERSION,
  AuthorApiError,
  AuthorBridgeRequestGate,
  AUTHOR_EVENT_NAMES,
  authorApiDefinitions,
  characterConversationPermissions,
  routeAuthorApiRequest,
} from '@eleckoi/author-sdk';
import {
  deriveTrajectoryLayout,
  trajectoryRecordId,
  zh as trajectoryZh,
} from '@eleckoi/dsh-client-trajectory/projection';
import {
  characterCardMacroValues,
  resolveCharacterCardMacrosInJson,
} from '@shared/foundation/characterCardMacros';

const bridgeErrors = {
  BRIDGE_REQUEST_TOO_LARGE: '作者 API 请求过大',
  BRIDGE_BUSY: '作者 API 同时请求过多',
  BRIDGE_RATE_LIMITED: '作者 API 请求过于频繁',
};

const supportedMethods = new Set([
  'app.getInfo', 'app.getCapabilities', 'context.current',
  'variables.getState', 'variables.getConfig', 'variables.setState', 'variables.merge',
  'variables.applyPatch', 'variables.reset',
  'openings.list', 'openings.current', 'openings.select',
  'messages.list', 'messages.get', 'messages.current', 'messages.setContent', 'messages.deleteFrom',
  'messages.regenerate', 'messages.editAndRegenerate',
  'chat.current', 'chat.list', 'chat.getGenerationState', 'chat.getAgentTrajectory',
  'chat.getModels', 'chat.send', 'chat.stopGeneration', 'chat.create', 'chat.open',
  'chat.delete', 'chat.selectModel', 'character.current',
  'settingLibrary.current', 'settingLibrary.getSummary', 'settingLibrary.replace',
  'media.getMessageAttachments', 'media.getMessageAttachment',
  'audio.play', 'audio.pause', 'audio.resume', 'audio.stop', 'audio.seek', 'audio.getState',
  'audio.getPlaylist', 'audio.setPlaylist', 'audio.appendPlaylist', 'audio.getSettings',
  'audio.setSettings', 'input.get', 'input.set', 'input.append', 'input.clear', 'input.send',
  'events.list',
]);

const gates = new Map();

function requestId(rawRequest) {
  try {
    const value = JSON.parse(rawRequest);
    return value && typeof value === 'object' && typeof value.id === 'string' ? value.id : '';
  } catch { return ''; }
}

function parsedJson(source) {
  try { return JSON.parse(source || '{}'); } catch { return {}; }
}

function jsonObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthorApiError('INVALID_PARAMS', message);
  }
  return value;
}

function mergeObjects(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key];
    result[key] = previous && typeof previous === 'object' && !Array.isArray(previous)
      && value && typeof value === 'object' && !Array.isArray(value)
      ? mergeObjects(previous, value)
      : value;
  }
  return result;
}

function pointerParts(path) {
  if (typeof path !== 'string' || (path !== '' && !path.startsWith('/'))) {
    throw new AuthorApiError('INVALID_PARAMS', '变量补丁路径必须是 JSON Pointer');
  }
  return path === '' ? [] : path.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function arrayIndex(part, length, allowEnd) {
  if (allowEnd && part === '-') return length;
  if (!/^(0|[1-9]\d*)$/.test(part)) throw new AuthorApiError('INVALID_PARAMS', `无效的数组位置：${part}`);
  const index = Number(part);
  if (index < 0 || index > length || (!allowEnd && index === length)) {
    throw new AuthorApiError('INVALID_PARAMS', `数组位置超出范围：${part}`);
  }
  return index;
}

function applyVariablePatch(current, rawPatch) {
  if (!Array.isArray(rawPatch) || rawPatch.length > 1_000) {
    throw new AuthorApiError('INVALID_PARAMS', '变量补丁必须是操作数组');
  }
  let root = structuredClone(current);
  for (const rawOperation of rawPatch) {
    const operation = jsonObject(rawOperation, '变量补丁操作必须是对象');
    const op = operation.op;
    if (!['add', 'replace', 'remove'].includes(op)) {
      throw new AuthorApiError('INVALID_PARAMS', `不支持的变量补丁操作：${String(op)}`);
    }
    if (op !== 'remove' && !Object.prototype.hasOwnProperty.call(operation, 'value')) {
      throw new AuthorApiError('INVALID_PARAMS', `${op} 操作必须提供 value`);
    }
    const parts = pointerParts(operation.path);
    if (parts.length === 0) {
      root = op === 'remove' ? {} : structuredClone(operation.value);
      continue;
    }
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(parent)) parent = parent[arrayIndex(part, parent.length, false)];
      else if (parent && typeof parent === 'object') parent = parent[part];
      else throw new AuthorApiError('INVALID_PARAMS', `变量补丁找不到路径：${String(operation.path)}`);
    }
    const key = parts.at(-1);
    if (Array.isArray(parent)) {
      const index = arrayIndex(key, parent.length, op === 'add');
      if (op === 'add') parent.splice(index, 0, structuredClone(operation.value));
      else if (op === 'replace') parent[index] = structuredClone(operation.value);
      else parent.splice(index, 1);
    } else if (parent && typeof parent === 'object') {
      if (op !== 'add' && !(key in parent)) {
        throw new AuthorApiError('INVALID_PARAMS', `变量补丁找不到路径：${String(operation.path)}`);
      }
      if (op === 'remove') delete parent[key];
      else parent[key] = structuredClone(operation.value);
    } else throw new AuthorApiError('INVALID_PARAMS', `变量补丁找不到路径：${String(operation.path)}`);
  }
  return jsonObject(root, '变量补丁的最终结果必须是一个对象');
}

async function publicImageAttachment(conversations, conversationId, attachment) {
  return {
    id: attachment.attachmentId,
    type: 'image',
    url: await conversations.readImage(conversationId, attachment),
    mimeType: attachment.mediaType,
    name: attachment.name || '图片',
    size: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    duration: null,
    metadata: attachment.originalDimensions ? { originalDimensions: attachment.originalDimensions } : {},
  };
}

async function publicMessage(conversations, message, macroValues) {
  const variableStateJson = macroValues
    ? resolveCharacterCardMacrosInJson(message.variableStateJson || '{}', macroValues)
    : message.variableStateJson;
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content || '',
    displayContent: message.displayContent ?? message.content ?? '',
    variableState: parsedJson(variableStateJson),
    status: message.status,
    createdAt: message.createdAt,
    turnId: message.turnId || '',
    speakerId: message.speakerId || '',
    speakerName: message.speakerName || '',
    speakerAvatar: message.speakerAvatar || '',
    sequence: message.sequence ?? null,
    responseIndex: message.responseIndex ?? null,
    process: message.process || [],
    attachments: await Promise.all((message.inputImageAttachments || [])
      .map((attachment) => publicImageAttachment(conversations, message.conversationId, attachment))),
    openingOptions: (message.openingOptions || []).map((option) => ({
      id: option.id,
      title: option.title,
      content: option.content,
      ...(option.displayContent === undefined ? {} : { displayContent: option.displayContent }),
      initialVariableState: parsedJson(option.initialVariableStateJson),
    })),
    selectedOpeningId: message.selectedOpeningId || '',
  };
}

function trajectoryTranslate(key, values = {}) {
  let result = trajectoryZh[key] || key;
  for (const [name, value] of Object.entries(values)) {
    result = result.replaceAll(`{${name}}`, String(value));
  }
  return result;
}

function trajectoryStatus(value, isError = false) {
  if (isError || value === 'error') return 'error';
  if (value === 'running') return 'running';
  return 'complete';
}

function trajectoryRequest(request, number) {
  const requestConfig = request.requestConfig || request.prompt?.config || {};
  return {
    number: number + 1,
    seq: Number.isSafeInteger(request.startSeq) ? request.startSeq : 0,
    turn: Number.isSafeInteger(request.turn) && request.turn > 0 ? request.turn : null,
    step: Number.isSafeInteger(request.step) && request.step > 0 ? request.step : null,
    status: trajectoryStatus(request.status),
    reason: request.purpose || '',
    provider: typeof requestConfig.provider === 'string' ? requestConfig.provider : '',
    model: typeof requestConfig.model === 'string' ? requestConfig.model : '',
    detail: JSON.stringify({
      purpose: request.purpose,
      provenance: request.provenance,
      requestConfig,
      usage: request.usage,
      error: request.error,
    }, null, 2),
    rawJson: JSON.stringify(request, null, 2),
    timeMillis: Number.isSafeInteger(request.startedAt) ? request.startedAt : null,
    durationMillis: Number.isSafeInteger(request.startedAt) && Number.isSafeInteger(request.completedAt)
      ? Math.max(0, request.completedAt - request.startedAt) : null,
  };
}

function publicTrajectory(conversationId, runtimeThreadId, snapshot, params) {
  const requestEntries = (snapshot.requests || []).map((request, index) => ({
    source: request,
    value: trajectoryRequest(request, index),
  }));
  const requestsByTurn = new Map();
  const requestsByResultSeq = new Map();
  for (const entry of requestEntries) {
    const items = requestsByTurn.get(entry.value.turn) || [];
    items.push(entry.value);
    requestsByTurn.set(entry.value.turn, items);
    if (Number.isSafeInteger(entry.source.resultSeq)) {
      const resultItems = requestsByResultSeq.get(entry.source.resultSeq) || [];
      resultItems.push(entry.value);
      requestsByResultSeq.set(entry.source.resultSeq, resultItems);
    }
  }
  const attachedTurns = new Set();
  const records = deriveTrajectoryLayout({
    systemPrompts: snapshot.systemPrompts,
    nodes: snapshot.eventNodes || [],
    eventLocations: snapshot.eventLocations,
    partial: snapshot.partial || null,
    runningCalls: snapshot.runningCalls || [],
    requests: snapshot.requests || [],
    callSchemas: snapshot.callSchemas,
  }, trajectoryTranslate).flatMap((turnModel) => turnModel.groups.flatMap((group) => (
    group.cells.map((cell) => {
      const kind = cell.kind === 'compacted' ? 'compaction'
        : cell.kind === 'message' ? 'assistant'
          : cell.kind === 'subtool' ? 'tool' : cell.kind;
      const turn = Number.isSafeInteger(turnModel.turn) && turnModel.turn > 0 ? turnModel.turn : null;
      const resultRequests = Number.isSafeInteger(cell.sourceSeq)
        ? (requestsByResultSeq.get(cell.sourceSeq) || []) : [];
      const fallbackRequests = cell.kind === 'message' && !attachedTurns.has(turn)
        ? (requestsByTurn.get(turn) || []) : [];
      const recordRequests = resultRequests.length > 0 ? resultRequests : fallbackRequests;
      if (recordRequests.length > 0) attachedTurns.add(turn);
      const input = cell.inputDetail || cell.systemPromptDetail || '';
      const output = cell.outputDetail || cell.result || cell.thinkingDetail || '';
      return {
        id: trajectoryRecordId(cell),
        index: cell.index,
        seq: Number.isSafeInteger(cell.sourceSeq) ? cell.sourceSeq : 0,
        type: cell.kind,
        kind,
        title: cell.toolName || group.title || trajectoryTranslate(`kind.${cell.kind}`),
        preview: cell.previewMarkdown || cell.resultPreviewMarkdown || cell.text || '',
        source: typeof cell.messageSource === 'string'
          ? cell.messageSource
          : cell.messageSource && typeof cell.messageSource === 'object'
            ? String(cell.messageSource.kind || cell.messageSource.label || '')
            : cell.callId || '',
        input,
        output,
        detail: [input, cell.thinkingDetail, output].filter(Boolean).join('\n\n'),
        rawJson: JSON.stringify(cell, null, 2),
        timeMillis: Number.isSafeInteger(cell.startedAt) ? cell.startedAt : null,
        durationMillis: typeof cell.timeSeconds === 'number'
          ? Math.max(0, Math.round(cell.timeSeconds * 1_000)) : null,
        turn,
        step: recordRequests[0]?.step ?? null,
        status: cell.isError === true ? 'error'
          : cell.timeSeconds === null && ['message', 'tool', 'subtool'].includes(cell.kind)
            ? 'running' : 'complete',
        requests: recordRequests,
      };
    })
  )));
  const beforeIndex = Number.isInteger(params.beforeIndex) && params.beforeIndex > 0
    ? params.beforeIndex : records.length + 1;
  const eligible = records.filter((record) => record.index < beforeIndex);
  const limit = Number.isInteger(params.limit) && params.limit > 0
    ? Math.min(200, params.limit) : 200;
  const start = Math.max(0, eligible.length - limit);
  const page = eligible.slice(start);
  const times = records.map((record) => record.timeMillis).filter(Number.isSafeInteger);
  return {
    conversationId,
    runtimeThreadId: runtimeThreadId || null,
    records: page,
    totalRecords: records.length,
    hasMore: start > 0,
    beforeIndex: page[0]?.index ?? null,
    startedAtMillis: times[0] ?? null,
    completedAtMillis: times.at(-1) ?? null,
  };
}

function sendImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new AuthorApiError('INVALID_PARAMS', '每条消息最多发送 20 张图片');
  const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  return value.map((item) => {
    const input = jsonObject(item, '消息附件格式不正确');
    const mediaType = typeof input.mediaType === 'string' ? input.mediaType : '';
    const data = typeof input.data === 'string' ? input.data.replace(/\s+/g, '') : '';
    if (input.type !== 'image' || !supported.has(mediaType)) {
      throw new AuthorApiError('INVALID_PARAMS', 'Agent 消息附件仅支持 PNG、JPEG、WebP 和 GIF 图片');
    }
    if (!data) throw new AuthorApiError('INVALID_PARAMS', '图片附件内容不能为空');
    return { mediaType, data, ...(typeof input.name === 'string' && input.name.trim()
      ? { name: input.name.trim().slice(0, 255) } : {}) };
  });
}

async function currentDetails(conversations, conversationId) {
  const snapshot = conversations.getDetailsSnapshot();
  if (snapshot.id !== conversationId) {
    throw new AuthorApiError('INVALID_CONTEXT', '当前消息所属聊天已关闭');
  }
  if (snapshot.details) return snapshot.details;
  const details = await conversations.refreshDetails();
  if (!details) throw new AuthorApiError('NOT_FOUND', '找不到当前聊天');
  return conversations.getDetailsSnapshot().details || details;
}

function targetMessage(details, id) {
  const message = details.messages.find((item) => item.id === id);
  if (!message) throw new AuthorApiError('NOT_FOUND', '找不到指定消息');
  return message;
}

function sourceUserMessage(details, message) {
  if (message.role === 'user') return message;
  const index = details.messages.findIndex((item) => item.id === message.id);
  return details.messages.slice(0, index).findLast((item) => item.role === 'user');
}

function publicChat(item) {
  return {
    id: item.id,
    title: item.title,
    preview: item.preview,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    characterId: item.metadata?.characterId || '',
    characterName: item.metadata?.characterName || '',
    characterAvatar: item.metadata?.characterAvatar || '',
  };
}

function modelItems(models) {
  const snapshot = models?.getSnapshot?.();
  return (snapshot?.configs || []).map((config) => ({
    configId: config.id,
    name: config.name,
    provider: config.provider || config.id,
    defaultModel: config.model || config.model_options?.[0]?.id || '',
    models: (config.model_options || []).map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.contextWindowTokens === undefined ? {} : { contextWindowTokens: model.contextWindowTokens }),
      ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
      supportsImageInput: model.supportsImageInput === true || model.inputModalities?.includes('image') === true,
    })),
  }));
}

async function invokeMethod(context, method, params) {
  const { conversationId, messageId, conversations, characterConfiguration, models } = context;
  const details = await currentDetails(conversations, conversationId);
  // A rich-message iframe can outlive the message node that created it. During
  // rewind/regeneration it may still call global APIs such as messages.list;
  // those APIs must not fail merely because the iframe's original message was
  // removed from the current projection.
  const requireMessage = () => targetMessage(details, messageId);
  const messages = details.messages;
  const metadata = details.metadata;
  const macroValues = characterCardMacroValues(metadata, metadata.characterPersona.user_name);
  const opening = messages.find((item) => item.id === 'opening');
  let authorState;
  const readAuthorState = async () => (authorState ||= await conversations.readAuthorState(conversationId));
  switch (method) {
    case 'app.getInfo': return { name: 'ElecKoi', apiVersion: AUTHOR_API_VERSION, stage: AUTHOR_API_STAGE };
    case 'app.getCapabilities': return authorApiDefinitions.filter((item) => (
      supportedMethods.has(item.method) && characterConversationPermissions.has(item.permission)
    ));
    case 'context.current': return {
      surface: 'message-renderer', scope: 'current-character', conversationId,
      conversationTitle: details.conversation.title, messageId, characterId: metadata.characterId,
    };
    case 'variables.getState': {
      const requestedId = typeof params.messageId === 'string' ? params.messageId.trim() : '';
      if (requestedId) return (await publicMessage(conversations, targetMessage(details, requestedId), macroValues)).variableState;
      const stateJson = (await readAuthorState()).currentVariableStateJson;
      return parsedJson(macroValues ? resolveCharacterCardMacrosInJson(stateJson, macroValues) : stateJson);
    }
    case 'variables.getConfig': return (await readAuthorState()).variableConfig;
    case 'variables.setState': return conversations.replaceAuthorVariableState(
      conversationId, jsonObject(params.state, '变量状态必须是一个对象'),
    );
    case 'variables.merge': {
      const state = await readAuthorState();
      return conversations.replaceAuthorVariableState(conversationId, mergeObjects(
        jsonObject(parsedJson(state.currentVariableStateJson), '当前变量状态不正确'),
        jsonObject(params.state, '合并内容必须是一个对象'),
      ));
    }
    case 'variables.applyPatch': {
      const state = await readAuthorState();
      return conversations.replaceAuthorVariableState(conversationId, applyVariablePatch(
        jsonObject(parsedJson(state.currentVariableStateJson), '当前变量状态不正确'), params.patch,
      ));
    }
    case 'variables.reset': return conversations.replaceAuthorVariableState(
      conversationId, jsonObject(parsedJson((await readAuthorState()).initialVariableStateJson), '初始变量状态不正确'),
    );
    case 'openings.list': return { items: (await publicMessage(conversations, opening || requireMessage(), macroValues)).openingOptions };
    case 'openings.current': {
      const current = await publicMessage(conversations, opening || requireMessage(), macroValues);
      return current.openingOptions.find((item) => item.id === current.selectedOpeningId) || null;
    }
    case 'openings.select': {
      const id = typeof params.id === 'string' ? params.id.trim() : '';
      if (!id) throw new AuthorApiError('INVALID_PARAMS', '开场白 id 不能为空');
      await conversations.selectOpening(conversationId, id);
      return { selectedId: id };
    }
    case 'messages.list': return Promise.all(messages.map((item) => publicMessage(conversations, item, macroValues)));
    case 'messages.get': {
      const id = typeof params.id === 'string' ? params.id.trim() : '';
      if (!id) throw new AuthorApiError('INVALID_PARAMS', '消息 id 不能为空');
      return publicMessage(conversations, targetMessage(details, id), macroValues);
    }
    case 'messages.current': return publicMessage(conversations, messages.at(-1) || requireMessage(), macroValues);
    case 'messages.setContent': {
      const id = typeof params.id === 'string' ? params.id.trim() : '';
      if (!id) throw new AuthorApiError('INVALID_PARAMS', '消息 id 不能为空');
      if (typeof params.text !== 'string') throw new AuthorApiError('INVALID_PARAMS', '消息正文必须是文本');
      if (params.text.length > 1_000_000) throw new AuthorApiError('INVALID_PARAMS', '消息正文过长');
      const target = targetMessage(details, id);
      const updated = target.id === 'opening'
        ? await conversations.updateOpening(conversationId, params.text)
        : Number.isInteger(target.sessionEventSeq)
          ? await conversations.editMessage(conversationId, target.sessionEventSeq, target.role, params.text)
          : null;
      if (!updated) throw new AuthorApiError('INVALID_CONTEXT', '这条消息当前不能改写');
      const updatedTarget = targetMessage(updated, id);
      return publicMessage(conversations, updatedTarget, macroValues);
    }
    case 'messages.deleteFrom': {
      const id = typeof params.id === 'string' ? params.id.trim() : '';
      const target = targetMessage(details, id);
      if (!Number.isInteger(target.sessionEventSeq)) throw new AuthorApiError('INVALID_CONTEXT', '消息尚未写入 DSH Session');
      const result = await conversations.deleteMessagesFrom(conversationId, target.sessionEventSeq, target.role);
      return { deletedMessageCount: result.deletedMessageCount, remainingMessageCount: result.remainingMessageCount };
    }
    case 'messages.regenerate':
    case 'messages.editAndRegenerate': {
      const id = typeof params.id === 'string' ? params.id.trim() : '';
      const target = targetMessage(details, id);
      const user = sourceUserMessage(details, target);
      if (!user || !Number.isInteger(user.sessionEventSeq)) throw new AuthorApiError('INVALID_CONTEXT', '找不到对应的 DSH 用户消息');
      const replacementMessage = method === 'messages.editAndRegenerate'
        ? (typeof params.text === 'string' ? params.text.trim() : '') : undefined;
      if (method === 'messages.editAndRegenerate' && !replacementMessage) {
        throw new AuthorApiError('INVALID_PARAMS', '修改后的消息不能为空');
      }
      if (replacementMessage?.length > 100_000) throw new AuthorApiError('INVALID_PARAMS', '修改后的消息过长');
      const requestIdValue = crypto.randomUUID();
      const result = await conversations.regenerate({ conversationId, eventSeq: user.sessionEventSeq,
        requestId: requestIdValue, replacementMessage });
      return { accepted: true, conversationId, runId: details.runtimeSessionId,
        messageId: result.details?.messages?.at(-1)?.id || target.id };
    }
    case 'chat.current': return publicChat({ ...details.conversation, metadata });
    case 'chat.list': {
      const snapshot = conversations.getSnapshot();
      const items = snapshot.status === 'ready' ? snapshot.items : await conversations.refresh();
      return { items: items.filter((item) => !metadata.characterId || item.metadata?.characterId === metadata.characterId).map(publicChat) };
    }
    case 'chat.getGenerationState': {
      const stream = conversations.getStreamSnapshot();
      const stats = conversations.getStatsSnapshot();
      return {
        active: stream.id === conversationId && stream.status === 'running', conversationId,
        runId: stream.id === conversationId ? stream.runId : '', messageId: stream.id === conversationId ? stream.messageId : '',
        accumulated: stream.id === conversationId ? stream.content : '', sequence: stream.id === conversationId ? stream.sequence : 0,
        stats: stats.id === conversationId ? stats.stats : null,
      };
    }
    case 'chat.getAgentTrajectory': {
      return publicTrajectory(conversationId, details.runtimeSessionId,
        await conversations.readTrajectory(conversationId), params);
    }
    case 'chat.getModels': {
      const current = await conversations.readModelSelection(conversationId);
      return { current: { configId: current.provider, model: current.model }, items: modelItems(models) };
    }
    case 'chat.selectModel': {
      const configId = typeof params.configId === 'string' ? params.configId.trim() : '';
      const model = typeof params.model === 'string' ? params.model.trim() : '';
      if (!configId || !model) throw new AuthorApiError('INVALID_PARAMS', 'DSH 模型提供商和模型不能为空');
      const selected = await conversations.selectModel(conversationId, { provider: configId, model });
      return { configId: selected.provider, model: selected.model };
    }
    case 'chat.send': {
      const text = typeof params.text === 'string' ? params.text.trim() : '';
      const images = sendImages(params.attachments);
      if (!text && images.length === 0) throw new AuthorApiError('INVALID_PARAMS', '发送内容和图片不能同时为空');
      if (text.length > 100_000) throw new AuthorApiError('INVALID_PARAMS', '发送内容过长');
      const requestIdValue = crypto.randomUUID();
      const result = await conversations.send({ conversationId, text, images, requestId: requestIdValue });
      return { accepted: true, conversationId, runId: details.runtimeSessionId,
        messageId: result.details?.messages?.at(-1)?.id || '' };
    }
    case 'chat.stopGeneration': {
      const stream = conversations.getStreamSnapshot();
      return { cancelled: stream.id === conversationId && stream.runId
        ? await conversations.cancelStream(stream.runId) : false };
    }
    case 'chat.create': {
      if (!metadata.characterId) throw new AuthorApiError('INVALID_CONTEXT', '当前聊天没有绑定角色');
      const title = typeof params.title === 'string' ? params.title.trim() : '';
      const created = await conversations.create({ title: title || metadata.characterName || '新对话', metadata });
      return { chat: publicChat({ ...created.conversation, metadata: created.metadata }) };
    }
    case 'chat.open': {
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
      const item = conversations.getSnapshot().items.find((candidate) => candidate.id === sessionId);
      if (!item) throw new AuthorApiError('NOT_FOUND', '找不到聊天');
      if (!metadata.characterId || item.metadata?.characterId !== metadata.characterId) {
        throw new AuthorApiError('OUT_OF_SCOPE', '角色对话界面只能打开当前角色的聊天');
      }
      return { chat: publicChat(item) };
    }
    case 'chat.delete': {
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
      const catalog = conversations.getSnapshot().items;
      const target = catalog.find((item) => item.id === sessionId);
      if (!target) throw new AuthorApiError('NOT_FOUND', '找不到聊天');
      if (!metadata.characterId || target.metadata?.characterId !== metadata.characterId) {
        throw new AuthorApiError('OUT_OF_SCOPE', '角色对话界面只能删除当前角色的聊天');
      }
      await conversations.delete(sessionId);
      const remaining = conversations.getSnapshot().items.filter((item) => item.metadata?.characterId === metadata.characterId);
      const active = remaining[0] || await conversations.create({ title: metadata.characterName || '新对话', metadata });
      return { deletedId: sessionId, chat: publicChat(active.conversation ? { ...active.conversation, metadata: active.metadata } : active) };
    }
    case 'character.current': return { id: metadata.characterId, name: metadata.characterName,
      avatar: metadata.characterAvatar, persona: metadata.characterPersona };
    case 'settingLibrary.getSummary': return (await readAuthorState()).settingLibrarySummary;
    case 'settingLibrary.current': return (await readAuthorState()).settingLibrary;
    case 'settingLibrary.replace': {
      const runtimeLibrary = jsonObject(params.library, '设定库内容必须是一个对象');
      const settingLibraries = characterConfiguration?.settingLibraries;
      if (!metadata.characterId || !settingLibraries?.readUntracked || !settingLibraries?.saveConversation) {
        throw new AuthorApiError('INVALID_CONTEXT', '当前聊天的设定库尚未就绪');
      }
      if (runtimeLibrary.characterId !== metadata.characterId || !Array.isArray(runtimeLibrary.entries)
        || !Array.isArray(runtimeLibrary.groups) || !Array.isArray(runtimeLibrary.promptPositions)) {
        throw new AuthorApiError('INVALID_PARAMS', '设定库内容与当前角色不匹配');
      }
      const base = await settingLibraries.readUntracked(metadata.characterId);
      const saved = await settingLibraries.saveConversation(metadata.characterId, conversationId, {
        ...base,
        name: typeof runtimeLibrary.name === 'string' ? runtimeLibrary.name : base.name,
        entries: runtimeLibrary.entries,
        groups: runtimeLibrary.groups,
        promptPositions: runtimeLibrary.promptPositions,
      });
      return {
        characterId: saved.characterId,
        name: saved.name,
        entries: saved.entries,
        groups: saved.groups,
        promptPositions: saved.promptPositions,
      };
    }
    case 'media.getMessageAttachments': {
      const target = typeof params.messageId === 'string' && params.messageId.trim()
        ? targetMessage(details, params.messageId.trim()) : requireMessage();
      return { items: await Promise.all((target.inputImageAttachments || [])
        .map((item) => publicImageAttachment(conversations, conversationId, item))) };
    }
    case 'media.getMessageAttachment': {
      const target = targetMessage(details, typeof params.messageId === 'string' ? params.messageId.trim() : '');
      const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId.trim() : '';
      const attachment = target.inputImageAttachments?.find((item) => item.attachmentId === attachmentId);
      if (!attachment) throw new AuthorApiError('NOT_FOUND', '找不到这条消息里的媒体附件');
      return publicImageAttachment(conversations, conversationId, attachment);
    }
    case 'events.list': return { items: AUTHOR_EVENT_NAMES };
    default: throw new AuthorApiError('METHOD_NOT_FOUND', `当前页面不支持 ${method}`);
  }
}

export async function routeAuthorConversationRequest(rawRequest, context) {
  const gateKey = `${context.bridgeKey}:${context.conversationId}:${context.messageId}`;
  let gate = gates.get(gateKey);
  if (gate) gates.delete(gateKey);
  else {
    gate = new AuthorBridgeRequestGate();
    if (gates.size >= 1_024) gates.delete(gates.keys().next().value);
  }
  gates.set(gateKey, gate);
  const rejection = gate.tryAcquire(rawRequest);
  if (rejection) return JSON.stringify({ id: requestId(rawRequest), ok: false,
    error: { code: rejection, message: bridgeErrors[rejection] } });
  try {
    return await routeAuthorApiRequest(rawRequest, characterConversationPermissions,
      (method, params) => invokeMethod(context, method, params));
  } finally {
    gate.release();
  }
}
