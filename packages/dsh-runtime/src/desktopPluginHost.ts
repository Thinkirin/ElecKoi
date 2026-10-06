import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { preparePluginHost } from './pluginHostConfiguration'
import type { ChildHostMessage, ParentHostMessage } from './hostSessionProtocol'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('@eleckoi/dsh-runtime'))

export function resolveDshWebFrontendDirectory(): string {
  return join(dirname(runtimeRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
}

export interface DshDesktopPluginHostReady {
  url: string
  injections: readonly unknown[]
}

export interface DshDesktopPluginHostOptions {
  runtimeDataRoot: string
  workspaceRoot: string
  productDatabasePath: string
  productMediaRoot: string
  presetTemplatePath: string
  agentPatchPath: string
  executablePath: string
  packageManager?: { entryPath: string; nodeBinPath: string }
  onDiagnostic?: (message: string) => void
  onFailure?: (error: Error) => void
}

export type DshDesktopPluginHostEnvironment = Readonly<Record<string, string>>

function isChildMessage(value: unknown): value is ChildHostMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const message = value as Record<string, unknown>
  if (message.type === 'ready') return typeof message.url === 'string' && Array.isArray(message.injections)
  if (message.type === 'fatal') return typeof message.message === 'string'
  if (message.type === 'update-tasks-complete') return typeof message.id === 'string'
    && typeof message.active === 'boolean'
    && (message.message === undefined || typeof message.message === 'string')
  return message.type === 'shutdown-complete'
}

interface PendingControl {
  resolve(value: boolean): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class DshDesktopPluginHost {
  private child: ChildProcess | undefined
  private readyTask: Promise<DshDesktopPluginHostReady> | undefined
  private stopping = false
  private readonly controls = new Map<string, PendingControl>()

  constructor(private readonly options: DshDesktopPluginHostOptions) {
    if (typeof options.productDatabasePath !== 'string' || options.productDatabasePath.trim().length === 0) {
      throw new Error('DSH 插件宿主必须提供产品数据库路径。')
    }
    if (typeof options.productMediaRoot !== 'string' || options.productMediaRoot.trim().length === 0) {
      throw new Error('DSH 插件宿主必须提供产品媒体目录。')
    }
  }

  start(environment: DshDesktopPluginHostEnvironment = {}): Promise<DshDesktopPluginHostReady> {
    if (this.readyTask !== undefined) return this.readyTask
    if (this.stopping) return Promise.reject(new Error('DSH 插件宿主正在停止。'))
    const prepared = preparePluginHost(this.options)
    const child = spawn(this.options.executablePath, [
      require.resolve('@eleckoi/dsh-runtime/desktop-plugin-host'),
      prepared.profileDirectory,
      prepared.overlayPath,
      this.options.packageManager?.entryPath ?? '',
      this.options.packageManager?.nodeBinPath ?? '',
      this.options.agentPatchPath
    ], {
      cwd: prepared.profileDirectory,
      env: {
        ...process.env,
        ...environment,
        ...prepared.environment,
        ELECTRON_RUN_AS_NODE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    })
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { this.options.onDiagnostic?.(chunk) })
    child.stderr?.on('data', (chunk: string) => { this.options.onDiagnostic?.(chunk) })
    this.readyTask = new Promise((resolve, reject) => {
      let settled = false
      let failureReported = false
      const timeout = setTimeout(() => {
        fail(new Error('DSH 插件宿主启动超时。'))
        child.kill()
      }, 90_000)
      const reportFailure = (error: Error): void => {
        if (failureReported || this.stopping) return
        failureReported = true
        this.options.onFailure?.(error)
      }
      const fail = (error: Error): void => {
        if (settled) reportFailure(error)
        else {
          settled = true
          clearTimeout(timeout)
          reject(error)
        }
      }
      child.on('message', (value: unknown) => {
        if (!isChildMessage(value)) {
          fail(new Error('DSH 插件宿主返回了无效消息。'))
          return
        }
        if (value.type === 'fatal') fail(new Error(value.message))
        if (value.type === 'update-tasks-complete') {
          const pending = this.controls.get(value.id)
          if (pending !== undefined) {
            clearTimeout(pending.timer)
            this.controls.delete(value.id)
            if (value.message) pending.reject(new Error(value.message))
            else pending.resolve(value.active)
          }
        }
        if (value.type === 'ready' && !settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ url: value.url, injections: value.injections })
        }
      })
      child.once('error', error => fail(error))
      child.once('exit', code => {
        const error = new Error(`DSH 插件宿主退出：${String(code)}`)
        this.rejectControls(error)
        if (this.child === child) {
          this.child = undefined
          this.readyTask = undefined
        }
        if (!this.stopping) fail(error)
      })
    })
    return this.readyTask
  }

  async updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> {
    await (this.readyTask ?? this.start())
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 插件宿主未连接。')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controls.delete(id)
        reject(new Error('DSH 任务检查超时。'))
      }, 10_000)
      this.controls.set(id, { resolve, reject, timer })
      const message: ParentHostMessage = { type: 'update-tasks', id, action }
      child.send(message, error => {
        if (error === null) return
        clearTimeout(timer)
        this.controls.delete(id)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const child = this.child
    this.child = undefined
    this.readyTask = undefined
    this.rejectControls(new Error('DSH 插件宿主正在停止。'))
    if (child === undefined || child.exitCode !== null) return
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    if (child.connected) child.send({ type: 'shutdown' } satisfies ParentHostMessage)
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 5_000))
    ])
    if (!graceful) {
      child.kill()
      await exited
    }
  }

  private rejectControls(error: Error): void {
    for (const pending of this.controls.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.controls.clear()
  }
}
