import { win32 } from 'node:path'
import { app, ipcMain } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Logger } from 'pino'
import { UpdateService } from './UpdateService'
import { DESKTOP_SHELL_IPC } from '@shared/contracts/desktopShell'
import { assertTrustedDshClientFrame } from '@main/platform/electron/validateSender'

export function attachUpdaterLogger(
  updater: Pick<AppUpdater, 'logger'>,
  appLog: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>
): () => void {
  updater.logger = {
    info: (message?: unknown) => appLog.info({ message }, 'electron-updater'),
    warn: (message?: unknown) => appLog.warn({ message }, 'electron-updater'),
    error: (message?: unknown) => appLog.error({ message }, 'electron-updater'),
    debug: (message: string) => appLog.debug({ message }, 'electron-updater')
  }
  return () => { updater.logger = null }
}

export function preserveWindowsUpdateInstallDirectory(
  updater: AppUpdater,
  executablePath: string,
  packaged: boolean,
  platform: NodeJS.Platform
): void {
  if (!packaged || platform !== 'win32') return
  ;(updater as AppUpdater & { installDirectory?: string }).installDirectory = win32.dirname(executablePath)
}

export const updatesPlugin = {
  name: 'eleckoi-updates',
  inject: ['appLog', 'pluginHost', 'electronWindows'],
  provide: 'updates',
  apply(ctx: Context) {
    const updater = electronUpdater.autoUpdater
    const appLog = ctx.appLog
    const pluginHost = ctx.pluginHost
    const windows = ctx.electronWindows
    const detachUpdaterLogger = attachUpdaterLogger(updater, appLog)

    const enabled = app.isPackaged && process.platform === 'win32'
    preserveWindowsUpdateInstallDirectory(updater, process.execPath, app.isPackaged, process.platform)
    const updates = new UpdateService({
      updater,
      currentVersion: app.getVersion(),
      enabled,
      disabledMessage: app.isPackaged ? '当前平台暂不支持自动更新。' : '开发模式不检查更新。',
      async prepareInstall() {
        if (await pluginHost.updateTasks('inspect')) return false
        try {
          const active = await pluginHost.updateTasks('lock')
          if (!active) return true
          await pluginHost.updateTasks('unlock')
          return false
        } catch (error) {
          await pluginHost.updateTasks('unlock').catch(() => undefined)
          throw error
        }
      },
      releaseInstall: async () => { await pluginHost.updateTasks('unlock') },
      publish: (status) => {
        for (const window of windows.all()) {
          if (!window.isDestroyed()) window.webContents.send(DESKTOP_SHELL_IPC.updatesChanged, status)
        }
      },
      logger: appLog
    })
    ctx.provide('updates', updates)

    const assertSender = (event: Electron.IpcMainInvokeEvent): void => assertTrustedDshClientFrame(
      event.sender,
      event.senderFrame?.url ?? '',
      event.senderFrame === event.sender.mainFrame,
      windows.all().map(window => window.webContents)
    )
    ipcMain.handle(DESKTOP_SHELL_IPC.updatesStatus, (event) => {
      assertSender(event)
      return updates.status()
    })
    ipcMain.handle(DESKTOP_SHELL_IPC.updatesCheck, (event) => {
      assertSender(event)
      return updates.check()
    })
    ipcMain.handle(DESKTOP_SHELL_IPC.updatesDownload, (event) => {
      assertSender(event)
      return updates.download()
    })
    ipcMain.handle(DESKTOP_SHELL_IPC.updatesInstall, (event) => {
      assertSender(event)
      return updates.install()
    })
    updates.start()

    return () => {
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.updatesStatus)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.updatesCheck)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.updatesDownload)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.updatesInstall)
      updates.dispose()
      detachUpdaterLogger()
    }
  }
} satisfies Plugin.Object
