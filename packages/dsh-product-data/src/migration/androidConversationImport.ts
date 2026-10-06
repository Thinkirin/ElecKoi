import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { installSchema } from '../storage/sqlite/installSchema'

type Row = Record<string, string | number | null | Buffer>
export interface ImportedAndroidMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  reasoning: string
  images: unknown[]
  files: unknown[]
}
export interface AndroidConversationSessionAdapter {
  inspect(sessionRoot: string, sessionId: string): { turns: Array<{ turn: number; userText: string; assistantText: string; userEventSeq?: number; assistantEventSeq?: number; userMessageId?: string; assistantMessageId?: string }> } | undefined
  /** Explicit legacy transcript import; no invented model/tool execution records. */
  materialize(sessionRoot: string, sessionId: string, messages: ImportedAndroidMessage[], options?: { cwd?: string; agentPreset?: string }): Array<{ messageId: string; turn: number }> | Promise<Array<{ messageId: string; turn: number }>>
}
export interface AndroidConversationImportOptions {
  sourceRoomPath: string
  targetRoomPath: string
  targetRegistryPath: string
  targetSessionsRoot: string
  snapshotDirectory: string
  sessions: AndroidConversationSessionAdapter
  transform?: <T>(value: T) => T
  conflicts?: 'fail' | 'replace'
}
export const ANDROID_CONVERSATION_TABLES = ['chat_sessions', 'chat_session_character_snapshots', 'chat_session_variable_states',
  'agent_conversations', 'agent_branches', 'conversation_speakers', 'agent_turns', 'agent_responses', 'agent_branch_turns', 'conversation_setting_changes'] as const
export interface AndroidConversationImportReport {
  format: 'eleckoi.android-conversation-import'
  version: 1
  roomSnapshot: string
  manifestPath: string
  tables: Array<{ name: string; sourceRows: number; importedRows: number; reusedRows: number }>
  sessions: Array<{ conversationId: string; sessionId: string; mode: 'exact-session' | 'transcript-only'; reason?: string }>
  candidates: number
}

/** Import original Room relationships while binding genuine Session logs or explicitly labelled legacy text. */
export async function importAndroidConversations(options: AndroidConversationImportOptions): Promise<AndroidConversationImportReport> {
  const sourcePath = resolve(options.sourceRoomPath), targetPath = resolve(options.targetRoomPath), registryPath = resolve(options.targetRegistryPath)
  if (sourcePath === targetPath || sourcePath === registryPath) throw new Error('Android conversation source and target databases must differ')
  const snapshotRoot = join(resolve(options.snapshotDirectory), `android-conversations-${randomUUID()}`)
  mkdirSync(snapshotRoot, { recursive: true })
  const roomSnapshot = join(snapshotRoot, 'room.sqlite')
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try { await source.backup(roomSnapshot) } finally { source.close() }
  mkdirSync(dirname(targetPath), { recursive: true })
  const room = new Database(roomSnapshot, { readonly: true }), target = new Database(targetPath)
  const report: AndroidConversationImportReport = { format: 'eleckoi.android-conversation-import', version: 1, roomSnapshot,
    manifestPath: join(snapshotRoot, 'manifest.json'), tables: [], sessions: [], candidates: 0 }
  const sourceHash = createHash('sha256').update(readFileSync(roomSnapshot)).digest('hex')
  const transform = options.transform ?? (<T>(value: T): T => value)
  let attached = false
  try {
    if (room.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Android conversation SQLite validation failed')
    mkdirSync(dirname(registryPath), { recursive: true }); target.pragma('foreign_keys=ON'); installSchema(target)
    target.prepare('ATTACH DATABASE ? AS compatibility_registry').run(registryPath); attached = true
    target.exec('CREATE TABLE IF NOT EXISTS compatibility_registry.documents(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,key))')
    const save = target.prepare('INSERT INTO compatibility_registry.documents(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value')
    const lookupDocument = target.prepare('SELECT value FROM compatibility_registry.documents WHERE scope=? AND key=?')
    const batches = ANDROID_CONVERSATION_TABLES.filter(table => hasTable(room, table)).map(table => ({ table, rows: room.prepare(`SELECT * FROM "${table}"`).all() as Row[] }))
    const rows = (table: string) => batches.find(batch => batch.table === table)?.rows ?? []
    const responses = rows('agent_responses'), turns = rows('agent_turns'), paths = rows('agent_branch_turns')
    const parts = readParts(room), binding = new Map<string, { runtimeThreadId: string; dshTurn: number }>(), roots = new Map<string, string>()
    const eventBindings: Array<{ conversationId: string; sessionId: string; seq: number; id: string; dshMessageId: string }> = []
    const inspectCache = new Map<string, ReturnType<AndroidConversationSessionAdapter['inspect']>>()
    const inspect = (id: string) => { if (!inspectCache.has(id)) inspectCache.set(id, options.sessions.inspect(options.targetSessionsRoot, id)); return inspectCache.get(id) }
    for (const response of responses) {
      const id = String(response.runtimeThreadId ?? ''), number = Number(String(response.runtimeTurnId ?? '').replace(`${id}:`, ''))
      const actual = id && Number.isSafeInteger(number) && number > 0 ? inspect(id)?.turns.find(turn => turn.turn === number) : undefined
      const parent = turns.find(turn => turn.id === response.turnId)
      if (actual && actual.assistantText === body(parts, 'response', String(response.id))
        && (!parent || parent.kind !== 'user' || actual.userText === body(parts, 'turn', String(parent.id)))) {
        binding.set(String(response.id), { runtimeThreadId: id, dshTurn: number })
        if (actual.assistantEventSeq !== undefined) eventBindings.push({ conversationId: String(response.conversationId), sessionId: id, seq: actual.assistantEventSeq, id: String(response.id), dshMessageId: actual.assistantMessageId ?? '' })
        if (parent && actual.userEventSeq !== undefined) eventBindings.push({ conversationId: String(response.conversationId), sessionId: id, seq: actual.userEventSeq, id: String(parent.id), dshMessageId: actual.userMessageId ?? '' })
      }
    }
    for (const conversation of rows('agent_conversations')) {
      const conversationId = String(conversation.id), branch = String(conversation.activeBranchId)
      const orderedTurns = paths.filter(path => path.branchId === branch).sort((a, b) => Number(a.sequence) - Number(b.sequence))
        .map(path => turns.find(turn => turn.id === path.turnId)).filter((turn): turn is Row => !!turn)
      const activeReplies = orderedTurns.flatMap(turn => responses.filter(response => response.turnId === turn.id).sort((a, b) => Number(a.responseIndex) - Number(b.responseIndex)))
      const exact = activeReplies.length > 0 && activeReplies.every(reply => binding.has(String(reply.id)))
      const latest = activeReplies.at(-1), latestId = latest ? binding.get(String(latest.id))?.runtimeThreadId : undefined
      if (exact && latestId) {
        roots.set(conversationId, latestId); report.sessions.push({ conversationId, sessionId: latestId, mode: 'exact-session' })
      } else {
        const messages = orderedTurns.flatMap(turn => {
          if (turn.kind === 'opening') return []
          const first = imported(parts, turn, 'turn', String(turn.id), turn.kind === 'system' ? 'system' : turn.kind === 'user' ? 'user' : 'assistant', transform)
          return [first, ...responses.filter(response => response.turnId === turn.id).sort((a, b) => Number(a.responseIndex) - Number(b.responseIndex))
            .map(response => imported(parts, response, 'response', String(response.id), 'assistant', transform))]
        })
        const sessionId = `android-import-${createHash('sha256').update(`${conversationId}/${branch}/${JSON.stringify(messages)}`).digest('hex').slice(0, 32)}`
        const importedBindings = await options.sessions.materialize(options.targetSessionsRoot, sessionId, messages)
        for (const item of importedBindings) if (!binding.has(item.messageId)) binding.set(item.messageId, { runtimeThreadId: sessionId, dshTurn: item.turn })
        roots.set(conversationId, sessionId)
        report.sessions.push({ conversationId, sessionId, mode: 'transcript-only', reason: activeReplies.length ? 'Visible edited/imported replies lack a matching original Session binding' : 'No generated reply binding exists' })
      }
    }
    // Non-active branches remain native relationships. Missing historical bindings get their own honest transcript.
    for (const response of responses.filter(row => !binding.has(String(row.id)))) {
      const turn = turns.find(row => row.id === response.turnId)
      if (!turn) throw new Error(`Android response has no parent turn: ${response.id}`)
      const messages = [imported(parts, turn, 'turn', String(turn.id), turn.kind === 'user' ? 'user' : 'system', transform), imported(parts, response, 'response', String(response.id), 'assistant', transform)]
      const sessionId = `android-import-${createHash('sha256').update(`response/${response.id}/${JSON.stringify(messages)}`).digest('hex').slice(0, 32)}`
      const result = (await options.sessions.materialize(options.targetSessionsRoot, sessionId, messages)).find(item => item.messageId === response.id)
      if (!result) throw new Error(`Legacy Session import failed to bind reply: ${response.id}`)
      binding.set(String(response.id), { runtimeThreadId: sessionId, dshTurn: result.turn })
      report.sessions.push({ conversationId: String(response.conversationId), sessionId, mode: 'transcript-only', reason: 'Unbound reply retained on an inactive branch' })
    }
    target.transaction(() => {
      target.pragma('defer_foreign_keys = ON')
      function putDocument(scope: string, key: string, value: unknown) {
        const json = JSON.stringify(value), existing = lookupDocument.get(scope, key) as { value: string } | undefined
        if (existing && existing.value !== json && options.conflicts !== 'replace') throw new Error(`Android conversation registry conflict: ${scope}/${key}`)
        save.run(scope, key, json)
      }
      for (const batch of batches) {
        let importedRows = 0, reusedRows = 0
        for (const raw of batch.rows) {
          const row = { ...raw }
          if (batch.table === 'agent_conversations') row.runtimeThreadId = roots.get(String(row.id))!
          if (batch.table === 'agent_responses') { Object.assign(row, binding.get(String(row.id))); row.storedRegexRulesJson ??= '[]'; if (row.status === 'pending') row.status = 'cancelled' }
          for (const [key, value] of Object.entries(row)) if (typeof value === 'string') {
            if ((key.endsWith('Json') || key === 'stateJson') && value.trim()) { try { row[key] = JSON.stringify(transform(JSON.parse(value))) } catch (error) { throw new Error(`Invalid Android JSON in ${batch.table}.${key}: ${(error as Error).message}`) } }
            else row[key] = transform(value)
          }
          const same = putRow(target, batch.table, row, options.conflicts)
          same ? reusedRows++ : importedRows++
          putDocument(`migration:android:raw:${sourceHash}`, `${batch.table}/${JSON.stringify(primaryValues(target, batch.table, raw))}`, raw)
        }
        report.tables.push({ name: batch.table, sourceRows: batch.rows.length, importedRows, reusedRows })
      }
      for (const turn of turns) {
        const id = String(turn.id), conversationId = String(turn.conversationId), ownParts = parts.filter(part => part.ownerType === 'turn' && part.ownerId === id)
        if (turn.kind === 'opening') putRow(target, 'agent_openings', { conversationId, turnId: id, content: transform(body(parts, 'turn', id)), payloadJson: JSON.stringify(transform(ownParts)) }, options.conflicts)
        else if (!responses.some(response => response.turnId === id) && turn.kind === 'user') putRow(target, 'agent_pending_inputs', { turnId: id, draftJson: JSON.stringify({ content: transform(body(parts, 'turn', id)), images: transform(payload(parts, 'turn', id, 'input_images')), files: [], process: [] }) }, options.conflicts)
      }
      for (const part of parts) {
        putDocument(`migration:android:parts:${part.conversationId}`, `${part.ownerType}/${part.ownerId}/${part.partIndex}`, part)
        if (part.kind === 'setting_library_state') putRow(target, 'agent_setting_snapshots', { conversationId: String(part.conversationId), ownerType: String(part.ownerType), ownerId: String(part.ownerId), stateJson: String(part.payloadJson) }, options.conflicts)
      }
      for (const item of eventBindings) putDocument(`migration:android:message-bindings:${item.conversationId}`, `${item.sessionId}:${item.seq}`, { id: item.id, dshMessageId: item.dshMessageId, sessionEventSeq: item.seq })
      // Android surface IDs differ from normalized ledger IDs. Preserve original keys and add native aliases.
      for (const row of [...turns, ...responses]) if (row.sourceMessageId && row.sourceMessageId !== row.id) {
        const chat = String(row.conversationId), oldId = String(row.sourceMessageId), id = row.kind === 'opening' ? 'opening' : String(row.id)
        for (const scope of [`metadata:${chat}`, `swipes:${chat}`, `message-extensions:${chat}`]) {
          const previous = lookupDocument.get(scope, oldId) as { value: string } | undefined
          if (previous) putDocument(scope, id, transform(JSON.parse(previous.value)))
        }
        const variableScope = `variables:message:${chat}:${oldId}`
        for (const previous of target.prepare('SELECT key,value FROM compatibility_registry.documents WHERE scope=?').all(variableScope) as Array<{ key: string; value: string }>) putDocument(`variables:message:${chat}:${id}`, previous.key, JSON.parse(previous.value))
        const previous = lookupDocument.get(`message-extensions:${chat}`, id) as { value: string } | undefined
        putDocument(`message-extensions:${chat}`, id, { ...(previous ? JSON.parse(previous.value) : {}), androidSourceMessageId: oldId })
      }
      const candidates = new Map<string, Array<{ index: number; value: any }>>()
      for (const part of parts.filter(part => part.ownerType === 'reply_candidate' && part.kind === 'reply_candidate')) {
        const value = transform(JSON.parse(String(part.text)))
        if (value.id !== part.ownerId || value.role !== 'assistant') throw new Error(`Invalid Android candidate identity: ${part.ownerId}`)
        const owner = responses.find(response => response.conversationId === part.conversationId && (response.sourceMessageId === part.ownerId || response.id === part.ownerId))
        if (!owner) throw new Error(`Android candidate has no native reply: ${part.ownerId}`)
        const key = `${part.conversationId}\0${owner.id}`
        candidates.set(key, [...candidates.get(key) ?? [], { index: Number(part.partIndex) / 3, value }]); report.candidates++
      }
      for (const [key, items] of candidates) {
        const [chat, id] = key.split('\0') as [string, string], ordered = items.sort((a, b) => a.index - b.index)
        if (ordered.some((item, index) => item.index !== index)) throw new Error(`Noncontiguous Android reply candidates: ${id}`)
        const current = body(parts, 'response', id)
        let selected = ordered.findIndex(item => item.value.content === current)
        if (selected < 0) { selected = ordered.length; ordered.push({ index: selected, value: { content: current, createdAt: responses.find(response => response.id === id)?.createdAt, reasoningContent: '', variableStateJson: responses.find(response => response.id === id)?.variableStateJson } }) }
        putDocument(`swipes:${chat}`, id, { swipes: ordered.map(item => item.value.content), swipe_id: selected < 0 ? 0 : selected,
          swipes_info: ordered.map(item => ({ send_date: item.value.createdAt, extra: { reasoning: item.value.reasoningContent, androidLedgerSnapshot: item.value } })) })
        for (const item of ordered) if (item.value.variableStateJson) putDocument(`variables:message:${chat}:${id}`, `state:${item.index}`, JSON.parse(item.value.variableStateJson))
      }
      const invalid = target.pragma('foreign_key_check') as unknown[]
      if (invalid.length) throw new Error(`Android conversation import failed foreign-key validation: ${JSON.stringify(invalid)}`)
      save.run('migration:android:conversations', sourceHash, JSON.stringify({ roomSnapshot, sessions: report.sessions, candidates: report.candidates }))
    }).immediate()
    writeFileSync(report.manifestPath, JSON.stringify(report, null, 2) + '\n')
    return report
  } catch (error) {
    writeFileSync(report.manifestPath, JSON.stringify({ ...report, state: 'failed', error: (error as Error).message }, null, 2) + '\n'); throw error
  } finally { if (attached) target.exec('DETACH DATABASE compatibility_registry'); target.close(); room.close() }
}
function hasTable(database: Database.Database, table: string): boolean { return !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) }
function primaryValues(database: Database.Database, table: string, row: Row): unknown[] {
  return (database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number }>).filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => row[column.name])
}
function putRow(database: Database.Database, table: string, row: Row, conflicts: 'fail' | 'replace' | undefined): boolean {
  const columns = database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number; notnull: number; dflt_value: unknown }>
  const selected = columns.filter(column => row[column.name] !== undefined), primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk)
  if (columns.some(column => column.notnull && column.dflt_value === null && row[column.name] === undefined)) throw new Error(`Android import requires a transform for ${table}`)
  const existing = database.prepare(`SELECT * FROM "${table}" WHERE ${primary.map(column => `"${column.name}"=?`).join(' AND ')}`).get(...primary.map(column => row[column.name])) as Row | undefined
  if (existing && selected.every(column => existing[column.name] === row[column.name])) return true
  if (existing && conflicts !== 'replace') throw new Error(`Android conversation import conflict: ${table}/${JSON.stringify(primaryValues(database, table, row))}`)
  const mutable = selected.filter(column => !column.pk)
  database.prepare(`INSERT INTO "${table}"(${selected.map(column => `"${column.name}"`).join(',')}) VALUES(${selected.map(() => '?').join(',')}) ON CONFLICT(${primary.map(column => `"${column.name}"`).join(',')}) ${mutable.length ? `DO UPDATE SET ${mutable.map(column => `"${column.name}"=excluded."${column.name}"`).join(',')}` : 'DO NOTHING'}`).run(...selected.map(column => row[column.name]))
  return false
}
function readParts(database: Database.Database): Row[] {
  if (!hasTable(database, 'agent_content_parts')) return []
  const groups = new Map<string, Row[]>()
  for (const row of database.prepare('SELECT * FROM agent_content_parts ORDER BY ownerType,ownerId,partIndex,chunkIndex').all() as Row[]) {
    const key = `${row.ownerType}\0${row.ownerId}\0${row.partIndex}`; groups.set(key, [...groups.get(key) ?? [], row])
  }
  return [...groups.values()].map(chunks => {
    if (chunks.some((chunk, index) => Number(chunk.chunkIndex) !== index)) throw new Error(`Incomplete Android content chunks: ${chunks[0]!.ownerId}`)
    const row = { ...chunks[0]!, text: chunks.map(chunk => chunk.text).join(''), payloadJson: chunks.map(chunk => chunk.payloadJson).join('') }
    if (row.payloadJson) JSON.parse(row.payloadJson)
    return row
  })
}
function body(parts: Row[], ownerType: string, ownerId: string): string { return String(parts.find(part => part.ownerType === ownerType && part.ownerId === ownerId && ['user_text', 'assistant_text', 'opening_text', 'system_text'].includes(String(part.kind)))?.text ?? '') }
function payload(parts: Row[], ownerType: string, ownerId: string, kind: string): unknown[] {
  const json = parts.find(part => part.ownerType === ownerType && part.ownerId === ownerId && part.kind === kind)?.payloadJson
  return json ? JSON.parse(String(json)) : []
}
function imported(parts: Row[], row: Row, ownerType: string, id: string, role: ImportedAndroidMessage['role'], transform: <T>(value: T) => T): ImportedAndroidMessage {
  return { id, role, content: transform(body(parts, ownerType, id)), createdAt: String(row.createdAt), reasoning: String(parts.find(part => part.ownerType === ownerType && part.ownerId === id && part.kind === 'reasoning')?.text ?? ''), images: transform(payload(parts, ownerType, id, 'input_images')), files: [] }
}
