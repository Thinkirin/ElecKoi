import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { initProfile, PROFILE_TEMPLATES, readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'
import { ELECKOI_DESKTOP_BUNDLES, ELECKOI_INSTALL_ANCHOR, registerDesktopBundles } from './desktopPluginBundles'

const require = createRequire(ELECKOI_INSTALL_ANCHOR)
const TAVILY_BUNDLE = '@eleckoi/dsh-web-search-tavily'

export interface PluginHostPaths {
  runtimeDataRoot: string
  workspaceRoot: string
  productDatabasePath: string
  productMediaRoot: string
  presetTemplatePath: string
  agentPatchPath: string
  homeRoot?: string
  directoryPickerMode?: 'auto' | 'browse'
}

export interface PreparedPluginHost {
  profileDirectory: string
  overlayPath: string
  environment: Readonly<Record<string, string>>
}

/** Materialize the same product profile for Electron and the standalone Node Host. */
export function preparePluginHost(paths: PluginHostPaths): PreparedPluginHost {
  const home = paths.homeRoot ?? join(paths.runtimeDataRoot, 'home')
  const profileDirectory = join(home, 'profiles', 'desktop')
  const sessionRoot = join(paths.runtimeDataRoot, 'sessions')
  for (const directory of [home, paths.runtimeDataRoot, paths.workspaceRoot, paths.productMediaRoot,
    dirname(paths.productDatabasePath), sessionRoot]) mkdirSync(directory, { recursive: true })
  const webProfile = PROFILE_TEMPLATES.web
  if (!webProfile) throw new Error('DSH web profile template is unavailable')
  initProfile(profileDirectory, [...webProfile.bundles, ...ELECKOI_DESKTOP_BUNDLES, TAVILY_BUNDLE])
  registerDesktopBundles(profileDirectory)
  const marker = join(profileDirectory, '.eleckoi-tavily-bundle-v1')
  if (!existsSync(marker)) {
    const manifest = readProfileManifest('dsh', profileDirectory)
    const bundles = manifest.dsh?.profile?.bundles ?? []
    if (!bundles.includes(TAVILY_BUNDLE)) writeProfileBundles(profileDirectory, manifest, [...bundles, TAVILY_BUNDLE])
    writeFileSync(marker, 'initialized\n', { flag: 'wx' })
  }
  const overlayPath = join(profileDirectory, 'eleckoi-plugin-host.patch.yml')
  writeFileSync(overlayPath, [
    '- id: session-persistence-jsonl', '  config:', `    root: ${JSON.stringify(sessionRoot)}`, '    compression: none',
    ...['desktop-product-telemetry', 'product-analytics', 'ui-layout', 'ui-sidebar',
      'ui-settings-general', 'ui-settings-models'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
    ...(paths.directoryPickerMode === 'browse' ? [
      // In Cordis patches, name asserts the existing package; it does not
      // replace it. Disable the adaptive pair before inserting both browse
      // entries so native and browse never compete for the same single slot.
      '- id: directory-picker', '  disabled: true',
      '- insert:',
      '    - id: eleckoi-mobile-directory-picker', '      name: "@deepseek-ai/dsh-host-directory-picker-browse"',
      '    - id: eleckoi-mobile-directory-picker-ui', '      name: "@deepseek-ai/dsh-client-ui-directory-picker-browse"',
    ] : []), ''
  ].join('\n'))
  return {
    profileDirectory,
    overlayPath,
    environment: {
      DSH_HOME: home,
      DSH_SESSION_ROOT: sessionRoot,
      DSH_CWD: paths.workspaceRoot,
      ELECKOI_SESSION_SNAPSHOT_ROOT: join(paths.runtimeDataRoot, 'session-snapshots'),
      ELECKOI_PRESET_ROOT: join(paths.runtimeDataRoot, 'generated-presets'),
      ELECKOI_PRESET_TEMPLATE_PATH: paths.presetTemplatePath,
      ELECKOI_SESSION_BRIDGE_ROOT: join(paths.runtimeDataRoot, 'session-bridges'),
      ELECKOI_DATABASE_PATH: paths.productDatabasePath,
      ELECKOI_MEDIA_ROOT: paths.productMediaRoot,
      ELECKOI_WORKSPACE_ROOT: paths.workspaceRoot,
      DSH_TELEMETRY_DISABLED: '1'
    }
  }
}

export interface NodeHostConfiguration extends PluginHostPaths {
  resourceRoot: string
  clientDirectory: string
  packageManagerEntryPath: string
  nodeBinPath: string
  environment: Record<string, string>
}

/** Relative paths are anchored to the configuration file, never a launcher's cwd. */
export function loadNodeHostConfiguration(configPath: string): NodeHostConfiguration {
  const absoluteConfig = resolve(configPath)
  const value: unknown = JSON.parse(readFileSync(absoluteConfig, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ElecKoi Node Host configuration must be a JSON object')
  }
  const config = value as Record<string, unknown>
  const base = dirname(absoluteConfig)
  const path = (name: string, fallback?: string): string => {
    const raw = config[name] ?? fallback
    if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error(`Missing Host configuration path: ${name}`)
    return isAbsolute(raw) ? raw : resolve(base, raw)
  }
  const resourceRoot = path('resourceRoot')
  const runtimeDataRoot = path('runtimeDataRoot')
  const packageManagerEntryPath = path('packageManagerEntryPath',
    join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'))
  const result: NodeHostConfiguration = {
    directoryPickerMode: config.directoryPickerMode === 'browse' ? 'browse' : 'auto',
    resourceRoot,
    clientDirectory: path('clientDirectory', join(resourceRoot, 'renderer')),
    runtimeDataRoot,
    homeRoot: path('homeRoot', join(runtimeDataRoot, 'home')),
    workspaceRoot: path('workspaceRoot'),
    productDatabasePath: path('productDatabasePath', join(runtimeDataRoot, 'product.sqlite')),
    productMediaRoot: path('productMediaRoot'),
    presetTemplatePath: path('presetTemplatePath', join(resourceRoot, 'agent-preset-template', 'agent.cordis.yml')),
    agentPatchPath: path('agentPatchPath', join(resourceRoot, 'desktop-agent.patch.yml')),
    packageManagerEntryPath,
    nodeBinPath: path('nodeBinPath', join(resourceRoot, 'node-bin')),
    environment: {}
  }
  if (config.environment !== undefined) {
    if (config.environment === null || typeof config.environment !== 'object' || Array.isArray(config.environment)) {
      throw new Error('Host configuration environment must contain string values')
    }
    for (const [key, entry] of Object.entries(config.environment)) {
      if (typeof entry !== 'string') throw new Error(`Host environment ${key} must be a string`)
      result.environment[key] = entry
    }
  }
  for (const file of [result.presetTemplatePath, result.agentPatchPath, result.packageManagerEntryPath,
    join(resourceRoot, 'runtime-manifest.json')]) {
    if (!existsSync(file)) throw new Error(`ElecKoi Host resource is missing: ${file}`)
  }
  return result
}

export function nodeHostPackageManager(config: NodeHostConfiguration) {
  return {
    command: process.execPath,
    args: ['--expose-internals', config.packageManagerEntryPath],
    env: {
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      PATH: `${config.nodeBinPath}${delimiter}${process.env.PATH ?? ''}`
    }
  }
}
