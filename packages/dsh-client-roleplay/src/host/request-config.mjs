import { readSessionSnapshot } from './session-snapshot.mjs'
import { isProjectionEnvelope } from './conversation-context.mjs'
import { readFileSync } from 'node:fs'

const COMPACTION_GUARD = '你当前只执行内部历史压缩。只返回非空的纯文本摘要正文；不要调用工具，不要输出推理过程，也不要使用主对话的输出协议标签。'

/**
 * Installs a request configuration on one Agent scope. The top-level turn
 * preparation freezes the global selection into the product snapshot; every
 * model step then reads that frozen value through DSH's official
 * agent/request waterfall. Persisted DSH request headers are history, not the
 * authority for a new turn.
 */
export function installRequestConfig(agentCtx, snapshotRoot, sourceSessionId, { compatibilitySettings = true } = {}) {
  const reroutedCompactions = new WeakSet()
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const snapshot = readSessionSnapshot(snapshotRoot, sourceSessionId)
    const model = snapshot.model
    const result = await next()
    return model === undefined ? result : {
      ...result,
      variables: {
        ...result.variables,
        provider: model.provider,
        model: model.model
      }
    }
  })
  const disposeRequest = agentCtx.on('agent/request', async (_payload, next) => {
    const inherited = await next()
    const snapshot = readSessionSnapshot(snapshotRoot, sourceSessionId)
    let model = structuredClone(snapshot.model)
    const context = compatibilitySettings ? JSON.parse(readFileSync(snapshot.contextFile, 'utf8')) : {}
    const settings = context.compatibilityPreset?.compatibility === true ? context.compatibilityPreset.settings : undefined
    if (settings) model = projectCompatibilityPresetSettings(model, settings)
    if (!model?.provider || !model?.model) return inherited
    const {
      provider: _provider,
      model: _model,
      reasoningEffort: _reasoningEffort,
      temperature: _temperature,
      topP: _topP,
      maxTokens: _maxTokens,
      ...rest
    } = inherited
    return {
      ...rest,
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
      ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
      ...(model.topP === undefined ? {} : { topP: model.topP }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens })
    }
  }, { prepend: true })
  const disposeCompaction = agentCtx.on('llm/stream', (options, next) => {
    if (reroutedCompactions.has(options)) return next()
    const snapshot = readSessionSnapshot(snapshotRoot, sourceSessionId)
    const projected = projectCompactionRequest(
      options,
      snapshot.historyCompactionInstructions,
      snapshot.model?.reasoningEffort
    )
    if (!projected) return next()
    // DSH deep-freezes requests before the waterfall. Route a fresh one-shot request through the
    // public LLM service, and let its nested waterfall pass through to the adapter exactly once.
    reroutedCompactions.add(projected)
    return agentCtx.llm.stream(projected)
  })
  return () => {
    disposeCompaction()
    disposeRequest()
    disposeAssembly()
  }
}

/** Freeze typed settings into official DSH request fields, keeping provider selection original. */
export function projectCompatibilityPresetSettings(model, settings) {
  const result = { ...model }
  for (const [source, target] of [['temperature', 'temperature'], ['top_p', 'topP'], ['max_completion_tokens', 'maxTokens']]) {
    if (settings[source] !== undefined) {
      if (typeof settings[source] !== 'number' || !Number.isFinite(settings[source])) throw new TypeError(`Preset ${source} must be numeric`)
      result[target] = settings[source]
    }
  }
  if (typeof settings.reasoning_effort === 'string' && settings.reasoning_effort !== 'auto') result.reasoningEffort = settings.reasoning_effort
  return result
}

export function projectCompactionRequest(options, customInstructions, defaultReasoningEffort) {
  const instructions = typeof customInstructions === 'string' ? customInstructions.trim() : ''
  if (options?.purpose !== 'compaction' || !Array.isArray(options.messages) || !options.messages.length) {
    return undefined
  }
  const configuredReasoningEffort = typeof defaultReasoningEffort === 'string' && defaultReasoningEffort.trim()
    ? defaultReasoningEffort.trim()
    : undefined
  const reasoningEffort = options.reasoningEffort ?? configuredReasoningEffort
  const reasoningChanged = reasoningEffort !== undefined && options.reasoningEffort !== reasoningEffort
  const messages = options.messages.filter((message) => !isProjectionEnvelope(message))
  const removedProjection = messages.length !== options.messages.length
  const last = messages.at(-1)
  if (!instructions || !last || last.role !== 'user') {
    if (!removedProjection && !reasoningChanged) return undefined
    return {
      ...options,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      messages
    }
  }
  const { tools: _tools, ...rest } = options
  return {
    ...rest,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    messages: [
      ...messages.slice(0, -1),
      {
        ...last,
        content: [{ type: 'text', text: `${COMPACTION_GUARD}\n\n${instructions}` }]
      }
    ]
  }
}
