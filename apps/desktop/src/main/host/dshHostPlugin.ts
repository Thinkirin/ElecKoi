import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app, session } from 'electron'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { DshDesktopPluginHost, resolveDshWebFrontendDirectory } from '@eleckoi/desktop-host'
import { resolveDshSystemProxyEnvironment } from '@main/platform/electron/systemProxy'

const require = createRequire(import.meta.url)

export const dshHostPlugin = {
  name: 'eleckoi-dsh-host',
  inject: ['appPaths', 'appLog'],
  provide: 'pluginHost',
  apply(ctx: Context) {
    const failureListeners = new Set<(error: Error) => void>()
    const packageManager = app.isPackaged
      ? {
          entryPath: join(process.resourcesPath, 'dsh', 'pnpm', 'bin', 'pnpm.mjs'),
          nodeBinPath: join(process.resourcesPath, 'dsh', 'node-bin')
        }
      : {
          entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'),
          nodeBinPath: ctx.appPaths.resolveResource('dsh', 'node-bin')
        }
    const host = new DshDesktopPluginHost({
      runtimeDataRoot: ctx.appPaths.dshRuntime,
      workspaceRoot: ctx.appPaths.workspace,
      productDatabasePath: ctx.appPaths.database,
      productMediaRoot: ctx.appPaths.media,
      presetTemplatePath: ctx.appPaths.resolveResource('dsh', 'agent-preset-template', 'agent.cordis.yml'),
      agentPatchPath: ctx.appPaths.resolveResource('dsh', 'desktop-agent.patch.yml'),
      executablePath: process.execPath,
      packageManager,
      onFailure(error) {
        ctx.appLog.error({ error }, 'DSH plugin Host exited unexpectedly')
        for (const listener of failureListeners) listener(error)
      }
    })
    ctx.provide('pluginHost', {
      async start() {
        const proxyEnvironment = await resolveDshSystemProxyEnvironment(
          url => session.defaultSession.resolveProxy(url),
          process.env,
          message => ctx.appLog.warn(message)
        )
        return host.start(proxyEnvironment)
      },
      frontendDirectory: resolveDshWebFrontendDirectory,
      updateTasks: (action) => host.updateTasks(action),
      onFailure(listener) {
        failureListeners.add(listener)
        return () => { failureListeners.delete(listener) }
      }
    })
    return () => host.close()
  }
} satisfies Plugin.Object
