import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CreatorProjectRepository } from '../domain/creatorStudio/CreatorProjectRepository'
import { CompatibilityStore } from '../storage/compatibility/CompatibilityStore'
import type { AndroidConversationSessionAdapter, ImportedAndroidMessage } from './androidConversationImport'

type Document = Record<string, any>
export interface AndroidCreatorImportOptions {
  /** Extracted normal backup files/ root, containing creator_workspaces/. */
  sourceFilesDirectory: string
  targetWorkspaceRoot: string
  targetProjectsDirectory: string
  targetRegistryDirectory: string
  targetSessionsRoot: string
  sessions: AndroidConversationSessionAdapter
  documents: Array<{ name: string; value: unknown }>
  transform?: <T>(value: T) => T
  conflicts?: 'fail' | 'replace'
}
export interface AndroidCreatorImportReport {
  format: 'eleckoi.android-creator-import'
  version: 1
  projects: Array<{ workspaceId: string; projectId: string; rootPath: string; reused: boolean; preservedFiles: number }>
  conversations: Array<{ workspaceId: string; conversationId: string; sessionId: string; messages: number; mode: 'transcript-only'; missingExecutionHistory: boolean }>
  differences: Array<{ workspaceId: string; conversationId?: string; kind: string; detail: string }>
}
const object = (value: unknown, label: string): Document => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object`)
  return value as Document
}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safeId = (value: unknown, label: string) => { const id = text(value); if (!id || ['.', '..'].includes(id) || /[\\/]/.test(id) || isAbsolute(id)) throw new Error(`Invalid ${label}: ${id}`); return id }

/** Restore ordinary-backup creator projects into the original catalog plus real official Sessions.
 * Source manifests, checkpoints, ledger/provider history and unknown fields remain recoverable.
 * A normal ZIP has visible ledger history, not original DSH execution logs; never manufacture those. */
export async function importAndroidCreatorBackup(options: AndroidCreatorImportOptions): Promise<AndroidCreatorImportReport> {
  const sourceRoot = resolve(options.sourceFilesDirectory, 'creator_workspaces'), targetRoot = resolve(options.targetProjectsDirectory)
  if (sourceRoot === targetRoot || targetRoot.startsWith(`${sourceRoot}${sep}`) || sourceRoot.startsWith(`${targetRoot}${sep}`)) throw new Error('Creator source and target directories must be independent')
  const transform = options.transform ?? (<T>(value: T) => value), report: AndroidCreatorImportReport = { format: 'eleckoi.android-creator-import', version: 1, projects: [], conversations: [], differences: [] }
  const manifests: Array<{ path: string; workspace: Document }> = []
  const ordinary = join(sourceRoot, 'workspaces'), characters = join(sourceRoot, 'characters')
  if (existsSync(ordinary)) for (const entry of readdirSync(ordinary, { withFileTypes: true })) {
    const directory = join(ordinary, entry.name), path = join(directory, 'manifest.json')
    if (entry.isDirectory() && existsSync(path)) manifests.push({ path: directory, workspace: object(JSON.parse(readFileSync(path, 'utf8')), `Creator manifest ${path}`) })
  }
  if (existsSync(characters)) for (const owner of readdirSync(characters, { withFileTypes: true }).filter(item => item.isDirectory())) {
    for (const entry of readdirSync(join(characters, owner.name), { withFileTypes: true }).filter(item => item.isDirectory())) {
      const directory = join(characters, owner.name, entry.name), path = join(directory, 'manifest.json')
      if (existsSync(path)) manifests.push({ path: directory, workspace: object(JSON.parse(readFileSync(path, 'utf8')), `Creator manifest ${path}`) })
    }
  }
  const byId = new Map<string, typeof manifests[number]>()
  for (const item of manifests) {
    const id = safeId(item.workspace.id, 'Android creator workspace ID')
    if (byId.has(id)) throw new Error(`Duplicate Android creator workspace ID: ${id}`)
    if (!text(item.workspace.name) || !Array.isArray(item.workspace.conversations) || !Array.isArray(item.workspace.files)) throw new Error(`Incomplete Android creator manifest: ${id}`)
    const directory = join(item.path, 'project')
    if (!existsSync(directory)) { if (item.workspace.files.length || Number(item.workspace.totalBytes)) throw new Error(`Creator project files are missing: ${id}`) }
    else for (const name of item.workspace.files) {
      const path = resolve(directory, name), inside = relative(directory, path)
      if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || !existsSync(path)) throw new Error(`Creator project file is missing: ${id}/${name}`)
    }
    byId.set(id, item)
  }
  const backups = new Map<string, { name: string; value: Document; restored: Document; messages: ImportedAndroidMessage[]; missingExecutionHistory: boolean }>()
  for (const section of options.documents) {
    const document = object(section.value, `Creator backup ${section.name}`)
    if (document.format !== 'eleckoi.creator-assistant-backup' || document.version !== 1 || !Array.isArray(document.conversations)) throw new Error(`Unsupported creator backup: ${section.name}`)
    for (const value of document.conversations) {
      const conversation = object(value, `Creator backup ${section.name} conversation`), workspaceId = safeId(conversation.workspaceId, 'creator backup workspace ID'), conversationId = safeId(conversation.conversationId, 'creator conversation ID')
      if (!byId.get(workspaceId)?.workspace.conversations.some((item: Document) => item.id === conversationId)) throw new Error(`Creator backup has no corresponding workspace conversation: ${workspaceId}/${conversationId}`)
      if (!Array.isArray(conversation.messages)) throw new Error(`Creator backup messages are invalid: ${conversationId}`)
      const key = `${workspaceId}/${conversationId}`
      if (backups.has(key)) throw new Error(`Duplicate creator conversation backup: ${key}`)
      const restored = transform(structuredClone(conversation)), messageIds = new Set<string>()
      const messages: ImportedAndroidMessage[] = restored.messages.map((value: unknown) => {
        const message = object(value, `Creator message ${conversationId}`), role = text(message.role), id = safeId(message.id, 'creator message ID')
        if (!['user', 'assistant', 'system'].includes(role)) throw new Error(`Unsupported creator visible message role: ${role}`)
        if (messageIds.has(id)) throw new Error(`Duplicate creator visible message ID: ${conversationId}/${id}`)
        messageIds.add(id)
        const images = transform(JSON.parse(text(message.inputImageAttachmentsJson) || '[]')), files = transform(JSON.parse(text(message.inputFileAttachmentsJson) || '[]')), toolCalls = JSON.parse(text(message.toolCallsJson) || '[]')
        if (!Array.isArray(images)) throw new Error(`Invalid creator image attachments: ${id}`)
        if (!Array.isArray(files)) throw new Error(`Invalid creator file attachments: ${id}`)
        if (!Array.isArray(toolCalls)) throw new Error(`Invalid creator tool calls: ${id}`)
        return { id, role: role as ImportedAndroidMessage['role'], content: text(message.content), createdAt: text(message.createdAt), reasoning: text(message.reasoningContent), images, files }
      })
      const missingExecutionHistory = restored.messages.some((message: Document) => message.runtimeThreadId || message.modelHistoryItems?.length || JSON.parse(text(message.toolCallsJson) || '[]').length || message.surfaceTimelineJson)
      backups.set(key, { name: section.name, value: conversation, restored, messages, missingExecutionHistory })
    }
  }
  const repository = new CreatorProjectRepository(resolve(options.targetWorkspaceRoot)), store = new CompatibilityStore(resolve(options.targetRegistryDirectory))
  try {
    mkdirSync(targetRoot, { recursive: true })
    // Validate every existing owner before the first file/catalog write.
    for (const [id, item] of byId) {
      const target = join(targetRoot, id), fingerprint = treeHash(item.path), previous = store.get('migration:android:creator', id) as Document | null
      if (existsSync(target) && previous?.sourceHash !== fingerprint && options.conflicts !== 'replace') throw new Error(`Android creator project conflict: ${id}`)
      const native = repository.list().items.find(project => project.id === id)
      if (native && native.rootPath !== join(target, 'project') && options.conflicts !== 'replace') throw new Error(`Native creator project ID conflict: ${id}`)
    }
    for (const [id, item] of byId) {
      const target = join(targetRoot, id), sourceHash = treeHash(item.path), previous = store.get('migration:android:creator', id) as Document | null
      const reused = existsSync(target) && previous?.sourceHash === sourceHash, workspace = transform(structuredClone(item.workspace))
      const conversations: Array<Document> = []
      for (const metadata of workspace.conversations) {
        const backup = backups.get(`${id}/${metadata.id}`)
        if (!backup) { report.differences.push({ workspaceId: id, conversationId: metadata.id, kind: 'missing-ledger', detail: 'Workspace manifest references a conversation whose visible ledger is absent from this backup' }); conversations.push({ ...metadata, sessionId: null }); continue }
        const raw = backup.value, ledger = backup.restored, messages = backup.messages
        const sessionId = `android-creator-${hash({ workspaceId: id, conversationId: metadata.id, messages }).slice(0, 32)}`
        await options.sessions.materialize(options.targetSessionsRoot, sessionId, messages, { cwd: join(target, 'project'), agentPreset: 'eleckoi-creator' })
        // Keep exact provider history/surface timeline as source data, never model-execution events.
        store.put('migration:android:creator-ledgers', `${id}/${metadata.id}`, { sourceName: backup.name, original: raw, restored: ledger, sessionId })
        conversations.push({ ...metadata, sessionId })
        const missingExecutionHistory = backup.missingExecutionHistory
        report.conversations.push({ workspaceId: id, conversationId: metadata.id, sessionId, messages: messages.length, mode: 'transcript-only', missingExecutionHistory })
        if (missingExecutionHistory) report.differences.push({ workspaceId: id, conversationId: metadata.id, kind: 'execution-history-not-in-zip', detail: 'Original ledger/provider history was preserved; ordinary backup does not contain the corresponding official DSH execution log' })
      }
      let staged: string | undefined, prior: string | undefined
      if (!reused) {
        staged = join(targetRoot, `.import-${randomUUID()}`); cpSync(item.path, staged, { recursive: true, verbatimSymlinks: true }); mkdirSync(join(staged, 'project'), { recursive: true })
        if (existsSync(target)) { prior = join(targetRoot, `.previous-${id}-${randomUUID()}`); renameSync(target, prior) }
        renameSync(staged, target); staged = undefined
      }
      try {
        repository.adopt({ id, name: workspace.name, mode: workspace.linkedCharacterId ? 'existing' : 'blank', rootPath: join(target, 'project'), sourceCharacterId: text(workspace.linkedCharacterId),
          coverImage: text(workspace.coverImage), createdAt: text(workspace.createdAt), updatedAt: text(workspace.updatedAt) },
        { androidMigration: { workspaceId: id, activeConversationId: workspace.activeConversationId ?? null, conversations, sourceManifest: '../manifest.json', sourceHash } }, options.conflicts)
        store.put('migration:android:creator', id, { sourceHash, originalWorkspace: item.workspace, restoredWorkspace: workspace, projectId: id, rootPath: join(target, 'project'), conversations, ...(prior ? { previousDirectory: prior } : {}) })
        report.projects.push({ workspaceId: id, projectId: id, rootPath: join(target, 'project'), reused, preservedFiles: countFiles(item.path) })
      } catch (error) {
        if (!reused) { assertWithin(targetRoot, target); rmSync(target, { recursive: true, force: true }); if (prior) renameSync(prior, target) }
        throw error
      } finally { if (staged) { assertWithin(targetRoot, staged); rmSync(staged, { recursive: true, force: true }) } }
    }
    store.put('migration:android:creator', 'last-report', report as unknown as Parameters<CompatibilityStore['put']>[2])
    return report
  } finally { store.close() }
}
function treeHash(root: string): string {
  const output: unknown[] = []
  const walk = (directory: string) => { for (const name of readdirSync(directory).sort()) { const path = join(directory, name), stat = lstatSync(path), key = relative(root, path).replaceAll('\\', '/')
    if (stat.isSymbolicLink()) output.push([key, 'link', readlinkSync(path)])
    else if (stat.isDirectory()) { output.push([key, 'directory']); walk(path) }
    else if (stat.isFile()) output.push([key, createHash('sha256').update(readFileSync(path)).digest('hex')])
    else throw new Error(`Unsupported creator workspace file: ${path}`) } }
  walk(root); return hash(output)
}
function countFiles(root: string): number { return readdirSync(root).reduce((count, name) => { const path = join(root, name), stat = lstatSync(path); return count + (stat.isDirectory() && !stat.isSymbolicLink() ? countFiles(path) : 1) }, 0) }
function assertWithin(root: string, path: string): void { if (!resolve(path).startsWith(`${resolve(root)}${sep}`)) throw new Error('Creator migration rollback target is outside the imported-project directory') }
