import { timingSafeEqual } from 'node:crypto'
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { ELECKOI_INSTALL_ANCHOR } from './desktopPluginBundles'
import { repairRequestContextLogs } from './sessionRequestContextRepair'
import { recoverStartupSessions } from './sessionStartupRecovery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@eleckoi/dsh-product-api'
import type { ParentHostMessage } from './hostSessionProtocol'
import { installProductFrontendAssets, installWebClientAssets } from './webClientAssets'
import { installProductMediaAssets } from './productMediaAssets'
import { installAndroidMigration } from './androidMigrationHost'

export interface PluginHostApplicationOptions {
  profileDirectory: string
  patchFiles: readonly string[]
  clientDirectory?: string
  packageManager?: NonNullable<Parameters<typeof runProfile>[0]['packageManager']>
}

export interface PluginHostApplication {
  readonly ready: { url: string; healthUrl: string; injections: readonly unknown[] }
  control(message: Extract<ParentHostMessage, { type: 'update-tasks' }>): Promise<boolean>
  close(): Promise<void>
}

/** Shared application boot: transports own process IO, all product services stay here. */
export async function startPluginHostApplication(options: PluginHostApplicationOptions): Promise<PluginHostApplication> {
  if (process.env.DSH_SESSION_ROOT) await repairRequestContextLogs(process.env.DSH_SESSION_ROOT)
  const profile = loadProfileDirectory('dsh', options.profileDirectory, ELECKOI_INSTALL_ANCHOR)
  reportSkippedBundles('dsh', profile)
  if (profile.skippedBundles.length > 0) {
    throw new Error(`ElecKoi Host profile bundles failed to load: ${profile.skippedBundles.map(bundle => `${bundle.packageName}: ${bundle.reason}`).join('; ')}`)
  }
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor: ELECKOI_INSTALL_ANCHOR },
    patchFiles: [...options.patchFiles],
    args: ['--no-open', '--port', '0'],
    ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager })
  })
  const running = await application
  try {
    const { ctx } = running
    if (options.clientDirectory) await installWebClientAssets(ctx, options.clientDirectory)
    installProductFrontendAssets(ctx)
    installProductMediaAssets(ctx)
    await installAndroidMigration(ctx)
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
      'eleckoiConversationsApi', 'eleckoiRoleplaySessions',
      'eleckoiCompatibilityApi', 'eleckoiAuthorPluginsApi', 'eleckoiMainAgentGeneration'
    ] as const
    const missingServices = requiredServices.filter(name => ctx.get(name) === undefined)
    if (missingServices.length > 0) {
      throw new Error(`ElecKoi Host 服务未正确装载：${missingServices.join(', ')}`)
    }
    const sessionRoot = process.env.DSH_SESSION_ROOT
    if (sessionRoot) await recoverStartupSessions(ctx, sessionRoot)

    const updateTasks = installUpdateTaskControl(ctx)
    const baseUrl = `http://127.0.0.1:${String(ctx.webServer.port)}`
    const url = ctx.connection.authenticatedUrl(baseUrl)
    const healthUrl = ctx.connection.authenticatedUrl(`${baseUrl}/_eleckoi/health`)
    const healthToken = new URL(healthUrl).searchParams.get('token')!
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/_eleckoi/health', handler: (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' })
        response.end()
        return
      }
      const tokens = new URL(request.url ?? '/', baseUrl).searchParams.getAll('token')
      const expected = Buffer.from(healthToken)
      const actual = Buffer.from(tokens[0] ?? '')
      const tokenAccepted = tokens.length === 1 && actual.length === expected.length && timingSafeEqual(actual, expected)
      if (!tokenAccepted && 'rejection' in ctx.connection.admit(request)) {
        response.writeHead(401)
        response.end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ status: 'ready', architecture: 'dsh-remote', protocolVersion: 1,
        platform: process.platform, arch: process.arch, pid: process.pid }))
    } }), 'eleckoi: authenticated runtime health')
    let closing: Promise<void> | undefined
    return {
      ready: { url, healthUrl, injections: ctx.webServer.collectIndexInjections() },
      control: message => updateTasks(message.action),
      close: () => closing ??= running.shutdown.shutdown(0)
    }
  } catch (error) {
    try { await running.shutdown.shutdown(1) }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'ElecKoi Host startup and shutdown failed') }
    throw error
  }
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

