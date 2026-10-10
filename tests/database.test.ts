import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { SqliteDatabase } from '../packages/dsh-product-data/src/storage/sqlite/SqliteDatabase'
import { commonTables } from '../packages/dsh-product-data/src/storage/sqlite/schema/common'
import { BASELINE_ID, CURRENT_SCHEMA_VERSION, installSchema } from '../packages/dsh-product-data/src/storage/sqlite/installSchema'
import { commonSchemaSql } from '../packages/dsh-product-data/src/storage/sqlite/migrations/commonSchemaSql'
import { ConversationRepository } from '../packages/dsh-product-data/src/domain/conversations/ConversationRepository'
import { MessageRepository } from '../packages/dsh-product-data/src/domain/conversations/MessageRepository'
import { CharacterRepository } from '../packages/dsh-product-data/src/domain/personas/CharacterRepository'
import { PersonaRepository } from '../packages/dsh-product-data/src/domain/personas/PersonaRepository'
import { resolveConversationSeed } from '../packages/dsh-product-data/src/domain/conversations/conversationSeed'
import { LocalMediaStore } from '@eleckoi/dsh-product-data/media'
import { SettingLibraryRepository } from '../packages/dsh-product-data/src/domain/settingLibraries/SettingLibraryRepository'
import { emptyEntry } from '../packages/dsh-product-data/src/domain/settingLibraries/settingLibraryNormalization'
import { readEntry, writeEntry } from '../packages/dsh-product-data/src/domain/settingLibraries/settingLibraryCodec'
import { AgentPresetRepository } from '../packages/dsh-product-data/src/domain/agentPresets/AgentPresetRepository'
import { DEFAULT_AGENT_TOOL_GROUP_IDS } from '../packages/dsh-product-data/src/domain/agentTools'
import { defaultRoleplayPlanSettings } from '../packages/product-shared/src/contracts/presets/roleplayPlan'
import { DEFAULT_HIDDEN_TOOL_TIMELINE_CONTENT } from '../packages/product-shared/src/contracts/presets/builtIns'
import { settingLibraryEntrySchema, settingLibraryPromptPositionSchema, settingLibraryStoredEntrySchema } from '../packages/product-shared/src/contracts/settingLibrary/schemas'
import { VariableConfigRepository } from '../packages/dsh-product-data/src/domain/variables/VariableConfigRepository'
import { VariableStateRepository } from '../packages/dsh-product-data/src/domain/variables/VariableStateRepository'
import { VARIABLE_INITIALIZATION_OBJECT_ID } from '../packages/product-shared/src/contracts/variables/schemas'

const directories: string[] = []
const connections: Array<{ close(): void }> = []
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close()
  for (const directory of directories.splice(0)) {
    const child = relative(tmpdir(), directory)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected test cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
})
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-common-test-'))
  directories.push(directory)
  const path = join(directory, 'eleckoi.sqlite3')
  const database = new SqliteDatabase(path)
  database.open()
  connections.push(database)
  const conversations = new ConversationRepository(database)
  const media = new LocalMediaStore(join(directory, 'media'))
  return { path, database, conversations, media, characters: new CharacterRepository(database, conversations, media), messages: new MessageRepository(database) }
}
function card(id = 'card-a') {
  return { id, name: id, group: '', persona: { assistant_name: id, assistant_avatar: '', assistant_cover: '', opening: 'opening', show_opening: true } }
}

const unreleasedGenerationTableSql = 'CREATE TABLE IF NOT EXISTS `conversation_generation_results` (`operationId` TEXT NOT NULL, `conversationId` TEXT NOT NULL, `resultJson` TEXT NOT NULL, PRIMARY KEY(`operationId`), FOREIGN KEY(`conversationId`) REFERENCES `chat_sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )'

describe('unreleased database baseline consolidation', () => {
  it.each([9, 10])('removes the unused table from development v%s and preserves product records across reopen', (version) => {
    const { path, database, conversations } = harness()
    const conversationId = conversations.create({ title: '合成迁移聊天' }).conversation.id
    new VariableStateRepository(database, new VariableConfigRepository(database)).replaceCurrent(conversationId, '{"score":7}')
    database.close()
    const legacy = new Database(path)
    legacy.exec(unreleasedGenerationTableSql)
    legacy.prepare('INSERT INTO conversation_generation_results VALUES (?,?,?)').run('synthetic-operation', conversationId, '{}')
    if (version === 9) legacy.exec('ALTER TABLE agent_conversations DROP COLUMN variableVersionId')
    legacy.pragma(`user_version = ${version}`)
    const before = productRecords(legacy)
    legacy.close()
    const reopened = new SqliteDatabase(path)
    reopened.open()
    try {
      expect(reopened.native.pragma('user_version', { simple: true })).toBe(9)
      expect(reopened.native.prepare("SELECT 1 FROM sqlite_master WHERE name='conversation_generation_results'").get()).toBeUndefined()
      expect(productRecords(reopened.native)).toEqual(before)
      expect(new ConversationRepository(reopened).get(conversationId).title).toBe('合成迁移聊天')
      expect(JSON.parse(new VariableStateRepository(reopened, new VariableConfigRepository(reopened)).viewerStates(conversationId).currentStateJson)).toEqual({ score: 7 })
      expect(reopened.native.pragma('foreign_key_check')).toEqual([])
      expect(reopened.native.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { reopened.close() }
    reopened.open()
    try {
      expect(reopened.native.pragma('user_version', { simple: true })).toBe(9)
      expect(productRecords(reopened.native)).toEqual(before)
    } finally { reopened.close() }
  }, 30_000)

  it('rolls back removal and column changes together when development v9 consolidation fails', () => {
    const { path, database, conversations } = harness()
    conversations.create({ title: '合成回滚聊天' })
    database.close()
    const legacy = new Database(path)
    try {
      legacy.exec(`${unreleasedGenerationTableSql}; ALTER TABLE agent_conversations DROP COLUMN variableVersionId;
        CREATE TRIGGER synthetic_binding_failure BEFORE UPDATE ON agent_conversations BEGIN SELECT RAISE(ABORT, 'synthetic update failure'); END;
        PRAGMA user_version = 9;`)
      const schema = schemaObjects(legacy)
      const records = productRecords(legacy)
      expect(() => installSchema(legacy)).toThrow('synthetic update failure')
      expect(schemaObjects(legacy)).toEqual(schema)
      expect(productRecords(legacy)).toEqual(records)
      expect(legacy.pragma('user_version', { simple: true })).toBe(9)
    } finally { legacy.close() }
  }, 30_000)

  it('rejects an unknown development v10 table shape without deleting data', () => {
    const { path, database } = harness()
    database.close()
    const legacy = new Database(path)
    try {
      legacy.exec('CREATE TABLE conversation_generation_results (unexpected TEXT); INSERT INTO conversation_generation_results VALUES (\'preserved\'); PRAGMA user_version = 10;')
      const schema = schemaObjects(legacy)
      expect(() => installSchema(legacy)).toThrow('生成结果表结构不匹配')
      expect(schemaObjects(legacy)).toEqual(schema)
      expect(legacy.prepare('SELECT unexpected FROM conversation_generation_results').get()).toEqual({ unexpected: 'preserved' })
      expect(legacy.pragma('user_version', { simple: true })).toBe(10)
    } finally { legacy.close() }
  }, 30_000)
})
function schemaObjects(db: Database.Database) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
}

// Older fixtures must retain the released table shape until the v7 → v8 step.
const schemaV7Sql = commonSchemaSql
  .replace(", `variableVersionId` TEXT NOT NULL DEFAULT ''", '')
  .replace(/^CREATE TABLE IF NOT EXISTS `chat_sessions` .*;$/m,
    'CREATE TABLE IF NOT EXISTS `chat_sessions` (`id` TEXT NOT NULL, `title` TEXT NOT NULL, `characterId` TEXT NOT NULL, `characterName` TEXT NOT NULL, `characterAvatar` TEXT NOT NULL, `historyMessageCount` INTEGER NOT NULL, `historyUserMessageCount` INTEGER NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, PRIMARY KEY(`id`));')
  .replace(/^PRAGMA user_version = \d+;$/m, 'PRAGMA user_version = 7;')

function productRecords(database: Database.Database) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'conversation_generation_results' ORDER BY name")
    .all() as { name: string }[]
  return Object.fromEntries(tables.map(({ name }) => [name,
    (database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<string, unknown>[])
      .map((row) => Object.fromEntries(Object.entries(row)
        .filter(([key]) => (name !== 'chat_sessions' || key !== 'historyUserMessageCount')
          && (name !== 'agent_conversations' || key !== 'variableVersionId'))))
  ]))
}

const legacyContentSql = `
  CREATE TABLE web_search_settings (singletonId INTEGER NOT NULL PRIMARY KEY, mode TEXT NOT NULL, maxResults INTEGER NOT NULL, tavilyApiKey TEXT NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE agent_content_parts (conversationId TEXT NOT NULL,ownerType TEXT NOT NULL,ownerId TEXT NOT NULL,partIndex INTEGER NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,payloadJson TEXT NOT NULL,chunkIndex INTEGER NOT NULL,PRIMARY KEY(ownerType,ownerId,partIndex,chunkIndex));
  CREATE INDEX index_agent_content_parts_conversationId ON agent_content_parts(conversationId);
  CREATE INDEX index_agent_content_parts_ownerType_ownerId ON agent_content_parts(ownerType,ownerId);
`

function insertSyntheticCharacter(database: Database.Database, id = 'synthetic-character'): void {
  database.prepare(`INSERT INTO characters(
    id,name,avatar,squareImage,coverImage,groupName,orderIndex,groupViewOrder,folder,
    frontendBeautyEnabled,assistantName,assistantAvatar,profileAge,profileSex,profileHeight,
    profileBirthday,profileLike,showOpening,chatBackground,chatBackgroundOpacity,
    chatBackgroundBlur,chatBackgroundScrim
  ) VALUES (?,?,'','','','',0,0,'',0,?,'','','','','','',1,'',1,0,0)`)
    .run(id, '合成角色', '合成助手')
}

function registerDesktopV2(database: Database.Database): void {
  database.exec(`
    CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
    CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
    INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
    PRAGMA user_version = 2;
  `)
}

function legacyV1Database(path = ':memory:'): Database.Database {
  const database = new Database(path)
  database.exec(schemaV7Sql)
  database.exec(legacyContentSql)
  database.exec(`
    ALTER TABLE chat_sessions ADD COLUMN historySummary TEXT NOT NULL DEFAULT '';
    ALTER TABLE chat_sessions ADD COLUMN characterMode TEXT NOT NULL DEFAULT 'story';
    ALTER TABLE chat_sessions ADD COLUMN workspaceId TEXT NOT NULL DEFAULT '';
    ALTER TABLE chat_sessions ADD COLUMN permissionMode TEXT NOT NULL DEFAULT '';
    ALTER TABLE characters ADD COLUMN characterMode TEXT NOT NULL DEFAULT 'story';
    ALTER TABLE agent_presets ADD COLUMN usageInstructions TEXT NOT NULL DEFAULT '';
    DROP TABLE web_search_settings;
    CREATE TABLE global_tool_config (singletonId INTEGER NOT NULL PRIMARY KEY, payloadJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE chat_session_model_settings (sessionId TEXT NOT NULL PRIMARY KEY, settingsJson TEXT NOT NULL);
    CREATE TABLE frontend_projects (id TEXT NOT NULL PRIMARY KEY, characterId TEXT NOT NULL, name TEXT NOT NULL, entryFile TEXT NOT NULL, filesJson TEXT NOT NULL, importedAt TEXT NOT NULL);
    CREATE TABLE character_frontend_settings (characterId TEXT NOT NULL PRIMARY KEY, selectedProjectId TEXT, messageRendererEnabled INTEGER NOT NULL);

    ALTER TABLE agent_conversations ADD COLUMN surface TEXT NOT NULL DEFAULT 'roleplay';
    ALTER TABLE agent_conversations ADD COLUMN createdAt TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_conversations ADD COLUMN updatedAt TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_conversations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE agent_conversation_display_cache (conversationId TEXT NOT NULL, chunkIndex INTEGER NOT NULL, ledgerRevision INTEGER NOT NULL, payloadJson TEXT NOT NULL, rendererVersion INTEGER NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY(conversationId, chunkIndex));

    ALTER TABLE agent_branches ADD COLUMN parentBranchId TEXT;
    ALTER TABLE agent_branches ADD COLUMN forkedFromTurnId TEXT;
    ALTER TABLE agent_branches ADD COLUMN headSequence INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agent_branches ADD COLUMN name TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_branches ADD COLUMN reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_branches ADD COLUMN createdAt TEXT NOT NULL DEFAULT '';
    CREATE INDEX index_agent_branches_conversationId_createdAt ON agent_branches (conversationId, createdAt);

    ALTER TABLE agent_turns ADD COLUMN sourceMessageId TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_turns ADD COLUMN provider TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_turns ADD COLUMN model TEXT NOT NULL DEFAULT '';
    CREATE INDEX index_agent_turns_conversationId_sourceMessageId ON agent_turns (conversationId, sourceMessageId);

    ALTER TABLE agent_responses ADD COLUMN sourceMessageId TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_responses ADD COLUMN provider TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_responses ADD COLUMN model TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_responses ADD COLUMN runtimeTurnId TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_responses ADD COLUMN turnStartedAtMillis INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agent_responses ADD COLUMN turnCompletedAtMillis INTEGER;

    CREATE TABLE generation_attempts (id TEXT NOT NULL PRIMARY KEY, conversationId TEXT NOT NULL, ownerId TEXT NOT NULL, state TEXT NOT NULL,
      FOREIGN KEY(conversationId) REFERENCES agent_conversations(id) ON DELETE CASCADE);
    CREATE INDEX index_generation_attempts_conversationId ON generation_attempts (conversationId);
    CREATE UNIQUE INDEX index_generation_attempts_conversationId_ownerId ON generation_attempts (conversationId, ownerId);
    CREATE INDEX index_generation_attempts_conversationId_state ON generation_attempts (conversationId, state);
    DROP INDEX index_generation_attempts_conversationId_ownerId;
    ALTER TABLE generation_attempts ADD COLUMN kind TEXT NOT NULL DEFAULT 'generation';
    ALTER TABLE generation_attempts ADD COLUMN parentAttemptId TEXT;
    ALTER TABLE generation_attempts ADD COLUMN outputMessageId TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_attempts ADD COLUMN attemptNumber INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE generation_attempts ADD COLUMN createdAtMillis INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE generation_attempts ADD COLUMN startedAtMillis INTEGER;
    ALTER TABLE generation_attempts ADD COLUMN finishedAtMillis INTEGER;
    ALTER TABLE generation_attempts ADD COLUMN errorMessage TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_attempts ADD COLUMN outputPath TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_attempts ADD COLUMN supersededByAttemptId TEXT;
    CREATE UNIQUE INDEX index_generation_attempts_conversationId_kind_ownerId_attemptNumber ON generation_attempts (conversationId, kind, ownerId, attemptNumber);
    CREATE INDEX index_generation_attempts_parentAttemptId ON generation_attempts (parentAttemptId);
    CREATE INDEX index_generation_attempts_outputMessageId ON generation_attempts (outputMessageId);

    CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
    CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
    INSERT INTO desktop_schema VALUES (1, 'eleckoi-common-v1-2026-09-11-agent-presets');
    PRAGMA user_version = 1;
  `)
  return database
}

function legacyV2Database(baseline = 'eleckoi-common-v1-2026-09-14-runtime-clean'): Database.Database {
  const database = new Database(':memory:')
  database.exec(schemaV7Sql)
  database.exec(legacyContentSql)
  database.exec(`
    ALTER TABLE chat_sessions ADD COLUMN historySummary TEXT NOT NULL DEFAULT '';
    ALTER TABLE chat_sessions ADD COLUMN characterMode TEXT NOT NULL DEFAULT 'story';
    ALTER TABLE characters ADD COLUMN characterMode TEXT NOT NULL DEFAULT 'story';
    ALTER TABLE agent_presets ADD COLUMN usageInstructions TEXT NOT NULL DEFAULT '';
    DROP TABLE web_search_settings;
    CREATE TABLE global_tool_config (singletonId INTEGER NOT NULL PRIMARY KEY, payloadJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
    CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
    INSERT INTO desktop_schema VALUES (1, 'eleckoi-common-v1-2026-09-14-runtime-clean');
    PRAGMA user_version = 2;
  `)
  database.prepare('UPDATE desktop_schema SET baseline = ? WHERE id = 1').run(baseline)
  return database
}

function currentV2Database(): Database.Database {
  const database = new Database(':memory:')
  database.exec(schemaV7Sql)
  database.exec(legacyContentSql)
  database.exec(`
    CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
    CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
    INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
    PRAGMA user_version = 2;
  `)
  return database
}

describe('shared SQLite baseline', () => {
  it('removes only the v7 user counter and preserves product records across two disk reopens', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-v7-user-count-'))
    directories.push(directory)
    const path = join(directory, 'eleckoi.sqlite3')
    const source = new Database(path)
    let expected: ReturnType<typeof productRecords>
    try {
      source.exec(schemaV7Sql)
      insertSyntheticCharacter(source)
      source.exec(`
        INSERT INTO chat_sessions VALUES
          ('synthetic-chat','合成聊天','synthetic-character','合成角色','',3,0,'created','updated'),
          ('synthetic-empty-chat','合成空聊天','','','',0,99,'created','updated');
        INSERT INTO chat_session_character_snapshots VALUES ('synthetic-chat','{"assistant_name":"合成助手"}');
        INSERT INTO chat_session_variable_states VALUES ('synthetic-chat','global','{"score":5}');
        INSERT INTO conversation_setting_changes VALUES ('synthetic-chat','entry','synthetic-entry','upsert','{}','updated');
        INSERT INTO agent_conversations VALUES ('synthetic-chat','synthetic-branch','synthetic-session');
        INSERT INTO agent_branches VALUES ('synthetic-branch','synthetic-chat');
        INSERT INTO conversation_speakers VALUES
          ('synthetic-user','synthetic-chat','user','user','合成用户',''),
          ('synthetic-assistant','synthetic-chat','assistant','assistant','合成助手','');
        INSERT INTO agent_turns VALUES
          ('synthetic-opening','synthetic-chat','synthetic-assistant','opening','created','{}'),
          ('synthetic-input','synthetic-chat','synthetic-user','user','created','{"score":5}');
        INSERT INTO agent_branch_turns VALUES
          ('synthetic-branch',0,'synthetic-opening'),('synthetic-branch',1,'synthetic-input');
        INSERT INTO agent_openings VALUES ('synthetic-chat','synthetic-opening','合成开场','{"options":[]}');
        INSERT INTO agent_pending_inputs VALUES ('synthetic-input','{"content":"合成输入","images":[],"files":[]}');
        INSERT INTO agent_responses VALUES
          ('synthetic-response','synthetic-chat','synthetic-input',0,'synthetic-assistant','completed','created','{"score":6}','synthetic-session',1,'[]');
        INSERT INTO agent_setting_snapshots VALUES ('synthetic-chat','response','synthetic-response','[]');
        INSERT INTO user_profile VALUES ('self','合成用户','','','','');
        INSERT INTO setting_libraries VALUES ('synthetic-character','合成设定','',1,'[]','[]','updated');
        INSERT INTO agent_presets VALUES ('synthetic-preset','合成预设','general','[]','','','','',0,'[]');
        INSERT INTO agent_preset_contents VALUES ('synthetic-preset','usage_instructions','合成说明');
      `)
      expected = productRecords(source)
      expect(source.pragma('user_version', { simple: true })).toBe(7)
    } finally { source.close() }

    for (let reopen = 0; reopen < 2; reopen++) {
      const database = new SqliteDatabase(path)
      try {
        database.open()
        expect(database.native.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
        expect((database.native.pragma('table_info(chat_sessions)') as { name: string }[]).map(column => column.name))
          .not.toContain('historyUserMessageCount')
        expect(productRecords(database.native)).toEqual(expected!)
        expect(database.native.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chat_sessions' ORDER BY name").all())
          .toEqual([
            { name: 'index_chat_sessions_characterId' },
            { name: 'index_chat_sessions_updatedAt' },
            { name: 'sqlite_autoindex_chat_sessions_1' }
          ])
        expect(database.native.pragma('foreign_key_check')).toEqual([])
        expect(database.native.pragma('integrity_check', { simple: true })).toBe('ok')
      } finally { database.close() }
    }
  }, 15_000)

  it('rolls back a v7 column removal if the migration is interrupted before the version stamp', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-v7-user-count-rollback-'))
    directories.push(directory)
    const path = join(directory, 'eleckoi.sqlite3')
    const source = new Database(path)
    let originalSchema: ReturnType<typeof schemaObjects>
    try {
      source.exec(schemaV7Sql)
      source.exec("INSERT INTO chat_sessions VALUES ('synthetic-chat','合成聊天','','','',2,1,'created','updated')")
      originalSchema = schemaObjects(source)
      const execute = source.exec.bind(source)
      const interrupted = vi.spyOn(source, 'exec').mockImplementation((sql) => {
        const result = execute(sql)
        if (sql === 'ALTER TABLE chat_sessions DROP COLUMN historyUserMessageCount') {
          throw new Error('合成迁移中断')
        }
        return result
      })
      try {
        expect(() => installSchema(source)).toThrow('合成迁移中断')
      } finally { interrupted.mockRestore() }
    } finally { source.close() }

    const reopened = new Database(path)
    try {
      expect(reopened.pragma('user_version', { simple: true })).toBe(7)
      expect(schemaObjects(reopened)).toEqual(originalSchema!)
      expect(reopened.prepare('SELECT * FROM chat_sessions').get()).toEqual({
        id: 'synthetic-chat', title: '合成聊天', characterId: '', characterName: '', characterAvatar: '',
        historyMessageCount: 2, historyUserMessageCount: 1, createdAt: 'created', updatedAt: 'updated'
      })
      installSchema(reopened)
      expect(reopened.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(reopened.pragma('foreign_key_check')).toEqual([])
      expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { reopened.close() }
  }, 15_000)

  it('refuses a v7 database with an unexpected table shape without changing its data', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(`
        INSERT INTO chat_sessions VALUES ('synthetic-chat','合成聊天','','','',2,1,'created','updated');
        ALTER TABLE chat_sessions ADD COLUMN unexpected TEXT;
      `)
      const before = schemaObjects(database)
      expect(() => installSchema(database)).toThrow('公共数据库结构不匹配：chat_sessions')
      expect(database.pragma('user_version', { simple: true })).toBe(7)
      expect(schemaObjects(database)).toEqual(before)
      expect(database.prepare('SELECT historyUserMessageCount,title FROM chat_sessions').get())
        .toEqual({ historyUserMessageCount: 1, title: '合成聊天' })
    } finally { database.close() }
  })

  it('removes child-model routing from current and versioned preset tool configuration', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(`
        INSERT INTO agent_presets(
          id,name,modelFamily,modelTagsJson,libraryGroupId,activeVersionId,authorName,
          authorAvatarPath,sortIndex,expandedGroupIdsJson
        ) VALUES ('synthetic-preset','合成预设','general','[]','','synthetic-v1','','',0,'[]');
        INSERT INTO agent_preset_versions(
          presetId,versionId,versionNumber,name,createdAtEpochMs,expandedGroupIdsJson
        ) VALUES ('synthetic-preset','synthetic-v1',1,'合成版本',1,'[]');
        PRAGMA user_version = 6;
      `)
      const legacyConfiguration = JSON.stringify({
        version: 4,
        includedGroupIds: ['synthetic:tool'],
        enabledGroupIds: ['synthetic:tool'],
        subagentModelSelection: { configId: 'deepseek-default', model: 'synthetic-model' },
        roleplayPlan: { steps: ['合成步骤'] },
        futureField: { preserved: true }
      })
      database.prepare('INSERT INTO agent_preset_contents VALUES (?,?,?)')
        .run('synthetic-preset', 'tool_configuration', legacyConfiguration)
      database.prepare('INSERT INTO agent_preset_version_contents VALUES (?,?,?,?)')
        .run('synthetic-preset', 'synthetic-v1', 'tool_configuration', legacyConfiguration)

      installSchema(database)

      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      for (const row of database.prepare(`
        SELECT content FROM agent_preset_contents WHERE kind='tool_configuration'
        UNION ALL
        SELECT content FROM agent_preset_version_contents WHERE kind='tool_configuration'
      `).all() as Array<{ content: string }>) {
        expect(JSON.parse(row.content)).toMatchObject({
          version: 5,
          includedGroupIds: ['synthetic:tool'],
          enabledGroupIds: ['synthetic:tool'],
          roleplayPlan: { steps: ['合成步骤'] },
          futureField: { preserved: true }
        })
        expect(JSON.parse(row.content)).not.toHaveProperty('subagentModelSelection')
      }
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { database.close() }
  })

  it('removes DSH-owned configuration in the v5 to v6 migration without a handoff', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(`
        CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
        INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
        CREATE TABLE web_search_settings (singletonId INTEGER NOT NULL PRIMARY KEY, mode TEXT NOT NULL, maxResults INTEGER NOT NULL, tavilyApiKey TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
        INSERT INTO web_search_settings VALUES (1,'tavily',8,'retired-ciphertext','saved');
        INSERT INTO desktop_preferences VALUES ('appearance.mode','"dark"','saved');
        PRAGMA user_version = 5;
      `)
      installSchema(database)
      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name IN ('web_search_settings','migration_handoffs','desktop_preferences','desktop_schema')").all()).toEqual([])
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { database.close() }
  })

  it('reads existing setting payloads with unknown enum values without changing the database version', () => {
    const raw = JSON.parse(writeEntry(emptyEntry('saved-setting', 'now'))) as Record<string, unknown>
    raw.content = '已保存正文'
    raw.dynamic_mode = 'single_condition'
    raw.trigger_mode = 'cache'
    raw.agent_read_condition = "getvar('剧情.章节') > 1"
    expect(readEntry(JSON.stringify(raw))).toMatchObject({
      content: '已保存正文', dynamicMode: 'standard', triggerMode: null
    })
    expect(settingLibraryStoredEntrySchema.parse({
      ...emptyEntry('preset-setting', 'now'),
      dynamicMode: 'single_condition', triggerMode: 'cache', agentReadCondition: '旧表达式'
    })).toMatchObject({ dynamicMode: 'standard', triggerMode: null })
  })

  it('drops extra setting entry fields while rejecting invalid defined fields', () => {
    const source = emptyEntry('setting', 'now')
    const parsed = settingLibraryEntrySchema.parse({ ...source, editorOnly: true })
    expect(parsed).not.toHaveProperty('editorOnly')
    expect(settingLibraryEntrySchema.safeParse({ ...source, enabled: 'yes' }).success).toBe(false)
  })

  it('uses Agent on-demand reading for newly created setting entries', () => {
    expect(emptyEntry('new-setting', '2026-09-15T00:00:00.000Z')).toMatchObject({
      triggerMode: 'agent_tool',
      agentReadStrategy: 'normal',
      position: null
    })
  })

  it('installs all common tables, views, indexes and foreign keys exactly and maps every column', () => {
    const { database } = harness()
    const expected = new Database(':memory:')
    try {
      expected.exec(commonSchemaSql)
      expect(schemaObjects(database.native)).toEqual(schemaObjects(expected))
    } finally { expected.close() }
    const canonicalTableNames = [...commonSchemaSql.matchAll(/^CREATE TABLE IF NOT EXISTS `([^`]+)`/gm)].map((match) => match[1])
    const canonicalViewNames = [...commonSchemaSql.matchAll(/^CREATE VIEW `?([^`\s]+)`?/gm)].map((match) => match[1])
    expect(Object.values(commonTables).map(getTableName).sort()).toEqual(canonicalTableNames.sort())
    expect(database.native.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all())
      .toEqual(canonicalViewNames.sort().map((name) => ({ name })))
    for (const table of Object.values(commonTables)) {
      const fields = database.native.prepare(`PRAGMA table_info("${getTableName(table)}")`).all() as { name: string }[]
      expect(Object.values(getTableColumns(table)).map((column) => column.name)).toEqual(fields.map((column) => column.name))
    }
    expect(database.native.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(database.native.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
    expect((database.native.pragma('table_info(chat_sessions)') as { name: string }[]).map(column => column.name))
      .not.toContain('historyUserMessageCount')
    expect(database.native.pragma('secure_delete', { simple: true })).toBe(2)
    expect(database.native.pragma('foreign_key_check')).toEqual([])
    expect(database.native.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(commonSchemaSql).toBe(readFileSync('apps/desktop/resources/database/eleckoi-common-schema-v1.sql', 'utf8').replaceAll('\r\n', '\n'))
  })

  it('upgrades a v3 response ledger with its existing messages intact', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(legacyContentSql)
      database.exec(`
        CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
        CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
        INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
        ALTER TABLE agent_responses DROP COLUMN dshTurn;
        ALTER TABLE agent_responses DROP COLUMN storedRegexRulesJson;
        DROP TABLE agent_openings;
        DROP TABLE agent_setting_snapshots;
        ALTER TABLE agent_conversations DROP COLUMN runtimeThreadId;
        PRAGMA user_version = 3;
      `)
      database.prepare('INSERT INTO agent_conversations(id,activeBranchId) VALUES (?,?)').run('conversation', 'branch')
      database.prepare('INSERT INTO agent_branches(id,conversationId) VALUES (?,?)').run('branch', 'conversation')
      database.prepare('INSERT INTO conversation_speakers(id,conversationId,sourceSpeakerId,kind,displayName,avatarAssetId) VALUES (?,?,?,?,?,?)')
        .run('speaker', 'conversation', 'user', 'user', '用户', '')
      database.prepare('INSERT INTO agent_turns(id,conversationId,speakerId,kind,createdAt,variableStateJson) VALUES (?,?,?,?,?,?)')
        .run('turn', 'conversation', 'speaker', 'user', 'created', '{}')
      database.prepare('INSERT INTO agent_responses(id,conversationId,turnId,responseIndex,speakerId,status,createdAt,variableStateJson,runtimeThreadId) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('reply', 'conversation', 'turn', 0, 'speaker', 'completed', 'created', '{}', 'existing-session')
      database.prepare("INSERT INTO agent_content_parts(conversationId,ownerType,ownerId,partIndex,kind,text,payloadJson,chunkIndex) VALUES (?,'response',?,0,'assistant_text',?,'',0)")
        .run('conversation', 'reply', '现有回复')
      database.prepare("INSERT INTO agent_content_parts(conversationId,ownerType,ownerId,partIndex,kind,text,payloadJson,chunkIndex) VALUES (?,'response',?,1,'setting_library_state','',?,0)")
        .run('conversation', 'reply', '["state"]')

      installSchema(database)

      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare('SELECT runtimeThreadId,dshTurn FROM agent_responses WHERE id=?').get('reply'))
        .toEqual({ runtimeThreadId: 'existing-session', dshTurn: null })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_content_parts'").get())
        .toBeUndefined()
      expect(database.prepare("SELECT stateJson FROM agent_setting_snapshots WHERE ownerType='response' AND ownerId='reply'").get())
        .toEqual({ stateJson: '["state"]' })
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  })

  it('migrates v3 opening text and EJS settings into v4', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(legacyContentSql)
      database.exec(`
        CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
        CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
        INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
        DROP TABLE agent_openings;
        DROP TABLE agent_setting_snapshots;
        ALTER TABLE agent_conversations DROP COLUMN runtimeThreadId;
        INSERT INTO agent_conversations(id,activeBranchId) VALUES ('conversation','branch');
        INSERT INTO conversation_speakers(id,conversationId,sourceSpeakerId,kind,displayName,avatarAssetId)
          VALUES ('speaker','conversation','assistant','assistant','角色','');
        INSERT INTO agent_turns(id,conversationId,speakerId,kind,createdAt,variableStateJson)
          VALUES ('opening','conversation','speaker','opening','created','{}');
        INSERT INTO agent_content_parts(conversationId,ownerType,ownerId,partIndex,kind,text,payloadJson,chunkIndex)
          VALUES ('conversation','turn','opening',0,'opening_text','开场白','{"options":[]}',0);
        PRAGMA user_version = 3;
      `)
      insertSyntheticCharacter(database)
      database.prepare(`INSERT INTO setting_libraries(characterId,name,activeVersionId,listAllExpanded,expandedGroupIdsJson,promptPositionsJson,updatedAt)
        VALUES ('synthetic-character','合成设定','saved',1,'[]','[]','now')`).run()
      database.prepare(`INSERT INTO setting_entry_contents(characterId,entryId,revisionId,payloadJson)
        VALUES ('synthetic-character','scene','revision-1',?)`).run(JSON.stringify({
        id: 'scene', content: '<%= getvar("chapter") %>', agent_read_strategy: 'variable_condition',
        dynamic_mode: 'ejs_controller', trigger_mode: 'agent_tool'
      }))
      database.prepare(`INSERT INTO agent_presets(
        id,name,modelFamily,modelTagsJson,libraryGroupId,activeVersionId,authorName,
        authorAvatarPath,sortIndex,expandedGroupIdsJson
      ) VALUES ('synthetic-preset','合成预设','general','[]','','','', '',0,'[]')`).run()
      const previousTimelineContent = DEFAULT_HIDDEN_TOOL_TIMELINE_CONTENT.replace(/^  reasoning_channel:.*\n/m, '')
      database.prepare('INSERT INTO agent_preset_entries VALUES (?,?,0,?)').run(
        'synthetic-preset', 'built-in-hidden-tool-timeline', JSON.stringify({
          id: 'built-in-hidden-tool-timeline', kind: 'hidden_tool_timeline',
          content: previousTimelineContent, promptPositionId: 'hidden-tool-timeline', position: 'insert_point_4'
        })
      )
      database.prepare('INSERT INTO agent_preset_contents VALUES (?,?,?)').run(
        'synthetic-preset', 'prompt_positions', JSON.stringify([{
          id: 'hidden-tool-timeline', name: '隐藏工具时间线',
          anchor: 'insert_point_4', side: 'before_setting_position', order: 1
        }])
      )
      installSchema(database)
      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      const setting = database.prepare("SELECT payloadJson FROM setting_entry_contents WHERE entryId='scene'").get() as { payloadJson: string }
      expect(JSON.parse(setting.payloadJson)).toMatchObject({
        content: '<%= getvar("chapter") %>', agent_read_strategy: 'normal',
        dynamic_mode: 'standard', content_mode: 'ejs'
      })
      const hidden = database.prepare("SELECT payloadJson FROM agent_preset_entries WHERE entryId='built-in-hidden-tool-timeline'").get() as { payloadJson: string }
      expect(JSON.parse(hidden.payloadJson)).toMatchObject({
        content: DEFAULT_HIDDEN_TOOL_TIMELINE_CONTENT, position: 'insert_point_5'
      })
      const positions = database.prepare("SELECT content FROM agent_preset_contents WHERE kind='prompt_positions'").get() as { content: string }
      expect(JSON.parse(positions.content)).toContainEqual(expect.objectContaining({
        id: 'hidden-tool-timeline', anchor: 'insert_point_5', side: 'after_setting_position'
      }))
      expect(database.prepare('SELECT content,payloadJson FROM agent_openings WHERE turnId=?').get('opening'))
        .toEqual({ content: '开场白', payloadJson: '{"options":[]}' })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_content_parts'").get())
        .toBeUndefined()
      expect(database.pragma('foreign_key_check')).toEqual([])
    } finally { database.close() }
  })

  it('preserves records after reopening and refuses an unrelated nonempty database', () => {
    const { database, path, conversations } = harness()
    const id = conversations.create({ title: '持久存档' }).conversation.id
    database.close()
    database.open()
    expect(conversations.get(id).title).toBe('持久存档')
    expect(new ConversationRepository(database).get(id).id).toBe(id)
    const old = new Database(':memory:')
    try {
      old.exec("CREATE TABLE messages(id TEXT PRIMARY KEY,content TEXT); INSERT INTO messages VALUES (1, 'preserve');")
      expect(() => installSchema(old)).toThrow('不是 ElecKoi 数据库')
      expect(old.prepare('SELECT content FROM messages').get()).toEqual({ content: 'preserve' })
    } finally { old.close() }
    expect(path).toContain('eleckoi.sqlite3')
  })

  it('adds pending inputs in the v3 to v4 migration without changing conversations', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(`
        CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
        INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
        INSERT INTO chat_sessions(id,title,characterId,characterName,characterAvatar,historyMessageCount,historyUserMessageCount,createdAt,updatedAt)
          VALUES ('chat-v3','Existing','','','',0,0,'created','updated');
        CREATE TABLE web_search_settings (singletonId INTEGER NOT NULL PRIMARY KEY, mode TEXT NOT NULL, maxResults INTEGER NOT NULL, tavilyApiKey TEXT NOT NULL, updatedAt TEXT NOT NULL);
        DROP TABLE agent_pending_inputs;
        PRAGMA user_version = 3;
      `)
      installSchema(database)
      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare('SELECT title FROM chat_sessions WHERE id=?').get('chat-v3')).toEqual({ title: 'Existing' })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='agent_pending_inputs'").get())
        .toEqual({ name: 'agent_pending_inputs' })
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { database.close() }
  })

  it('removes the released v4 rich-message height cache in the v5 migration and preserves product data', () => {
    const database = new Database(':memory:')
    try {
      database.exec(schemaV7Sql)
      database.exec(`
        CREATE TABLE desktop_schema (id INTEGER PRIMARY KEY CHECK(id = 1), baseline TEXT NOT NULL);
        INSERT INTO desktop_schema VALUES (1, 'eleckoi-common');
        CREATE TABLE web_search_settings (singletonId INTEGER NOT NULL PRIMARY KEY, mode TEXT NOT NULL, maxResults INTEGER NOT NULL, tavilyApiKey TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TABLE desktop_preferences (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TABLE roleplay_rich_heights (
          sessionId TEXT NOT NULL,
          messageId TEXT NOT NULL,
          contentRevision TEXT NOT NULL,
          rootIndex INTEGER NOT NULL,
          viewportWidthPx INTEGER NOT NULL,
          heightPx INTEGER NOT NULL,
          measuredAtEpochMs INTEGER NOT NULL,
          PRIMARY KEY(sessionId,messageId,contentRevision,rootIndex,viewportWidthPx),
          FOREIGN KEY(sessionId) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX index_roleplay_rich_heights_sessionId ON roleplay_rich_heights(sessionId);
        INSERT INTO desktop_preferences VALUES ('appearance.mode', '"dark"', 'now');
        PRAGMA user_version = 4;
      `)

      installSchema(database)

      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roleplay_rich_heights'").get())
        .toBeUndefined()
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='desktop_preferences'").get()).toBeUndefined()
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { database.close() }
  })

  it('migrates v1 through the complete chain atomically, preserves product data and removes only retired storage', () => {
    const database = legacyV1Database()
    try {
      database.exec(`
        INSERT INTO chat_sessions(id, title, characterId, characterName, characterAvatar, characterMode, historySummary, historyMessageCount, historyUserMessageCount, createdAt, updatedAt, workspaceId, permissionMode)
          VALUES ('chat', '保留会话', '', '', '', 'roleplay', '摘要', 2, 1, 'created', 'updated', 'dead-workspace', 'dead-permission');
        INSERT INTO chat_session_model_settings VALUES ('chat', '{"dead":true}');
        INSERT INTO global_tool_config VALUES (1, '{"version":1,"futureTool":{"dead":true},"webSearch":{"mode":"tavily","maxResults":8,"tavilyApiKey":"encrypted-key"}}', 'tool-updated');
        INSERT INTO desktop_preferences VALUES ('appearance.mode', '"dark"', 'now');
        INSERT INTO agent_presets(id,name,modelFamily,modelTagsJson,libraryGroupId,activeVersionId,authorName,authorAvatarPath,sortIndex,expandedGroupIdsJson,usageInstructions)
          VALUES ('preset','预设','general','[]','','preset-v1','','',0,'[]','使用说明');
        INSERT INTO agent_preset_versions(presetId,versionId,versionNumber,name,createdAtEpochMs,expandedGroupIdsJson)
          VALUES ('preset','preset-v1',1,'预设',1,'[]');
        INSERT INTO agent_conversations(id, activeBranchId, surface, createdAt, updatedAt, revision)
          VALUES ('chat', 'branch', 'roleplay', 'created', 'updated', 8);
        INSERT INTO agent_branches(id, conversationId, headSequence, name, reason, createdAt)
          VALUES ('branch', 'chat', 2, 'dead-name', 'dead-reason', 'created');
        INSERT INTO conversation_speakers VALUES ('speaker-user', 'chat', 'user', 'user', '测试用户', 'avatar');
        INSERT INTO conversation_speakers VALUES ('speaker-ai', 'chat', 'assistant', 'assistant', '角色', 'avatar');
        INSERT INTO agent_turns(id, conversationId, speakerId, kind, createdAt, variableStateJson, sourceMessageId, provider, model)
          VALUES ('turn', 'chat', 'speaker-user', 'user', 'created', '{"hp":10}', 'turn', 'dead-provider', 'dead-model');
        INSERT INTO agent_responses(id, conversationId, turnId, responseIndex, speakerId, status, createdAt, variableStateJson, runtimeThreadId, sourceMessageId, provider, model, runtimeTurnId, turnStartedAtMillis, turnCompletedAtMillis)
          VALUES ('response', 'chat', 'turn', 0, 'speaker-ai', 'complete', 'created', '{"hp":9}', 'dsh-session', 'response', 'dead-provider', 'dead-model', 'dead-turn', 1, 2);
        INSERT INTO agent_branch_turns VALUES ('branch', 0, 'turn');
        INSERT INTO agent_content_parts VALUES ('chat', 'turn', 'turn', 0, 'text', '用户正文', '{}', 0);
        INSERT INTO agent_content_parts VALUES ('chat', 'response', 'response', 0, 'text', '角色正文', '{}', 0);
        INSERT INTO generation_attempts(id, conversationId, ownerId, state, kind, outputMessageId, attemptNumber, createdAtMillis, errorMessage, outputPath)
          VALUES ('attempt', 'chat', 'response', 'complete', 'generation', 'response', 1, 1, '', 'dead-path');
        INSERT INTO agent_conversation_display_cache VALUES ('chat', 0, 8, '{"dead":true}', 1, 'now');
      `)

      installSchema(database)

      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='desktop_schema'").get()).toBeUndefined()
      expect(database.prepare('SELECT title FROM chat_sessions').get()).toEqual({ title: '保留会话' })
      expect((database.pragma('table_info(chat_sessions)') as Array<{ name: string }>).map((column) => column.name))
        .not.toContain('historySummary')
      expect(database.prepare('SELECT displayName FROM conversation_speakers ORDER BY id').all()).toEqual([{ displayName: '角色' }, { displayName: '测试用户' }])
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_content_parts'").get()).toBeUndefined()
      expect(database.prepare('SELECT runtimeThreadId FROM agent_responses').get()).toEqual({ runtimeThreadId: 'dsh-session' })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('generation_attempts','cleanup_operations','desktop_preferences')").all()).toEqual([])
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_session_model_settings','frontend_projects','character_frontend_settings','agent_conversation_display_cache','global_tool_config')").all()).toEqual([])
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='web_search_settings'").get()).toBeUndefined()
      expect(database.prepare("SELECT content FROM agent_preset_contents WHERE presetId='preset' AND kind='usage_instructions'").get())
        .toEqual({ content: '使用说明' })
      expect(database.prepare("SELECT content FROM agent_preset_version_contents WHERE presetId='preset' AND versionId='preset-v1' AND kind='usage_instructions'").get())
        .toEqual({ content: '使用说明' })
      expect(database.prepare("PRAGMA table_info('characters')").all().map((column: any) => column.name)).not.toContain('characterMode')
      expect(database.prepare("PRAGMA table_info('chat_sessions')").all().map((column: any) => column.name)).not.toContain('characterMode')
      expect(database.prepare("PRAGMA table_info('agent_presets')").all().map((column: any) => column.name)).not.toContain('usageInstructions')
      expect(database.prepare("PRAGMA table_info('agent_responses')").all().map((column: any) => column.name)).not.toContain('model')
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  })

  it('opens an on-disk v1 database through the complete chain and opens it again after an app restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-v1-reopen-test-'))
    directories.push(directory)
    const path = join(directory, 'eleckoi-common.sqlite3')
    const legacy = legacyV1Database(path)
    legacy.exec(`
      INSERT INTO chat_sessions(id, title, characterId, characterName, characterAvatar, characterMode, historySummary, historyMessageCount, historyUserMessageCount, createdAt, updatedAt, workspaceId, permissionMode)
        VALUES ('chat-reopen', '迁移后保留', '', '', '', 'story', '历史摘要', 1, 1, 'created', 'updated', '', '');
      INSERT INTO desktop_preferences VALUES ('appearance.mode', '"dark"', 'saved-at');
    `)
    legacy.close()

    const firstStart = new SqliteDatabase(path)
    const secondStart = new SqliteDatabase(path)
    try {
      firstStart.open()
      expect(firstStart.native.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(firstStart.native.prepare('SELECT title FROM chat_sessions WHERE id = ?').get('chat-reopen'))
        .toEqual({ title: '迁移后保留' })
      expect(firstStart.native.prepare("SELECT name FROM sqlite_master WHERE name='desktop_preferences'").get()).toBeUndefined()
      firstStart.close()

      secondStart.open()
      expect(secondStart.native.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(secondStart.native.prepare("SELECT name FROM sqlite_master WHERE name='desktop_schema'").get()).toBeUndefined()
      expect(secondStart.native.prepare('SELECT title FROM chat_sessions WHERE id = ?').get('chat-reopen'))
        .toEqual({ title: '迁移后保留' })
      expect(secondStart.native.pragma('foreign_key_check')).toEqual([])
      expect(secondStart.native.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      firstStart.close()
      secondStart.close()
    }
  }, 15_000)

  it('rolls back every v1 schema change when a migration step fails', () => {
    const database = legacyV1Database()
    try {
      database.exec('DROP INDEX index_agent_turns_conversationId_sourceMessageId')
      expect(() => installSchema(database)).toThrow('index_agent_turns_conversationId_sourceMessageId')
      expect(database.pragma('user_version', { simple: true })).toBe(1)
      expect(database.prepare('SELECT baseline FROM desktop_schema WHERE id = 1').get()).toEqual({ baseline: 'eleckoi-common-v1-2026-09-11-agent-presets' })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_session_model_settings'").get()).toEqual({ name: 'chat_session_model_settings' })
      expect(database.prepare("PRAGMA table_info('chat_sessions')").all().map((column: any) => column.name)).toContain('workspaceId')
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  })

  it('normalizes an existing pre-release v2 database without clearing valid settings or presets', () => {
    const database = legacyV2Database(BASELINE_ID)
    try {
      database.exec(`
        INSERT INTO global_tool_config VALUES (1, '{"version":1,"webSearch":{"mode":"tavily","maxResults":3,"tavilyApiKey":"ciphertext"}}', 'saved-at');
        INSERT INTO agent_presets(id,name,modelFamily,modelTagsJson,libraryGroupId,activeVersionId,authorName,authorAvatarPath,sortIndex,expandedGroupIdsJson,usageInstructions)
          VALUES ('preset-v2','预设','general','[]','','preset-v2:1','','',0,'[]','保留说明');
        INSERT INTO agent_preset_versions(presetId,versionId,versionNumber,name,createdAtEpochMs,expandedGroupIdsJson)
          VALUES ('preset-v2','preset-v2:1',1,'预设',1,'[]');
      `)

      installSchema(database)

      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='desktop_schema'").get()).toBeUndefined()
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='web_search_settings'").get()).toBeUndefined()
      expect(database.prepare("SELECT content FROM agent_preset_contents WHERE presetId='preset-v2' AND kind='usage_instructions'").get())
        .toEqual({ content: '保留说明' })
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  })

  it('normalizes obsolete preset storage in v2 before continuing to the current schema', () => {
    const database = currentV2Database()
    try {
      database.exec(`
        INSERT INTO agent_presets(id,name,modelFamily,modelTagsJson,libraryGroupId,activeVersionId,authorName,authorAvatarPath,sortIndex,expandedGroupIdsJson)
          VALUES ('preset-current-v2','通用预设','general','[]','','preset-current-v2:1','','',0,'[]');
        INSERT INTO agent_preset_versions(presetId,versionId,versionNumber,name,createdAtEpochMs,expandedGroupIdsJson)
          VALUES ('preset-current-v2','preset-current-v2:1',1,'通用预设',1,'[]');
        INSERT INTO agent_preset_contents(presetId,kind,content)
          VALUES ('preset-current-v2','tool_policy','{"version":2,"enabledGroupIds":["builtin:variables"]}');
        INSERT INTO agent_preset_entries(presetId,entryId,sortIndex,payloadJson)
          VALUES ('preset-current-v2','fixed-roleplay-plan',0,'{"kind":"roleplay_plan","content":"读取变量\\n生成正文"}');
      `)

      installSchema(database)

      const configuration = database.prepare(`SELECT content FROM agent_preset_contents
        WHERE presetId = 'preset-current-v2' AND kind = 'tool_configuration'`).get() as { content: string }
      expect(JSON.parse(configuration.content)).toEqual({
        version: 5,
        includedGroupIds: ['builtin:variables'],
        enabledGroupIds: ['builtin:variables'],
        roleplayPlan: { steps: ['读取变量', '生成正文'] }
      })
      expect(database.prepare("SELECT kind FROM agent_preset_contents WHERE kind='tool_policy'").all()).toEqual([])
      expect(database.prepare("SELECT entryId FROM agent_preset_entries WHERE entryId='fixed-roleplay-plan'").all()).toEqual([])
      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.pragma('foreign_key_check')).toEqual([])
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  })

  it('rolls back pre-release v2 normalization when a legacy setting cannot be migrated safely', () => {
    const database = legacyV2Database()
    try {
      database.prepare('INSERT INTO global_tool_config VALUES (1, ?, ?)').run('{"webSearch":{"mode":"invalid","maxResults":5,"tavilyApiKey":""}}', 'saved-at')

      expect(() => installSchema(database)).toThrow('旧联网搜索模式无效')

      expect(database.pragma('user_version', { simple: true })).toBe(2)
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='global_tool_config'").get())
        .toEqual({ name: 'global_tool_config' })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='web_search_settings'").get())
        .toBeUndefined()
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  })

  it('migrates a closed v2 file to v3 and reopens every persisted setting placement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-v2-placement-test-'))
    directories.push(directory)
    const path = join(directory, 'eleckoi.sqlite3')
    const timestamp = '2026-01-01T00:00:00.000Z'
    const baseEntry = emptyEntry('setting-entry', timestamp)
    const snakeEntry = JSON.parse(writeEntry({ ...baseEntry, position: 'insert_point_1' })) as Record<string, unknown>
    snakeEntry.position = 'after_instructions'
    const presetEntry = { ...baseEntry, id: 'preset-entry', position: 'before_latest_user_input' }
    const presetVersionEntry = { ...baseEntry, id: 'preset-version-entry', position: 'after_tool_flow' }
    const hiddenEntry = {
      ...baseEntry,
      id: 'built-in-hidden-tool-timeline',
      kind: 'hidden_tool_timeline',
      position: 'after_tool_flow',
      promptPositionId: ''
    }
    const conversationEntry = { ...baseEntry, id: 'conversation-entry', position: 'after_history' }
    const snapshotEntry = { ...baseEntry, id: 'snapshot-entry', position: 'before_tool_flow' }
    const toolConfiguration = JSON.stringify({
      version: 4,
      includedGroupIds: [...DEFAULT_AGENT_TOOL_GROUP_IDS],
      enabledGroupIds: [...DEFAULT_AGENT_TOOL_GROUP_IDS],
      subagentModelSelection: { configId: '', model: '' },
      roleplayPlan: defaultRoleplayPlanSettings()
    })

    let database = new Database(path)
    try {
      database.exec(schemaV7Sql)
      database.exec(legacyContentSql)
      registerDesktopV2(database)
      insertSyntheticCharacter(database)
      database.prepare(`INSERT INTO setting_libraries(
        characterId,name,activeVersionId,listAllExpanded,expandedGroupIdsJson,promptPositionsJson,updatedAt
      ) VALUES (?,?,?,1,'[]',?,?)`).run('synthetic-character', '合成设定', 'setting-version', JSON.stringify([{
        id: 'setting-position', name: '位置一', anchor: 'before_history', order: 1,
        created_at: timestamp, updated_at: timestamp
      }]), timestamp)
      database.prepare(`INSERT INTO setting_library_versions(
        characterId,versionId,sortIndex,name,listAllExpanded,expandedGroupIdsJson,promptPositionsJson,createdAt,updatedAt
      ) VALUES (?, ?, 0, ?, 1, '[]', ?, ?, ?)`).run(
        'synthetic-character', 'setting-version', '初始版本', JSON.stringify([{
          id: 'setting-version-position', name: '位置二', anchor: 'after_latest_user_input', order: 1,
          created_at: timestamp, updated_at: timestamp
        }]), timestamp, timestamp
      )
      database.prepare('INSERT INTO setting_entry_contents VALUES (?,?,?,?)')
        .run('synthetic-character', 'setting-entry', 'revision-1', JSON.stringify(snakeEntry))
      database.prepare('INSERT INTO setting_library_entry_links VALUES (?,?,0,?)')
        .run('synthetic-character', 'setting-entry', 'revision-1')
      database.prepare('INSERT INTO setting_library_version_entry_links VALUES (?,?,?,0,?)')
        .run('synthetic-character', 'setting-version', 'setting-entry', 'revision-1')

      database.prepare(`INSERT INTO chat_sessions(
        id,title,characterId,characterName,characterAvatar,historyMessageCount,
        historyUserMessageCount,createdAt,updatedAt
      ) VALUES (?,'合成会话','synthetic-character','合成角色','',0,0,?,?)`)
        .run('synthetic-session', timestamp, timestamp)
      database.prepare('INSERT INTO conversation_setting_changes VALUES (?,?,?,?,?,?)').run(
        'synthetic-session', 'entry', 'conversation-entry', 'upsert', JSON.stringify(conversationEntry), timestamp
      )

      database.prepare(`INSERT INTO agent_presets(
        id,name,modelFamily,modelTagsJson,libraryGroupId,activeVersionId,authorName,
        authorAvatarPath,sortIndex,expandedGroupIdsJson
      ) VALUES (?,'合成预设','general','[]','',?,'','',0,'[]')`).run('synthetic-preset', 'preset-version')
      database.prepare(`INSERT INTO agent_preset_versions(
        presetId,versionId,versionNumber,name,createdAtEpochMs,expandedGroupIdsJson
      ) VALUES (?,?,1,'合成版本',1,'[]')`).run('synthetic-preset', 'preset-version')
      database.prepare('INSERT INTO agent_preset_state VALUES (1,?)').run('synthetic-preset')
      database.prepare('INSERT INTO agent_preset_entries VALUES (?,?,0,?)')
        .run('synthetic-preset', 'preset-entry', JSON.stringify(presetEntry))
      database.prepare('INSERT INTO agent_preset_entries VALUES (?,?,1,?)')
        .run('synthetic-preset', 'built-in-hidden-tool-timeline', JSON.stringify(hiddenEntry))
      database.prepare('INSERT INTO agent_preset_version_entries VALUES (?,?,?,0,?)')
        .run('synthetic-preset', 'preset-version', 'preset-version-entry', JSON.stringify(presetVersionEntry))
      database.prepare('INSERT INTO agent_preset_version_entries VALUES (?,?,?,1,?)')
        .run('synthetic-preset', 'preset-version', 'built-in-hidden-tool-timeline', JSON.stringify(hiddenEntry))
      database.prepare('INSERT INTO agent_preset_contents VALUES (?,?,?)').run(
        'synthetic-preset', 'prompt_positions', JSON.stringify([{
          id: 'preset-position', name: '位置三', anchor: 'after_history', order: 1,
          createdAt: timestamp, updatedAt: timestamp
        }])
      )
      database.prepare('INSERT INTO agent_preset_contents VALUES (?,?,?)')
        .run('synthetic-preset', 'tool_configuration', toolConfiguration)
      database.prepare('INSERT INTO agent_preset_version_contents VALUES (?,?,?,?)').run(
        'synthetic-preset', 'preset-version', 'prompt_positions', JSON.stringify([{
          id: 'preset-version-position', name: '位置四', anchor: 'before_tool_flow', order: 1,
          createdAt: timestamp, updatedAt: timestamp
        }])
      )
      database.prepare('INSERT INTO agent_preset_version_contents VALUES (?,?,?,?)')
        .run('synthetic-preset', 'preset-version', 'tool_configuration', toolConfiguration)

      database.prepare('INSERT INTO agent_conversations VALUES (?,?,?)').run('synthetic-session', '', 'synthetic-session')
      const snapshot = JSON.stringify([{
        targetType: 'entry', targetId: 'snapshot-entry', operation: 'upsert',
        payloadJson: JSON.stringify(snapshotEntry), updatedAt: timestamp
      }])
      database.prepare(`INSERT INTO agent_content_parts(
        conversationId,ownerType,ownerId,partIndex,kind,text,payloadJson,chunkIndex
      ) VALUES (?,'turn','synthetic-owner',1,'setting_library_state','',?,0)`)
        .run('synthetic-session', snapshot)
    } finally {
      database.close()
    }

    const reopened = new SqliteDatabase(path)
    reopened.open()
    try {
      expect(reopened.native.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(reopened.native.prepare("SELECT name FROM sqlite_master WHERE name='desktop_schema'").get()).toBeUndefined()

      const library = new SettingLibraryRepository(reopened).get('synthetic-character')
      expect(library.entries[0]?.position).toBe('insert_point_1')
      expect(library.promptPositions).toEqual([expect.objectContaining({ anchor: 'insert_point_2', side: 'before_setting_position' })])
      expect(library.versions[0]?.promptPositions).toEqual([
        expect.objectContaining({ anchor: 'insert_point_4', side: 'before_setting_position' })
      ])

      const preset = new AgentPresetRepository(reopened).get('synthetic-preset')
      expect(preset.entries.find((entry) => entry.id === 'preset-entry')?.position).toBe('insert_point_3')
      expect(preset.entries.find((entry) => entry.id === 'built-in-hidden-tool-timeline')).toMatchObject({
        position: 'insert_point_5', promptPositionId: 'hidden-tool-timeline'
      })
      expect(preset.promptPositions).toContainEqual(expect.objectContaining({
        id: 'preset-position', anchor: 'insert_point_3', side: 'before_setting_position'
      }))
      expect(preset.promptPositions).toContainEqual(expect.objectContaining({
        id: 'hidden-tool-timeline', anchor: 'insert_point_5', side: 'after_setting_position'
      }))

      const conversation = reopened.native.prepare(`SELECT payloadJson FROM conversation_setting_changes
        WHERE sessionId='synthetic-session' AND targetType='entry'`).get() as { payloadJson: string }
      expect(settingLibraryEntrySchema.parse(JSON.parse(conversation.payloadJson)).position).toBe('insert_point_3')
      const snapshotRow = reopened.native.prepare(`SELECT stateJson FROM agent_setting_snapshots
        WHERE ownerId='synthetic-owner'`).get() as { stateJson: string }
      const snapshotValue = JSON.parse(snapshotRow.stateJson) as Array<{ payloadJson: string }>
      expect(settingLibraryEntrySchema.parse(JSON.parse(snapshotValue[0]!.payloadJson)).position).toBe('insert_point_4')

      const storedVersionEntry = reopened.native.prepare(`SELECT payloadJson FROM agent_preset_version_entries
        WHERE entryId='preset-version-entry'`).get() as { payloadJson: string }
      expect(settingLibraryEntrySchema.parse(JSON.parse(storedVersionEntry.payloadJson)).position).toBe('insert_point_5')
      const storedVersionPositions = reopened.native.prepare(`SELECT content FROM agent_preset_version_contents
        WHERE kind='prompt_positions'`).get() as { content: string }
      expect((JSON.parse(storedVersionPositions.content) as unknown[]).map((item) => settingLibraryPromptPositionSchema.parse(item)))
        .toContainEqual(expect.objectContaining({ anchor: 'insert_point_4', side: 'after_setting_position' }))
      expect(reopened.native.pragma('foreign_key_check')).toEqual([])
      expect(reopened.native.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      reopened.close()
    }

    const secondReopen = new SqliteDatabase(path)
    secondReopen.open()
    try {
      expect(secondReopen.native.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(new AgentPresetRepository(secondReopen).get('synthetic-preset').entries)
        .toContainEqual(expect.objectContaining({ id: 'preset-entry', position: 'insert_point_3' }))
    } finally {
      secondReopen.close()
    }
  }, 15_000)

  it('keeps a v2 file unchanged when the placement migration encounters damaged JSON', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-v2-placement-rollback-'))
    directories.push(directory)
    const path = join(directory, 'eleckoi.sqlite3')
    let database = new Database(path)
    try {
      database.exec(schemaV7Sql)
      database.exec(legacyContentSql)
      registerDesktopV2(database)
      insertSyntheticCharacter(database)
      database.prepare(`INSERT INTO setting_libraries(
        characterId,name,activeVersionId,listAllExpanded,expandedGroupIdsJson,promptPositionsJson,updatedAt
      ) VALUES (?,'合成设定','version-1',1,'[]','{','2026-01-01T00:00:00.000Z')`)
        .run('synthetic-character')
      const oldEntry = JSON.parse(writeEntry({
        ...emptyEntry('setting-entry', '2026-01-01T00:00:00.000Z'),
        position: 'insert_point_1'
      })) as Record<string, unknown>
      oldEntry.position = 'after_instructions'
      database.prepare('INSERT INTO setting_entry_contents VALUES (?,?,?,?)')
        .run('synthetic-character', 'setting-entry', 'revision-1', JSON.stringify(oldEntry))
    } finally {
      database.close()
    }

    database = new Database(path)
    try {
      expect(() => installSchema(database)).toThrow('数据库 JSON 已损坏')
    } finally {
      database.close()
    }

    database = new Database(path)
    try {
      expect(database.pragma('user_version', { simple: true })).toBe(2)
      const row = database.prepare('SELECT payloadJson FROM setting_entry_contents').get() as { payloadJson: string }
      expect((JSON.parse(row.payloadJson) as Record<string, unknown>).position).toBe('after_instructions')
      expect(database.prepare('SELECT baseline FROM desktop_schema WHERE id=1').get()).toEqual({ baseline: BASELINE_ID })
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      database.close()
    }
  }, 15_000)

  it('updates only the changed character text and keeps user identity separate', () => {
    const { database, characters, conversations, media } = harness()
    const a = card(), b = card('card-b')
    characters.replaceAll({ active_character_id: a.id, groups: [], items: [a, b] })
    database.native.exec(`CREATE TEMP TABLE writes(kind TEXT,card TEXT);
      CREATE TEMP TRIGGER watch_text AFTER UPDATE ON character_text_contents BEGIN INSERT INTO writes VALUES (new.kind,new.characterId); END;
      CREATE TEMP TRIGGER watch_card AFTER UPDATE ON characters BEGIN INSERT INTO writes VALUES ('card',new.id); END;`)
    const current = characters.get()
    const changed = current.items.map((item) => item.id === a.id ? { ...item, persona: { ...(item.persona as object), opening: 'changed' } } : item)
    characters.replaceAll({ ...current, items: changed })
    expect(database.native.prepare('SELECT * FROM writes').all()).toEqual([{ kind: 'opening', card: a.id }])
    database.native.exec('DELETE FROM writes')
    characters.replaceAll(characters.get())
    expect(database.native.prepare('SELECT * FROM writes').all()).toEqual([])
    const profiles = new PersonaRepository(database, conversations, media)
    profiles.save({ ...profiles.get(), user_name: '用户' })
    expect(profiles.get().user_name).toBe('用户')
  })

  it('updates one character without deleting records created after an editor loaded', () => {
    const { characters } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card(), card('card-b')] })
    const staleCharacter = characters.get().items.find((item) => item.id === 'card-a')!

    characters.create(card('card-c'))
    characters.update({ ...staleCharacter, name: '只更新 A' })

    const saved = characters.get()
    expect(saved.items.map((item) => item.id)).toEqual(['card-a', 'card-b', 'card-c'])
    expect(saved.items.find((item) => item.id === 'card-a')?.name).toBe('只更新 A')
  })

  it('stores ordered replies by different speakers and rejects a cross-conversation turn', () => {
    const { conversations, messages, database } = harness()
    const a = conversations.create({}).conversation.id, b = conversations.create({}).conversation.id
    const user = messages.create(a, 'user', '原文', 'complete')
    messages.createResponse(a, user.turnId!, '旁白原文', 'complete', { id: 'narrator', name: '旁白', avatar: '', kind: 'narrator' })
    messages.createResponse(a, user.turnId!, '人物原文', 'complete', { id: 'member', name: '人物', avatar: '', kind: 'card_character' })
    expect(messages.list(a).map((message) => message.content)).toEqual(['原文', '旁白原文', '人物原文'])
    expect(messages.list(a).slice(1).map((message) => message.responseIndex)).toEqual([0, 1])
    expect(() => messages.createResponse(b, user.turnId!, 'wrong', 'complete', { id: 'member', name: '', avatar: '', kind: 'card_character' })).toThrow('活动分支')
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('binds an active historical reply to its exact DSH turn without changing message text', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    messages.create(conversationId, 'user', '当前输入', 'complete')
    const reply = messages.create(conversationId, 'assistant', '当前回复', 'complete', undefined, 'runtime-a')

    expect(messages.unboundActiveResponses()).toEqual([{
      conversationId, messageId: reply.id, runtimeThreadId: 'runtime-a'
    }])
    messages.bindHistoricalDshTurn(conversationId, reply.id, 'runtime-a', 3)
    expect(messages.unboundActiveResponses()).toEqual([])
    expect(database.native.prepare('SELECT dshTurn FROM agent_responses WHERE id=?').get(reply.id))
      .toEqual({ dshTurn: 3 })
    expect(messages.list(conversationId).map((message) => message.content)).toEqual(['当前输入', '当前回复'])
  })

  it('reads bound conversation text from the DSH turn after duplicate content is removed', () => {
    const { conversations, messages } = harness()
    const conversationId = conversations.create({}).conversation.id
    const user = messages.create(conversationId, 'user', '当前输入', 'complete')
    const reply = messages.create(conversationId, 'assistant', '当前回复', 'complete', undefined, 'runtime-a')
    messages.bindHistoricalDshTurn(conversationId, reply.id, 'runtime-a', 3)
    const calls: string[] = []
    const detach = messages.attachTranscriptReader((runtimeThreadId) => {
      calls.push(runtimeThreadId)
      return [{ turn: 3, completed: true, userSeq: 1, userText: '当前输入', userImages: [{
        attachmentId: 'sha256:synthetic', mediaType: 'image/png', bytes: 128, width: 16, height: 8
      }], assistantText: '当前回复', process: [] }]
    })
    try {
      expect(messages.list(conversationId).map((message) => message.content)).toEqual(['当前输入', '当前回复'])
      expect(messages.get(conversationId, user.id).content).toBe('当前输入')
      expect(messages.get(conversationId, user.id).inputImageAttachments?.[0]?.attachmentId).toBe('sha256:synthetic')
      expect(messages.findInputImage(conversationId, 'sha256:synthetic').width).toBe(16)
      expect(messages.listInputImageReferences()).toContainEqual({ conversationId, attachmentId: 'sha256:synthetic' })
      expect(messages.get(conversationId, reply.id).content).toBe('当前回复')
      expect(calls.every((id) => id === 'runtime-a')).toBe(true)
    } finally {
      detach()
    }
    expect(messages.get(conversationId, reply.id).content).toBe('当前回复')
  })

  it('removes a completed image reference from SQLite after the DSH log confirms it', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    const image = { attachmentId: 'sha256:synthetic-image', mediaType: 'image/png' as const,
      bytes: 128, width: 16, height: 8 }
    const user = messages.create(conversationId, 'user', '图片', 'complete', undefined, '', [image])
    const reply = messages.create(conversationId, 'assistant', '', 'streaming', undefined, 'runtime-image')
    messages.bindDshTurn(conversationId, reply.id, 'runtime-image', 1)
    const detach = messages.attachTranscriptReader(() => [{
      turn: 1, completed: true, userSeq: 1, userText: '图片', userImages: [image], assistantText: '收到', process: []
    }])
    try {
      messages.finish(reply.id, '收到', 'complete')
      expect(database.native.prepare("SELECT name FROM sqlite_master WHERE name='agent_content_parts'").get())
        .toBeUndefined()
      expect(messages.get(conversationId, reply.id).content).toBe('收到')
      expect(messages.get(conversationId, user.id).inputImageAttachments).toEqual([image])
      expect(messages.findInputImage(conversationId, image.attachmentId)).toEqual(image)
      expect(database.native.prepare('SELECT turnId FROM agent_pending_inputs WHERE turnId=?').get(user.id))
        .toBeUndefined()
    } finally { detach() }
  })

  it('restores an uploaded file and image on a failed input after restarting', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    const image = { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png' as const,
      bytes: 128, width: 16, height: 8 }
    const pendingFile = { attachmentId: 'draft:file', name: 'notes.txt', bytes: 12 }
    const uploadedFile = { ...pendingFile, attachmentId: `sha256:${'b'.repeat(64)}` }
    const user = messages.create(conversationId, 'user', '', 'complete', undefined, '', [image], [pendingFile])
    const reply = messages.create(conversationId, 'assistant', '', 'streaming', undefined, conversationId)
    messages.recordUploadedFile(reply.id, pendingFile.attachmentId, uploadedFile)
    messages.finish(reply.id, '', 'error')

    database.close()
    database.open()
    const restored = new MessageRepository(database)
    expect(restored.get(conversationId, user.id)).toMatchObject({
      content: '', inputImageAttachments: [image], inputFileAttachments: [uploadedFile]
    })
    expect(restored.listInputFileReferences()).toContainEqual({ conversationId, file: uploadedFile })
    expect(restored.findInputFile(conversationId, uploadedFile.attachmentId, uploadedFile.name)).toEqual(uploadedFile)
    expect(restored.findInputImage(conversationId, image.attachmentId)).toEqual(image)
    restored.deleteFrom(conversationId, user.id)
    expect(database.native.prepare('SELECT turnId FROM agent_pending_inputs WHERE turnId=?').get(user.id))
      .toBeUndefined()
  }, 20_000)

  it('recovers a cancelled file message already recorded in the DSH Session after restart', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    const sessionId = 'runtime-synthetic'
    for (let turn = 1; turn <= 2; turn += 1) {
      messages.create(conversationId, 'user', `input-${turn}`, 'complete')
      const reply = messages.create(conversationId, 'assistant', `reply-${turn}`, 'complete', undefined, sessionId)
      messages.bindHistoricalDshTurn(conversationId, reply.id, sessionId, turn)
    }
    const user = messages.create(conversationId, 'user', '', 'complete')
    const reply = messages.create(conversationId, 'assistant', '', 'streaming', undefined, sessionId)
    messages.finish(reply.id, '', 'cancelled')
    database.native.prepare('DELETE FROM agent_pending_inputs WHERE turnId=?').run(user.id)
    database.close()
    database.open()

    const restored = new MessageRepository(database)
    expect(restored.get(conversationId, user.id).inputFileAttachments).toBeUndefined()
    const file = { attachmentId: `sha256:${'c'.repeat(64)}`, name: 'sample.txt', bytes: 12 }
    const detach = restored.attachTranscriptReader(() => [1, 2, 3].map((turn) => ({
      turn, startSeq: turn * 10, userSeq: turn * 10 + 1, userMessageId: `user-${turn}`,
      userText: turn === 3 ? '' : `input-${turn}`, userImages: [], userFiles: turn === 3 ? [file] : [],
      assistantSeq: turn === 3 ? null : turn * 10 + 2,
      assistantMessageId: turn === 3 ? null : `assistant-${turn}`,
      assistantText: turn === 3 ? '' : `reply-${turn}`, process: [], completed: true
    })))
    try {
      restored.reconcileUnboundActiveResponses(sessionId)
      expect(database.native.prepare('SELECT dshTurn FROM agent_responses WHERE id=?').get(reply.id))
        .toEqual({ dshTurn: 3 })
      expect(restored.get(conversationId, user.id).inputFileAttachments).toEqual([file])
      expect(restored.listInputFileReferences()).toContainEqual({ conversationId, file })
    } finally { detach() }
  }, 20_000)

  it('projects a completed reply through its saved display rule without keeping another text copy', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    const user = messages.create(conversationId, 'user', '问题', 'complete')
    const reply = messages.create(conversationId, 'assistant', '', 'streaming', undefined, 'runtime-regex')
    messages.bindDshTurn(conversationId, reply.id, 'runtime-regex', 1)
    const detach = messages.attachTranscriptReader(() => [{
      turn: 1, completed: true, userSeq: 1, userText: '问题', userImages: [], assistantText: '原文', process: []
    }])
    try {
      messages.finish(reply.id, '显示文本', 'complete', undefined, undefined, [{
        id: 'display-rule', name: 'display', pattern: '原文', replacement: '显示文本',
        targets: ['AiOutput'], enabled: true, displayOnly: false, promptOnly: false,
        runOnEdit: false, order: 0
      }])
      expect(messages.get(conversationId, user.id).content).toBe('问题')
      expect(messages.get(conversationId, reply.id).content).toBe('显示文本')
      expect(database.native.prepare("SELECT name FROM sqlite_master WHERE name='agent_content_parts'").get())
        .toBeUndefined()
    } finally { detach() }
  })

  it('pages turns without gaps or repeated messages', () => {
    const { conversations, messages } = harness()
    const id = conversations.create({}).conversation.id
    for (let i = 0; i < 125; i++) { messages.create(id, 'user', String(i), 'complete'); messages.create(id, 'assistant', 'reply '+i, 'complete') }
    let cursor: number | undefined
    const seen: string[] = []
    const seenFloors: number[] = []
    do {
      const page = messages.page(id, cursor, 40)
      seen.unshift(...page.messages.map((message) => message.content))
      seenFloors.unshift(...page.messages.map((message) => message.messageIndex!))
      if (!page.hasMore) break
      cursor = page.beforeSequence!
    } while (true)
    expect(seen).toHaveLength(250)
    expect(seenFloors).toEqual(Array.from({ length: 250 }, (_, index) => index))
    expect(seen[0]).toBe('0')
    expect(seen.at(-1)).toBe('reply 124')
    expect(() => messages.page(id, -1)).toThrow('游标')
    expect(() => messages.page(id, undefined, 201)).toThrow('轮次数')
  })

  it('keeps a terminal reply immutable when a late checkpoint or duplicate completion arrives', () => {
    const { conversations, messages } = harness()
    const id = conversations.create({}).conversation.id
    messages.create(id, 'user', 'input', 'complete')
    const reply = messages.create(id, 'assistant', '', 'streaming')
    messages.finish(reply.id, 'final', 'complete')
    messages.appendCheckpoint(reply.id, 'late delta')
    expect(messages.finish(reply.id, 'late failure', 'error')).toMatchObject({ content: 'final', status: 'complete' })
  })

  it('projects the variable snapshot stored on each message instead of the latest conversation state', () => {
    const { conversations, messages, database } = harness()
    const id = conversations.create({}).conversation.id
    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"step":1}', id)
    const first = messages.create(id, 'user', 'one', 'complete')
    const reply = messages.create(id, 'assistant', '', 'streaming')
    messages.finish(reply.id, 'answer', 'complete', undefined, '{"step":2}')
    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"step":99}', id)

    expect(messages.get(id, first.id).variableStateJson).toBe('{"step":1}')
    expect(messages.get(id, reply.id).variableStateJson).toBe('{"step":2}')
    expect(messages.list(id).map((message) => message.variableStateJson)).toEqual(['{"step":1}', '{"step":2}'])
  })

  it('enforces deferred active variable versions and cascades the whole card-owned version tree', () => {
    const { characters, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card(), card('card-b')] })
    database.withWriteTx(() => {
      database.native.exec(`INSERT INTO variable_configs VALUES ('card-a','v1','now',0);
        INSERT INTO variable_config_versions VALUES ('card-a','v1',0,'version','[]','now','now');
        INSERT INTO variable_config_version_contents VALUES ('card-a','v1','schema','{}');
        INSERT INTO variable_config_objects VALUES ('card-a','v1','object',0,'{}');
        INSERT INTO variable_config_variables VALUES ('card-a','v1','variable',0,'{}');`)
    })
    expect(() => database.withWriteTx(() => database.native.exec("UPDATE variable_configs SET activeVersionId='missing' WHERE characterId='card-a'"))).toThrow('FOREIGN KEY')
    expect(database.native.prepare('SELECT activeVersionId FROM variable_configs').get()).toEqual({ activeVersionId: 'v1' })
    expect(() => database.native.exec("INSERT INTO variable_config_version_contents VALUES ('card-b','v1','schema','{}')")).toThrow('FOREIGN KEY')
    characters.delete(['card-a'])
    for (const table of ['variable_configs', 'variable_config_versions', 'variable_config_version_contents', 'variable_config_objects', 'variable_config_variables']) {
      expect(database.native.prepare(`SELECT * FROM ${table}`).all()).toEqual([])
    }
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('shares setting content between current and saved links without mixing their revisions', () => {
    const { characters, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    database.withWriteTx(() => database.native.exec(`
      INSERT INTO setting_libraries VALUES ('card-a','library','saved',1,'[]','{}','now');
      INSERT INTO setting_entry_contents VALUES ('card-a','entry','rev-old','{"text":"old"}');
      INSERT INTO setting_library_entry_links VALUES ('card-a','entry',0,'rev-old');
      INSERT INTO setting_library_versions VALUES ('card-a','saved',0,'saved',1,'[]','{}','now','now');
      INSERT INTO setting_library_version_entry_links VALUES ('card-a','saved','entry',0,'rev-old');`))
    database.withWriteTx(() => database.native.exec(`
      INSERT INTO setting_entry_contents VALUES ('card-a','entry','rev-new','{"text":"new"}');
      UPDATE setting_library_entry_links SET revisionId='rev-new';`))
    expect(database.native.prepare('SELECT payloadJson FROM setting_library_entries').get()).toEqual({ payloadJson: '{"text":"new"}' })
    expect(database.native.prepare('SELECT payloadJson FROM setting_library_version_entries').get()).toEqual({ payloadJson: '{"text":"old"}' })
    expect(() => database.native.exec("DELETE FROM setting_entry_contents WHERE revisionId='rev-old'")).toThrow('FOREIGN KEY')
    characters.delete(['card-a'])
    expect(database.native.prepare('SELECT * FROM setting_entry_contents').all()).toEqual([])
    expect(database.native.prepare('SELECT * FROM setting_library_version_entries').all()).toEqual([])
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('creates and persists the current setting-library tree without a second schema', () => {
    const { characters, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const repository = new SettingLibraryRepository(database)
    const empty = repository.get('card-a')
    expect(empty.entries.map((entry) => entry.id)).toEqual(['fixed-opening-assistant'])
    expect(repository.primaryOpening('card-a')).toBe('')

    const timestamp = new Date().toISOString()
    const group = { id: 'world', name: '世界', parentId: '', order: 1, treeViewOrder: 1, createdAt: timestamp, updatedAt: timestamp }
    const entry = {
      id: 'capital', title: '王都', iconId: '', kind: 'normal' as const, groupId: group.id, content: '群山之间的城市。',
      openingMessages: [], defaultOpeningMessageId: '', agentSelectionHint: '', agentReadStrategy: 'normal' as const,
      dynamicMode: 'standard' as const, contentMode: 'plain_text' as const, keywords: [], keywordScanDepth: 1,
      conditionKeywords: [], keywordCondition: 'none' as const, keywordUseRegex: false, keywordIgnoreCase: true,
      keywordWholeWord: false, keywordRecursionDepth: 0, triggerMode: 'always' as const, enabled: true,
      position: 'insert_point_3' as const, promptPositionId: '', insertRole: 'user' as const, order: 1,
      viewOrder: 0, groupViewOrder: 0, treeViewOrder: 1, createdAt: timestamp, updatedAt: timestamp
    }
    const opening = {
      ...empty.entries.find((candidate) => candidate.id === 'fixed-opening-assistant')!,
      content: '主开场',
      openingMessages: [
        { id: 'opening-main', title: '初次见面', content: '主开场', initialVariableStateJson: '{"好感":0}' },
        { id: 'opening-backup', title: '再次见面', content: '备用开场', initialVariableStateJson: '{"好感":10}' }
      ],
      defaultOpeningMessageId: 'opening-main'
    }
    const reference = {
      ...entry,
      id: 'reference-capital',
      title: '王都资料',
      content: '供 EJS 控制器读取。',
      agentReadStrategy: 'normal' as const,
      dynamicMode: 'ejs_reference' as const,
      triggerMode: 'agent_tool' as const,
      enabled: true,
      treeViewOrder: 2
    }
    const saved = repository.save('card-a', {
      ...empty,
      groups: [group],
      entries: [opening, entry, reference]
    })
    expect(saved.groups).toEqual([expect.objectContaining({ id: 'world', name: '世界' })])
    expect(saved.entries).toContainEqual(expect.objectContaining({
      id: 'capital',
      groupId: 'world',
      content: '群山之间的城市。',
      position: 'insert_point_3'
    }))
    expect(saved.entries.find((candidate) => candidate.id === 'fixed-opening-assistant')).toMatchObject({
      content: '主开场',
      defaultOpeningMessageId: 'opening-main',
      openingMessages: [
        expect.objectContaining({ id: 'opening-main', content: '主开场' }),
        expect.objectContaining({ id: 'opening-backup', content: '备用开场' })
      ]
    })
    expect(repository.primaryOpening('card-a')).toBe('主开场')
    expect(saved.entries).toContainEqual(expect.objectContaining({
      id: 'reference-capital',
      agentReadStrategy: 'normal',
      dynamicMode: 'ejs_reference',
      triggerMode: 'agent_tool'
    }))
    expect(database.native.prepare('SELECT COUNT(*) AS count FROM setting_library_entries WHERE characterId = ?').get('card-a')).toEqual({ count: 3 })
    expect(database.native.prepare('SELECT COUNT(*) AS count FROM setting_library_version_entries WHERE characterId = ?').get('card-a')).toEqual({ count: 3 })
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('reloads current author settings in an existing conversation and stores only real Agent mutations', () => {
    const { characters, conversations, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const settingLibraries = new SettingLibraryRepository(database)
    const empty = settingLibraries.get('card-a')
    const timestamp = new Date().toISOString()
    const entry = {
      id: 'identity', title: '身份', iconId: '', kind: 'normal' as const, groupId: '',
      content: '你是{{char}}，我是{{user}}', openingMessages: [], defaultOpeningMessageId: '',
      agentSelectionHint: '', agentReadStrategy: 'required' as const,
      dynamicMode: 'standard' as const, contentMode: 'plain_text' as const, keywords: [], keywordScanDepth: 1,
      conditionKeywords: [], keywordCondition: 'none' as const, keywordUseRegex: false,
      keywordIgnoreCase: true, keywordWholeWord: false, keywordRecursionDepth: 0,
      triggerMode: 'agent_tool' as const, enabled: true, position: 'insert_point_1' as const,
      promptPositionId: '', insertRole: 'user' as const, order: 1, viewOrder: 1,
      groupViewOrder: 0, treeViewOrder: 1, createdAt: timestamp, updatedAt: timestamp
    }
    settingLibraries.save('card-a', { ...empty, entries: [...empty.entries, entry] })
    const conversationId = conversations.create({ metadata: { characterId: 'card-a' } }).conversation.id
    const binding = conversations.getCharacterBinding(conversationId)
    const source = settingLibraries.runtimeContext(conversationId, binding)!
    const projected = structuredClone(source)
    projected.entries = projected.entries.map((candidate) => candidate.id === entry.id
      ? { ...candidate, content: '你是card-a，我是旧名字' }
      : candidate)

    expect(settingLibraries.runtimeContext(conversationId, binding)?.entries.find((candidate) => candidate.id === entry.id)?.content)
      .toBe('你是{{char}}，我是{{user}}')

    settingLibraries.replaceConversationRuntimeState(
      conversationId,
      JSON.stringify(projected),
      binding,
      { source, projected }
    )
    expect(database.native.prepare('SELECT COUNT(*) AS count FROM conversation_setting_changes WHERE sessionId=?')
      .get(conversationId)).toEqual({ count: 0 })

    const latest = settingLibraries.get('card-a')
    settingLibraries.save('card-a', {
      ...latest,
      entries: latest.entries.map((candidate) => candidate.id === entry.id
        ? { ...candidate, content: '最新设定：{{user}}' }
        : candidate)
    })
    const latestSource = settingLibraries.runtimeContext(conversationId, binding)!
    expect(latestSource.entries.find((candidate) => candidate.id === entry.id)?.content)
      .toBe('最新设定：{{user}}')

    const latestProjected = structuredClone(latestSource)
    latestProjected.entries = latestProjected.entries.map((candidate) => candidate.id === entry.id
      ? { ...candidate, content: '最新设定：测试角色' }
      : candidate)
    const agentResult = structuredClone(latestProjected)
    agentResult.entries = agentResult.entries.map((candidate) => candidate.id === entry.id
      ? { ...candidate, content: '会话专属改写' }
      : candidate)
    settingLibraries.replaceConversationRuntimeState(
      conversationId,
      JSON.stringify(agentResult),
      binding,
      { source: latestSource, projected: latestProjected }
    )

    expect(settingLibraries.runtimeContext(conversationId, binding)?.entries.find((candidate) => candidate.id === entry.id)?.content)
      .toBe('会话专属改写')
    const persisted = database.native.prepare(`SELECT payloadJson FROM conversation_setting_changes
      WHERE sessionId=? AND targetType='entry' AND targetId=?`).get(conversationId, entry.id) as { payloadJson: string }
    expect(JSON.parse(persisted.payloadJson)).toMatchObject({ id: entry.id, content: '会话专属改写' })
  })


  it('manages conversation setting overlays without changing the author library', () => {
    const { characters, conversations, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const settingLibraries = new SettingLibraryRepository(database)
    const base = settingLibraries.get('card-a')
    const timestamp = new Date().toISOString()
    const entry = {
      id: 'agent-memory', title: '对话记忆', iconId: '', kind: 'normal' as const, groupId: '',
      content: '母设定', openingMessages: [], defaultOpeningMessageId: '', agentSelectionHint: '需要时读取',
      agentReadStrategy: 'normal' as const, dynamicMode: 'standard' as const, contentMode: 'plain_text' as const,
      keywords: [], keywordScanDepth: 1, conditionKeywords: [], keywordCondition: 'none' as const,
      keywordUseRegex: false, keywordIgnoreCase: true, keywordWholeWord: false, keywordRecursionDepth: 0,
      triggerMode: 'agent_tool' as const, enabled: true, position: null, promptPositionId: '',
      insertRole: 'user' as const, order: 1, viewOrder: 1, groupViewOrder: 0, treeViewOrder: 1,
      createdAt: timestamp, updatedAt: timestamp
    }
    settingLibraries.save('card-a', { ...base, entries: [...base.entries, entry] })
    const conversationId = conversations.create({ metadata: { characterId: 'card-a' } }).conversation.id
    expect(settingLibraries.conversationLibrary('card-a', conversationId)).toBeUndefined()

    const authorLibrary = settingLibraries.get('card-a')
    const effective = settingLibraries.replaceConversationLibrary('card-a', conversationId, {
      ...authorLibrary,
      entries: authorLibrary.entries.map((candidate) => candidate.id === entry.id
        ? { ...candidate, content: '只属于当前对话', updatedAt: new Date().toISOString() }
        : candidate)
    })

    expect(effective.versions).toEqual([])
    expect(effective.entries.find((candidate) => candidate.id === entry.id)?.content).toBe('只属于当前对话')
    expect(settingLibraries.get('card-a').entries.find((candidate) => candidate.id === entry.id)?.content).toBe('母设定')
    expect(settingLibraries.conversationLibrary('card-a', conversationId)?.entries.find((candidate) => candidate.id === entry.id)?.content)
      .toBe('只属于当前对话')

    const configured = settingLibraries.replaceConversationLibrary('card-a', conversationId, {
      ...effective,
      entries: effective.entries.map(candidate => candidate.id === entry.id ? {
        ...candidate, agentReadStrategy: 'keyword', contentMode: 'ejs', keywords: ['茶'],
        keywordScanDepth: 3, conditionKeywords: ['雨'], keywordCondition: 'any',
        agentSelectionHint: '到茶馆时读取', enabled: true
      } : candidate)
    })
    expect(configured.entries.find(candidate => candidate.id === entry.id)).toMatchObject({
      agentReadStrategy: 'keyword', contentMode: 'ejs', keywords: ['茶'], keywordScanDepth: 3,
      conditionKeywords: ['雨'], keywordCondition: 'any'
    })
    expect(settingLibraries.get('card-a').entries.find(candidate => candidate.id === entry.id)?.agentReadStrategy).toBe('normal')

    const withVersion = settingLibraries.saveConversationAsVersion('card-a', conversationId, '第一段对话')
    expect(withVersion.versions.find((version) => version.name === '第一段对话')?.entries
      .find((candidate) => candidate.id === entry.id)?.content).toBe('只属于当前对话')
    expect(() => settingLibraries.replaceConversationLibrary('card-a', conversationId, {
      ...effective,
      entries: effective.entries.map((candidate) => candidate.id === 'fixed-opening-assistant'
        ? { ...candidate, content: '越权修改' }
        : candidate)
    })).toThrow('只允许查看')

    settingLibraries.deleteConversationChanges('card-a', conversationId)
    expect(settingLibraries.conversationLibrary('card-a', conversationId)).toBeUndefined()
    expect(settingLibraries.get('card-a').entries.find((candidate) => candidate.id === entry.id)?.content).toBe('母设定')
  })

  it('creates a story conversation with the saved primary opening as its first assistant message', () => {
    const { characters, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const settingLibraries = new SettingLibraryRepository(database)
    const variables = new VariableConfigRepository(database)
    const library = settingLibraries.get('card-a')
    const opening = library.entries.find((entry) => entry.id === 'fixed-opening-assistant')!
    settingLibraries.save('card-a', {
      ...library,
      entries: library.entries.map((entry) => entry.id === opening.id ? {
        ...opening,
        content: '<FINAL>保存后的开场白</FINAL>',
        openingMessages: [{
          id: 'opening-primary',
          title: '默认开场',
          content: '<FINAL>保存后的开场白</FINAL>',
          initialVariableStateJson: '{"好感":10}'
        }],
        defaultOpeningMessageId: 'opening-primary'
      } : entry)
    })
    const conversations = new ConversationRepository(database, (characterId, db) => (
      resolveConversationSeed(characterId, db, settingLibraries, variables)
    ))
    const messages = new MessageRepository(database)

    const created = conversations.create({ metadata: { characterId: 'card-a' } })

    expect(messages.list(created.conversation.id)).toEqual([
      expect.objectContaining({ id: 'opening', role: 'assistant', content: '<FINAL>保存后的开场白</FINAL>', status: 'complete' })
    ])
    expect(conversations.list()[0]?.conversation.preview).toBe('保存后的开场白')
    expect(database.native.prepare("SELECT kind,stateJson FROM chat_session_variable_states WHERE sessionId=? ORDER BY kind")
      .all(created.conversation.id)).toEqual([
      { kind: 'current', stateJson: '{"好感":10}' },
      { kind: 'initial', stateJson: '{"好感":10}' }
    ])
    expect(database.native.prepare('SELECT historyMessageCount FROM chat_sessions WHERE id=?')
      .get(created.conversation.id)).toEqual({ historyMessageCount: 1 })
  })

  it('stores opening choices and edits only in the conversation snapshot', () => {
    const { characters, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const settingLibraries = new SettingLibraryRepository(database)
    const variables = new VariableConfigRepository(database)
    const library = settingLibraries.get('card-a')
    settingLibraries.save('card-a', {
      ...library,
      entries: library.entries.map((entry) => entry.id === 'fixed-opening-assistant' ? {
        ...entry,
        content: '主开场',
        openingMessages: [
          { id: 'primary', title: '主开场', content: '主开场', initialVariableStateJson: '{"好感":1}' },
          { id: 'backup', title: '备用', content: '备用开场', initialVariableStateJson: '{"好感":2}' }
        ],
        defaultOpeningMessageId: 'primary'
      } : entry)
    })
    const conversations = new ConversationRepository(database, (characterId, db) => (
      resolveConversationSeed(characterId, db, settingLibraries, variables)
    ))
    const messages = new MessageRepository(database)
    const conversationId = conversations.create({ metadata: { characterId: 'card-a' } }).conversation.id

    conversations.selectOpening(conversationId, 'backup')
    expect(messages.list(conversationId)[0]).toMatchObject({
      id: 'opening',
      content: '备用开场',
      selectedOpeningId: 'backup'
    })
    expect(conversations.get(conversationId).preview).toBe('备用开场')
    expect(database.native.prepare("SELECT stateJson FROM chat_session_variable_states WHERE sessionId=? AND kind='current'")
      .get(conversationId)).toEqual({ stateJson: '{"好感":2}' })

    conversations.updateOpening(conversationId, '只改当前对话的备用开场')
    expect(messages.list(conversationId)[0]).toMatchObject({
      content: '只改当前对话的备用开场',
      openingOptions: expect.arrayContaining([
        expect.objectContaining({ id: 'backup', content: '只改当前对话的备用开场' })
      ])
    })
    expect(settingLibraries.get('card-a').entries.find((entry) => entry.id === 'fixed-opening-assistant')?.openingMessages)
      .toContainEqual(expect.objectContaining({ id: 'backup', content: '备用开场' }))

    messages.create(conversationId, 'user', '开始聊天', 'complete')
    conversations.touch(conversationId, '最近的真实消息')
    expect(conversations.get(conversationId).preview).toBe('只改当前对话的备用开场')

    const deleted = messages.deleteFrom(conversationId, 'opening')
    expect(deleted).toMatchObject({ deletedMessageCount: 2, remainingMessageCount: 0 })
    expect(messages.list(conversationId)).toEqual([])
    expect(database.native.prepare("SELECT stateJson FROM chat_session_variable_states WHERE sessionId=? AND kind='current'")
      .get(conversationId)).toEqual({ stateJson: '{"好感":2}' })
    expect(database.native.prepare('SELECT historyMessageCount FROM chat_sessions WHERE id=?')
      .get(conversationId)).toEqual({ historyMessageCount: 0 })
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('regenerates from a user turn without deleting its unchanged input and restores its variable snapshot', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    messages.create(conversationId, 'user', '第一轮', 'complete')
    messages.create(conversationId, 'assistant', '第一轮回复', 'complete', undefined, 'runtime-a')
    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"轮次":1}', conversationId)
    const secondUser = messages.create(conversationId, 'user', '第二轮原文', 'complete')
    const secondAssistant = messages.create(conversationId, 'assistant', '第二轮回复', 'complete', undefined, 'runtime-b')
    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"轮次":2}', conversationId)

    const prepared = messages.prepareRegeneration(conversationId, secondAssistant.id)
    expect(prepared).toMatchObject({ turnId: secondUser.turnId, text: '第二轮原文' })
    expect(prepared.runtimeThreadId).not.toBe('runtime-b')
    expect(prepared.obsoleteRuntimeThreadIds).toEqual(['runtime-b'])
    expect(messages.list(conversationId).map((message) => message.content)).toEqual(['第一轮', '第一轮回复', '第二轮原文'])
    expect(messages.list(conversationId).map((message) => message.messageIndex)).toEqual([0, 1, 2])
    expect(database.native.prepare("SELECT stateJson FROM chat_session_variable_states WHERE sessionId=? AND kind='current'")
      .get(conversationId)).toEqual({ stateJson: '{"轮次":1}' })
    expect(database.native.prepare('SELECT historyMessageCount FROM chat_sessions WHERE id=?')
      .get(conversationId)).toEqual({ historyMessageCount: 3 })

    messages.create(conversationId, 'assistant', '重新生成的回复', 'complete')
    expect(messages.list(conversationId).map((message) => message.messageIndex)).toEqual([0, 1, 2, 3])
    expect(messages.prepareRegeneration(conversationId, secondUser.id, '第二轮已编辑')).toMatchObject({ text: '第二轮已编辑' })
    expect(messages.list(conversationId).at(-1)?.content).toBe('第二轮已编辑')
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('reprojects per-turn usage after regeneration and removes it with a deleted reply', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    const user = messages.create(conversationId, 'user', '问题', 'complete')
    const oldReply = messages.create(conversationId, 'assistant', '旧回复', 'complete', undefined, 'runtime-usage')
    database.native.prepare('UPDATE agent_responses SET dshTurn=1 WHERE id=?').run(oldReply.id)
    let replyText = '旧回复'
    let totalTokens = 120
    const detach = messages.attachTranscriptReader(() => [{
      turn: 1, completed: true, userSeq: 1, userText: '问题', userImages: [],
      assistantText: replyText, process: [],
      turnUsage: { uncachedInputTokens: totalTokens - 20, outputTokens: 20, totalTokens }
    }])
    try {
      expect(messages.list(conversationId).find((message) => message.id === oldReply.id)?.turnUsage?.totalTokens).toBe(120)

      messages.prepareRegeneration(conversationId, oldReply.id)
      expect(messages.list(conversationId).map((message) => message.id)).toEqual([user.id])

      const newReply = messages.create(conversationId, 'assistant', '新回复', 'complete', undefined, 'runtime-usage')
      expect(messages.list(conversationId).find((message) => message.id === newReply.id)?.turnUsage).toBeUndefined()
      database.native.prepare('UPDATE agent_responses SET dshTurn=1 WHERE id=?').run(newReply.id)
      replyText = '新回复'
      totalTokens = 240
      expect(messages.list(conversationId).find((message) => message.id === newReply.id)?.turnUsage?.totalTokens).toBe(240)

      messages.deleteFrom(conversationId, newReply.id)
      expect(messages.list(conversationId).map((message) => message.id)).toEqual([user.id])
      expect(messages.list(conversationId).some((message) => message.turnUsage)).toBe(false)
    } finally { detach() }
  })

  it('deletes a message tail together with process, media caches and rewinds native state', () => {
    const { conversations, messages, database } = harness()
    const conversationId = conversations.create({}).conversation.id
    const settings = new SettingLibraryRepository(database)
    const image = {
      attachmentId: `sha256:${'a'.repeat(64)}`,
      mediaType: 'image/png' as const,
      bytes: 12,
      width: 2,
      height: 3
    }
    const settingBeforeSecond = JSON.stringify([{
      targetType: 'entry', targetId: 'place', operation: 'delete', payloadJson: 'null', updatedAt: '2026-01-01T00:00:00.000Z'
    }])
    const settingAfterSecond = JSON.stringify([{
      targetType: 'entry', targetId: 'weather', operation: 'delete', payloadJson: 'null', updatedAt: '2026-01-02T00:00:00.000Z'
    }])

    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"beforeFirst":1}', conversationId)
    const firstUser = messages.create(conversationId, 'user', '第一轮', 'complete')
    messages.writeSettingLibraryStateSnapshot(conversationId, firstUser.id, '[]')
    const firstAssistant = messages.create(conversationId, 'assistant', '', 'streaming', undefined, 'runtime-a')
    messages.finish(firstAssistant.id, '第一轮回复', 'complete', undefined, '{"afterFirst":2}')
    messages.writeSettingLibraryStateSnapshot(conversationId, firstAssistant.id, '[]')

    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"betweenRounds":3}', conversationId)
    settings.restoreConversationRuntimeState(conversationId, settingBeforeSecond)
    const secondUser = messages.create(conversationId, 'user', '第二轮', 'complete', undefined, '', [image])
    messages.writeSettingLibraryStateSnapshot(conversationId, secondUser.id, settingBeforeSecond)
    const secondAssistant = messages.create(conversationId, 'assistant', '', 'streaming', undefined, 'runtime-b')
    messages.upsertProcessItem(secondAssistant.id, {
      id: 'tool-second', kind: 'tool', status: 'complete', toolName: 'generate_image',
      arguments: '{"prompt":"scene"}', summary: '生成图片', detail: '完成',
      startedAtMillis: 1, completedAtMillis: 2
    })
    messages.finish(secondAssistant.id, '第二轮回复', 'complete', undefined, '{"afterSecond":4}')
    settings.restoreConversationRuntimeState(conversationId, settingAfterSecond)
    messages.writeSettingLibraryStateSnapshot(conversationId, secondAssistant.id, settingAfterSecond)
    database.native.prepare("UPDATE chat_session_variable_states SET stateJson=? WHERE sessionId=? AND kind='current'")
      .run('{"afterSecond":4}', conversationId)
    const deleted = messages.deleteFrom(conversationId, secondUser.id)
    expect(deleted).toMatchObject({
      deletedMessageCount: 2,
      remainingMessageCount: 2,
      deletedAttachmentIds: [image.attachmentId],
      obsoleteRuntimeThreadIds: ['runtime-b'],
      retainedRuntimeThreadIds: ['runtime-a', conversationId],
      rollbackSettingLibraryStateJson: settingBeforeSecond
    })
    settings.restoreConversationRuntimeState(conversationId, deleted.rollbackSettingLibraryStateJson!)
    expect(messages.list(conversationId).map((message) => message.content)).toEqual(['第一轮', '第一轮回复'])
    expect(database.native.prepare("SELECT stateJson FROM chat_session_variable_states WHERE sessionId=? AND kind='current'")
      .get(conversationId)).toEqual({ stateJson: '{"betweenRounds":3}' })
    expect(settings.snapshotConversationRuntimeState(conversationId)).toBe(settingBeforeSecond)
    expect(database.native.prepare("SELECT name FROM sqlite_master WHERE name='agent_content_parts'").get())
      .toBeUndefined()
    expect(database.native.prepare('SELECT DISTINCT runtimeThreadId FROM agent_responses WHERE conversationId=?')
      .all(conversationId)).toEqual([{ runtimeThreadId: 'runtime-a' }])
    expect(database.native.prepare('SELECT historyMessageCount FROM chat_sessions WHERE id=?')
      .get(conversationId)).toEqual({ historyMessageCount: 2 })
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('persists complete variable versions and seeds new character conversations from the active state', () => {
    const { characters, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const repository = new VariableConfigRepository(database)
    const empty = repository.get('card-a')
    const timestamp = new Date().toISOString()
    const object = {
      id: 'status', name: '状态', parentId: '', enabled: true, description: '角色状态', updateRule: '发生变化时更新',
      dynamicKey: false, order: 1, treeViewOrder: 1, createdAt: timestamp, updatedAt: timestamp
    }
    const variable = {
      id: 'mood', title: '心情', objectId: object.id, enabled: true, type: 'string' as const, defaultValue: '平静',
      description: '当前心情', updateRule: '按剧情更新', readMode: 'required' as const, order: 1, treeViewOrder: 1,
      createdAt: timestamp, updatedAt: timestamp
    }
    const saved = repository.save('card-a', {
      ...empty,
      name: '正式版',
      initialStateJson: '{}',
      schemaCode: 'z.object({ 状态: z.object({ 心情: z.string() }) })',
      objects: [object],
      variables: [variable],
      expandedObjectIds: [object.id]
    })

    expect(saved.objects[0]).toMatchObject({ id: VARIABLE_INITIALIZATION_OBJECT_ID, name: '变量运行配置' })
    expect(saved.initialStateJson).toBe('{\n  "状态": {\n    "心情": "平静"\n  }\n}')
    expect(saved.versions).toHaveLength(1)
    expect(database.native.prepare('SELECT COUNT(*) AS count FROM variable_config_objects WHERE characterId = ?').get('card-a')).toEqual({ count: 2 })
    expect(database.native.prepare('SELECT COUNT(*) AS count FROM variable_config_variables WHERE characterId = ?').get('card-a')).toEqual({ count: 1 })

    const conversations = new ConversationRepository(database, (characterId, db) => repository.initialState(characterId, db))
    const conversationId = conversations.create({ metadata: { characterId: 'card-a' } }).conversation.id
    expect(database.native.prepare('SELECT kind,stateJson FROM chat_session_variable_states WHERE sessionId = ? ORDER BY kind').all(conversationId)).toEqual([
      { kind: 'current', stateJson: saved.initialStateJson },
      { kind: 'initial', stateJson: saved.initialStateJson }
    ])
    const states = new VariableStateRepository(database, repository)
    expect(states.runtimeContext(conversationId, conversations.getCharacterBinding(conversationId))).toMatchObject({
      schemaCode: saved.schemaCode,
      stateJson: saved.initialStateJson,
      variables: [expect.objectContaining({ id: 'mood', readMode: 'required' })]
    })
    expect(states.replaceCurrent(conversationId, '{"状态":{"心情":"开心"}}')).toBe('{\n  "状态": {\n    "心情": "开心"\n  }\n}')
    expect(database.native.prepare("SELECT stateJson FROM chat_session_variable_states WHERE sessionId=? AND kind='current'").get(conversationId)).toEqual({
      stateJson: '{\n  "状态": {\n    "心情": "开心"\n  }\n}'
    })
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })

  it('keeps streaming text in memory and marks an interrupted response as failed after reopening', async () => {
    const { conversations, messages, database } = harness()
    const id = conversations.create({}).conversation.id
    messages.create(id, 'user', 'input', 'complete')
    const reply = messages.create(id, 'assistant', '', 'streaming')
    const prefix = 'x'.repeat(64 * 1024 - 1) + '😀' + 'y'.repeat(100)
    messages.appendCheckpoint(reply.id, prefix)
    messages.appendCheckpoint(reply.id, 'tail')
    expect(messages.list(id).at(-1)?.content).toBe(prefix + 'tail')
    database.close(); database.open()
    expect(new MessageRepository(database).list(id).at(-1)).toMatchObject({ content: '', status: 'error' })
    await conversations.delete(id)
    expect(database.native.prepare("SELECT name FROM sqlite_master WHERE name='agent_content_parts'").get()).toBeUndefined()
  })

  it('removes a card and its chats while preserving another card and shared configuration', () => {
    const { characters, conversations, messages, database } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card(), card('card-b')] })
    const a = conversations.create({ metadata: { characterId: 'card-a' } }).conversation.id
    const b = conversations.create({ metadata: { characterId: 'card-b' } }).conversation.id
    messages.create(a, 'user', 'a', 'complete'); messages.create(b, 'user', 'b', 'complete')
    characters.delete(['card-a'])
    expect(conversations.exists(a)).toBe(false)
    expect(messages.list(b).map((message) => message.content)).toEqual(['b'])
    expect(database.native.pragma('foreign_key_check')).toEqual([])
  })


  it('restores a consistent SQLite snapshot in an independent directory', async () => {
    const { database, characters, conversations, messages } = harness()
    characters.replaceAll({ active_character_id: 'card-a', groups: [], items: [card()] })
    const id = conversations.create({ metadata: { characterId: 'card-a' } }).conversation.id
    messages.create(id, 'user', 'backup source', 'complete')
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-restore-test-'))
    directories.push(directory)
    const destination = join(directory, 'restored.sqlite3')
    await database.backupTo(destination)
    const restored = new SqliteDatabase(destination)
    connections.push(restored)
    restored.open()
    const restoredConversations = new ConversationRepository(restored)
    expect(restoredConversations.getMetadata(id).characterId).toBe('card-a')
    expect(new MessageRepository(restored).list(id)[0]?.id).toBeTruthy()
    expect(restored.native.prepare("SELECT name FROM sqlite_master WHERE name='agent_content_parts'").get()).toBeUndefined()
    expect(restored.native.pragma('foreign_key_check')).toEqual([])
    expect(restored.native.pragma('integrity_check', { simple: true })).toBe('ok')
    await expect(database.backupTo(destination)).rejects.toThrow('新的文件')
  })

  it('rejects an altered common view without rebuilding or clearing data', () => {
    const { database } = harness()
    database.native.exec('DROP VIEW setting_library_entries')
    database.close()
    expect(() => database.open()).toThrow('公共数据库结构不匹配')
  })

  it('refuses an unexpected product table without modifying the database', () => {
    const { database } = harness()
    database.native.exec('CREATE TABLE unknown_preferences (id TEXT PRIMARY KEY)')
    database.close()
    expect(() => database.open()).toThrow('未知表')
  })
})
