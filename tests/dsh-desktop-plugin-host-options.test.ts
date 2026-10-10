import { expect, it } from 'vitest'
import { DshDesktopPluginHost, type DshDesktopPluginHostOptions } from '@eleckoi/desktop-host'

const completeOptions: DshDesktopPluginHostOptions = {
  runtimeDataRoot: 'runtime',
  workspaceRoot: 'workspace',
  productDatabasePath: 'product.sqlite',
  productMediaRoot: 'media',
  presetTemplatePath: 'agent.cordis.yml',
  agentPatchPath: 'desktop-agent.patch.yml',
  executablePath: 'electron'
}

it('rejects a missing product database path before starting the DSH Host', () => {
  const { productDatabasePath: _omitted, ...missingDatabasePath } = completeOptions
  expect(() => new DshDesktopPluginHost(
    missingDatabasePath as DshDesktopPluginHostOptions
  )).toThrow('DSH 插件宿主必须提供产品数据库路径。')
})

it('rejects a missing product media directory before starting the DSH Host', () => {
  expect(() => new DshDesktopPluginHost({
    ...completeOptions,
    productMediaRoot: '   '
  })).toThrow('DSH 插件宿主必须提供产品媒体目录。')
})
