#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { importAndroidFrontends } from '@eleckoi/dsh-product-data/android-import'
import { importAndroidConversations } from '@eleckoi/dsh-product-data/android-conversations'
import { createAndroidMediaImporter, importAndroidFiles, importAndroidMediaReferences } from '@eleckoi/dsh-product-data/android-files'
import { createAndroidConversationFileSessionAdapter } from '@eleckoi/dsh-runtime/android-transcript-import'

const args = process.argv.slice(2), options = new Map()
if (args.length % 2) throw new Error('Use flag/value pairs; see docs/migration/android-conversation-file-migration-status.md')
const flags = ['--room', '--product-db', '--plugin-registry', '--snapshots', '--sessions', '--target-sessions', '--workspace', '--source-plugin-root', '--source-dsh-attachments', '--target-dsh-home', '--frontends', '--files', '--android-files-prefix', '--target-media', '--target-attachments', '--conflicts']
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]
  if (!flags.includes(flag)) throw new Error(`Unknown migration option: ${flag}`)
  if (options.has(flag)) throw new Error(`Duplicate migration option: ${flag}`)
  options.set(flag, args[index + 1])
}
function path(flag) { const value = options.get(flag); if (!value) throw new Error(`Missing migration option: ${flag}`); return resolve(value) }
const shared = { snapshotDirectory: path('--snapshots'), ...(options.has('--conflicts') ? { conflicts: options.get('--conflicts') } : {}) }
const targetRegistryPath = path('--plugin-registry'), targetRoomPath = path('--product-db'), targetSessionsRoot = path('--target-sessions')
const targetDshHome = options.has('--target-dsh-home') ? path('--target-dsh-home') : dirname(targetSessionsRoot)
const workspaceRoot = options.has('--workspace') ? path('--workspace') : resolve(process.env.ELECKOI_WORKSPACE_ROOT || join(targetDshHome, 'workspace'))
mkdirSync(workspaceRoot, { recursive: true })
const sourceAttachments = options.has('--source-dsh-attachments') ? path('--source-dsh-attachments') : join(dirname(path('--sessions')), 'attachments')
const mediaOptions = options.has('--files') ? { sourceFilesRoot: path('--files'), androidFilesPrefix: options.get('--android-files-prefix'), targetMediaRoot: path('--target-media'), targetAttachmentsRoot: path('--target-attachments') } : undefined
if (mediaOptions && !mediaOptions.androidFilesPrefix) throw new Error('Missing migration option: --android-files-prefix')
const media = mediaOptions ? createAndroidMediaImporter(mediaOptions) : undefined
const files = await importAndroidFiles({ ...shared, sourceSessionsRoot: path('--sessions'), targetSessionsRoot,
  ...(existsSync(sourceAttachments) ? { sourceAttachmentsRoot: sourceAttachments, targetAttachmentsRoot: join(targetDshHome, 'attachments') } : {}),
  ...(options.has('--source-plugin-root') ? { sourcePluginRoot: path('--source-plugin-root'), targetPluginRoot: dirname(targetRegistryPath) } : {}) })
const conversations = await importAndroidConversations({ ...shared, sourceRoomPath: path('--room'), targetRoomPath, targetRegistryPath, targetSessionsRoot,
  sessions: createAndroidConversationFileSessionAdapter(targetDshHome, undefined, { cwd: workspaceRoot }), ...(media ? { transform: media.transform } : {}) })
const references = mediaOptions ? await importAndroidMediaReferences({ ...mediaOptions, targetRoomPath, targetRegistryPath, snapshotDirectory: shared.snapshotDirectory }) : undefined
const frontends = options.has('--frontends') ? importAndroidFrontends({ sourceRoomPath: path('--room'), sourceProjectsDirectory: path('--frontends'), targetRegistryDirectory: dirname(targetRegistryPath), targetProjectsDirectory: join(dirname(targetRegistryPath), 'frontends') }) : undefined
process.stdout.write(JSON.stringify({ pass: true, filesManifest: files.manifestPath, conversationManifest: conversations.manifestPath,
  sessions: conversations.sessions, candidates: conversations.candidates, tables: conversations.tables,
  ...(references ? { mediaManifest: references.manifestPath, mediaMappings: references.mappings.length } : {}), ...(frontends ? { frontends } : {}) }, null, 2) + '\n')
