import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import { extractAndroidBackup, androidArchivePath, type ExtractedAndroidBackup } from '@eleckoi/dsh-product-api'
import type { CharacterRecord, CompatibilityValue, CompatibilityCommand } from '@eleckoi/dsh-product-api/types'
import { importAndroidDomains, importAndroidFrontendBackup, decodeAndroidPreferences, prepareAndroidFontSelection } from '@eleckoi/dsh-product-data/android-import'
import { importAndroidConversations } from '@eleckoi/dsh-product-data/android-conversations'
import { createAndroidConversationFileSessionAdapter } from './androidTranscriptImport'
import { importAndroidLogicalChats } from './androidLogicalChatImport'

type Document = Record<string, any>
const object = (value: unknown): Document => value && typeof value === 'object' && !Array.isArray(value) ? value as Document : {}
const json = (value: unknown): CompatibilityValue => JSON.parse(JSON.stringify(value)) as CompatibilityValue
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const now = () => new Date().toISOString()
const required = (p: Document, field: string) => { const value = text(p[field]); if (!value) throw new Error(`Migration requires ${field}`); return value }
interface Upload { id: string; path: string; filename: string; bytes: number; createdAt: string }
interface Task {
  id: string; uploadId: string; conflicts: 'fail' | 'replace'; status: 'pending' | 'running' | 'completed' | 'failed';
  phase: string; createdAt: string; updatedAt: string; progress?: { completed: number; total: number; current?: string };
  report?: Document; error?: { code: string; message: string }
}

/** The upload, task and data conversions live in the shared Host; Android only picks a file. */
export async function installAndroidMigration(ctx: Context): Promise<void> {
  const store = ctx.eleckoiProductData.compatibilityStore(), root = join(dirname(store.root), 'migration')
  mkdirSync(join(root, 'uploads'), { recursive: true })
  const inspections = new Map<string, Promise<{ value: Document; backup?: ExtractedAndroidBackup }>>()
  const upload = (id: string): Upload => { const value = store.get('migration:uploads', id); if (!value) throw new Error(`Migration upload does not exist: ${id}`); return value as unknown as Upload }
  const task = (id: string): Task => { const value = store.get('migration:tasks', id); if (!value) throw new Error(`Migration task does not exist: ${id}`); return value as unknown as Task }
  const saveTask = (value: Task) => { value.updatedAt = now(); store.put('migration:tasks', value.id, json(value)); return value }
  let queue: Promise<void> = Promise.resolve(), closing = false

  function inspect(id: string) {
    let pending = inspections.get(id)
    if (!pending) {
      pending = (async () => {
        const source = upload(id), header = Buffer.alloc(16)
        const stream = createReadStream(source.path, { start: 0, end: 15 })
        let offset = 0; for await (const chunk of stream) { chunk.copy(header, offset); offset += chunk.length }
        if (header.toString('utf8') === 'SQLite format 3\u0000') {
          return { value: { uploadId: id, source: { kind: 'room-snapshot', label: source.filename, format: 'sqlite' },
            contents: [{ id: 'room', label: '原始 Android Room 数据', count: 1, supported: true }],
            warnings: ['单个 Room 快照不含 registry、插件独立数据库、媒体及原始 DSH 日志；请使用完整快照 CLI 导入这些资料。'] } }
        }
        const backup = await extractAndroidBackup(source.path, join(root, 'uploads', id, 'extracted'))
        const { manifest } = backup
        const contents = [
          { id: 'characters', label: '角色、设定库、变量和正则', count: manifest.character_count, supported: true },
          { id: 'chats', label: '聊天可见历史', count: manifest.session_count, supported: true },
          { id: 'files', label: '媒体与主题文件', count: manifest.entries.filter(entry => entry.kind === 'file').length, supported: true },
          { id: 'sections', label: '模型、预设、用户资料和全局配置', count: manifest.entries.filter(entry => entry.kind === 'section').length, supported: true },
          { id: 'creator', label: '创作工作区与助手会话', count: manifest.creator_workspace_count + manifest.creator_conversation_count, supported: true }
        ]
        return { backup, value: { uploadId: id, source: { kind: 'logical-backup', label: source.filename, format: manifest.format, version: manifest.version }, contents,
          warnings: ['普通备份未导出原始 Agent Session、历史分支、compat registry 或插件数据库；可见历史会明确标记为导入记录。',
            '备份不包含 API 密钥，需要在新应用重新填写。', ...(manifest.excluded ?? []).map(value => `原备份排除：${value}`)] } }
      })()
      inspections.set(id, pending)
      pending.catch(() => inspections.delete(id))
    }
    return pending
  }

  async function logicalImport(current: Task, backup: ExtractedAndroidBackup): Promise<Document> {
    const data = ctx.eleckoiProductData, sectionScope = `migration:android:sections:${backup.sourceHash}`
    const report: Document = { format: 'eleckoi.android-logical-backup-import', version: 1, sourceHash: backup.sourceHash,
      source: backup.manifest, sections: [], chats: [], warnings: [], preservedRoot: backup.root, credentialsMissing: [] }
    current.report = report; saveTask(current)
    const sections: Record<string, unknown> = {}, mappings: Document[] = []
    const mediaRoot = required(process.env, 'ELECKOI_MEDIA_ROOT'), filesRoot = join(mediaRoot, 'android-backup', backup.sourceHash)
    const completedScope = `migration:android:logical-checkpoints:${backup.sourceHash}`
    const update = (phase: string, done: number, total: number, entry?: string) => { current.phase = phase; current.progress = { completed: done, total, ...(entry ? { current: entry } : {}) }; saveTask(current) }
    const transform = (input: unknown): unknown => {
      if (typeof input === 'string') {
        if (!input.startsWith('@files/')) return input
        const suffix = input.slice('@files/'.length), target = androidArchivePath(filesRoot, suffix)
        if (!existsSync(target)) throw new Error(`Backup references a file that was not exported: ${input}`)
        return target
      }
      if (Array.isArray(input)) return input.map(transform)
      if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, transform(value)]))
      return input
    }
    let done = 0
    for (const entry of backup.manifest.entries.filter(entry => entry.kind === 'file')) {
      update('files', done++, backup.manifest.entries.length, entry.name)
      if (!entry.name.startsWith('files/')) throw new Error(`Invalid backup file prefix: ${entry.name}`)
      const original = `@files/${entry.name.slice('files/'.length)}`, target = androidArchivePath(filesRoot, entry.name.slice('files/'.length))
      mkdirSync(dirname(target), { recursive: true }); await copyFile(androidArchivePath(backup.root, entry.name), target)
      mappings.push({ original, target, reference: target })
    }
    store.put('migration:android:media', 'path-mappings', json([...new Map([...(Array.isArray(store.get('migration:android:media', 'path-mappings')) ? store.get('migration:android:media', 'path-mappings') as Document[] : []), ...mappings].map(value => [value.original, value])).values()]))
    for (const entry of backup.manifest.entries.filter(entry => ['section', 'chat', 'creator_chat'].includes(entry.kind))) {
      const raw = JSON.parse(readFileSync(androidArchivePath(backup.root, entry.name), 'utf8'))
      store.put(sectionScope, entry.name, json(raw)); sections[entry.name] = transform(raw)
    }
    const stage = async (key: string, action: () => unknown | Promise<unknown>) => {
      update('sections', done++, backup.manifest.entries.length, key)
      const old = store.get(completedScope, key)
      if (old !== null) { report.sections.push({ name: key, reused: true, result: old }); saveTask(current); return old }
      const value = json(await action()); store.put(completedScope, key, value)
      report.sections.push({ name: key, reused: false, result: value }); saveTask(current); return value
    }
    if (sections['characters.json']) await stage('characters.json', () => {
      const collection = object(sections['characters.json'])
      if (!Array.isArray(collection.items)) throw new Error('characters.json has no items')
      for (const input of collection.items) {
        const character = object(input), id = required(character, 'id'), existing = data.readCharacters().items.find(item => item.id === id)
        if (existing && current.conflicts !== 'replace') throw new Error(`Character ID already exists: ${id}`)
        if (existing) data.updateCharacter(character as CharacterRecord); else data.createCharacter(character as CharacterRecord)
        store.put('character-native-extra', id, json(character))
      }
      data.saveCharacterGroups(Array.isArray(collection.groups) ? collection.groups : [], collection.items.map((item: Document) => ({ characterId: item.id, group: item.group ?? item.group_name ?? '' })))
      if (collection.active_character_id) data.selectCharacter(collection.active_character_id)
      ctx.eleckoiProductRecordChanges.publish({ kind: 'records', domain: 'characters', ids: collection.items.map((item: Document) => item.id) })
      return { items: collection.items.length }
    })
    if (sections['profile.json']) await stage('profile.json', () => {
      const profile = object(sections['profile.json']); data.savePersona({ ...data.readPersona(), ...profile })
      return { imported: true }
    })
    if (sections['preferences.json']) await stage('preferences.json', async () => {
      const currentPreferences = ctx.eleckoiDisplayPreferencesApi.read()
      const decoded = decodeAndroidPreferences({ section: sections['preferences.json'], currentUi: currentPreferences.ui, currentChatDisplay: currentPreferences.chatDisplay })
      await ctx.eleckoiDisplayPreferencesApi.updateUi(json(decoded.ui) as Record<string, CompatibilityValue>)
      await ctx.eleckoiDisplayPreferencesApi.setChatDisplay(json(decoded.chatDisplay) as Record<string, CompatibilityValue>)
      return { appliedKeys: decoded.appliedKeys, unmappedKeys: decoded.unmappedKeys }
    })
    if (sections['app-font.json']) await stage('app-font.json', async () => {
      const result = prepareAndroidFontSelection({ section: sections['app-font.json'], sourceFilesRoot: filesRoot })
      await ctx.eleckoiDisplayPreferencesApi.updateUi({ ...ctx.eleckoiDisplayPreferencesApi.read().ui, app_font: json(result.selection), app_fonts: json(result.installed) })
      return result
    })
    // Domain conversion and model/frontend helpers are installed from the product data package.
    const { importAndroidLogicalDomains, importAndroidModelConfigSection, importAndroidCreatorBackup } = await import('@eleckoi/dsh-product-data/android-import')
    await stage('logical-domains', () => importAndroidLogicalDomains({ sections, targetRoomPath: required(process.env, 'ELECKOI_DATABASE_PATH'),
      targetRegistryPath: join(store.root, 'registry.sqlite'), conflicts: current.conflicts, mediaRoot }))
    if (sections['model-configs.json']) report.models = await stage('model-configs.json', () => importAndroidModelConfigSection(sections['model-configs.json'], {
      invokeCompatibility: async command => ctx.eleckoiCompatibilityApi.invoke({ method: command.method, params: json(command.params) as CompatibilityCommand['params'] }),
      selectActive: selection => ctx.eleckoiConversationModelsApi.select('', { provider: selection.provider, model: selection.model }),
      preserveRaw: section => store.put('migration:android:models', backup.sourceHash, json(section))
    }))
    if (sections['author-frontends.json']) await stage('author-frontends.json', () => importAndroidFrontendBackup({ catalog: sections['author-frontends.json'],
      sourceProjectsDirectory: join(backup.root, 'files', 'author_frontends', 'projects'), targetRegistryDirectory: store.root,
      targetProjectsDirectory: join(store.root, 'frontends'), conflicts: current.conflicts }))
    for (const [name, history] of Object.entries(sections).filter(([name]) => name.startsWith('chats/'))) {
      const result = await stage(name, () => importAndroidLogicalChats(ctx, history, backup.sourceHash, current.conflicts))
      report.chats.push(...result as Document[])
    }
    if (backup.manifest.creator_workspace_count || backup.manifest.creator_conversation_count) report.creator = await stage('creator', () => importAndroidCreatorBackup({
      sourceFilesDirectory: join(backup.root, 'files'), targetWorkspaceRoot: required(process.env, 'ELECKOI_WORKSPACE_ROOT'),
      targetProjectsDirectory: join(required(process.env, 'ELECKOI_WORKSPACE_ROOT'), 'android-creator-projects'), targetRegistryDirectory: store.root,
      targetSessionsRoot: required(process.env, 'DSH_SESSION_ROOT'), sessions: createAndroidConversationFileSessionAdapter(required(process.env, 'DSH_HOME'), ctx.sessionPersistence),
      documents: backup.manifest.entries.filter(entry => entry.kind === 'creator_chat').map(entry => ({ name: entry.name, value: sections[entry.name] })),
      transform: input => transform(input) as typeof input, conflicts: current.conflicts
    }))
    for (const entry of backup.manifest.entries.filter(entry => entry.kind === 'symlink')) report.warnings.push(`Preserved original symlink metadata ${entry.name}; restoring links requires its exported target`)
    report.warnings.push('Logical backup does not contain original Agent logs, inactive branches, compatibility registry or plugin databases.', 'API keys were excluded by the source exporter; enter them in the new app.')
    report.credentialsMissing = report.models?.imported?.filter((item: Document) => item.credentialsMissing).map((item: Document) => item.targetId) ?? []
    report.files = mappings.length
    return report
  }

  async function run(current: Task) {
    try {
      current.status = 'running'; current.phase = 'inspect'; delete current.error; saveTask(current)
      const inspected = await inspect(current.uploadId)
      if (inspected.backup) current.report = await logicalImport(current, inspected.backup)
      else {
        const source = upload(current.uploadId), shared = { sourceRoomPath: source.path,
          targetRoomPath: required(process.env, 'ELECKOI_DATABASE_PATH'), targetRegistryPath: join(store.root, 'registry.sqlite'),
          snapshotDirectory: join(root, 'snapshots'), conflicts: current.conflicts }
        current.phase = 'room'; saveTask(current)
        const domains = await importAndroidDomains(shared)
        current.phase = 'conversations'; saveTask(current)
        const conversations = await importAndroidConversations({ ...shared, targetSessionsRoot: required(process.env, 'DSH_SESSION_ROOT'),
          sessions: createAndroidConversationFileSessionAdapter(required(process.env, 'DSH_HOME'), ctx.sessionPersistence, { cwd: required(process.env, 'ELECKOI_WORKSPACE_ROOT') }) })
        current.report = { format: 'eleckoi.android-room-snapshot-import', version: 1, domains, conversations,
          warnings: ['Standalone Room snapshot has no plugin registry/SQLite, files or original Session logs. Import the complete snapshot with the CLI to restore these.'] }
      }
      current.status = 'completed'; current.phase = 'completed'; saveTask(current)
    } catch (error) {
      current.status = 'failed'; current.phase = 'failed'; current.error = { code: 'migration_failed', message: error instanceof Error ? error.message : String(error) }; saveTask(current)
      console.error(`Android migration ${current.id} failed:`, error)
    }
  }
  const schedule = (current: Task) => { queue = queue.then(() => run(current)); return current }
  ctx.provide('eleckoiMigration', { async invoke(method, params) {
    switch (method) {
      case 'migration.inspect': return json((await inspect(required(params, 'uploadId'))).value)
      case 'migration.list': return json(Object.values(store.list('migration:tasks')).sort((a, b) => text(object(b).createdAt).localeCompare(text(object(a).createdAt))))
      case 'migration.status': return json(task(text(params.taskId) || required(params, 'id')))
      case 'migration.start': {
        if (closing) throw new Error('Migration Host is stopping')
        const uploadId = required(params, 'uploadId'); await inspect(uploadId)
        const conflicts = text(params.conflicts) || 'fail'
        if (!['fail', 'replace'].includes(conflicts)) throw new Error(`Unknown migration conflicts policy: ${conflicts}`)
        const existing = Object.values(store.list('migration:tasks')).map(value => value as unknown as Task).find(value => value.uploadId === uploadId && ['pending', 'running'].includes(value.status))
        if (existing) return json(existing)
        const current: Task = { id: randomUUID(), uploadId, conflicts: conflicts as Task['conflicts'], status: 'pending', phase: 'queued', createdAt: now(), updatedAt: now() }
        saveTask(current); schedule(current); return json(current)
      }
      default: throw new Error(`Unknown migration method: ${method}`)
    }
  } })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/eleckoi/migration/uploads', async handler(request, response) {
    try {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end(); return }
      const id = new URL(request.url ?? '/', 'http://localhost').pathname.split('/').at(-1)!
      if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Invalid migration upload ID')
      const directory = join(root, 'uploads', id); mkdirSync(directory, { recursive: true })
      const target = join(directory, 'source'), temporary = join(directory, `source.${randomUUID()}.part`)
      if (store.get('migration:uploads', id)) throw new Error('Migration upload ID already exists')
      const filename = decodeURIComponent(String(request.headers['x-eleckoi-filename'] ?? 'android-backup.zip'))
      await pipeline(request, createWriteStream(temporary, { flags: 'wx' })); renameSync(temporary, target)
      const source: Upload = { id, path: target, filename, bytes: statSync(target).size, createdAt: now() }
      store.put('migration:uploads', id, json(source))
      response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ uploadId: id, bytes: source.bytes }))
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: { code: 'migration_upload_failed', message: error instanceof Error ? error.message : String(error) } })) }
  } }), 'eleckoi: streaming Android backup upload')
  ctx.effect(() => () => { closing = true; return queue })
  for (const value of Object.values(store.list('migration:tasks'))) {
    const current = value as unknown as Task
    if (['pending', 'running'].includes(current.status)) { current.status = 'pending'; current.phase = 'resuming'; saveTask(current); schedule(current) }
  }
}
