import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { CompatibilityStore, type CompatibilityValue } from '../storage/compatibility/CompatibilityStore'

export interface AndroidFrontendImportOptions {
  sourceRoomPath: string; sourceProjectsDirectory: string; targetRegistryDirectory: string; targetProjectsDirectory: string
  conflicts?: 'fail' | 'replace'
}
export interface AndroidFrontendBackupImportOptions {
  /** Parsed author-frontends.json from the original Android backup, not a Room dump. */
  catalog: unknown
  sourceProjectsDirectory: string; targetRegistryDirectory: string; targetProjectsDirectory: string
  conflicts?: 'fail' | 'replace'
}
interface FrontendProjectDocument extends Record<string, CompatibilityValue> {
  id: string; characterId: string; name: string; entryFile: string; files: string[]; importedAt: string
}
interface FrontendSettingDocument { characterId: string; value: { selectedProjectId: string | null; messageRendererEnabled: boolean } }

/** Import the ordinary eleckoi.author-frontends v1 JSON section with its actual extracted assets. */
export function importAndroidFrontendBackup(options: AndroidFrontendBackupImportOptions) {
  const catalog = options.catalog as Record<string, unknown>
  if (!catalog || catalog.format !== 'eleckoi.author-frontends' || catalog.version !== 1) throw new TypeError('Unsupported Android frontend backup format')
  if (!Array.isArray(catalog.projects)) throw new TypeError('Frontend backup projects must be an array')
  const projects = catalog.projects.map(value => {
    const row = value as Record<string, unknown>
    if (!row || ['id', 'characterId', 'name', 'entryFile', 'importedAt'].some(key => typeof row[key] !== 'string')
      || !Array.isArray(row.files) || row.files.some(name => typeof name !== 'string')) throw new TypeError('Invalid frontend project in backup')
    return { ...row, files: [...row.files] } as FrontendProjectDocument
  })
  if (new Set(projects.map(row => row.id)).size !== projects.length) throw new Error('Duplicate frontend project IDs in backup')
  const selections = catalog.selectedProjectIds ?? {}, renderers = catalog.messageRendererEnabledByCharacter ?? {}
  if (typeof selections !== 'object' || selections === null || Array.isArray(selections)
    || typeof renderers !== 'object' || renderers === null || Array.isArray(renderers)) throw new TypeError('Invalid frontend settings in backup')
  const selected = selections as Record<string, unknown>, enabled = renderers as Record<string, unknown>
  const projectsById = new Map(projects.map(row => [row.id, row]))
  for (const [characterId, projectId] of Object.entries(selected)) {
    if (typeof projectId !== 'string' || projectsById.get(projectId)?.characterId !== characterId) throw new Error(`Frontend selection belongs to another character: ${characterId}`)
  }
  for (const [characterId, flag] of Object.entries(enabled)) if (typeof flag !== 'boolean') throw new TypeError(`Invalid frontend renderer setting: ${characterId}`)
  const characters = new Set([...projects.map(row => row.characterId), ...Object.keys(selected), ...Object.keys(enabled)])
  const settings = [...characters].map(characterId => ({ characterId, value: {
    selectedProjectId: (selected[characterId] as string | undefined) ?? null,
    messageRendererEnabled: (enabled[characterId] as boolean | undefined) ?? true,
  } }))
  return importDocuments(options, projects, settings)
}
/** Import original Room project registration and actual file bytes, preserving IDs and relative paths. */
export function importAndroidFrontends(options: AndroidFrontendImportOptions) {
  const source = new Database(resolve(options.sourceRoomPath), { readonly: true, fileMustExist: true })
  try {
    const exists = (table: string) => source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!exists('frontend_projects')) return { projects: 0, files: 0, settings: 0, reusedProjects: 0 }
    const projects = source.prepare('SELECT id,characterId,name,entryFile,filesJson,importedAt FROM frontend_projects ORDER BY id').all() as Array<{
      id: string; characterId: string; name: string; entryFile: string; filesJson: string; importedAt: string
    }>
    const projectDocuments = projects.map(row => {
      const files = JSON.parse(row.filesJson) as unknown
      if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) throw new TypeError(`Invalid frontend files: ${row.id}`)
      const { filesJson: _serialized, ...fields } = row
      return { ...fields, files: files as string[] }
    })
    const settings = exists('character_frontend_settings') ? source.prepare('SELECT characterId,selectedProjectId,messageRendererEnabled FROM character_frontend_settings ORDER BY characterId').all() as Array<{
      characterId: string; selectedProjectId: string | null; messageRendererEnabled: number
    }> : []
    const settingDocuments = settings.map(row => ({ characterId: row.characterId,
      value: { selectedProjectId: row.selectedProjectId, messageRendererEnabled: !!row.messageRendererEnabled } }))
    return importDocuments(options, projectDocuments, settingDocuments)
  } finally { source.close() }
}

function importDocuments(options: Pick<AndroidFrontendImportOptions, 'sourceProjectsDirectory' | 'targetRegistryDirectory' | 'targetProjectsDirectory' | 'conflicts'>,
  projects: FrontendProjectDocument[], settingDocuments: FrontendSettingDocument[]) {
  const sourceRoot = resolve(options.sourceProjectsDirectory), targetRoot = resolve(options.targetProjectsDirectory)
  if (sourceRoot === targetRoot) throw new Error('Frontend migration target must differ from the source')
  const target = new CompatibilityStore(resolve(options.targetRegistryDirectory))
  const report = { projects: 0, files: 0, settings: 0, reusedProjects: 0 }
  try {
    const normalized = projects.map(project => {
      if (!project.files.includes(project.entryFile)) throw new Error(`Frontend entry is missing: ${project.id}/${project.entryFile}`)
      const projectRoot = resolve(sourceRoot, project.id), destinationRoot = resolve(targetRoot, project.id)
      if (!projectRoot.startsWith(sourceRoot + sep) || !destinationRoot.startsWith(targetRoot + sep)) throw new Error(`Invalid frontend project path: ${project.id}`)
      const assets = project.files.map(name => {
        const sourcePath = resolve(projectRoot, name), destination = resolve(destinationRoot, name)
        if (!sourcePath.startsWith(projectRoot + sep) || !destination.startsWith(destinationRoot + sep)) throw new Error(`Invalid frontend resource path: ${name}`)
        const bytes = readFileSync(sourcePath)
        if (options.conflicts !== 'replace' && existsSync(destination) && !readFileSync(destination).equals(bytes)) throw new Error(`Frontend migration resource conflict: ${project.id}/${name}`)
        return { sourcePath, destination }
      })
      const prior = target.get('frontend-projects', project.id)
      if (options.conflicts !== 'replace' && prior && JSON.stringify(prior) !== JSON.stringify(project)) throw new Error(`Frontend migration registration conflict: ${project.id}`)
      return { project, assets, reused: prior !== null }
    })
    for (const setting of settingDocuments) {
      const previous = target.get('frontend-settings', setting.characterId)
      if (options.conflicts !== 'replace' && previous && JSON.stringify(previous) !== JSON.stringify(setting.value)) throw new Error(`Frontend migration settings conflict: ${setting.characterId}`)
    }
    // Validate every source asset and conflict before copying or publishing the registrations.
    for (const { assets } of normalized) for (const asset of assets) {
      mkdirSync(dirname(asset.destination), { recursive: true }); cpSync(asset.sourcePath, asset.destination); report.files++
    }
    target.atomic(() => {
      for (const { project, reused } of normalized) {
        target.put('frontend-projects', project.id, project as CompatibilityValue)
        report.projects++; if (reused) report.reusedProjects++
      }
      for (const setting of settingDocuments) { target.put('frontend-settings', setting.characterId, setting.value); report.settings++ }
    })
    return report
  } finally { target.close() }
}
