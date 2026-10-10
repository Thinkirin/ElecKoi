import type { Context, Plugin } from '@deepseek-ai/cordis'
import { AppPaths } from '@main/platform/filesystem/AppPaths'
import { createAppLog } from '@main/platform/logging/AppLog'
import './desktopContext'

export const platformPlugin = {
  name: 'eleckoi-platform',
  provide: ['appPaths', 'appLog'],
  apply(ctx: Context) {
    ctx.provide('appPaths', new AppPaths())
    ctx.provide('appLog', createAppLog())
  }
} satisfies Plugin.Object
