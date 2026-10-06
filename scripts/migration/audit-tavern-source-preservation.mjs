#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BROWSER_LIBRARY_SCRIPTS, BROWSER_LIBRARY_STYLES } from '../../packages/compatibility/tavern-shared/src/browser-libraries.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), root = join(repo, 'packages/compatibility/tavern-shared')
const source = JSON.parse(readFileSync(join(root, 'SOURCE.json'), 'utf8')), libraries = JSON.parse(readFileSync(join(root, 'LIBRARY-SOURCE.json'), 'utf8'))
const reportPath = resolve(process.argv[2] || join(repo, 'build/migration/tavern-source-preservation-report.json'))
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const list = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? list(join(directory, entry.name)) : [join(directory, entry.name)])
const files = [], errors = [], legacyRoots = ['tools/tavern-runtime', 'tools/vendor/sillytavern']
for (const entry of source.files) {
  const oldFile = join(source.legacyRoot, entry.sourcePath), file = join(root, entry.path)
  if (!existsSync(file) || !existsSync(oldFile)) { errors.push({ path: entry.path, reason: 'source-or-target-missing' }); continue }
  const current = sha(file), legacy = sha(oldFile)
  files.push({ path: entry.path, current, sourceUnchangedSinceCapture: legacy === entry.sourceSha256, unchangedSinceMigration: current === entry.migratedSha256 })
}
for (const directory of legacyRoots) for (const file of list(join(source.legacyRoot, directory))) {
  const sourcePath = relative(source.legacyRoot, file).replaceAll('\\', '/')
  if (!source.files.some(entry => entry.sourcePath === sourcePath)) errors.push({ path: sourcePath, reason: 'legacy-runtime-source-not-listed' })
}
const libraryFiles = []
for (const entry of libraries.files) {
  const sourceFile = join(libraries.sourceRepository, entry.source), target = join(root, entry.target), built = join(root, 'dist', entry.target)
  if (!existsSync(target) || !existsSync(sourceFile) || !existsSync(built)) { errors.push({ path: entry.target, reason: 'browser-library-missing' }); continue }
  const current = sha(target)
  assert.equal(sha(built), current, `Stale built browser library: ${entry.target}`)
  libraryFiles.push({ path: entry.target, current, sourceUnchangedSinceCapture: sha(sourceFile) === entry.sourceSha256, unchangedSinceMigration: current === entry.migratedSha256 })
}
const oldLibraries = join(libraries.sourceRepository, 'app/src/main/assets/frontend/runtime-libraries')
for (const file of list(oldLibraries)) {
  const oldPath = relative(libraries.sourceRepository, file).replaceAll('\\', '/')
  if (oldPath.endsWith('/tavern-runtime.global.js')) continue // Rebuilt from the preserved vendor/runtime modules.
  if (!libraries.files.some(entry => entry.source === oldPath)) errors.push({ path: oldPath, reason: 'old-library-not-listed' })
}
for (const path of [...BROWSER_LIBRARY_SCRIPTS, ...BROWSER_LIBRARY_STYLES, 'tiktoken.global.js']) {
  if (!existsSync(join(root, 'assets', path)) || !existsSync(join(root, 'dist/assets', path))) errors.push({ path, reason: 'loader-library-missing' })
}
const tokenModels = JSON.parse(readFileSync(join(root, 'assets/tokenizer-models/manifest.json'), 'utf8'))
for (const [name, model] of Object.entries(tokenModels)) {
  if (sha(join(root, 'assets/tokenizer-models', model.filename)) !== model.sha256) errors.push({ path: model.filename, reason: 'tokenizer-model-hash-changed' })
}
const macroSlash = files.filter(entry => /\/macros\/|\/slash-commands\/|\/variables\.js$|runtime\/tavern-runtime\/(integration|command-contract|native-commands|generation-commands|prompt-commands|service-commands)\./.test(entry.path))
const result = { pass: errors.length === 0, execution: 'static-source-and-asset-inventory', sourceRevision: source.legacyHead,
  files: files.length, sourceFilesUnchanged: files.filter(file => file.sourceUnchangedSinceCapture).length,
  unchangedMigrationFiles: files.filter(file => file.unchangedSinceMigration).length, changedMigrationFiles: files.filter(file => !file.unchangedSinceMigration),
  macroSlashSources: macroSlash.length, macroSlashChanges: macroSlash.filter(file => !file.unchangedSinceMigration),
  libraryFiles: libraryFiles.length, libraryChanges: libraryFiles.filter(file => !file.unchangedSinceMigration),
  tokenizerModels: Object.keys(tokenModels).length, errors }
await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n')
process.stdout.write(JSON.stringify({ pass: result.pass, reportPath, files: result.files, macroSlashSources: result.macroSlashSources, libraryFiles: result.libraryFiles, errors: errors.length }) + '\n')
if (!result.pass) process.exitCode = 1
