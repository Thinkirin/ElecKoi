import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
export { importAndroidFrontends, importAndroidFrontendBackup } from './androidFrontendImport'
export { importAndroidLogicalDomains } from './androidLogicalDomainImport'
export type { AndroidFrontendImportOptions } from './androidFrontendImport'
export { importAndroidModelConfigSection } from './androidModelImport'
export type { AndroidModelConfigImportReport, AndroidModelConfigImportServices } from './androidModelImport'
export { importAndroidCreatorBackup } from './androidCreatorImport'
export type { AndroidCreatorImportOptions, AndroidCreatorImportReport } from './androidCreatorImport'
export { decodeAndroidPreferences, prepareAndroidFontSelection } from './androidPreferencesImport'
import { installSchema } from '../storage/sqlite/installSchema'

type SqlValue = null | string | number | bigint | Buffer
type Row = Record<string, SqlValue>
type Column = { name: string; pk: number; notnull: number; dflt_value: string | null }
export const ANDROID_DOMAIN_TABLES = [
  'characters', 'character_text_contents', 'character_meta', 'user_profile',
  'agent_preset_library_groups', 'agent_presets', 'agent_preset_contents', 'agent_preset_entries', 'agent_preset_groups',
  'agent_preset_versions', 'agent_preset_version_contents', 'agent_preset_version_entries', 'agent_preset_version_groups', 'agent_preset_state',
  'setting_libraries', 'setting_entry_contents', 'setting_library_entry_links', 'setting_library_groups',
  'setting_library_versions', 'setting_library_version_entry_links', 'setting_library_version_groups',
  'variable_configs', 'variable_config_versions', 'variable_config_version_contents', 'variable_config_objects', 'variable_config_variables',
  'global_regex_rules', 'character_regex_rules', 'regex_enablement_versions', 'regex_state'
] as const
export interface AndroidDomainImportOptions {
  sourceRoomPath: string
  sourceRegistryPath?: string
  targetRoomPath: string
  targetRegistryPath: string
  snapshotDirectory: string
  /** Different existing rows fail by default; replace is an explicit migration choice. */
  conflicts?: 'fail' | 'replace'
}
export interface AndroidDomainImportReport {
  format: 'eleckoi.android-domain-import'; version: 1; sourceVersion: number; sourceHash: string
  roomSnapshot: string; registrySnapshot?: string; manifestPath: string
  targetRoomPath: string; targetRegistryPath: string
  tables: Array<{ name: string; sourceRows: number; importedRows: number; reusedRows: number; preservedColumns: string[] }>
  registry: { sourceRows: number; importedRows: number; reusedRows: number }
  /** IDs are retained; singleton settings change their storage key from Android 0 to common 1. */
  mappings: Array<{ table: string; sourceKey: string; targetKey: string }>
}

/** Offline domain import into the existing common schema; never copy over the target database. */
export async function importAndroidDomains(options: AndroidDomainImportOptions): Promise<AndroidDomainImportReport> {
  const sourcePath = resolve(options.sourceRoomPath), targetPath = resolve(options.targetRoomPath), targetRegistry = resolve(options.targetRegistryPath)
  const sourceRegistry = options.sourceRegistryPath ? resolve(options.sourceRegistryPath) : undefined
  if ([targetPath, targetRegistry].some(path => path === sourcePath || path === sourceRegistry)) throw new Error('Migration target must differ from the source database')
  if (options.conflicts && !['fail', 'replace'].includes(options.conflicts)) throw new Error('Unknown migration conflict policy')
  const snapshotRoot = join(resolve(options.snapshotDirectory), `android-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
  mkdirSync(snapshotRoot, { recursive: true })
  const roomSnapshot = join(snapshotRoot, 'room.sqlite'), registrySnapshot = sourceRegistry ? join(snapshotRoot, 'registry.sqlite') : undefined
  await backupReadOnly(sourcePath, roomSnapshot)
  if (sourceRegistry && registrySnapshot) await backupReadOnly(sourceRegistry, registrySnapshot)
  const sourceHash = await sha256(roomSnapshot), room = new Database(roomSnapshot, { readonly: true, fileMustExist: true })
  const registry = registrySnapshot ? new Database(registrySnapshot, { readonly: true, fileMustExist: true }) : undefined
  mkdirSync(dirname(targetPath), { recursive: true }); mkdirSync(dirname(targetRegistry), { recursive: true })
  const target = new Database(targetPath)
  const report: AndroidDomainImportReport = { format: 'eleckoi.android-domain-import', version: 1,
    sourceVersion: Number(room.pragma('user_version', { simple: true })), sourceHash, roomSnapshot,
    ...(registrySnapshot ? { registrySnapshot } : {}), manifestPath: join(snapshotRoot, 'manifest.json'),
    targetRoomPath: targetPath, targetRegistryPath: targetRegistry, tables: [], registry: { sourceRows: 0, importedRows: 0, reusedRows: 0 }, mappings: [] }
  let attached = false
  try {
    assertHealthy(room, 'source Room'); if (registry) assertHealthy(registry, 'source registry')
    target.pragma('foreign_keys = ON'); target.pragma('busy_timeout = 5000'); installSchema(target)
    target.prepare('ATTACH DATABASE ? AS compatibility_registry').run(targetRegistry); attached = true
    target.exec('CREATE TABLE IF NOT EXISTS compatibility_registry.documents (scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,key))')
    const saveDocument = target.prepare('INSERT INTO compatibility_registry.documents(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value')
    const rawScope = `migration:android:raw:${sourceHash}`, mappingScope = `migration:android:mappings:${sourceHash}`
    const batches = ANDROID_DOMAIN_TABLES.filter(table => hasTable(room, table)).map(table => ({ table,
      sourceColumns: columns(room, table), targetColumns: columns(target, table), rows: room.prepare(`SELECT * FROM ${quote(table)}`).all() as Row[] }))
    const sourceDocuments = registry && hasTable(registry, 'documents') ? registry.prepare('SELECT scope,key,value FROM documents ORDER BY scope,key').all() as Array<{ scope: string; key: string; value: string }> : []
    // Parse every source JSON row before target changes. Bad source data is reported with its owner.
    for (const batch of batches) for (const row of batch.rows) for (const [name, value] of Object.entries(row)) {
      if ((name.endsWith('Json') || ['payloadJson', 'targetsJson'].includes(name)) && typeof value === 'string' && value.trim()) {
        try { JSON.parse(value) } catch (error) { throw new Error(`Invalid Android JSON in ${batch.table}.${name}: ${(error as Error).message}`) }
      }
    }
    for (const document of sourceDocuments) {
      try { JSON.parse(document.value) } catch (error) { throw new Error(`Invalid registry JSON in ${document.scope}/${document.key}: ${(error as Error).message}`) }
    }
    target.transaction(() => {
      target.pragma('defer_foreign_keys = ON')
      for (const batch of batches) {
        const shared = batch.targetColumns.filter(column => batch.sourceColumns.some(source => source.name === column.name))
        const primary = batch.targetColumns.filter(column => column.pk).sort((a, b) => a.pk - b.pk)
        if (!primary.length || primary.some(column => !shared.includes(column))) throw new Error(`Android migration lacks the primary key for ${batch.table}`)
        const missing = batch.targetColumns.filter(column => column.notnull && column.dflt_value === null && !shared.includes(column))
        if (missing.length) throw new Error(`Android migration needs a transform for ${batch.table}: ${missing.map(column => column.name).join(', ')}`)
        const extra = batch.sourceColumns.filter(column => !shared.some(shared => shared.name === column.name)).map(column => column.name)
        const keyWhere = primary.map(column => `${quote(column.name)}=?`).join(' AND ')
        const lookup = target.prepare(`SELECT * FROM ${quote(batch.table)} WHERE ${keyWhere}`)
        const mutable = shared.filter(column => !primary.includes(column))
        const put = target.prepare(`INSERT INTO ${quote(batch.table)}(${shared.map(column => quote(column.name)).join(',')}) VALUES(${shared.map(() => '?').join(',')}) ON CONFLICT(${primary.map(column => quote(column.name)).join(',')}) ${mutable.length ? `DO UPDATE SET ${mutable.map(column => `${quote(column.name)}=excluded.${quote(column.name)}`).join(',')}` : 'DO NOTHING'}`)
        let importedRows = 0, reusedRows = 0
        for (const original of batch.rows) {
          const row = { ...original }
          if (['agent_preset_state', 'regex_state'].includes(batch.table) && row.singletonId === 0) row.singletonId = 1
          const sourceKey = key(original, primary), targetKey = key(row, primary)
          const existing = lookup.get(...primary.map(column => row[column.name])) as Row | undefined
          const same = existing && shared.every(column => sameSql(existing[column.name], row[column.name]))
          if (existing && !same && options.conflicts !== 'replace') throw new Error(`Android import conflict in ${batch.table}/${sourceKey}; source snapshot is preserved`)
          if (same) reusedRows++; else { put.run(...shared.map(column => row[column.name])); importedRows++ }
          const mapping = { table: batch.table, sourceKey, targetKey }
          report.mappings.push(mapping)
          saveDocument.run(rawScope, `${batch.table}/${sourceKey}`, JSON.stringify(jsonRow(original)))
          saveDocument.run(mappingScope, `${batch.table}/${sourceKey}`, JSON.stringify({ ...mapping, sourceSnapshot: roomSnapshot }))
        }
        report.tables.push({ name: batch.table, sourceRows: batch.rows.length, importedRows, reusedRows, preservedColumns: extra })
      }
      // The shared companion registry has the same schema, so IDs/scope names and arbitrary values remain exact.
      const lookupDocument = target.prepare('SELECT value FROM compatibility_registry.documents WHERE scope=? AND key=?')
      for (const document of sourceDocuments) {
        const existing = lookupDocument.get(document.scope, document.key) as { value: string } | undefined
        report.registry.sourceRows++
        if (existing?.value === document.value) report.registry.reusedRows++
        else {
          if (existing && options.conflicts !== 'replace') throw new Error(`Android import conflict in registry ${document.scope}/${document.key}`)
          saveDocument.run(document.scope, document.key, document.value); report.registry.importedRows++
        }
      }
      const invalid = target.pragma('foreign_key_check') as unknown[]
      if (invalid.length) throw new Error(`Android domain import failed foreign-key validation: ${JSON.stringify(invalid)}`)
      preserveRegexCompanions(target, batches, saveDocument)
      saveDocument.run('migration:android', sourceHash, JSON.stringify({ state: 'domains-imported', roomSnapshot,
        registrySnapshot: registrySnapshot ?? null, tables: report.tables, registry: report.registry }))
    }).immediate()
    writeFileSync(report.manifestPath, JSON.stringify(report, null, 2) + '\n')
    return report
  } catch (error) {
    writeFileSync(report.manifestPath, JSON.stringify({ ...report, state: 'failed', error: (error as Error).message }, null, 2) + '\n')
    throw error
  } finally {
    if (attached) target.exec('DETACH DATABASE compatibility_registry')
    target.close(); registry?.close(); room.close()
  }
}

function preserveRegexCompanions(target: Database.Database, batches: Array<{ table: string; rows: Row[] }>, save: Database.Statement): void {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const batch of batches.filter(batch => ['global_regex_rules', 'character_regex_rules'].includes(batch.table))) for (const row of batch.rows) {
    const scope = batch.table === 'global_regex_rules' ? 'global' : `character:${row.characterId}`
    const compatibility = typeof row.compatibilityJson === 'string' ? JSON.parse(row.compatibilityJson) : {}
    const projected = { ...compatibility, id: row.id, name: row.name, pattern: row.pattern, replacement: row.replacement,
      targets: JSON.parse(String(row.targetsJson)), enabled: row.enabled === 1, displayOnly: row.displayOnly === 1,
      promptOnly: row.promptOnly === 1, runOnEdit: row.runOnEdit === 1, order: row.sortIndex }
    groups.set(scope, [...groups.get(scope) ?? [], projected])
  }
  for (const [scope, imported] of groups) {
    const existing = target.prepare('SELECT value FROM compatibility_registry.documents WHERE scope=? AND key=?').get('regex-native-companions', scope) as { value: string } | undefined
    const previous = existing ? JSON.parse(existing.value) as Record<string, unknown>[] : []
    save.run('regex-native-companions', scope, JSON.stringify([...previous.filter(row => !imported.some(item => item.id === row.id)), ...imported]))
  }
}
async function backupReadOnly(sourcePath: string, destination: string): Promise<void> {
  if (!existsSync(sourcePath)) throw new Error(`Android source database does not exist: ${sourcePath}`)
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try { await source.backup(destination) } finally { source.close() }
}
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function assertHealthy(database: Database.Database, label: string): void {
  const result = database.pragma('quick_check', { simple: true })
  if (result !== 'ok') throw new Error(`${label} SQLite validation failed: ${String(result)}`)
}
function hasTable(database: Database.Database, table: string): boolean { return !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) }
function columns(database: Database.Database, table: string): Column[] { return database.prepare(`PRAGMA table_info(${quote(table)})`).all() as Column[] }
function quote(identifier: string): string { return `"${identifier.replaceAll('"', '""')}"` }
function key(row: Row, primary: Column[]): string { return JSON.stringify(primary.map(column => jsonValue(row[column.name]))) }
function sameSql(a: SqlValue | undefined, b: SqlValue | undefined): boolean { return Buffer.isBuffer(a) && Buffer.isBuffer(b) ? a.equals(b) : a === b }
function jsonValue(value: SqlValue | undefined): unknown { return Buffer.isBuffer(value) ? { sqliteBlobBase64: value.toString('base64') } : typeof value === 'bigint' ? { sqliteInteger: value.toString() } : value }
function jsonRow(row: Row): Record<string, unknown> { return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, jsonValue(value)])) }
