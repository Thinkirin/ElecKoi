#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exposeInstallationPackages, pruneForeignPackages, refreshWorkspacePackages, stageProductionClosure } from './stage-production-closure.mjs'
import { applyArm64Native } from './apply-arm64-native.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flags = new Map()
if (args.length % 2 !== 0) throw new Error('Host package arguments must be flag/value pairs')
for (let i = 0; i < args.length; i += 2) {
  if (!['--output', '--native-downloads', '--reuse-production'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`)
  flags.set(args[i], args[i + 1])
}
if (!flags.get('--output') || !flags.get('--native-downloads')) {
  throw new Error('Usage: node scripts/android-runtime/build-host-package.mjs --output build/android-runtime/app --native-downloads build/android-runtime/downloads')
}
const output = resolve(flags.get('--output'))
if (output === repo || repo.startsWith(`${output}${sep}`)) throw new Error('Host output must not contain the repository')
if (!flags.has('--reuse-production') && existsSync(output) && readdirSync(output).length > 0) throw new Error(`Host output is not empty: ${output}`)
for (const file of ['packages/dsh-runtime/dist/node-host.mjs', 'packages/dsh-runtime/dist/desktop-plugin-host.mjs']) {
  if (!existsSync(join(repo, file))) throw new Error(`Build the shared workspace packages first: ${file}`)
}
const closure = flags.has('--reuse-production')
  ? JSON.parse(readFileSync(join(resolve(flags.get('--reuse-production')), 'production-closure.json'), 'utf8'))
  : stageProductionClosure(repo, output)
if (flags.has('--reuse-production') && resolve(flags.get('--reuse-production')) !== output) {
  throw new Error('--reuse-production must name the same staged output directory')
}
pruneForeignPackages(output, closure)
exposeInstallationPackages(output, closure)
const refreshedWorkspacePackages = refreshWorkspacePackages(repo, output, closure)
applyArm64Native(output, resolve(flags.get('--native-downloads')))
cpSync(join(repo, 'packages', 'dsh-runtime', 'dist'), join(output, 'dist'), { recursive: true, dereference: true })
for (const record of closure.packages.filter(record => record.name.startsWith('@eleckoi/dsh-client-'))) {
  const workspacePackage = join(repo, 'packages', record.name.split('/')[1])
  cpSync(join(workspacePackage, 'src'), join(output, record.directory, 'src'), { recursive: true, dereference: true })
}
const resources = join(output, 'resources', 'dsh')
mkdirSync(dirname(resources), { recursive: true })
cpSync(join(repo, 'resources', 'dsh'), resources, { recursive: true, dereference: true })
if (!existsSync(join(repo, 'out', 'renderer-dsh', 'assets', 'app.js'))) throw new Error('Build the shared renderer before packaging the Host')
cpSync(join(repo, 'out', 'renderer-dsh'), join(resources, 'renderer'), { recursive: true, dereference: true })
chmodSync(join(resources, 'node-bin', 'node'), 0o755)
mkdirSync(join(output, 'bin'), { recursive: true })
writeFileSync(join(output, 'bin', 'eleckoi-host.mjs'), "#!/usr/bin/env node\nimport '@eleckoi/dsh-runtime/node-host'\n", { mode: 0o755 })
const packagedRequire = createRequire(join(output, 'package.json'))
const sourceManifest = JSON.parse(readFileSync(join(resources, 'runtime-manifest.json'), 'utf8'))
const bundleNames = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...sourceManifest.desktopProfile.bundles]
const bundles = bundleNames.map(name => {
  const manifestPath = packagedRequire.resolve(`${name}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const patches = manifest.dsh?.bundle?.patch
  if (!patches) throw new Error(`Host bundle has no composition patch: ${name}`)
  for (const patch of typeof patches === 'string' ? [patches] : patches) {
    if (!existsSync(resolve(dirname(manifestPath), patch))) throw new Error(`Host bundle patch missing: ${name}/${patch}`)
  }
  return { name, version: manifest.version }
})
for (const name of sourceManifest.presetPlugins) packagedRequire.resolve(name)
packagedRequire.resolve('@eleckoi/dsh-runtime/node-host')
const pnpmManifest = packagedRequire.resolve('pnpm')
if (!existsSync(join(dirname(pnpmManifest), 'bin', 'pnpm.mjs'))) throw new Error('Host package is missing pnpm entry')
// pnpm publishes a private, vendored dependency tree inside dist. It is part
// of the executable, rather than an installed dependency graph edge.
cpSync(join(repo, 'node_modules', 'pnpm', 'dist', 'node_modules'),
  join(dirname(pnpmManifest), 'dist', 'node_modules'), { recursive: true, dereference: true })
const sqlitePackage = dirname(packagedRequire.resolve('better-sqlite3/package.json'))
const sqliteBinary = join(sqlitePackage, 'build', 'Release', 'better_sqlite3.node')
assertArm64Elf(sqliteBinary)
const ptyPackage = dirname(packagedRequire.resolve('node-pty/package.json'))
const ptyBinary = join(ptyPackage, 'build', 'Release', 'pty.node')
if (existsSync(ptyBinary)) assertArm64Elf(ptyBinary)
else if (!existsSync(join(ptyPackage, 'prebuilds', 'linux-arm64'))) {
  throw new Error('Host package has no Linux ARM64 node-pty binary')
}
const escaped = findEscapingLinks(output)
if (escaped.length > 0) throw new Error(`Host dependencies escape the package: ${escaped.join(', ')}`)
const manifest = {
  schemaVersion: 1,
  architecture: 'linux-arm64',
  upstream: sourceManifest.upstream,
  entrypoint: 'bin/eleckoi-host.mjs',
  resources: 'resources/dsh',
  protocolVersion: 1,
  stdoutPrefix: 'ELECKOI_HOST\t',
  bundles,
  refreshedWorkspacePackages,
  native: { sqlite: relative(output, sqliteBinary).split(sep).join('/'), pty: relative(output, ptyPackage).split(sep).join('/') }
}
writeFileSync(join(output, 'host-package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const archive = `${output}.tar.gz`
if (existsSync(archive)) throw new Error(`Host archive already exists: ${archive}`)
// Keep symlinks, but materialize hardlinks Android extraction cannot create.
const tar = spawnSync('tar', ['--hard-dereference', '-czf', archive, '-C', output, '.'], { stdio: 'inherit' })
if (tar.error) throw tar.error
if (tar.status !== 0) throw new Error(`Host archive failed: exit ${tar.status}`)
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
writeFileSync(`${archive}.sha256`, `${sha256}  ${archive.split(/[\\/]/).pop()}\n`)
process.stdout.write(`${JSON.stringify({ output, archive, sha256, bytes: statSync(archive).size, bundles: bundles.length, packages: closure.packages.length })}\n`)

function assertArm64Elf(file) {
  if (!existsSync(file)) throw new Error(`Linux ARM64 native dependency missing: ${file}`)
  const bytes = readFileSync(file)
  if (bytes.length < 20 || bytes.subarray(0, 4).toString('hex') !== '7f454c46'
    || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 183) {
    throw new Error(`Expected a Linux ARM64 ELF dependency; build native modules for the chosen Node ABI: ${file}`)
  }
}

function findEscapingLinks(root) {
  const escaped = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path)
        if (target !== root && !target.startsWith(`${root}${sep}`)) escaped.push(relative(root, path))
      }
    }
  }
  return escaped
}
