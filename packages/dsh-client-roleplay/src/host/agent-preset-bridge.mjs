/** Composes each ElecKoi Agent from its immutable Session snapshot. */

import { installConversationContext } from './conversation-context.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { installRequestConfig } from './request-config.mjs'
import { readRuntimePresetDefinition } from './preset-definition.mjs'
import { commitSessionPreset, inheritSessionSnapshot, readSessionSnapshot, removeSessionSnapshot } from './session-snapshot.mjs'
import { applyDisabledPolicy } from './tool-policy.mjs'
import { ACTIVE_RUNTIME_PRESET_ID, installRoleplaySessionRuntime } from './session-runtime.mjs'
import { refreshSessionModelSnapshot } from './model-selection-migration.mjs'

export const name = 'eleckoi-agent-preset-bridge'
export const inject = ['agents', 'agentPresets', 'agentDefaultModel', 'llm', 'settings', 'sessionController', 'sessions', 'eleckoiConversationLifecycle']

export async function apply(ctx) {
  const snapshotRoot = process.env.ELECKOI_SESSION_SNAPSHOT_ROOT
  const presetRoot = process.env.ELECKOI_PRESET_ROOT
  const templatePath = process.env.ELECKOI_PRESET_TEMPLATE_PATH
  if (!snapshotRoot) throw new Error('ELECKOI_SESSION_SNAPSHOT_ROOT is required')
  if (!presetRoot) throw new Error('ELECKOI_PRESET_ROOT is required')
  let activeRegistration
  let registrationQueue = Promise.resolve()
  const legacyRegistrations = new Map()
  const sessionHandles = new Map()
  const sessionLocks = new Map()
  const withSessionLock = async (sessionId, action) => {
    const previous = sessionLocks.get(sessionId) ?? Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    sessionLocks.set(sessionId, current)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId)
    }
  }
  const disposeTracked = async (sessionId) => {
    const handle = sessionHandles.get(sessionId)
    if (!handle) {
      if (ctx.agents.get(sessionId)) throw new Error(`DSH 会话 ${sessionId} 有未跟踪的写入句柄。`)
      return false
    }
    await handle.dispose()
    if (sessionHandles.get(sessionId) === handle) sessionHandles.delete(sessionId)
    if (ctx.agents.get(sessionId)) throw new Error(`DSH 会话 ${sessionId} 的写入句柄未释放。`)
    return true
  }
  ctx.provide('eleckoiSessionHandles', {
    dispose: (sessionId) => withSessionLock(sessionId, () => disposeTracked(sessionId)),
    withClosed: (sessionId, action) => withSessionLock(sessionId, async () => {
      await disposeTracked(sessionId)
      return action()
    })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    if (sessionHandles.get(agent.id)?.agent === agent) sessionHandles.delete(agent.id)
  })
  const disposeHandleTracking = installAgentHandleTracking(ctx.agents, (handle) => {
    sessionHandles.set(handle.agent.id, handle)
  })
  const registerActivePreset = () => {
    const id = ACTIVE_RUNTIME_PRESET_ID
    const path = join(presetRoot, id, 'preset.json')
    const revision = presetRevision(path)
    const operation = registrationQueue.then(async () => {
      if (activeRegistration?.revision === revision) return activeRegistration
      const definition = readRuntimePresetDefinition(path, id, templatePath)
      if (activeRegistration) {
        const previous = activeRegistration
        activeRegistration = undefined
        await previous.dispose()
      }
      const dispose = await ctx.agentPresets.register(definition)
      activeRegistration = { revision, dispose }
      return activeRegistration
    })
    registrationQueue = operation.catch(() => undefined)
    return operation
  }

  const registerLegacyPreset = (id) => {
    const existing = legacyRegistrations.get(id)
    if (existing) return existing
    const operation = Promise.resolve().then(async () => {
      const legacyPath = join(presetRoot, id, 'preset.json')
      const definition = existsSync(legacyPath)
        ? readRuntimePresetDefinition(legacyPath, id, templatePath)
        : legacyAliasDefinition(presetRoot, id, templatePath)
      const dispose = await ctx.agentPresets.register(definition)
      return { dispose }
    }).catch((error) => {
      legacyRegistrations.delete(id)
      throw error
    })
    legacyRegistrations.set(id, operation)
    return operation
  }

  const registerPreset = (id) => id === ACTIVE_RUNTIME_PRESET_ID
    ? registerActivePreset()
    : registerLegacyPreset(id)

  // TODO(迁移清理)：停止支持保存实体化预设 ID 的旧版本直升，并确认仍支持恢复的
  // Session、快照及导入记录都已持久选择 eleckoi-active 后，删除 legacyRegistrations、
  // registerLegacyPreset、legacyAliasDefinition、旧目录扫描及对应迁移用例。
  // 同步收口 registerPreset 的旧 ID 分支；保留当前预设注册、重组和 Session 恢复服务。
  // 升级客户端不会自动改写未打开的旧 Session；不能只按客户端版本号删除旧声明。
  if (existsSync(presetRoot)) {
    const ids = readdirSync(presetRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(presetRoot, entry.name, 'preset.json')))
      .map(entry => entry.name)
      .sort()
    await Promise.all(ids.map(registerPreset))
  }
  const presetRegistrar = {
    async prepareForSession(sessionId, requestedPresetId) {
      await registerPreset(requestedPresetId)
      const inspection = await ctx.sessionController.inspect(sessionId)
      const storedPresetId = storedPresetForInspection(inspection)
      if (storedPresetId) await registerPreset(storedPresetId)
      let snapshot
      try {
        snapshot = readSessionSnapshot(snapshotRoot, sessionId)
      } catch (error) {
        if (error?.code === 'ENOENT') return storedPresetId ?? requestedPresetId
        throw error
      }
      await registerPreset(snapshot.mountedPresetId)
      return storedPresetId ?? snapshot.mountedPresetId
    },
    async registerForSession(sessionId) {
      const snapshot = readSessionSnapshot(snapshotRoot, sessionId)
      await registerPreset(snapshot.mountedPresetId)
      return snapshot.mountedPresetId
    },
    async selectForSession(sessionId) {
      return withSessionLock(sessionId, async () => {
        const snapshot = readSessionSnapshot(snapshotRoot, sessionId)
        const requested = snapshot.pendingPresetId
        const requestedRevision = snapshot.pendingPresetRevision
        if (!requested || !requestedRevision) return snapshot.mountedPresetId
        if (requested === snapshot.mountedPresetId
          && requestedRevision === snapshot.mountedPresetRevision) return snapshot.mountedPresetId
        const agent = ctx.agents.get(sessionId)
        if (!agent) throw new Error(`DSH 会话 ${sessionId} 尚未激活，不能切换预设。`)
        if (agent.status !== 'idle') throw new Error(`DSH 会话 ${sessionId} 正在生成，不能切换预设。`)
        const current = await registerPreset(requested)
        try {
          await ctx.agentPresets.recompose(agent.ctx, requested)
          agent.session.append('agent-preset/selected', { agentPreset: requested })
        } catch (error) {
          throw error
        }
        commitSessionPreset(snapshotRoot, sessionId, requested, current.revision)
        applyDisabledPolicy(agent.ctx, snapshot.disabledToolGroupIds)
        return requested
      })
    }
  }
  ctx.provide('eleckoiPresetRegistrar', presetRegistrar)
  ctx.on('agent/created', async ({ agent }) => {
    const child = agent.session.header.origin === 'subagent'
    const sourceSessionId = child ? agent.session.header.parentSession : agent.id
    if (!sourceSessionId) return
    let inherited = false
    try {
      const snapshot = child
        ? inheritSessionSnapshot(snapshotRoot, sourceSessionId, agent.id)
        : await refreshSessionModelSnapshot(ctx, snapshotRoot, agent.id)
      inherited = child
      await registerPreset(snapshot.mountedPresetId)
      if (!child) {
        installRequestConfig(agent.ctx, snapshotRoot, agent.id)
        installConversationContext(agent.ctx, snapshotRoot, agent.id, ctx.eleckoiRequestPreviews)
      }
      applyDisabledPolicy(agent.ctx, snapshot.disabledToolGroupIds)
    } catch (error) {
      if (inherited) removeSessionSnapshot(snapshotRoot, agent.id)
      if (error?.code === 'ENOENT') return
      throw error
    }
  })
  const disposeRuntime = installRoleplaySessionRuntime(ctx, presetRegistrar)
  return async () => {
    disposeRuntime()
    disposeHandleTracking()
    await registrationQueue
    await activeRegistration?.dispose()
    await Promise.allSettled([...legacyRegistrations.values()].map(async task => {
      const legacy = await task
      await legacy.dispose()
    }))
  }
}

function presetRevision(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function installAgentHandleTracking(agents, track) {
  // Cordis services are caller-traced proxies. Patching the proxy only creates
  // a caller-local shadow, so SessionController would bypass it. Patch the
  // exported concrete service target and keep the original caller-bound `this`.
  const target = agents[Symbol.for('cordis.original')] ?? agents
  const originalCreate = target.create
  const originalResume = target.resume
  const wrappedCreate = async function (options) {
    const handle = await Reflect.apply(originalCreate, this, [options])
    track(handle)
    return handle
  }
  const wrappedResume = async function (options) {
    const handle = await Reflect.apply(originalResume, this, [options])
    track(handle)
    return handle
  }
  target.create = wrappedCreate
  target.resume = wrappedResume
  return () => {
    if (target.create === wrappedCreate) target.create = originalCreate
    if (target.resume === wrappedResume) target.resume = originalResume
  }
}

function legacyAliasDefinition(presetRoot, id, templatePath) {
  const activePath = join(presetRoot, ACTIVE_RUNTIME_PRESET_ID, 'preset.json')
  const active = readRuntimePresetDefinition(activePath, ACTIVE_RUNTIME_PRESET_ID, templatePath)
  return { ...active, id }
}

function storedPresetForInspection(inspection) {
  let selected = typeof inspection?.meta?.agentPreset === 'string'
    ? inspection.meta.agentPreset
    : undefined
  for (const event of inspection?.events ?? []) {
    if (event?.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') {
      selected = event.data.agentPreset
    }
  }
  return selected
}
