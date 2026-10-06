#!/usr/bin/env node
import { resolve } from 'node:path'
import { importAndroidDomains } from '@eleckoi/dsh-product-data/android-import'

const args = process.argv.slice(2), options = new Map()
if (args.length % 2) throw new Error('Use flag/value pairs; see docs/migration/android-data-migration-status.md')
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]
  if (!['--room', '--registry', '--product-db', '--plugin-registry', '--snapshots', '--conflicts'].includes(flag)) throw new Error(`Unknown migration option: ${flag}`)
  if (options.has(flag)) throw new Error(`Duplicate migration option: ${flag}`)
  options.set(flag, args[index + 1])
}
const path = flag => {
  const value = options.get(flag)
  if (!value) throw new Error(`Missing migration option: ${flag}`)
  return resolve(value)
}
const report = await importAndroidDomains({ sourceRoomPath: path('--room'), targetRoomPath: path('--product-db'),
  targetRegistryPath: path('--plugin-registry'), snapshotDirectory: path('--snapshots'),
  ...(options.has('--registry') ? { sourceRegistryPath: path('--registry') } : {}),
  ...(options.has('--conflicts') ? { conflicts: options.get('--conflicts') } : {}) })
process.stdout.write(JSON.stringify({ pass: true, sourceVersion: report.sourceVersion, sourceHash: report.sourceHash,
  manifestPath: report.manifestPath, tables: report.tables.length, nativeRows: report.tables.reduce((sum, table) => sum + table.sourceRows, 0),
  registryRows: report.registry.sourceRows, roomSnapshot: report.roomSnapshot, registrySnapshot: report.registrySnapshot }, null, 2) + '\n')
