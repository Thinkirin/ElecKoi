import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { LocalMediaStore } from '../storage/media/LocalMediaStore'

export interface AndroidFileImportOptions {
  sourceSessionsRoot?: string
  targetSessionsRoot?: string
  sourceAttachmentsRoot?: string
  targetAttachmentsRoot?: string
  sourcePluginRoot?: string
  targetPluginRoot?: string
  snapshotDirectory: string
  conflicts?: 'fail' | 'replace'
}
export interface AndroidFileImportReport {
  format: 'eleckoi.android-file-import'
  version: 1
  manifestPath: string
  files: Array<{ kind: 'session' | 'attachment' | 'plugin-database'; source: string; snapshot: string; target: string; sha256: string; reused: boolean; decompressed?: boolean }>
}

/** Preserve genuine Session files and independent plugin DB identities, including committed WAL data. */
export async function importAndroidFiles(options: AndroidFileImportOptions): Promise<AndroidFileImportReport> {
  if (!!options.sourceSessionsRoot !== !!options.targetSessionsRoot || !!options.sourceAttachmentsRoot !== !!options.targetAttachmentsRoot || !!options.sourcePluginRoot !== !!options.targetPluginRoot) throw new Error('Android file import requires both source and target roots')
  const snapshotRoot = join(resolve(options.snapshotDirectory), `android-files-${randomUUID()}`)
  mkdirSync(snapshotRoot, { recursive: true })
  const report: AndroidFileImportReport = { format: 'eleckoi.android-file-import', version: 1, manifestPath: join(snapshotRoot, 'manifest.json'), files: [] }
  const prepared: Array<{ staged: string; target: string; backup?: string }> = []
  const installed: typeof prepared = []
  try {
    if (options.sourceSessionsRoot && options.targetSessionsRoot) {
      const sourceRoot = resolve(options.sourceSessionsRoot), targetRoot = resolve(options.targetSessionsRoot)
      assertDifferentRoots(sourceRoot, targetRoot)
      for (const source of listFiles(sourceRoot)) {
        const name = relative(sourceRoot, source), snapshot = join(snapshotRoot, 'sessions', name), target = join(targetRoot, name)
        mkdirSync(dirname(snapshot), { recursive: true })
        if (existsSync(snapshot) && !readFileSync(snapshot).equals(readFileSync(source))) throw new Error(`Conflicting compressed and plain Session: ${source}`)
        copyFileSync(source, snapshot)
        await stage('session', source, snapshot, target)
        // The immutable compressed original remains present. Native Node readers use the decoded sibling.
        if (/\.jsonl\.zstd$/.test(source)) {
          const decoded = snapshot.replace(/\.zstd$/, '')
          const bytes = zstdDecompressSync(readFileSync(snapshot))
          if (existsSync(decoded) && !readFileSync(decoded).equals(bytes)) throw new Error(`Conflicting compressed and plain Session: ${source}`)
          writeFileSync(decoded, bytes)
          await stage('session', source, decoded, target.replace(/\.zstd$/, ''), true)
        }
      }
    }
    if (options.sourceAttachmentsRoot && options.targetAttachmentsRoot) {
      const sourceRoot = resolve(options.sourceAttachmentsRoot), targetRoot = resolve(options.targetAttachmentsRoot)
      assertDifferentRoots(sourceRoot, targetRoot)
      for (const source of listFiles(sourceRoot)) {
        const name = relative(sourceRoot, source), snapshot = join(snapshotRoot, 'attachments', name), target = join(targetRoot, name)
        mkdirSync(dirname(snapshot), { recursive: true }); copyFileSync(source, snapshot)
        await stage('attachment', source, snapshot, target)
      }
    }
    if (options.sourcePluginRoot && options.targetPluginRoot) {
      const sourceRoot = resolve(options.sourcePluginRoot), targetRoot = resolve(options.targetPluginRoot)
      assertDifferentRoots(sourceRoot, targetRoot)
      if (!existsSync(sourceRoot)) throw new Error(`Android plugin directory does not exist: ${sourceRoot}`)
      for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.sqlite$/.test(entry.name)) continue
        const source = join(sourceRoot, entry.name), snapshot = join(snapshotRoot, 'plugins', entry.name), target = join(targetRoot, entry.name)
        mkdirSync(dirname(snapshot), { recursive: true })
        const database = new Database(source, { readonly: true, fileMustExist: true })
        try {
          if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error(`Invalid Android plugin database: ${source}`)
          await database.backup(snapshot)
        } finally { database.close() }
        await stage('plugin-database', source, snapshot, target)
      }
    }
    for (const item of prepared) {
      mkdirSync(dirname(item.target), { recursive: true })
      const temporary = `${item.target}.${randomUUID()}.tmp`
      copyFileSync(item.staged, temporary)
      try { renameSync(temporary, item.target); installed.push(item) }
      finally { rmSync(temporary, { force: true }) }
    }
    writeFileSync(report.manifestPath, JSON.stringify(report, null, 2) + '\n')
    return report
  } catch (error) {
    for (const item of installed.reverse()) {
      if (item.backup) copyFileSync(item.backup, item.target)
      else rmSync(item.target, { force: true })
    }
    writeFileSync(report.manifestPath, JSON.stringify({ ...report, state: 'failed', error: (error as Error).message }, null, 2) + '\n')
    throw error
  }
  async function stage(kind: 'session' | 'attachment' | 'plugin-database', source: string, snapshot: string, target: string, decompressed = false) {
    const repeated = report.files.find(file => file.target === target)
    if (repeated) {
      if (!readFileSync(repeated.snapshot).equals(readFileSync(snapshot))) throw new Error(`Conflicting source files for ${target}`)
      return
    }
    const same = existsSync(target) && (kind === 'plugin-database' ? sameSqlite(target, snapshot) : readFileSync(target).equals(readFileSync(snapshot)))
    if (existsSync(target) && !same && options.conflicts !== 'replace') throw new Error(`Android file import conflict: ${target}`)
    report.files.push({ kind, source, snapshot, target, sha256: hash(snapshot), reused: same, ...(decompressed ? { decompressed: true } : {}) })
    if (!same) {
      let backup: string | undefined
      if (existsSync(target)) {
        backup = join(snapshotRoot, 'previous-target', `${prepared.length}-${basename(target)}`); mkdirSync(dirname(backup), { recursive: true })
        if (kind === 'plugin-database') {
          const previous = new Database(target, { readonly: true, fileMustExist: true })
          try { await previous.backup(backup) } finally { previous.close() }
          if (existsSync(`${target}-wal`) || existsSync(`${target}-shm`)) throw new Error(`Close the target plugin database before replacing it: ${target}`)
        } else copyFileSync(target, backup)
      }
      prepared.push({ staged: snapshot, target, ...(backup ? { backup } : {}) })
    }
  }
}

export interface AndroidMediaImportOptions {
  sourceFilesRoot: string
  /** Original device files directory, e.g. /data/user/0/com.eleckoi.android/files. */
  androidFilesPrefix: string
  targetMediaRoot: string
  targetAttachmentsRoot: string
}
export function createAndroidMediaImporter(options: AndroidMediaImportOptions) {
  const sourceRoot = resolve(options.sourceFilesRoot), attachmentsRoot = resolve(options.targetAttachmentsRoot)
  const media = new LocalMediaStore(options.targetMediaRoot)
  const mappings: Array<{ original: string; source: string; target: string; reference: string; sha256: string }> = []
  function sourcePath(value: string): string | undefined {
    let path = value
    if (path.startsWith('file:')) { try { path = fileURLToPath(path) } catch { return undefined } }
    const original = options.androidFilesPrefix.replaceAll('\\', '/').replace(/\/$/, ''), normalized = path.replaceAll('\\', '/')
    const suffix = normalized.startsWith(`${original}/`) ? normalized.slice(original.length + 1)
      : resolve(path).startsWith(`${sourceRoot}${sep}`) ? relative(sourceRoot, resolve(path)) : undefined
    if (suffix === undefined) return undefined
    const candidate = resolve(sourceRoot, suffix)
    if (!candidate.startsWith(`${sourceRoot}${sep}`)) throw new Error(`Android media path leaves source files: ${value}`)
    if (!existsSync(candidate)) throw new Error(`Referenced Android media is missing: ${value}`)
    return candidate
  }
  function rewrite(value: string, owner?: string, slot?: string): string {
    const source = sourcePath(value)
    if (!source) return value
    const extension = extname(source).toLowerCase().replace('.', ''), digest = hash(source)
    if (owner && slot && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
      const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`
      const prepared = media.prepareImage(owner, slot, `data:${mime};base64,${readFileSync(source).toString('base64')}`)
      // Offline import retains every old owner asset until the database transaction settles.
      // The normal native edit service can prune its slot on a later user edit.
      mappings.push({ original: value, source, target: media.pathForReference(prepared.reference)!, reference: prepared.reference, sha256: digest })
      return prepared.reference
    }
    const target = join(attachmentsRoot, `${digest}${extension ? `.${extension}` : ''}`)
    mkdirSync(attachmentsRoot, { recursive: true })
    if (!existsSync(target)) copyFileSync(source, target)
    else if (hash(target) !== digest) throw new Error(`Android attachment content conflict: ${target}`)
    mappings.push({ original: value, source, target, reference: target, sha256: digest })
    return target
  }
  function transform<T>(value: T): T {
    if (typeof value === 'string') return rewrite(value) as T
    if (Array.isArray(value)) return value.map(item => transform(item)) as T
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key.endsWith('Json') && typeof item === 'string' && item.trim()) return [key, JSON.stringify(transform(JSON.parse(item)))]
      return [key, transform(item)]
    })) as T
    return value
  }
  return { rewrite, transform, mappings }
}

export interface AndroidMediaReferencesImportOptions extends AndroidMediaImportOptions {
  targetRoomPath: string
  targetRegistryPath: string
  snapshotDirectory: string
}
/** Rewrite existing native/compatibility media fields after domain import; raw migration records remain exact. */
export async function importAndroidMediaReferences(options: AndroidMediaReferencesImportOptions) {
  const importer = createAndroidMediaImporter(options), snapshotRoot = join(resolve(options.snapshotDirectory), `android-media-${randomUUID()}`)
  mkdirSync(snapshotRoot, { recursive: true })
  const target = new Database(options.targetRoomPath), registryPath = resolve(options.targetRegistryPath)
  const roomSnapshot = join(snapshotRoot, 'product-before-media.sqlite'), registrySnapshot = join(snapshotRoot, 'registry-before-media.sqlite')
  let attached = false, changedRows = 0, changedDocuments = 0
  try {
    await target.backup(roomSnapshot)
    const registry = new Database(registryPath, { readonly: true, fileMustExist: true })
    try { await registry.backup(registrySnapshot) } finally { registry.close() }
    target.prepare('ATTACH DATABASE ? AS compatibility_registry').run(registryPath); attached = true
    target.transaction(() => {
      const tables = target.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
      for (const { name } of tables) {
        const columns = target.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as Array<{ name: string; pk: number }>
        const primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk)
        if (!primary.length) continue
        for (const raw of target.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Record<string, unknown>[]) {
          const changed: Record<string, string> = {}
          for (const column of columns) {
            const value = raw[column.name]
            if (typeof value !== 'string') continue
            let next: string
            const characterSlots: Record<string, string> = { avatar: 'avatar', assistantAvatar: 'assistant-avatar', squareImage: 'square', coverImage: 'portrait', chatBackground: 'chat-background' }
            const userSlots: Record<string, string> = { userAvatar: 'avatar', userSquare: 'square', userPortrait: 'portrait', userCover: 'cover' }
            if (name === 'characters' && characterSlots[column.name]) next = importer.rewrite(value, `character/${raw.id}`, characterSlots[column.name])
            else if (name === 'user_profile' && userSlots[column.name]) next = importer.rewrite(value, 'user/default', userSlots[column.name])
            else if (column.name.endsWith('Json') && value.trim()) next = JSON.stringify(importer.transform(JSON.parse(value)))
            else next = importer.rewrite(value)
            if (next !== value) changed[column.name] = next
          }
          const names = Object.keys(changed)
          if (!names.length) continue
          target.prepare(`UPDATE "${name.replaceAll('"', '""')}" SET ${names.map(column => `"${column}"=?`).join(',')} WHERE ${primary.map(column => `"${column.name}"=?`).join(' AND ')}`).run(...Object.values(changed), ...primary.map(column => raw[column.name]))
          changedRows++
        }
      }
      for (const row of target.prepare("SELECT scope,key,value FROM compatibility_registry.documents WHERE scope NOT LIKE 'migration:android%'").all() as Array<{ scope: string; key: string; value: string }>) {
        const next = JSON.stringify(importer.transform(JSON.parse(row.value)))
        if (next === row.value) continue
        target.prepare('UPDATE compatibility_registry.documents SET value=? WHERE scope=? AND key=?').run(next, row.scope, row.key); changedDocuments++
      }
      const previous = target.prepare('SELECT value FROM compatibility_registry.documents WHERE scope=? AND key=?').get('migration:android:media', 'path-mappings') as { value: string } | undefined
      const accumulated = previous ? JSON.parse(previous.value) as typeof importer.mappings : []
      for (const mapping of importer.mappings) if (!accumulated.some(item => item.original === mapping.original && item.target === mapping.target)) accumulated.push(mapping)
      target.prepare('INSERT INTO compatibility_registry.documents(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value').run('migration:android:media', 'path-mappings', JSON.stringify(accumulated))
    }).immediate()
    const report = { format: 'eleckoi.android-media-import', version: 1, roomSnapshot, registrySnapshot, changedRows, changedDocuments, mappings: importer.mappings, manifestPath: join(snapshotRoot, 'manifest.json') }
    writeFileSync(report.manifestPath, JSON.stringify(report, null, 2) + '\n'); return report
  } catch (error) {
    writeFileSync(join(snapshotRoot, 'manifest.json'), JSON.stringify({ state: 'failed', roomSnapshot, registrySnapshot, changedRows, changedDocuments, mappings: importer.mappings, error: (error as Error).message }, null, 2) + '\n'); throw error
  } finally { if (attached) target.exec('DETACH DATABASE compatibility_registry'); target.close() }
}
function hash(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function assertDifferentRoots(source: string, target: string): void {
  if (source === target || source.startsWith(`${target}${sep}`) || target.startsWith(`${source}${sep}`)) throw new Error('Android source and target file trees must not overlap')
}
function listFiles(root: string): string[] {
  if (!existsSync(root)) throw new Error(`Android source directory does not exist: ${root}`)
  const result: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Android export must contain regular files: ${path}`)
    if (entry.isDirectory()) result.push(...listFiles(path)); else if (entry.isFile()) result.push(path)
  }
  return result
}
function sameSqlite(left: string, right: string): boolean {
  const databases = [left, right].map(path => new Database(path, { readonly: true, fileMustExist: true }))
  try {
    function content(database: Database.Database) {
      database.defaultSafeIntegers(true)
      const schema = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all() as Array<{ type: string; name: string; sql: string }>
      const tables = schema.filter(item => item.type === 'table')
      return JSON.stringify({ schema, userVersion: String(database.pragma('user_version', { simple: true })), applicationId: String(database.pragma('application_id', { simple: true })),
        tables: tables.map(table => ({ ...table, rows: database.prepare(`SELECT ${/WITHOUT\s+ROWID/i.test(table.sql ?? '') ? '*' : '_rowid_ AS __migration_rowid__,*'} FROM "${table.name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: value.toString() } : value)).sort() })) })
    }
    return content(databases[0]!) === content(databases[1]!)
  } finally { databases.forEach(database => database.close()) }
}
