import { createSystemMessage, createUserMessage, freezeMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readSessionSnapshot } from './session-snapshot.mjs'
import { requiredSettingCache } from './required-setting-cache.mjs'
import { recordRequestContext } from './request-context-record.mjs'
import { projectFrozenWorldbookMessages } from '@eleckoi/dsh-worldbook-compat'
import { tavernPresetPlan, projectTavernPresetMessages, isCompatibilityCharacterField } from './tavern-preset-projection.mjs'

export const name = 'eleckoi-conversation-context'
export const projectionPlugin = 'eleckoi-request-projection'

const PROJECTION_VERSION = 2
const PROJECTION_PREFIX = `ELECKOI_REQUEST_PROJECTION_V${PROJECTION_VERSION}\n`
// TODO(迁移清理)：所有仍受支持的 Session 恢复、导入入口已转换持久化 V1 投影后，
// 删除此常量、decodeProjectionEnvelope 的 V1 分支和旧样例。历史补回不会改写旧信封；
// 必须单独核对该持久数据，保留当前 V2 信封、请求投影和角色上下文装配。
const LEGACY_PROJECTION_PREFIX = 'ELECKOI_REQUEST_PROJECTION_V1\n'

/** Install product-owned prompt contributions for every root turn. */
export function installConversationContext(agentCtx, snapshotRoot, sourceSessionId) {
  const read = () => {
    const snapshot = readSessionSnapshot(snapshotRoot, sourceSessionId)
    const persistedContext = JSON.parse(readFileSync(snapshot.contextFile, 'utf8'))
    const conversationContext = {
      ...persistedContext,
      conversationId: snapshot.conversationId ?? persistedContext.conversationId
    }
    return { ...snapshot, conversationContext }
  }
  const disposeStepProjection = agentCtx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const snapshot = requestProjectionSnapshot(read().conversationContext)
    if ((snapshot.plan.length === 0 && snapshot.history.length === 0)
      || activeProjectionEnvelope(agent.session)) return decision
    return {
      ...decision,
      messages: [...decision.messages, projectionEnvelope(snapshot)]
    }
  })
  const disposeRequestProjection = agentCtx.on('llm/stream', (options, next) => {
    if (!isAgentLoopRequest(options) || options.sessionId !== sourceSessionId) return next()
    const session = agentCtx.sessions.get(options.sessionId)
    if (!session) return next()
    const snapshot = read()
    const projection = requestProjectionSnapshot(snapshot.conversationContext)
    ensureProjectionEnvelope(session, projection)
    const productMessages = projectProductHistory(session.deriveMessages(), snapshot.conversationContext)
    const messages = projectRequestMessages(
      appendSessionInstructions(projectCurrentUserPrompt(productMessages, snapshot.conversationContext), snapshot), projection.plan
    )
    recordRequestContext(agentCtx.sessionProjections, session, requestContextItems(messages, projection.plan))
    const request = {
      ...options,
      messages
    }
    const mainGeneration = typeof agentCtx.get === 'function' ? agentCtx.get('eleckoiMainAgentGeneration', false) : agentCtx.eleckoiMainAgentGeneration
    if (mainGeneration) return mainGeneration.streamRequest(request, snapshot.conversationContext)
    // Provider transport must see the assembled product prompt, never the
    // durable projection envelope or unfrozen Session input.
    const settings = snapshot.conversationContext.compatibilityPreset?.compatibility === true
      ? snapshot.conversationContext.compatibilityPreset.settings : undefined
    if (settings && options.purpose !== 'compaction') {
      const generation = typeof agentCtx.get === 'function' ? agentCtx.get('eleckoiCompatibilityGeneration', false) : agentCtx.eleckoiCompatibilityGeneration
      if (!generation) throw new Error('The shared preset generation service is not mounted')
      if (generation.requiresAdvancedSettings(settings)) return generation.streamWithSettings(request, settings, {
        conversationId: snapshot.conversationContext.conversationId ?? snapshot.conversationId
      })
    }
    return agentCtx.llm.stream(request)
  })
  return () => {
    disposeRequestProjection()
    disposeStepProjection()
  }
}

function sessionInstructions(snapshot) {
  const additions = (snapshot.conversationContext?.worldbookRound || snapshot.conversationContext?.compatibilityPreset?.compatibility
    ? [] : settingInjections(snapshot.conversationContext))
    .filter((entry) => entry.anchor === 'instructions')
    .map((entry) => entry.content)
  return [snapshot.model?.systemPrompt, ...additions]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n\n')
}

function appendSessionInstructions(input, snapshot) {
  const instructions = sessionInstructions(snapshot)
  if (!instructions) return input
  const messages = [...input]
  const systemIndex = messages.findLastIndex((message) => message?.role === 'system')
  if (systemIndex >= 0) {
    const system = messages[systemIndex]
    messages[systemIndex] = freezeMessage({ ...system, content: [...system.content, { type: 'text', text: `\n\n${instructions}` }] })
  } else {
    const id = `eleckoi-system-${createHash('sha256').update(instructions).digest('hex')}`
    messages.unshift(freezeMessage({ ...createSystemMessage(instructions, name), id }))
  }
  return messages
}

/** Freeze the complete active position graph into one durable projection definition. */
export function requestProjectionPlan(context) {
  const managed = context?.worldbookRound
  const orderedPreset = context?.compatibilityPreset?.compatibility === true
  const tavern = tavernPresetPlan(context)
  const databank = (context?.dataBankRound ?? []).map((row) => ({
    id: `databank:${row.documentId}:${row.index}`, role: 'system', content: `[${row.name}]\n${row.text}`,
    anchor: 'beforeHistory', projectionKind: 'worldbook', projectionRank: 50,
    traceTitle: `资料库 · ${row.name}`, traceSource: String(row.url ?? row.documentId)
  }))
  const groupDepth = (context?.groupDepthPrompts ?? []).map((entry, index) => ({
    id: `group-depth:${index}`, content: String(entry.text ?? ''), role: ['system', 'user', 'assistant'][entry.role] ?? entry.role ?? 'system',
    anchor: 'beforeLatestUserInput', worldbookPosition: 'at_depth', projectionKind: 'worldbook', projectionRank: 40,
    depth: Number(entry.depth), order: index, traceTitle: '群聊成员深度提示', traceSource: 'group'
  }))
  const compatibilityInjections = (context?.compatibilityInjections ?? []).filter(entry => entry.position !== 'none' && entry.content).map((entry, index) => ({
    ...entry, id: `plugin-injection:${entry.id ?? index}`, role: entry.role || 'system',
    anchor: ({ beforeHistory: 'insert_point_2', afterHistory: 'insert_point_5', beforeLatestUserInput: 'insert_point_3',
      afterLatestUserInput: 'insert_point_4', beforeToolContext: 'insert_point_3', afterToolContext: 'insert_point_5' })[entry.anchor] || entry.anchor || 'instructions',
    ...(entry.depth !== undefined ? { projectionKind: 'worldbook', worldbookPosition: 'at_depth', projectionRank: 40 } : {}),
    traceTitle: entry.traceTitle || '插件提示', traceSource: entry.traceSource || entry.pluginId || 'plugin'
  }))
  if (context?.mainGenerationOptions?.quiet_prompt && ['regenerate', 'swipe'].includes(context.mainGenerationOptions.type)) {
    compatibilityInjections.push({ id: 'main-generation:quiet-prompt', role: 'system', content: context.mainGenerationOptions.quiet_prompt,
      anchor: 'insert_point_5', traceTitle: '生成附加指令', traceSource: 'generate-options' })
  }
  const native = settingInjections(context)
    .filter((entry) => (managed || orderedPreset || entry.anchor !== 'instructions')
      && (!orderedPreset || !isCompatibilityCharacterField(entry.id)))
    .map((entry) => ({
      id: entry.id,
      anchor: entry.anchor,
      role: entry.role,
      content: entry.content,
      placementRank: entry.placementRank,
      positionOrder: entry.positionOrder,
      order: entry.order,
      traceTitle: entry.traceTitle,
      traceSource: entry.traceSource,
      ...(managed || orderedPreset ? { section: entry.id.startsWith('agent-preset:') ? 'preset'
        : entry.anchor === 'instructions' || entry.id === 'tavern-character-description'
          || /^compat-character:[^:]+:(?:description|personality|scenario)$/.test(entry.id)
          ? 'character-definition' : 'native' } : {})
    }))
  if (!managed) return [...native, ...tavern, ...groupDepth, ...databank, ...compatibilityInjections]
  const enabledPlaceholder = id => tavern.some(entry => entry.presetPromptId === id)
  const worldbooks = [...managed.fragments, ...managed.examples].filter(entry => {
    if (!orderedPreset) return true
    if (entry.anchor === 'examples') return false
    if (entry.worldbookPosition === 'before_character_definition') return enabledPlaceholder('worldInfoBefore')
    if (entry.worldbookPosition === 'after_character_definition') return enabledPlaceholder('worldInfoAfter')
    if (['before_example_messages', 'after_example_messages'].includes(entry.worldbookPosition)) return enabledPlaceholder('dialogueExamples')
    return true
  }).map((entry) => ({
    ...entry, id: `worldbook:${entry.id}`, projectionKind: 'worldbook',
    projectionRank: ({ before_character_definition: 0, after_character_definition: 10,
      before_example_messages: 20, after_example_messages: 30, at_depth: 40 })[entry.worldbookPosition] ?? 40,
    traceTitle: '世界书条目', traceSource: String(entry.id ?? ''),
    ...(entry.anchor === 'examples' ? { section: 'examples' } : {})
  }))
  const note = managed.authorNote
  if (note?.position !== 'none' && typeof note?.content === 'string' && note.content.trim()) {
    worldbooks.push({
      ...note, id: `worldbook:${note.id || '2_floating_prompt'}`, projectionKind: 'worldbook',
      role: note.role ?? 'system', anchor: note.anchor ?? 'beforeHistory',
      ...(note.depth !== undefined ? { worldbookPosition: 'at_depth' } : {}),
      traceTitle: '作者注释', traceSource: 'authors-note'
    })
  }
  return [...native, ...tavern, ...worldbooks, ...groupDepth, ...databank, ...compatibilityInjections]
}

/** Dry-run uses the same position graph and frozen history, without touching the durable Session. */
export function previewConversationRequest(context, model) {
  const history = (context.history ?? []).map(productHistoryMessage).filter(Boolean)
  const input = createUserMessage({ source: { kind: 'eleckoi-generation' }, content: [{ type: 'text', text: context.currentPromptText ?? '' },
    ...(context.mainGenerationOptions?.promptImages ?? [])] })
  return projectRequestMessages(appendSessionInstructions([...history, input], { conversationContext: context, model }), requestProjectionPlan(context))
}

/** Persist the product history that is authoritative for this provider request. */
export function requestProjectionSnapshot(context) {
  return {
    plan: requestProjectionPlan(context),
    historyMode: context?.historyMode === 'prefix' ? 'prefix' : 'replace',
    history: (Array.isArray(context?.history) ? context.history : [])
      .flatMap((item) => isProductHistoryEntry(item)
        ? [{ role: item.role, content: item.content,
            ...(typeof item.id === 'string' ? { id: item.id } : {}),
            ...(Number.isSafeInteger(item.sessionEventSeq) ? { sessionEventSeq: item.sessionEventSeq } : {}) }]
        : [])
  }
}

/**
 * Rebuild the exact provider-facing message order for one model request.
 * The projection envelope itself stays durable in the DSH log but never reaches
 * the provider. Every tool continuation is therefore reassembled against the
 * latest real user input and the tool flow accumulated after it.
 */
export function projectRequestMessages(messages, plan = projectionPlanFromMessages(messages)) {
  const visible = messages.filter((message) => !isProjectionEnvelope(message))
  if (!plan) return visible
  const globalSystem = message => message?.role === 'system' && message.source?.kind !== 'plugin:eleckoi-product-history'
  const system = visible.filter(globalSystem)
  const dialogue = visible.filter(message => !globalSystem(message))
  const latestUserIndex = dialogue.findLastIndex(isDirectUserMessage)
  if (latestUserIndex < 0) {
    return projectWorldbookPlan([
      ...system,
      ...messagesForAnchor(plan, 'instructions'),
      ...messagesForAnchor(plan, 'insert_point_1'),
      ...messagesForAnchor(plan, 'insert_point_2'),
      ...messagesForAnchor(plan, 'examples'),
      ...dialogue,
      ...messagesForAnchor(plan, 'insert_point_3'),
      ...messagesForAnchor(plan, 'insert_point_4'),
      ...messagesForAnchor(plan, 'insert_point_5')
    ], plan)
  }
  return projectWorldbookPlan([
    ...system,
    ...messagesForAnchor(plan, 'instructions'),
    ...messagesForAnchor(plan, 'insert_point_1'),
    ...messagesForAnchor(plan, 'insert_point_2'),
    ...messagesForAnchor(plan, 'examples'),
    ...dialogue.slice(0, latestUserIndex),
    ...messagesForAnchor(plan, 'insert_point_3'),
    dialogue[latestUserIndex],
    ...messagesForAnchor(plan, 'insert_point_4'),
    ...dialogue.slice(latestUserIndex + 1),
    ...messagesForAnchor(plan, 'insert_point_5')
  ], plan)
}

function projectWorldbookPlan(messages, plan) {
  const preset = projectTavernPresetMessages(messages, plan, projectionMessage, projectionPlugin)
  messages = preset.messages
  const fragments = plan.filter(entry => (entry.projectionKind === 'worldbook' && entry.anchor !== 'examples')
    || entry.projectionKind === 'tavern-preset-depth')
  if (!fragments.length) return messages
  const byId = new Map(plan.map(entry => [`${projectionPlugin}:${entry.id}`, entry]))
  const indexes = predicate => messages.flatMap((message, index) => predicate(message, byId.get(message.id)) ? [index] : [])
  const character = indexes((_message, entry) => entry?.section === 'character-definition')
  const examples = indexes((_message, entry) => entry?.section === 'examples')
  const history = indexes(isRequestHistoryMessage)
  const latestUser = messages.findLastIndex(isDirectUserMessage)
  const afterSystem = messages.findIndex(message => message.role !== 'system')
  const beforeHistory = history[0] ?? (latestUser >= 0 ? latestUser : messages.length)
  const beforeCharacter = character[0] ?? (afterSystem < 0 ? messages.length : afterSystem)
  return projectFrozenWorldbookMessages(messages, fragments, {
    anchorIndexes: {
      beforeCharacterDefinition: beforeCharacter,
      afterCharacterDefinition: character.length ? character.at(-1) + 1 : beforeCharacter,
      beforeExamples: examples[0] ?? beforeHistory,
      afterExamples: examples.length ? examples.at(-1) + 1 : beforeHistory,
      beforeHistory,
      beforeLatestUserInput: latestUser >= 0 ? latestUser : beforeHistory,
      afterLatestUserInput: latestUser >= 0 ? latestUser + 1 : messages.length,
      ...preset.anchorIndexes
    },
    isHistoryMessage: isRequestHistoryMessage,
    createMessage: projectionMessage
  })
}

function isRequestHistoryMessage(message) {
  return isDirectUserMessage(message) || message?.source?.kind === 'plugin:eleckoi-product-history'
    || message?.role === 'assistant' && message?.source?.kind === 'model'
      && !String(message.id ?? '').startsWith(`${projectionPlugin}:`)
      && message.content?.some(block => block.type === 'text')
      && !message.content.some(block => block.type === 'tool-call' || block.type === 'tool-result')
}

export function projectionPlanFromMessages(messages) {
  const envelope = messages.findLast(isProjectionEnvelope)
  if (!envelope) return undefined
  return decodeProjectionEnvelope(envelope).plan
}

/** Reconstruct previously recorded provider input from its product envelope. */
export function replayRequestContext(messages) {
  const envelope = messages.findLast(isProjectionEnvelope)
  const snapshot = envelope ? decodeProjectionEnvelope(envelope) : undefined
  const history = snapshot ? projectProductHistory(messages, snapshot) : messages
  return requestContextItems(projectRequestMessages(history, snapshot?.plan), snapshot?.plan)
}

export function isProjectionEnvelope(message) {
  return message?.role === 'user'
    && message?.source?.kind === `plugin:${projectionPlugin}`
}

export function requestContextItems(messages, plan = []) {
  const projectionByMessageId = new Map(plan.map((entry) => [
    `${projectionPlugin}:${entry.id}`,
    entry
  ]))
  const latestUserIndex = messages.findLastIndex(isDirectUserMessage)
  return messages.map((message, index) => {
    const projection = projectionByMessageId.get(String(message?.id ?? ''))
    const role = message?.role === 'system' || message?.role === 'assistant' ? message.role : 'user'
    if (projection) {
      return {
        order: index + 1,
        messageId: String(message?.id ?? ''),
        role,
        kind: 'prompt',
        title: projection.traceTitle || '设定提示词',
        source: projection.traceSource || positionLabel(projection.anchor),
        anchor: projection.anchor,
        content: readableMessageContent(message)
      }
    }
    const source = message?.source && typeof message.source === 'object' ? message.source : {}
    const kind = requestContextKind(message, source)
    const directUser = source.kind === 'user'
    return {
      order: index + 1,
      messageId: String(message?.id ?? ''),
      role,
      kind,
      title: requestContextTitle(message, source, directUser && index === latestUserIndex),
      source: requestContextSource(source, directUser && index === latestUserIndex),
      anchor: '',
      content: readableMessageContent(message)
    }
  }).filter((item) => item.content)
}

function requestContextKind(message, source) {
  if (source.kind === 'plugin:eleckoi-product-history') return 'history'
  if (message?.role === 'system') return 'system'
  if (source.kind === 'tool' || message?.content?.some((block) => block?.type === 'tool-result')) return 'tool'
  if (source.kind === 'plugin:eleckoi-product-history') return 'history'
  if (source.kind === 'user') return 'user'
  if (message?.role === 'assistant') return 'assistant'
  return 'context'
}

function requestContextTitle(message, source, latestUser) {
  if (message?.role === 'system') return '系统提示词'
  if (source.kind === 'tool' || message?.content?.some((block) => block?.type === 'tool-result')) return '工具结果'
  if (message?.content?.some((block) => block?.type === 'tool-call')) return '助手工具调用'
  if (source.kind === 'user') return latestUser ? '用户最新输入' : '用户消息'
  if (source.kind === 'plugin:eleckoi-product-history') return message?.role === 'assistant' ? '历史助手消息' : '历史用户消息'
  if (source.kind === 'model' || message?.role === 'assistant') return '助手消息'
  return source.sections?.[0]?.name || '上下文'
}

function requestContextSource(source, latestUser) {
  if (source.kind === 'user') return latestUser ? '本轮输入' : '聊天记录'
  if (source.kind === 'tool') return source.callId ? `工具结果 · ${source.callId}` : '工具结果'
  if (source.kind === 'plugin:eleckoi-product-history') return '聊天记录'
  if (source.kind === 'model') return [source.provider, source.model].filter(Boolean).join(' · ') || '模型'
  if (source.kind?.startsWith('plugin:')) return source.kind.slice('plugin:'.length)
  return source.kind || ''
}

function readableMessageContent(message) {
  return Array.isArray(message?.content)
    ? message.content.map(readableBlock).filter(Boolean).join('\n\n')
    : ''
}

function readableBlock(block) {
  if (!block || typeof block !== 'object') return ''
  if (block.type === 'text') return String(block.text ?? '')
  if (block.type === 'reasoning') return `思考\n${String(block.text ?? '')}`
  if (block.type === 'image') {
    const attachment = block.attachment && typeof block.attachment === 'object' ? block.attachment : {}
    return `[图片] ${attachment.name || attachment.id || attachment.mediaType || '图片附件'}`
  }
  if (block.type === 'file') {
    const attachment = block.attachment && typeof block.attachment === 'object' ? block.attachment : {}
    return `[文件] ${attachment.name || attachment.id || '文件附件'}`
  }
  if (block.type === 'tool-call') {
    return `调用工具 ${String(block.name || '')}\n${prettyJsonText(block.arguments)}`.trim()
  }
  if (block.type === 'tool-result') {
    const result = Array.isArray(block.content) ? block.content.map(readableBlock).filter(Boolean).join('\n\n') : ''
    return `${block.isError ? '工具返回错误' : '工具返回结果'}${result ? `\n${result}` : ''}`
  }
  try {
    return JSON.stringify(block, null, 2)
  } catch {
    return String(block.type || '')
  }
}

function prettyJsonText(value) {
  if (typeof value !== 'string') return String(value ?? '')
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function activeProjectionEnvelope(session) {
  for (const seq of session.surface.nodes.toReversed()) {
    const event = session.eventAt(seq)
    if (event?.type === 'user/message' && isProjectionEnvelope(event.data)) return event
  }
}

function ensureProjectionEnvelope(session, snapshot) {
  const current = activeProjectionEnvelope(session)
  const next = projectionEnvelope(snapshot)
  if (current && messageText(current.data) === messageText(next)) return current
  if (!current && snapshot.plan.length === 0 && snapshot.history.length === 0) return undefined
  if (!current) {
    return session.append('user/message', next, { surfaceOp: 'append' })
  }
  return session.append('user/message', next, {
    surfaceOp: { op: 'replace', startSeq: current.seq, endSeq: current.seq },
    sourceEventSeqs: [current.seq]
  })
}

function projectionEnvelope(snapshot) {
  return freezeMessage({
    id: `${projectionPlugin}:v${PROJECTION_VERSION}`,
    role: 'user',
    content: [{ type: 'text', text: `${PROJECTION_PREFIX}${JSON.stringify(snapshot)}` }],
    source: {
      kind: `plugin:${projectionPlugin}`,
      form: 'snapshot',
      sections: snapshot.plan.map((entry) => ({ name: entry.traceTitle || entry.id, text: entry.content }))
    }
  })
}

function decodeProjectionEnvelope(message) {
  const text = messageText(message)
  const prefix = text.startsWith(PROJECTION_PREFIX)
    ? PROJECTION_PREFIX
    : text.startsWith(LEGACY_PROJECTION_PREFIX) ? LEGACY_PROJECTION_PREFIX : undefined
  if (!prefix) return { plan: [], historyMode: 'replace', history: [] }
  try {
    const value = JSON.parse(text.slice(prefix.length))
    if (Array.isArray(value)) return { plan: value.filter(isProjectionEntry), historyMode: 'replace', history: [] }
    if (!value || typeof value !== 'object') return { plan: [], historyMode: 'replace', history: [] }
    return {
      plan: Array.isArray(value.plan) ? value.plan.filter(isProjectionEntry) : [],
      historyMode: value.historyMode === 'prefix' ? 'prefix' : 'replace',
      history: Array.isArray(value.history) ? value.history.filter(isProductHistoryEntry) : []
    }
  } catch {
    return { plan: [], history: [] }
  }
}

function isProjectionEntry(value) {
  return value && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.anchor === 'string'
    && (value.role === 'user' || value.role === 'assistant' || value.role === 'system')
    && typeof value.content === 'string'
}

function isDirectUserMessage(message) {
  return message?.role === 'user' && ['user', 'eleckoi-group', 'eleckoi-generation'].includes(message?.source?.kind)
}

function messagesForAnchor(plan, anchor) {
  return plan
    .filter((entry) => entry.anchor === anchor && (entry.projectionKind !== 'worldbook' || anchor === 'examples'))
    .map(projectionMessage)
}

function projectionMessage(entry) {
  return freezeMessage({
    id: `${projectionPlugin}:${entry.id}`,
    role: entry.role,
    content: [{ type: 'text', text: entry.content }],
    source: entry.role === 'assistant'
      ? { kind: 'model', provider: 'eleckoi', model: 'prompt-projection' }
      : {
          kind: `plugin:${name}`,
          form: 'snapshot',
          sections: [{ name: entry.traceTitle || entry.id || name, text: entry.content }]
        }
  })
}

/**
 * Keep prior user input and final replies, with the active turn's full flow.
 */
export function projectProductHistory(messages, context) {
  const currentUserIndex = findCurrentUserIndex(messages)
  if (currentUserIndex < 0) return messages
  const firstDialogue = messages.findIndex((message, index) => (
    index <= currentUserIndex && isDialogueMessage(message)
  ))
  const replaceFrom = firstDialogue < 0 ? currentUserIndex : firstDialogue
  const nativeHistory = messages.slice(replaceFrom, currentUserIndex)
  const productHistory = (Array.isArray(context?.history) ? context.history : [])
    .map(productHistoryMessage)
    .filter(Boolean)
  if (context?.historyMode === 'prefix') {
    const dialogueHistory = previousTurnDialogue(nativeHistory)
    const prefix = productHistory.filter((product, index) => !messagesMatch(product, dialogueHistory[index]))
    return [
      ...messages.slice(0, replaceFrom),
      ...prefix,
      ...dialogueHistory,
      ...messages.slice(currentUserIndex)
    ]
  }
  const authoritative = compactedProjection(productHistory, nativeHistory) ?? productHistory
  return [
    ...messages.slice(0, replaceFrom),
    ...authoritative,
    ...messages.slice(currentUserIndex)
  ]
}

function previousTurnDialogue(messages) {
  const history = []
  let finalReply
  const flush = () => {
    if (finalReply) history.push(finalReply)
    finalReply = undefined
  }
  for (const message of messages) {
    if (isDirectUserMessage(message) || isCompactionCheckpoint(message)) {
      flush()
      history.push(message)
    } else if (message?.role === 'assistant'
      && message?.source?.kind !== 'tool'
      && !message.content?.some(block => block?.type === 'tool-call' || block?.type === 'tool-result')) {
      const content = normalizedDialogueText(messageText(message), 'assistant')
      if (content) finalReply = freezeMessage({
        id: message.id,
        role: 'assistant',
        content: [{ type: 'text', text: content }],
        source: { kind: 'plugin:eleckoi-product-history' }
      })
    }
  }
  flush()
  return history
}

function isProductHistoryEntry(value) {
  return value && typeof value === 'object'
    && (value.role === 'user' || value.role === 'assistant' || value.role === 'system')
    && typeof value.content === 'string'
    && value.content.trim().length > 0
}

/** Apply prompt transformations to the provider request while keeping the DSH user event unchanged. */
export function projectCurrentUserPrompt(messages, context) {
  const prompt = context?.currentPromptText
  if (typeof prompt !== 'string') return messages
  const index = messages.findLastIndex(isDirectUserMessage)
  if (index < 0) return messages
  const message = messages[index]
  const content = []
  let inserted = false
  for (const part of message.content ?? []) {
    if (part?.type !== 'text') {
      content.push(part)
    } else if (!inserted) {
      content.push({ type: 'text', text: prompt })
      inserted = true
    }
  }
  if (!inserted) content.unshift({ type: 'text', text: prompt })
  content.push(...(context?.mainGenerationOptions?.promptImages ?? []))
  return messages.map((item, position) => position === index
    ? freezeMessage({ ...message, content })
    : item)
}

function productHistoryMessage(item, index) {
  if (!item || !['user', 'assistant', 'system'].includes(item.role)) return null
  const value = String(item.content ?? '')
  if (!value.trim()) return null
  return {
    id: typeof item.id === 'string' ? `eleckoi-product-history:${item.id}` : `eleckoi-product-history-${index}`,
    role: item.role,
    content: [{ type: 'text', text: value }],
    source: { kind: 'plugin:eleckoi-product-history' }
  }
}

function compactedProjection(productHistory, nativeHistory) {
  const checkpointIndex = nativeHistory.findLastIndex(isCompactionCheckpoint)
  if (checkpointIndex < 0) return null
  const checkpoint = nativeHistory[checkpointIndex]
  const nativeTail = nativeHistory.slice(checkpointIndex + 1).filter(isDialogueMessage)
  if (nativeTail.length > productHistory.length) return null
  const productTail = nativeTail.length === 0 ? [] : productHistory.slice(-nativeTail.length)
  if (!productTail.every((product, index) => messagesMatch(product, nativeTail[index]))) return null
  return [checkpoint, ...productTail]
}

function findCurrentUserIndex(messages) {
  return messages.findLastIndex(isDirectUserMessage)
}

function isDialogueMessage(message) {
  return (message?.role === 'user' || message?.role === 'assistant') && message?.source?.kind !== 'tool'
}

function isCompactionCheckpoint(message) {
  return message?.role === 'user' && messageText(message).includes('<compacted-summary>')
}

function messagesMatch(left, right) {
  if (left?.role !== right?.role) return false
  return normalizedDialogueText(messageText(left), left.role) === normalizedDialogueText(messageText(right), right.role)
}

function messageText(message) {
  return Array.isArray(message?.content)
    ? message.content.filter((part) => part?.type === 'text').map((part) => String(part.text ?? '')).join('\n')
    : ''
}

function normalizedDialogueText(value, role) {
  const trimmed = value.trim()
  if (role !== 'assistant') return trimmed
  const start = trimmed.indexOf('<FINAL>')
  if (start < 0) return trimmed
  const bodyStart = start + '<FINAL>'.length
  const end = trimmed.lastIndexOf('</FINAL>')
  return trimmed.slice(bodyStart, end >= bodyStart ? end : undefined).trim()
}

/** Render a diagnostic-only text view of the current projection definition. */
export function renderRuntimeContext(context) {
  return requestProjectionPlan(context)
    .map((entry) => entry.content)
    .join('\n\n')
}

export function settingInjections(context) {
  const library = context?.settingLibrary
  if (!library) return []
  const promptPositions = new Map((library.promptPositions || []).map((position) => [position.id, position]))
  const automatic = (library.entries || [])
    .filter((entry) => entry?.enabled
      && typeof entry.content === 'string'
      && entry.content.trim()
      && entry.kind !== 'opening'
      && entry.kind !== 'history_compaction'
      && entry.triggerMode === 'always' && entry.position)
    .map((entry) => {
      const custom = promptPositions.get(entry.promptPositionId)
      const anchor = custom?.anchor || entry.position || 'insert_point_1'
      const title = String(entry.title || '').trim() || '未命名设定'
      return {
        id: String(entry.id || '').slice(0, 128),
        anchor,
        role: anchor === 'instructions' ? 'system' : entry.insertRole === 'assistant' ? 'assistant' : 'user',
        content: entry.content.slice(0, 40_000),
        placementRank: custom?.side === 'before_setting_position' ? 0 : custom?.side === 'after_setting_position' ? 2 : 1,
        positionOrder: custom?.order ?? 0,
        order: Number.isInteger(entry.order) ? entry.order : 1,
        traceTitle: entry.kind === 'hidden_tool_timeline'
            ? `预设固定条目 · ${title}`
            : String(entry.id || '').startsWith('agent-preset:')
              ? `预设条目 · ${title}`
              : `设定 · ${title}`,
        traceSource: String(custom?.name || '').trim() || positionLabel(anchor)
      }
    })
  const required = requiredSettingCache(library).map((entry, index) => ({
    id: `required-setting-${entry.reference.slice(1)}`,
    anchor: 'insert_point_1', role: 'user', content: entry.prompt,
    placementRank: 3, positionOrder: 0, order: index + 1,
    traceTitle: `Agent 必读 · ${entry.title}`, traceSource: '缓存设定区'
  }))
  return [...automatic, ...required]
    .sort((left, right) => anchorOrder(left.anchor) - anchorOrder(right.anchor)
      || left.placementRank - right.placementRank
      || left.positionOrder - right.positionOrder
      || left.order - right.order
      || left.id.localeCompare(right.id))
}

function anchorOrder(anchor) {
  const index = [
    'instructions',
    'insert_point_1',
    'insert_point_2',
    'insert_point_3',
    'insert_point_4',
    'insert_point_5'
  ].indexOf(anchor)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function positionLabel(anchor) {
  return ({
    instructions: '系统指令',
    insert_point_1: '设定插入点 1',
    insert_point_2: '设定插入点 2',
    insert_point_3: '设定插入点 3',
    insert_point_4: '设定插入点 4',
    insert_point_5: '设定插入点 5'
  })[anchor] || '设定位置'
}
