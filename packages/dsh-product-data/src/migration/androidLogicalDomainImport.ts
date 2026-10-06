import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { SqliteDatabase } from '../storage/sqlite/SqliteDatabase'
import { LocalMediaStore, type PreparedLocalMedia } from '../storage/media/LocalMediaStore'
import { SettingLibraryRepository } from '../domain/settingLibraries/SettingLibraryRepository'
import { readEntry, readGroup, readPromptPositions } from '../domain/settingLibraries/settingLibraryCodec'
import { VariableConfigRepository } from '../domain/variables/VariableConfigRepository'
import { readVariable, readVariableObject } from '../domain/variables/variableConfigCodec'
import { AgentPresetRepository } from '../domain/agentPresets/AgentPresetRepository'
import { decodeAgentPresetImport } from '../domain/agentPresets/AgentPresetImportCodec'
import type { AgentPresetTransferVersion } from '../domain/agentPresets/AgentPresetImportCodec'
import { RegexRuleRepository } from '../domain/regexRules/RegexRuleRepository'
import { agentPresetLibraryGroups, agentPresets, agentPresetVersions, agentPresetVersionEntries, agentPresetVersionGroups,
  agentPresetVersionContents, globalRegexRules, regexEnablementVersions, regexState } from '../storage/sqlite/schema/common'
import { settingLibrarySchema, type SettingLibraryVersion, type SettingLibrary } from '@shared/contracts/settingLibrary/schemas'
import { variableConfigSchema, type VariableConfigVersion, type VariableConfig } from '@shared/contracts/variables/schemas'
import { regexRuleSchema, regexRuleVersionSchema, type RegexRuleVersion } from '@shared/contracts/regex/schemas'
import { agentPresetLibraryGroupSchema, type AgentPreset } from '@shared/contracts/presets/schemas'

type ObjectValue = Record<string, unknown>
export interface AndroidLogicalDomainImportOptions {
  /** Actual parsed ZIP sections keyed by their archive names. Unhandled sections belong to the caller. */
  sections: Record<string, unknown>
  targetRoomPath: string; targetRegistryPath: string; mediaRoot?: string
  conflicts?: 'fail' | 'replace'
}
export interface AndroidLogicalDomainImportReport {
  format: 'eleckoi.android-logical-domains'; version: 1
  settings: number; settingVersions: number; variables: number; variableVersions: number
  regexCollections: number; regexRules: number; regexVersions: number; presets: number; presetVersions: number; presetGroups: number
  reusedSections: string[]; preservedSections: string[]
}
const RAW_SCOPE = 'migration:android:logical-sections'

/** Restore exported DTOs through common repositories. The raw source remains available for unknown fields. */
export function importAndroidLogicalDomains(options: AndroidLogicalDomainImportOptions): AndroidLogicalDomainImportReport {
  if (options.conflicts && !['fail', 'replace'].includes(options.conflicts)) throw new Error('Unknown migration conflict policy')
  const recognized = Object.entries(options.sections).filter(([name]) => /^(?:settings|variables|regex)\/[^/]+\.json$/.test(name) || ['presets.json', 'shared-regex.json'].includes(name))
  // Decode the complete batch before target writes. Do not let a malformed later section partially import earlier ones.
  const decoded = recognized.map(([name, input]) => {
    const value = object(input, name)
    if (name.startsWith('settings/')) return { name, value, kind: 'settings' as const, document: decodeSettingSnapshot(owner(name, value), value) }
    if (name.startsWith('variables/')) return { name, value, kind: 'variables' as const, document: decodeVariableBackup(owner(name, value), value) }
    if (name === 'presets.json') return { name, value, kind: 'presets' as const, document: decodePresetBackup(value) }
    return { name, value, kind: 'regex' as const, document: decodeRegexBackup(value, name === 'shared-regex.json' ? null : owner(name, value)) }
  })
  const targetPath = resolve(options.targetRoomPath), registryPath = resolve(options.targetRegistryPath)
  mkdirSync(dirname(targetPath), { recursive: true }); mkdirSync(dirname(registryPath), { recursive: true })
  const store = new SqliteDatabase(targetPath); store.open()
  const prepared: PreparedLocalMedia[] = [], report: AndroidLogicalDomainImportReport = {
    format: 'eleckoi.android-logical-domains', version: 1, settings: 0, settingVersions: 0, variables: 0, variableVersions: 0,
    regexCollections: 0, regexRules: 0, regexVersions: 0, presets: 0, presetVersions: 0, presetGroups: 0, reusedSections: [], preservedSections: [],
  }
  let attached = false
  try {
    store.native.prepare('ATTACH DATABASE ? AS logical_registry').run(registryPath); attached = true
    store.native.exec('CREATE TABLE IF NOT EXISTS logical_registry.documents(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,key))')
    const prior = store.native.prepare('SELECT value FROM logical_registry.documents WHERE scope=? AND key=?')
    const saveRaw = store.native.prepare('INSERT INTO logical_registry.documents(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value')
    const settings = new SettingLibraryRepository(store), variables = new VariableConfigRepository(store)
    const media = new LocalMediaStore(options.mediaRoot || join(dirname(targetPath), 'media'))
    const presets = new AgentPresetRepository(store, media)
    const regex = new RegexRuleRepository(store, presets, {
      read: scope => { const row = prior.get('regex-rule-extensions', scope) as { value: string } | undefined; return row ? JSON.parse(row.value) : {} },
      replace: (scope, rules) => { saveRaw.run('regex-rule-extensions', scope, JSON.stringify(Object.fromEntries(rules.map(rule => [rule.id, {
        trimStrings: rule.trimStrings || [], minDepth: rule.minDepth ?? null, maxDepth: rule.maxDepth ?? null, substituteRegex: rule.substituteRegex || 0,
      }])))) },
    })
    store.withWriteTx(db => {
      const work = decoded.filter(item => {
        const source = prior.get(RAW_SCOPE, item.name) as { value: string } | undefined
        if (source && canonical(JSON.parse(source.value)) === canonical(item.value)) { report.reusedSections.push(item.name); return false }
        if (source && options.conflicts !== 'replace') throw new Error(`Android logical import conflict: ${item.name}`)
        return true
      })
      // Preset selection drives the original regex repository, so import it first.
      for (const item of work.filter(item => item.kind === 'presets')) {
        if (item.kind !== 'presets') continue
        const catalog = item.document
        for (const group of catalog.groups) {
          const existing = store.native.prepare('SELECT id FROM agent_preset_library_groups WHERE id=?').get(group.id)
          if (existing && options.conflicts !== 'replace') throw new Error(`Android preset group conflict: ${group.id}`)
          db.insert(agentPresetLibraryGroups).values(group).onConflictDoUpdate({ target: agentPresetLibraryGroups.id, set: group }).run(); report.presetGroups++
        }
        for (const source of catalog.presets) {
          const exists = store.native.prepare('SELECT id FROM agent_presets WHERE id=?').get(source.preset.id)
          if (exists && options.conflicts !== 'replace') throw new Error(`Android preset conflict: ${source.preset.id}`)
          const avatar = source.avatar ? media.prepareImage(`agent-preset:${source.preset.id}`, 'author-avatar', source.avatar) : undefined
          if (avatar) prepared.push(avatar)
          const preset = { ...source.preset, profile: { ...source.preset.profile, authorAvatarPath: avatar?.reference || source.preset.profile.authorAvatarPath } }
          db.insert(agentPresets).values({ id: preset.id, name: preset.name, modelFamily: preset.modelFamily, modelTagsJson: JSON.stringify(preset.modelTags),
            libraryGroupId: preset.libraryGroupId, activeVersionId: preset.activeVersionId, authorName: preset.profile.authorName,
            authorAvatarPath: preset.profile.authorAvatarPath, sortIndex: report.presets, expandedGroupIdsJson: JSON.stringify(preset.expandedGroupIds) })
            .onConflictDoNothing().run()
          db.delete(agentPresetVersionEntries).where(eq(agentPresetVersionEntries.presetId, preset.id)).run()
          db.delete(agentPresetVersionGroups).where(eq(agentPresetVersionGroups.presetId, preset.id)).run()
          db.delete(agentPresetVersionContents).where(eq(agentPresetVersionContents.presetId, preset.id)).run()
          db.delete(agentPresetVersions).where(eq(agentPresetVersions.presetId, preset.id)).run()
          for (const version of source.versions) {
            presets.save(presetVersion(preset, version))
            db.update(agentPresetVersions).set({ name: version.name, createdAtEpochMs: version.createdAtEpochMs })
              .where(and(eq(agentPresetVersions.presetId, preset.id), eq(agentPresetVersions.versionId, version.id))).run()
            report.presetVersions++
          }
          presets.save(preset)
          // save() owns the active content, while backup versions retain their own names and dates.
          for (const version of source.versions) db.update(agentPresetVersions).set({ name: version.name, createdAtEpochMs: version.createdAtEpochMs })
            .where(and(eq(agentPresetVersions.presetId, preset.id), eq(agentPresetVersions.versionId, version.id))).run()
          report.presets++
        }
        if (catalog.activeId) presets.setActive(catalog.activeId)
      }
      for (const item of work) {
        if (item.kind === 'settings') {
          assertOwnerConflict(store, 'setting_libraries', item.document.characterId, options.conflicts)
          settings.saveInTransaction(item.document.characterId, item.document, db); report.settings++; report.settingVersions += item.document.versions.length
        } else if (item.kind === 'variables') {
          assertOwnerConflict(store, 'variable_configs', item.document.characterId, options.conflicts)
          variables.restoreInTransaction(item.document.characterId, item.document, db); report.variables++; report.variableVersions += item.document.versions.length
        } else if (item.kind === 'regex') {
          const source = item.document
          if (source.characterId) {
            assertOwnerConflict(store, 'character_regex_rules', source.characterId, options.conflicts)
            const current = regex.get(source.characterId, db)
            regex.saveInTransaction(source.characterId, { ...current, globalRules: source.globalRules, characterRules: source.characterRules,
              agentPresetRules: source.presetRules, versions: source.versions, activeVersionId: source.activeVersionId }, current.revision, db)
            saveRaw.run('regex-native-companions', 'global', JSON.stringify(source.globalCompanions))
            saveRaw.run('regex-rule-extensions', 'global', JSON.stringify(Object.fromEntries(source.globalRules.map(rule => [rule.id, rule]))))
            saveRaw.run('regex-native-companions', `character:${source.characterId}`, JSON.stringify(source.characterCompanions))
          } else {
            if (options.conflicts !== 'replace' && store.native.prepare('SELECT id FROM global_regex_rules LIMIT 1').get()) throw new Error('Android global regex conflict')
            db.delete(globalRegexRules).run()
            if (source.globalRules.length) db.insert(globalRegexRules).values(source.globalRules.map((rule, index) => ({ id: rule.id, name: rule.name, pattern: rule.pattern,
              replacement: rule.replacement, targetsJson: JSON.stringify(rule.targets), enabled: +rule.enabled, displayOnly: +rule.displayOnly,
              promptOnly: +rule.promptOnly, runOnEdit: +rule.runOnEdit, sortIndex: index }))).run()
            db.delete(regexEnablementVersions).run()
            if (source.versions.length) db.insert(regexEnablementVersions).values(source.versions.map((version, sortIndex) => ({ id: version.id, name: version.name, sortIndex,
              globalEnabledIdsJson: JSON.stringify(version.globalEnabledIds), agentPresetEnabledIdsJson: JSON.stringify(version.agentPresetEnabledIds),
              characterEnabledIdsJson: JSON.stringify(version.characterEnabledIds) }))).run()
            const current = db.select().from(regexState).where(eq(regexState.singletonId, 1)).get()
            db.insert(regexState).values({ singletonId: 1, activeVersionId: source.activeVersionId || null, revision: (current?.revision || 0) + 1 })
              .onConflictDoUpdate({ target: regexState.singletonId, set: { activeVersionId: source.activeVersionId || null, revision: (current?.revision || 0) + 1 } }).run()
            saveRaw.run('regex-native-companions', 'global', JSON.stringify(source.globalCompanions))
          }
          report.regexCollections++; report.regexRules += source.globalRules.length + source.characterRules.length + source.presetRules.length; report.regexVersions += source.versions.length
        }
        saveRaw.run(RAW_SCOPE, item.name, JSON.stringify(item.value)); report.preservedSections.push(item.name)
      }
      const invalid = store.native.pragma('foreign_key_check') as unknown[]
      if (invalid.length) throw new Error(`Android logical import foreign-key failure: ${JSON.stringify(invalid)}`)
    })
    for (const image of prepared) image.commit()
    return report
  } catch (error) { for (const image of prepared) image.rollback(); throw error }
  finally { if (attached) store.native.exec('DETACH DATABASE logical_registry'); store.close() }
}

function decodeSettingSnapshot(characterId: string, source: ObjectValue): SettingLibrary {
  requireFormat(source, 'eleckoi.setting-library-snapshot', [1, 2])
  const versions = objects(source.versions, 'setting versions').map(value => {
    const entries = objects(value.entries, 'setting entries').map(entry => {
      const migrated = Number(source.version) === 1 ? { ...entry,
        agent_read_strategy: entry.agent_read_strategy === 'variable_condition' ? 'normal' : entry.agent_read_strategy,
        dynamic_mode: entry.dynamic_mode === 'ejs_controller' ? 'standard' : entry.dynamic_mode,
        content_mode: entry.dynamic_mode === 'ejs_controller' || (entry.dynamic_mode !== 'ejs_reference' && entry.agent_read_strategy !== 'required'
          && entry.trigger_mode === 'agent_tool' && String(entry.content || '').includes('<%')) ? 'ejs' : 'plain_text' } : entry
      return readEntry(JSON.stringify(migrated))
    })
    return { id: string(value.id), name: string(value.name), entries, groups: objects(value.groups, 'setting groups').map(group => readGroup(JSON.stringify(group))),
      promptPositions: readPromptPositions(JSON.stringify(value.prompt_positions || [])), listAllExpanded: value.list_all_expanded !== false,
      expandedGroupIds: strings(value.expanded_group_ids), createdAt: string(value.created_at), updatedAt: string(value.updated_at) } satisfies SettingLibraryVersion
  })
  const active = versions.find(version => version.id === source.active_version_id)
  if (!active) throw new Error(`Active setting version is missing: ${characterId}/${source.active_version_id}`)
  return settingLibrarySchema.parse({ ...active, characterId, activeVersionId: active.id, versions })
}

function decodeVariableBackup(characterId: string, source: ObjectValue): VariableConfig {
  requireFormat(source, 'eleckoi.variable-config', [1])
  const values = objects(source.versions, 'variable versions')
  const versions = (values.length ? values : [{ ...source, id: source.active_version_id }]).map(value => {
    const state = object(value.initial_state || {}, 'variable initial state')
    return { id: string(value.id), name: string(value.name), initialStateJson: JSON.stringify(state), schemaCode: string(value.schema_code),
      objects: objects(value.objects, 'variable objects').map(row => readVariableObject(JSON.stringify({ ...row, parentId: string(row.parent_id),
        updateRule: string(row.update_rule), dynamicKey: row.dynamic_key === true, treeViewOrder: Number(row.tree_view_order || 0),
        createdAt: string(row.created_at), updatedAt: string(row.updated_at) }))),
      variables: objects(value.variables, 'variables').map(row => readVariable(JSON.stringify({ ...row, objectId: string(row.object_id),
        defaultValue: string(row.default_value), updateRule: string(row.update_rule), readMode: string(row.read_mode) || 'on_demand',
        treeViewOrder: Number(row.tree_view_order || 0), createdAt: string(row.created_at), updatedAt: string(row.updated_at) }))),
      expandedObjectIds: strings(value.expanded_object_ids), createdAt: string(value.created_at), updatedAt: string(value.updated_at) } satisfies VariableConfigVersion
  })
  const active = versions.find(version => version.id === source.active_version_id)
  if (!active) throw new Error(`Active variable version is missing: ${characterId}/${source.active_version_id}`)
  return variableConfigSchema.parse({ ...active, characterId, activeVersionId: active.id, versions })
}

function decodePresetBackup(source: ObjectValue) {
  requireFormat(source, 'eleckoi.agent-presets-backup', [1])
  const groups = objects(source.groups, 'preset groups').map(value => agentPresetLibraryGroupSchema.parse({ id: value.id, name: value.name, sortIndex: value.sort_index }))
  const presets = objects(source.presets, 'presets').map(item => {
    const decoded = decodeAgentPresetImport({ displayName: `${item.source_id}.json`, mimeType: 'application/json',
      base64: Buffer.from(JSON.stringify(object(item.payload, 'preset payload'))).toString('base64') }, 'eleckoi')
    if (decoded.skippedUnsupportedEntries || decoded.skippedDepthRegexCount) throw new Error(`Preset contains unconverted items: ${item.source_id}`)
    const id = string(item.source_id)
    if (!id) throw new Error('Preset source ID is missing')
    const preset: AgentPreset = { ...decoded.preset, id, libraryGroupId: string(item.library_group_id) }
    const active: AgentPresetTransferVersion = { id: preset.activeVersionId, number: preset.activeVersionNumber, name: preset.name, createdAtEpochMs: 0,
      usageInstructions: preset.profile.usageInstructions, timeline: preset.profile.timeline, entries: preset.entries, groups: preset.groups,
      promptPositions: preset.promptPositions, toolGroups: preset.toolGroups, ...(preset.subagentModelSelection ? { subagentModelSelection: preset.subagentModelSelection } : {}), ...(preset.toolModelConfigIds ? { toolModelConfigIds: preset.toolModelConfigIds } : {}), roleplayPlan: preset.roleplayPlan, regexRules: preset.regexRules, expandedGroupIds: preset.expandedGroupIds }
    const versions = decoded.versions.length ? decoded.versions : [active]
    if (!versions.some(version => version.id === preset.activeVersionId)) versions.push(active)
    const avatarBase64 = typeof item.author_avatar_base64 === 'string' ? item.author_avatar_base64 : decoded.authorAvatarBase64
    return { preset, versions, avatar: avatarBase64 ? `data:${decoded.authorAvatarMediaType || 'image/png'};base64,${avatarBase64}` : '' }
  })
  const activeId = string(source.active_source_id)
  if (activeId && !presets.some(item => item.preset.id === activeId)) throw new Error(`Active preset is missing: ${activeId}`)
  return { groups, presets, activeId }
}
function presetVersion(base: AgentPreset, version: AgentPresetTransferVersion): AgentPreset {
  return { ...base, activeVersionId: version.id, activeVersionNumber: version.number,
    profile: { ...base.profile, usageInstructions: version.usageInstructions, timeline: version.timeline }, entries: version.entries, groups: version.groups,
    promptPositions: version.promptPositions, toolGroups: version.toolGroups, ...(version.subagentModelSelection ? { subagentModelSelection: version.subagentModelSelection } : {}), ...(version.toolModelConfigIds ? { toolModelConfigIds: version.toolModelConfigIds } : {}), roleplayPlan: version.roleplayPlan, regexRules: version.regexRules, expandedGroupIds: version.expandedGroupIds }
}
function decodeRegexBackup(source: ObjectValue, characterId: string | null) {
  requireFormat(source, characterId ? 'eleckoi.regex-backup' : 'eleckoi.shared-regex-backup', [1])
  const rules = (value: unknown) => objects(value, 'regex rules').map(row => regexRuleSchema.parse({ ...row, displayOnly: row.display_only === true,
    promptOnly: row.prompt_only === true, runOnEdit: row.run_on_edit === true, trimStrings: row.trim_strings || [],
    minDepth: row.min_depth ?? null, maxDepth: row.max_depth ?? null, substituteRegex: row.substituteRegex || 0 }))
  const versions: RegexRuleVersion[] = objects(source.versions, 'regex versions').map(row => regexRuleVersionSchema.parse({ id: row.id, name: row.name,
    globalEnabledIds: strings(row.global_enabled_ids), agentPresetEnabledIds: strings(row.prompt_preset_enabled_ids), characterEnabledIds: strings(row.character_enabled_ids) }))
  const activeVersionId = string(source.active_version_id)
  if (activeVersionId && !versions.some(version => version.id === activeVersionId)) throw new Error(`Active regex version is missing: ${activeVersionId}`)
  const globalRules = rules(source.global_rules), characterRules = rules(source.character_rules)
  return { characterId, globalRules, presetRules: rules(source.prompt_preset_rules), characterRules, versions, activeVersionId,
    globalCompanions: globalRules.map((rule, index) => ({ ...objects(source.global_rules, 'regex rules')[index], ...rule })),
    characterCompanions: characterRules.map((rule, index) => ({ ...objects(source.character_rules, 'regex rules')[index], ...rule })) }
}
function assertOwnerConflict(store: SqliteDatabase, table: string, characterId: string, conflicts: AndroidLogicalDomainImportOptions['conflicts']) {
  if (conflicts !== 'replace' && store.native.prepare(`SELECT characterId FROM ${table} WHERE characterId=? LIMIT 1`).get(characterId)) throw new Error(`Android ${table} conflict: ${characterId}`)
}
function owner(name: string, value: ObjectValue): string {
  const id = name.substring(name.indexOf('/') + 1, name.length - 5)
  if (value.character_id && value.character_id !== id) throw new Error(`Archive section owner differs from character_id: ${name}`)
  return id
}
function requireFormat(source: ObjectValue, format: string, versions: number[]) {
  if (source.format !== format || !versions.includes(Number(source.version))) throw new Error(`Unsupported Android section format: ${source.format}/${source.version}`)
}
function object(value: unknown, label: string): ObjectValue {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError(`${label} must be an object`)
  return parsed as ObjectValue
}
function objects(value: unknown, label: string): ObjectValue[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value.map(item => object(item, label))
}
function strings(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError('Expected string array')
  return value
}
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
