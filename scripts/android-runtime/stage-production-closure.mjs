import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

/** Copy exact installed production packages, retaining each importer's version graph. */
export function stageProductionClosure(repo, output, { links = true } = {}) {
  const initial = resolve(repo, 'packages/dsh-runtime')
  const packages = new Map()
  const missingOptional = []
  function register(source, root = false) {
    source = realpathSync(source)
    if (packages.has(source)) return packages.get(source)
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const id = `${manifest.name.replace(/[^a-zA-Z0-9.-]/g, '_')}@${manifest.version}-${createHash('sha256').update(relative(repo, source)).digest('hex').slice(0, 10)}`
    const target = root ? output : join(output, 'node_modules', '.eleckoi-packages', id)
    const record = { source, target, name: manifest.name, version: manifest.version, dependencies: [] }
    packages.set(source, record)
    const require = createRequire(join(source, 'package.json'))
    const edges = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {})])
    for (const name of edges) {
      const optional = name in (manifest.optionalDependencies ?? {}) || manifest.peerDependenciesMeta?.[name]?.optional === true
      // Some npm dependencies (buffer, util) share names with Node builtins;
      // querying their name yields null although the installed package exists.
      const directory = (require.resolve.paths('__eleckoi_package_lookup__') ?? []).map(search => join(search, name))
        .find(candidate => existsSync(join(candidate, 'package.json')))
      if (!directory) {
        if (optional) { missingOptional.push({ owner: manifest.name, name }); continue }
        throw new Error(`Installed production dependency missing: ${manifest.name} -> ${name}`)
      }
      if (optional) {
        const child = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
        if (!matchesPlatform(child.os, 'linux') || !matchesPlatform(child.cpu, 'arm64')) {
          missingOptional.push({ owner: manifest.name, name, reason: 'not-linux-arm64' })
          continue
        }
      }
      record.dependencies.push({ name, package: register(directory) })
    }
    return record
  }
  register(initial, true)
  for (const record of packages.values()) {
    mkdirSync(record.target, { recursive: true })
    cpSync(record.source, record.target, { recursive: true, dereference: false,
      filter: path => path !== join(record.source, 'node_modules') && !['.git', '.turbo'].includes(basename(path)) })
  }
  // DSH installation anchors resolve shipped bundles before the runtime
  // interceptor starts. Expose the installed closure at the installation root;
  // importer-local links above still retain different transitive versions.
  const inventory = { schemaVersion: 1, packages: [...packages.values()].map(record => ({ name: record.name,
    version: record.version, directory: relative(output, record.target).split('\\').join('/'),
    dependencies: record.dependencies.map(dependency => ({ name: dependency.name,
      directory: relative(output, dependency.package.target).split('\\').join('/') })) })), missingOptional }
  writeFileSync(join(output, 'production-closure.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  if (links) exposeInstallationPackages(output, inventory)
  return inventory
}

function matchesPlatform(constraints, value) {
  if (!Array.isArray(constraints) || constraints.length === 0) return true
  if (constraints.includes(`!${value}`)) return false
  const positive = constraints.filter(entry => !entry.startsWith('!'))
  return positive.length === 0 || positive.includes(value)
}

export function exposeInstallationPackages(output, inventory) {
  // Windows directory junctions do not require the symbolic-link privilege.
  // Linux keeps relative links so the closure remains relocatable in the APK.
  const linkDirectory = (target, link) => symlinkSync(
    process.platform === 'win32' ? resolve(target) : relative(dirname(link), target),
    link,
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  for (const record of inventory.packages) {
    for (const dependency of record.dependencies ?? []) {
      const link = join(output, record.directory, 'node_modules', dependency.name)
      if (existsSync(link)) continue
      mkdirSync(dirname(link), { recursive: true })
      linkDirectory(join(output, dependency.directory), link)
    }
  }
  for (const record of inventory.packages) {
    const link = join(output, 'node_modules', record.name)
    if (existsSync(link)) continue
    mkdirSync(dirname(link), { recursive: true })
    linkDirectory(join(output, record.directory), link)
  }
}

/** Refresh every shared workspace package, retaining the staged dependency graph. */
export function refreshWorkspacePackages(repo, output, inventory) {
  const workspaceRoot = resolve(repo, 'packages')
  const workspacePackages = new Map()
  function collect(directory) {
    if (existsSync(join(directory, 'package.json'))) {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      workspacePackages.set(manifest.name, directory)
      return
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) collect(join(directory, entry.name))
    }
  }
  collect(workspaceRoot)
  const refreshed = []
  for (const record of inventory.packages.filter(item => item.name.startsWith('@eleckoi/'))) {
    const source = workspacePackages.get(record.name)
    if (!source) throw new Error(`Shared package source was not found: ${record.name}`)
    const actualSource = realpathSync(source)
    if (!actualSource.startsWith(`${workspaceRoot}${sep}`)) throw new Error(`Shared package is not a workspace source: ${record.name}`)
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    if (manifest.version !== record.version) throw new Error(`Regenerate the production closure for changed version: ${record.name}`)
    const required = Object.keys(manifest.dependencies ?? {}).concat(Object.keys(manifest.peerDependencies ?? {}).filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true))
    for (const name of required) {
      const paths = createRequire(join(source, 'package.json')).resolve.paths('__eleckoi_package_lookup__') ?? []
      const current = paths.map(path => join(path, name, 'package.json')).find(path => existsSync(path))
      if (!current) throw new Error(`Installed workspace dependency missing: ${record.name} -> ${name}`)
      const currentVersion = JSON.parse(readFileSync(current, 'utf8')).version
      let edge = record.dependencies.find(item => item.name === name)
      if (!edge) {
        const candidates = inventory.packages.filter(item => item.name === name && item.version === currentVersion)
        if (candidates.length !== 1) throw new Error(`Regenerate the production closure for added dependency: ${record.name} -> ${name}@${currentVersion}`)
        edge = { name, directory: candidates[0].directory }
        record.dependencies.push(edge)
      }
      const staged = JSON.parse(readFileSync(join(output, edge.directory, 'package.json'), 'utf8'))
      if (currentVersion !== staged.version) throw new Error(`Regenerate the production closure for changed dependency: ${record.name} -> ${name}`)
    }
    const target = resolve(output, record.directory)
    if (target !== resolve(output) && !target.startsWith(`${resolve(output)}${sep}`)) throw new Error(`Workspace refresh target escapes the package: ${record.name}`)
    // Replace generated/source resource directories so removed chunks cannot
    // survive in an otherwise current package. Keep staged node_modules links.
    for (const directory of ['lib', 'dist', 'src', 'types', 'assets', 'locale']) {
      if (existsSync(join(source, directory))) rmSync(join(target, directory), { recursive: true, force: true })
    }
    cpSync(source, target, { recursive: true, dereference: false,
      filter: path => path !== join(source, 'node_modules') && !['.git', '.turbo'].includes(basename(path)) })
    refreshed.push({ name: record.name, version: record.version })
  }
  writeFileSync(join(output, 'production-closure.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  exposeInstallationPackages(output, inventory)
  return refreshed
}

/** Drop foreign optional binaries when reusing a closure made on Windows. */
export function pruneForeignPackages(output, inventory) {
  const kept = []
  const removed = new Set()
  for (const record of inventory.packages) {
    const directory = resolve(output, record.directory)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (matchesPlatform(manifest.os, 'linux') && matchesPlatform(manifest.cpu, 'arm64')) {
      kept.push(record)
      continue
    }
    if (!directory.startsWith(`${resolve(output)}${sep}node_modules${sep}.eleckoi-packages${sep}`)) {
      throw new Error(`Foreign package removal target is outside the staged store: ${directory}`)
    }
    removed.add(record.directory)
    rmSync(directory, { recursive: true })
  }
  inventory.packages = kept.map(record => ({ ...record,
    dependencies: record.dependencies.filter(dependency => !removed.has(dependency.directory)) }))
  inventory.removedForeignPackages = [...removed]
  writeFileSync(join(output, 'production-closure.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  return inventory
}
