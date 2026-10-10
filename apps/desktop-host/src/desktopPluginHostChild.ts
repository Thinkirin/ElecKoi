import { delimiter } from 'node:path'
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { ELECKOI_INSTALL_ANCHOR } from './desktopPluginBundles'
import { repairRequestContextLogs, recoverStartupSessions } from '@eleckoi/dsh-runtime'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@eleckoi/dsh-product-api'
import type { ChildHostMessage, ParentHostMessage } from './hostSessionProtocol'

function send(message: ChildHostMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) {
      resolve()
      return
    }
    process.send(message, error => error === null ? resolve() : reject(error))
  })
}

async function main(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (profileDirectory === undefined) throw new Error('Missing desktop plugin profile directory')
  if (process.env.DSH_SESSION_ROOT) await repairRequestContextLogs(process.env.DSH_SESSION_ROOT)
  const profile = loadProfileDirectory('dsh', profileDirectory, ELECKOI_INSTALL_ANCHOR)
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor: ELECKOI_INSTALL_ANCHOR },
    patchFiles: [process.argv[3], process.argv[6]].filter((value): value is string => Boolean(value)),
    args: ['--no-open', '--port', '0'],
    ...!process.argv[4] ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[4]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[5] ?? ''}${delimiter}${process.env.PATH ?? ''}`
        }
      }
    }
  })
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect?.()
  })()
  const { ctx } = await application
  const updateTasks = installUpdateTaskControl(ctx)
  const remoteStatus = await ctx.typertGateway.invoke({
    namespace: 'eleckoiSystem',
    method: 'status',
    args: {}
  }) as { architecture?: unknown; protocolVersion?: unknown }
  if (remoteStatus.architecture !== 'dsh-remote' || remoteStatus.protocolVersion !== 1) {
    throw new Error('ElecKoi DSH Remote Host 协议未正确装载。')
  }
  const requiredServices = [
    'eleckoiCharacterConfigurationApi', 'eleckoiCharactersApi', 'eleckoiPersonaApi',
    'eleckoiCreatorStudioApi', 'eleckoiWebSearchApi', 'eleckoiConversationModelsApi',
    'eleckoiConversationsApi', 'eleckoiRoleplaySessions'
  ] as const
  const missingServices = requiredServices.filter(name => ctx.get(name) === undefined)
  if (missingServices.length > 0) {
    throw new Error(`ElecKoi Host 服务未正确装载：${missingServices.join(', ')}`)
  }
  const sessionRoot = process.env.DSH_SESSION_ROOT
  if (sessionRoot) await recoverStartupSessions(ctx, sessionRoot)
  process.on('message', (value: unknown) => {
    if (typeof value !== 'object' || value === null || !('type' in value)) return
    const message = value as ParentHostMessage
    if (message.type === 'shutdown') {
      void stop()
      return
    }
    void updateTasks(message.action)
      .then(active => send({ type: 'update-tasks-complete', id: message.id, active }))
      .catch(error => send({
        type: 'update-tasks-complete', id: message.id, active: true,
        message: error instanceof Error ? error.message : String(error)
      }))
  })
  process.once('disconnect', () => { void stop() })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  await send({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() })
}

function installUpdateTaskControl(
  ctx: Awaited<ReturnType<typeof runProfile>>['ctx']
): (action: 'inspect' | 'lock' | 'unlock') => Promise<boolean> {
  let locked = false
  let lockGeneration = 0
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  const pendingRequests = new Set<Promise<void>>()
  ctx.on('connection/request', async (_request, response, next) => {
    if (locked) {
      response.writeHead(503)
      response.end()
      return
    }
    const finished = Promise.withResolvers<void>()
    pendingRequests.add(finished.promise)
    try { await next() }
    finally {
      pendingRequests.delete(finished.promise)
      finished.resolve()
    }
  })
  return async (action) => {
    if (stopped) throw new Error('DSH 插件宿主正在停止。')
    if (action === 'unlock') {
      locked = false
      lockGeneration++
    }
    const agents = ctx.get('agents')
    const jobs = ctx.get('jobs')
    if (agents === undefined || jobs === undefined) throw new Error('DSH 任务服务不可用。')
    if (action === 'lock') {
      locked = true
      const generation = ++lockGeneration
      await Promise.all(pendingRequests)
      if (stopped) throw new Error('DSH 插件宿主正在停止。')
      if (generation !== lockGeneration) throw new Error('DSH 更新锁已被替换。')
    }
    const liveAgents = agents.list()
    return liveAgents.some(agent => agent.status === 'running'
      || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
      || [undefined, ...liveAgents].some(agent => jobs.list(agent?.id)
        .some(job => job.status === 'running' || job.status === 'stopping'))
  }
}

void main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error)
  await send({ type: 'fatal', message }).catch(() => undefined)
  console.error(error)
  process.exitCode = 1
  if (process.connected) process.disconnect?.()
})
