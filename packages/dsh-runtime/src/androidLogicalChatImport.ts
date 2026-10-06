import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CompatibilityValue, ConversationArchiveSnapshot } from '@eleckoi/dsh-product-api/types'
import { createAndroidConversationFileSessionAdapter } from './androidTranscriptImport'

type Document = Record<string, any>
const object = (value: unknown): Document => value && typeof value === 'object' && !Array.isArray(value) ? value as Document : {}
const json = (value: unknown): CompatibilityValue => JSON.parse(JSON.stringify(value)) as CompatibilityValue
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const stable = (prefix: string, value: string): string => `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
const state = (value: unknown): string => { const raw = text(value) || '{}'; JSON.parse(raw); return raw }

/** Logical v3 history has no original Agent log. Preserve visible records, and label their provenance. */
export async function importAndroidLogicalChats(ctx: Context, history: unknown, sourceHash: string, conflicts: 'fail' | 'replace') {
  const document = object(history)
  if (document.format !== 'eleckoi.chat-history' || ![1, 2, 3].includes(document.version) || !Array.isArray(document.sessions)) throw new Error('Unsupported Android logical chat-history section')
  const sessionRoot = process.env.DSH_SESSION_ROOT!, dshHome = process.env.DSH_HOME ?? process.env.ELECKOI_DSH_HOME
  if (!sessionRoot || !dshHome) throw new Error('Session and attachment roots are required for migration')
  const cwd = process.env.ELECKOI_WORKSPACE_ROOT
  if (!cwd) throw new Error('Product workspace root is required for imported chat Sessions')
  const adapter = createAndroidConversationFileSessionAdapter(dshHome, ctx.sessionPersistence, { cwd }), data = ctx.eleckoiProductData, store = data.compatibilityStore()
  const results: Document[] = []
  for (const rawSession of document.sessions) {
    const session = object(rawSession), id = text(session.id), characterId = text(session.character_id) || text(document.character_id)
    if (!id || !characterId || !Array.isArray(session.messages)) throw new Error('Android chat has no identity, character, or messages')
    const checkpoint = `${sourceHash}/${id}`
    const previous = store.get('migration:android:logical-chats', checkpoint)
    if (previous && data.readConversationCatalog().some(item => item.id === id)) { results.push(object(previous)); continue }
    if (data.readConversationCatalog().some(item => item.id === id)) {
      if (conflicts !== 'replace') throw new Error(`Chat ID already exists: ${id}`)
      await ctx.eleckoiConversationsApi.delete(id)
    }
    const messages = session.messages.map((input: unknown) => {
      const message = object(input), role = text(message.role).toLowerCase()
      if (!text(message.id) || !['user', 'assistant', 'system'].includes(role)) throw new Error(`Invalid message identity/role in ${id}`)
      return { id: text(message.id), role: role as 'user' | 'assistant' | 'system', content: text(message.content),
        createdAt: text(message.created_at), reasoning: text(message.reasoning_content),
        images: Array.isArray(message.input_image_attachments) ? message.input_image_attachments : [], files: Array.isArray(message.file_attachments) ? message.file_attachments : [] }
    })
    const runtimeId = stable('android-backup', `${sourceHash}/${id}`)
    const bindings = await adapter.materialize(sessionRoot, runtimeId, messages), turns = new Map(bindings.map(item => [item.messageId, item.turn]))
    const branchId = stable('android-branch', id), userId = stable('android-user', id), assistantId = stable('android-assistant', id)
    const tables: ConversationArchiveSnapshot['tables'] = Object.fromEntries(['chat_sessions', 'chat_session_character_snapshots', 'chat_session_variable_states',
      'agent_conversations', 'agent_branches', 'conversation_speakers', 'agent_turns', 'agent_responses', 'agent_branch_turns', 'agent_openings', 'agent_setting_snapshots'].map(name => [name, []]))
    const createdAt = text(session.created_at), updatedAt = text(session.updated_at) || createdAt
    tables.chat_sessions!.push({ id, title: text(session.title) || text(session.character_name), characterId,
      characterName: text(session.character_name), characterAvatar: text(session.character_avatar), createdAt, updatedAt,
      historyMessageCount: messages.length, historyUserMessageCount: messages.filter(message => message.role === 'user').length })
    tables.chat_session_character_snapshots!.push({ sessionId: id, personaJson: JSON.stringify(object(session.character_persona)) })
    tables.chat_session_variable_states!.push({ sessionId: id, kind: 'initial', stateJson: state(session.initial_variable_state_json) }, { sessionId: id, kind: 'current', stateJson: state(session.variable_state_json) })
    tables.agent_conversations!.push({ id, activeBranchId: branchId, runtimeThreadId: runtimeId })
    tables.agent_branches!.push({ id: branchId, conversationId: id })
    tables.conversation_speakers!.push({ id: userId, conversationId: id, sourceSpeakerId: 'user', kind: 'user', displayName: data.readPersona().user_name, avatarAssetId: data.readPersona().user_avatar },
      { id: assistantId, conversationId: id, sourceSpeakerId: characterId, kind: 'assistant', displayName: text(session.character_name), avatarAssetId: text(session.character_avatar) })
    let latestTurn = '', sequence = 0, responseIndex = 0
    for (const message of messages) {
      const raw = object(session.messages.find((item: Document) => item.id === message.id)), variableStateJson = state(raw.variable_state_json)
      if (message.role !== 'assistant') {
        latestTurn = message.id; responseIndex = 0
        tables.agent_turns!.push({ id: latestTurn, conversationId: id, speakerId: message.role === 'user' ? userId : assistantId, kind: message.role, createdAt: message.createdAt, variableStateJson })
        tables.agent_branch_turns!.push({ branchId, sequence: sequence++, turnId: latestTurn })
      } else {
        if (!latestTurn) {
          latestTurn = stable('android-opening-turn', id)
          tables.agent_turns!.push({ id: latestTurn, conversationId: id, speakerId: assistantId, kind: 'system', createdAt: message.createdAt, variableStateJson })
          tables.agent_branch_turns!.push({ branchId, sequence: sequence++, turnId: latestTurn })
        }
        tables.agent_responses!.push({ id: message.id, conversationId: id, turnId: latestTurn, responseIndex: responseIndex++, speakerId: assistantId,
          status: 'complete', createdAt: message.createdAt, variableStateJson, runtimeThreadId: runtimeId, dshTurn: turns.get(message.id)!, storedRegexRulesJson: '[]' })
      }
    }
    const snapshot = data.parseConversationArchive({ format: 'eleckoi.desktop-conversation', version: 1, conversationId: id, characterId, tables })
    data.importConversationArchive(snapshot, characterId, new Map([[runtimeId, runtimeId]]), id, { preserveIds: true })
    store.atomic(() => {
      for (const message of messages) {
        const raw = object(session.messages.find((item: Document) => item.id === message.id))
        store.put(`metadata:${id}`, message.id, json({ ...object(raw.metadata), extra: { ...object(object(raw.metadata).extra),
          reasoning: message.reasoning, android_source: raw, original_runtime_thread_id: raw.runtime_thread_id ?? '', original_runtime_turn_id: raw.runtime_turn_id ?? '',
          original_tool_calls: raw.tool_calls ?? [], agent_trace_available: false } }))
        if (raw.variable_state_json) store.put(`variables:message:${id}:${message.id}`, 'state:0', JSON.parse(raw.variable_state_json))
        if (Array.isArray(raw.image_attachments) && raw.image_attachments.length) store.put(`message-extensions:${id}`, message.id, json({ images: raw.image_attachments }))
      }
      store.put(`message-presentation:${id}`, 'timeline', json({ order: messages.map(message => message.id), deleted: [] }))
      const result = { conversationId: id, runtimeSessionId: runtimeId, mode: 'transcript-only', messages: messages.length,
        reason: 'Ordinary Android ZIP contains visible history, not original Session/branch/plugin records' }
      store.put('migration:android:logical-chats', checkpoint, json(result)); results.push(result)
    })
    ctx.eleckoiConversationChanges.publish({ kind: 'catalog', conversationId: id, reason: 'created' })
  }
  return results
}
