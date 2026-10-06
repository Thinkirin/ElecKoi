#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), flags = new Map()
for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1])
assert.ok(flags.has('--stage') && flags.has('--report'), 'Pass --stage STAGE --report REPORT [--assets true]')
for (const name of flags.keys()) assert.ok(['--stage', '--report', '--assets'].includes(name), `Unknown option: ${name}`)
const stage = resolve(flags.get('--stage')), reportPath = resolve(flags.get('--report')), compareAssets = flags.get('--assets') === 'true'
const inventory = JSON.parse(readFileSync(join(stage, 'production-closure.json'), 'utf8')), checks = [], reusableEdges = []
let failure
const manifest = directory => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
const workspacePackages = new Map()
function collectWorkspace(directory) {
  if (existsSync(join(directory, 'package.json'))) { workspacePackages.set(manifest(directory).name, directory); return }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) collectWorkspace(join(directory, entry.name))
  }
}
collectWorkspace(join(repo, 'packages'))
try {
  for (const record of inventory.packages) {
    const actual = manifest(join(stage, record.directory))
    assert.equal(actual.name, record.name); assert.equal(actual.version, record.version)
    for (const edge of record.dependencies) assert.equal(manifest(join(stage, edge.directory)).name, edge.name)
  }
  checks.push({ name: 'production-graph-identities-and-installed-edges', pass: true, packages: inventory.packages.length })
  for (const record of inventory.packages.filter(item => item.name.startsWith('@eleckoi/'))) {
    const source = workspacePackages.get(record.name)
    assert.ok(source, `Missing workspace source: ${record.name}`)
    const current = manifest(source), lookup = createRequire(join(source, 'package.json')).resolve.paths('__eleckoi_package_lookup__') || []
    assert.equal(current.version, record.version, `Changed workspace version: ${record.name}`)
    const required = Object.keys(current.dependencies || {}).concat(Object.keys(current.peerDependencies || {}).filter(name => current.peerDependenciesMeta?.[name]?.optional !== true))
    for (const name of required) {
      const installed = lookup.map(path => join(path, name)).find(path => existsSync(join(path, 'package.json')))
      assert.ok(installed, `Installed workspace dependency missing: ${record.name} -> ${name}`)
      const version = manifest(installed).version, edge = record.dependencies.find(item => item.name === name)
      if (edge) assert.equal(manifest(join(stage, edge.directory)).version, version, `Changed dependency version: ${record.name} -> ${name}`)
      else {
        const candidates = inventory.packages.filter(item => item.name === name && item.version === version)
        assert.equal(candidates.length, 1, `New dependency needs a new closure: ${record.name} -> ${name}@${version}`)
        reusableEdges.push({ importer: record.name, name, version })
      }
    }
  }
  checks.push({ name: 'current-workspace-dependencies-covered-by-production-closure', pass: true, reusableEdges })
  if (compareAssets) {
    const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
    const record = name => { const value = inventory.packages.find(item => item.name === name); assert.ok(value, `Missing workspace package: ${name}`); return join(stage, value.directory) }
    const pairs = [
      ['host-entry', join(repo, 'packages/dsh-runtime/dist/node-host.mjs'), join(stage, 'dist/node-host.mjs')],
      ['shared-host-main-generation', join(repo, 'packages/dsh-compatibility-host/src/main-generation.js'), join(record('@eleckoi/dsh-compatibility-host'), 'src/main-generation.js')],
      ['shared-author-client-runtime', join(repo, 'packages/dsh-client-tavern-shared/src/runtime.js'), join(record('@eleckoi/dsh-client-tavern-shared'), 'src/runtime.js')],
      ['compatibility-sdk', join(repo, 'packages/compatibility/tavern-shared/dist/tavern-shared.global.js'), join(record('@eleckoi/compatibility-tavern-shared'), 'dist/tavern-shared.global.js')],
      ['compatibility-upstream-runtime', join(repo, 'packages/compatibility/tavern-shared/dist/tavern-runtime.global.js'), join(record('@eleckoi/compatibility-tavern-shared'), 'dist/tavern-runtime.global.js')],
      ['actual-renderer-entry', join(repo, 'out/renderer-dsh/assets/app.js'), join(stage, 'resources/dsh/renderer/assets/app.js')],
      ['product-frontend-viewport', join(repo, 'out/renderer-dsh/assets/eleckoi-page-messages.js'), join(stage, 'resources/dsh/renderer/assets/eleckoi-page-messages.js')],
      ['actual-profile-manifest', join(repo, 'resources/dsh/runtime-manifest.json'), join(stage, 'resources/dsh/runtime-manifest.json')],
      ['registered-default-creator-profile', join(repo, 'resources/dsh/cordis.yml'), join(stage, 'resources/dsh/cordis.yml')],
      ['registered-default-creator-agent-patch', join(repo, 'resources/dsh/desktop-agent.patch.yml'), join(stage, 'resources/dsh/desktop-agent.patch.yml')]
    ]
    for (const [name, source, packaged] of pairs) {
      const sha256 = hash(source); assert.equal(hash(packaged), sha256, `Stale production asset: ${name}`)
      checks.push({ name, pass: true, sha256 })
    }
  }
} catch (error) { failure = error.message; checks.push({ name: 'failure', pass: false, message: failure }) }
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify({ pass: !failure, stage, compareAssets, checks }, null, 2) + '\n')
if (failure) throw new Error(`${failure}; report: ${reportPath}`)
process.stdout.write(JSON.stringify({ pass: true, reportPath, checks: checks.length }) + '\n')
