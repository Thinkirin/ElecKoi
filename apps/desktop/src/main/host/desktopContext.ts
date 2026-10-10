import type { Context } from '@deepseek-ai/cordis'
import type { Logger } from 'pino'
import type { ElectronWindowHost } from '@main/platform/electron/ElectronWindowHost'
import type { AppPaths } from '@main/platform/filesystem/AppPaths'
import type { UpdateService } from '@main/modules/updates'

declare module '@deepseek-ai/cordis' {
  interface Context {
    appPaths: AppPaths
    appLog: Logger
    pluginHost: {
      start(): Promise<{ url: string; injections: readonly unknown[] }>
      frontendDirectory(): string
      updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean>
      onFailure(listener: (error: Error) => void): () => void
    }
    electronWindows: ElectronWindowHost
    updates: UpdateService
  }
}

export type DesktopContext = Context
