import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyAgentPresetBridge } from '../apps/desktop/resources/dsh/agent-preset-bridge.mjs'
import { materializeAgentPreset } from '../packages/dsh-client-roleplay/src/host/session-runtime.mjs'

const directories = []
const templatePath = resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml')

afterEach(() => {
  delete process.env.ELECKOI_SESSION_SNAPSHOT_ROOT
  delete process.env.ELECKOI_PRESET_ROOT
  delete process.env.ELECKOI_PRESET_TEMPLATE_PATH
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DSH Agent preset durability', () => {
  it('persists stable plugin identities instead of installation-specific pnpm paths', () => {
    const directory = temporaryDirectory()
    const presetRoot = join(directory, 'generated-presets')
    const preset = materializeAgentPreset(
      presetRoot,
      templatePath,
      {
        id: 'test-preset',
        name: '测试预设',
        versionId: 'version-a',
        roleplayPlan: { steps: [] }
      },
      { disabledGroupIds: [] },
      { provider: 'provider-a', model: 'model-a', contextWindow: 100_000, autoCompactTokenLimit: 80_000 }
    )
    expect(preset.id).toBe('eleckoi-active')
    expect(preset.revision).toMatch(/^[a-f0-9]{64}$/)
    const source = readFileSync(join(presetRoot, preset.id, 'preset.json'), 'utf8')
    const definition = JSON.parse(source)
    expect(source).not.toContain('node_modules/.pnpm')
    expect(source).not.toContain('file:///')
    expect(pluginById(definition.plugins, 'agent-instructions')?.name)
      .toBe('@deepseek-ai/dsh-agent-instructions')
    expect(pluginById(definition.plugins, 'variable-tools')?.name)
      .toBe('eleckoi:agent-preset/variable-tools')
    expect(pluginById(definition.plugins, 'tool-subagent')?.config).toMatchObject({
      provider: 'spawn',
      backgroundMode: 'one-shot',
      enableRunInBackground: false,
      modelSelectionSettings: true
    })
    expect(pluginById(definition.plugins, 'tool-subagent')?.config).not.toHaveProperty('agentOptions')
    expect(pluginById(definition.plugins, 'tool-subagent-fork')?.config).not.toHaveProperty('agentOptions')

    const updated = materializeAgentPreset(
      presetRoot,
      templatePath,
      {
        id: 'test-preset',
        name: '测试预设',
        versionId: 'version-b',
        roleplayPlan: { steps: ['完成正文'] }
      },
      { disabledGroupIds: [] },
      { provider: 'provider-a', model: 'model-a', contextWindow: 100_000, autoCompactTokenLimit: 20_000 }
    )
    expect(updated.id).toBe(preset.id)
    expect(updated.revision).not.toBe(preset.revision)
    expect(readdirSync(presetRoot)).toEqual(['eleckoi-active'])
  })

  it('resolves current runtime paths in memory without rewriting the durable definition', async () => {
    const directory = temporaryDirectory()
    const presetRoot = join(directory, 'generated-presets')
    const snapshotRoot = join(directory, 'session-snapshots')
    const presetDirectory = join(presetRoot, 'eleckoi-active')
    mkdirSync(presetDirectory, { recursive: true })
    mkdirSync(snapshotRoot)
    const path = join(presetDirectory, 'preset.json')
    const source = JSON.stringify({
      id: 'eleckoi-active',
      plugins: [
        {
          id: 'agent-instructions',
          name: '@deepseek-ai/dsh-agent-instructions'
        },
        {
          id: 'variable-tools',
          name: 'eleckoi:agent-preset/variable-tools'
        },
        {
          id: 'compaction',
          name: 'cordis:group',
          config: [{
            id: 'compaction-basic',
            name: '@deepseek-ai/dsh-compaction-basic'
          }]
        }
      ]
    })
    writeFileSync(path, source)
    process.env.ELECKOI_SESSION_SNAPSHOT_ROOT = snapshotRoot
    process.env.ELECKOI_PRESET_ROOT = presetRoot
    process.env.ELECKOI_PRESET_TEMPLATE_PATH = templatePath
    const registered = []
    const ctx = {
      provide: vi.fn(),
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), resume: vi.fn(), get: vi.fn() },
      sessionController: { inspect: vi.fn(async () => ({ meta: {}, events: [] })) },
      agentPresets: {
        register: vi.fn(async (definition) => {
          registered.push(definition)
          return async () => undefined
        })
      }
    }

    const dispose = await applyAgentPresetBridge(ctx)
    expect(readFileSync(path, 'utf8')).toBe(source)

    const runtime = registered[0]
    for (const pluginId of ['agent-instructions', 'variable-tools', 'compaction-basic']) {
      const name = pluginById(runtime.plugins, pluginId)?.name
      expect(name).toMatch(/^file:/)
      expect(existsSync(fileURLToPath(name))).toBe(true)
    }
    await dispose()
  })
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-preset-durability-'))
  directories.push(directory)
  return directory
}

function pluginById(plugins, id) {
  for (const plugin of plugins || []) {
    if (plugin?.id === id) return plugin
    if (Array.isArray(plugin?.config)) {
      const nested = pluginById(plugin.config, id)
      if (nested) return nested
    }
  }
  return undefined
}
