import { readSessionSnapshot, writeSessionSnapshot } from './session-snapshot.mjs'

/**
 * TODO(迁移清理)：停止支持 v0.2.1 及更早版本直升，且受支持的 profile 恢复入口
 * 不再携带旧路由后，删除本迁移函数、专用辅助函数和旧路由测试，同时移除 roleplay
 * 启动调用。currentRequestSnapshot 改为直接解析当前选择；requestSnapshot、
 * refreshSessionModelSnapshot 和每轮冻结当前全局模型的正常运行路径必须保留。
 * Older ElecKoi releases stored a display label such as `deepseek-default` as
 * the selected provider even though the generated DSH route had a hashed id.
 * Convert that one persisted value to the unique current route. Runtime model
 * requests use only the current DSH provider id after this migration.
 */
export async function migrateLegacyGlobalModelSelection(ctx, { required = false } = {}) {
  const selected = ctx.agentDefaultModel.currentSelection()
  try {
    return { selection: selected, info: await ctx.llm.resolveModelInfo(selected.provider, selected.model) }
  } catch (originalError) {
    const descriptors = ctx.settings?.describe() ?? []
    const providers = descriptors.find(row => row.ns === 'llm-pi-ai')?.value?.providers ?? {}
    const entries = descriptors.find(row => row.ns === 'eleckoi-client-models')?.value?.entries ?? {}
    if (!isLegacyProviderSelection(selected.provider, providers)) {
      if (required) throw originalError
      return undefined
    }
    const candidates = await validMigrationCandidates(ctx, selected, providers, entries)
    let migrated = selectMigrationCandidate(selected, candidates)
    if (!migrated && candidates.length === 0 && selected.provider === 'deepseek-default') {
      migrated = await dedicatedDeepSeekFallback(ctx, selected)
    }
    if (!migrated) {
      if (required) throw originalError
      return undefined
    }
    const info = await ctx.llm.resolveModelInfo(migrated.provider, migrated.model)
    await ctx.agentDefaultModel.saveSelection(migrated)
    ctx.logger?.info?.(`ElecKoi upgraded the legacy default model route to ${migrated.provider}.`)
    return { selection: migrated, info }
  }
}

async function dedicatedDeepSeekFallback(ctx, selected) {
  try {
    await ctx.llm.resolveModelInfo('deepseek-official', selected.model)
    return {
      provider: 'deepseek-official',
      model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort })
    }
  } catch {
    return undefined
  }
}

function isLegacyProviderSelection(provider, providers) {
  return provider === 'deepseek-default'
    || /^(?:openai-responses|deepseek)-[0-9a-f]{8,}$/i.test(provider)
    || Object.values(providers).some(profile => profile?.displayName === provider)
}

async function validMigrationCandidates(ctx, selected, providers, entries) {
  const configured = Object.entries(entries)
    .flatMap(([provider, entry]) => {
      const model = typeof entry?.model === 'string' && entry.model.trim()
        ? entry.model.trim()
        : selected.model
      return provider !== selected.provider && model ? [{
        provider,
        model,
        displayName: providers[provider]?.displayName ?? entry?.name ?? '',
        sameModel: model === selected.model
      }] : []
    })
  const described = Object.entries(providers)
    .filter(([provider, profile]) => provider !== selected.provider
      && profile?.displayName === selected.provider
      && Array.isArray(profile.models)
      && profile.models.some(model => model?.id === selected.model))
    .map(([provider, profile]) => ({
      provider,
      model: selected.model,
      displayName: profile.displayName,
      sameModel: true
    }))
  const unique = new Map([...described, ...configured]
    .map(candidate => [`${candidate.provider}\0${candidate.model}`, candidate]))
  const valid = []
  for (const candidate of unique.values()) {
    try {
      await ctx.llm.resolveModelInfo(candidate.provider, candidate.model)
      valid.push(candidate)
    } catch {}
  }
  return valid
}

function selectMigrationCandidate(selected, candidates) {
  const named = candidates.filter(candidate => candidate.displayName === selected.provider && candidate.sameModel)
  const sameModel = candidates.filter(candidate => candidate.sameModel)
  const chosen = named.length === 1
    ? named[0]
    : sameModel.length === 1
      ? sameModel[0]
      : candidates.length === 1
        ? candidates[0]
        : undefined
  return chosen && {
    provider: chosen.provider,
    model: chosen.model,
    ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort })
  }
}

export function requestSnapshot(ctx, selection, info) {
  const namespace = ctx.settings?.describe().find(row => row.ns === 'eleckoi-client-models')
  const parameters = namespace?.value?.entries?.[selection.provider]?.parameters?.[selection.model] || {}
  const reasoningEffort = parameters.reasoningEffort ?? selection.reasoningEffort
  return {
    configId: selection.provider,
    provider: selection.provider,
    model: selection.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(parameters.temperature === undefined ? {} : { temperature: parameters.temperature }),
    ...(parameters.topP === undefined ? {} : { topP: parameters.topP }),
    ...(parameters.autoCompactTokenLimit === undefined ? {} : { autoCompactTokenLimit: parameters.autoCompactTokenLimit }),
    ...(info?.defaultMaxTokens === undefined ? {} : { maxTokens: info.defaultMaxTokens }),
    ...(info?.contextWindow === undefined ? {} : { contextWindow: info.contextWindow })
  }
}

// Permanent runtime path: freeze the one global model at turn preparation so a
// settings change made during generation takes effect on the next turn only.
export async function currentRequestSnapshot(ctx) {
  const { selection, info } = await migrateLegacyGlobalModelSelection(ctx, { required: true })
  return requestSnapshot(ctx, selection, info)
}

/** Permanent runtime path: align a resumed top-level Session before its next turn. */
export async function refreshSessionModelSnapshot(ctx, root, sessionId) {
  const snapshot = readSessionSnapshot(root, sessionId)
  const model = await currentRequestSnapshot(ctx)
  if (sameModelSnapshot(snapshot.model, model)) return snapshot
  const next = { ...snapshot, model }
  writeSessionSnapshot(root, sessionId, next)
  return next
}

function sameModelSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
