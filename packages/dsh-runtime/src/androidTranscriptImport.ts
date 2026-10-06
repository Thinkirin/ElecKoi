import { readFileSync } from 'node:fs'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { readDshSessionLog } from './trajectory'

interface ImportedMessage { id: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; reasoning: string; images: unknown[]; files: unknown[] }
type ObjectValue = Record<string, any>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
function body(message: ObjectValue): string { return Array.isArray(message.content) ? message.content.filter(block => object(block).type === 'text').map(block => object(block).text ?? '').join('') : '' }

/** Uses the same locked Session catalog; only original logs carry model/tool execution history. */
interface ImportAttachments {
  saveImage(input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name?: string }): Promise<unknown>
  saveFile(input: { data: Uint8Array; name?: string }): Promise<unknown>
}
export function createAndroidConversationSessionAdapter(attachments?: ImportAttachments, hostPersistence?: Pick<SessionPersistence, 'create'>, options: { cwd?: string } = {}) {
  const persistenceByRoot = new Map<string, Pick<SessionPersistence, 'create'>>()
  return {
  inspect(sessionRoot: string, sessionId: string) {
    const log = readDshSessionLog(sessionRoot, sessionId)
    if (!log) return undefined
    const turns = new Map<number, { turn: number; userText: string; assistantText: string; userEventSeq?: number; assistantEventSeq?: number; userMessageId?: string; assistantMessageId?: string }>()
    let current = 0, latestUser = '', latestUserSeq: number | undefined, latestUserId: string | undefined, running = false
    for (const event of log.events) {
      const data = object(event.data)
      if (event.type === 'turn/start') { current = Number(data.turn); running = true; turns.set(current, { turn: current, userText: latestUser, assistantText: '', ...(latestUserSeq === undefined ? {} : { userEventSeq: latestUserSeq, userMessageId: latestUserId! }) }) }
      if (event.type === 'turn/end') running = false
      if (event.type === 'user/message' && event.surfaceOp === 'append' && object(data.source).kind === 'user') {
        latestUser = body(data)
        latestUserSeq = Number(event.seq); latestUserId = String(data.id)
        if (running && turns.has(current)) Object.assign(turns.get(current)!, { userText: latestUser, userEventSeq: latestUserSeq, userMessageId: latestUserId })
      }
      if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
        const turn = Number(data.turn)
        const row = turns.get(turn) ?? { turn, userText: latestUser, assistantText: '' }
        row.assistantText = body(object(data.message)); Object.assign(row, { assistantEventSeq: Number(event.seq), assistantMessageId: String(object(data.message).id) }); turns.set(turn, row)
      }
    }
    return { turns: [...turns.values()] }
  },
  async materialize(sessionRoot: string, sessionId: string, messages: ImportedMessage[], sessionOptions: { cwd?: string; agentPreset?: string } = {}) {
    const prior = readDshSessionLog(sessionRoot, sessionId)
    if (prior) {
      const rows = prior.events.filter(event => ['user/message', 'assistant/message', 'system/message'].includes(event.type)).map(event => {
        const data = object(event.data), message = event.type === 'user/message' ? data : object(data.message)
        return { marker: object(message.eleckoiCompatibility), content: body(message), turn: Number(data.turn) }
      }).filter(row => row.marker.androidTranscriptImport === true)
      if (rows.length !== messages.length || rows.some((row, index) => row.marker.id !== messages[index]!.id || row.content !== messages[index]!.content)) throw new Error(`Existing Android transcript import differs: ${sessionId}`)
      return rows.map(row => ({ messageId: String(row.marker.id), turn: row.turn }))
    }
    const seed = Session.create(SessionId(sessionId)), cwd = sessionOptions.cwd ?? options.cwd
    const session = cwd || sessionOptions.agentPreset ? Session.create(SessionId(sessionId), undefined, { ...seed.header,
      ...(cwd ? { cwd } : {}), ...(sessionOptions.agentPreset ? { agentPreset: sessionOptions.agentPreset } : {}) }) : seed
    const bindings: Array<{ messageId: string; turn: number }> = []
    let turn = 1, open = false, answered = false
    session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 })
    session.append('system/message', { turn, step: 1, message: createSystemMessage('') }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } })
    function finish() { if (open) { session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } }); open = false } }
    for (const input of messages) {
      if (input.role !== 'assistant' || answered) { finish(); turn++; answered = false }
      if (!open) { session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 }); open = true }
      const marker = { id: input.id, role: input.role, pluginInserted: true, androidTranscriptImport: true, reasoning: input.reasoning,
        createdAt: input.createdAt, attachments: { images: input.images, files: input.files } }
      const content: ContentBlock[] = [{ type: 'text', text: input.content }]
      for (const item of input.images) {
        if (!attachments) throw new Error('Android image transcript import requires the native attachment service')
        const image = object(item), path = image.localPath ?? image.local_path
        if (typeof path !== 'string' || !path) throw new Error(`Android imported image has no saved path: ${input.id}`)
        const name = image.displayName ?? image.display_name, mediaType = image.mediaType ?? image.media_type
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) throw new Error(`Android imported image has an invalid media type: ${input.id}`)
        const attachment = await attachments.saveImage({ data: readFileSync(path), mediaType, ...(name ? { name } : {}) })
        content.push({ type: 'image', attachment: attachment as never })
      }
      for (const item of input.files) {
        if (!attachments) throw new Error('Android file transcript import requires the native attachment service')
        const file = object(item), path = file.localPath ?? file.local_path ?? file.path
        if (typeof path !== 'string' || !path) throw new Error(`Android imported file has no saved path: ${input.id}`)
        const name = file.displayName ?? file.display_name ?? file.name
        const attachment = await attachments.saveFile({ data: readFileSync(path), ...(name ? { name } : {}) })
        content.push({ type: 'file', attachment: attachment as never })
      }
      if (input.role === 'user') {
        const message = createUserMessage({ content, source: { kind: 'user' } })
        session.append('user/message', { ...message, eleckoiCompatibility: marker, turn } as typeof message, { surfaceOp: 'append' })
      } else if (input.role === 'system') {
        const message = createSystemMessage(input.content)
        session.append('system/message', { turn, step: 1, message: { ...message, eleckoiCompatibility: marker } as typeof message }, { surfaceOp: 'append' })
      } else {
        const message = createAssistantMessage({ content, source: { provider: 'eleckoi-android-import', model: 'legacy-transcript' } })
        session.append('assistant/message', { turn, step: 1, message: { ...message, eleckoiCompatibility: marker } as typeof message, stream: [] }, { surfaceOp: 'append' }); answered = true
      }
      bindings.push({ messageId: input.id, turn })
    }
    finish()
    const header = { ...session.header, delegationDepth: 0 }
    const rows = [sessionFormatCatalog.encodeCurrentHeader(header, session.inheritedEventCount), ...session.snapshotEvents().map(event => sessionFormatCatalog.encodeCurrentEvent(event as never))]
    const restore = sessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' })
    rows.slice(1).forEach(row => restore.decodeRow(row)); restore.finish()
    let persistence: Pick<SessionPersistence, 'create'> | undefined = hostPersistence ?? persistenceByRoot.get(sessionRoot)
    if (!persistence) {
      persistence = new JsonlSessionPersistence(new Context(), { root: sessionRoot, compression: 'none' })
      persistenceByRoot.set(sessionRoot, persistence)
    }
    const handle = await persistence.create(header)
    try { await handle.append(session.snapshotEvents()); await handle.flush() }
    finally { await handle.close() }
    return bindings
  }
} }
export const androidConversationSessionAdapter = createAndroidConversationSessionAdapter()
/** Offline CLI reuses the same production local attachment backend as the Host. */
export function createAndroidConversationFileSessionAdapter(dshHome: string, persistence?: Pick<SessionPersistence, 'create'>, options: { cwd?: string } = {}) {
  return createAndroidConversationSessionAdapter(new LocalAttachmentStore(new Context(), { dshHome }), persistence, options)
}
