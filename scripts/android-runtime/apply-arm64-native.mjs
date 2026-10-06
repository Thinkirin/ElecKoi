import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const specifications = [
  { owner: '@deepseek-ai/node-addon-system', name: '@deepseek-ai/node-addon-system-linux-arm64', version: '0.1.2',
    integrity: 'Z/DQtqgEYzjBzb2ocHGjMzx51W7xDILkJKKj89nyErr8gZMNiLs+JNL1uKzJqc3VLZB+vYCPaHGyQ3oX6EzEmA==' },
  { owner: 'koffi', ownerVersion: '3.1.1', name: '@koromix/koffi-linux-arm64', version: '3.1.1',
    integrity: 'HA9xINK7G4dRAkpfnBWD9VfuyIBgW1SuK+KPHjksUwRMOnhgqP8J/JqgrAzdzcDiefGBkqEacIP776OUwz7knQ==' },
  { owner: 'koffi', ownerVersion: '3.1.5', name: '@koromix/koffi-linux-arm64', version: '3.1.5',
    integrity: 'u0vCmKPu4yQDhl/ri1J6U3vDnvYtYjoZaIWb+oMbRXhVZeiqdE53MGPb+q2A7Dj2n9IbYloAfEICQbL6l0pmiQ==' },
  { owner: '@deepseek-ai/libreoffice-kit', name: '@deepseek-ai/libreoffice-kit-wasm', version: '0.1.1',
    integrity: 'YuKZJdDhR/0GeTZUHJsJvachJR8ZiS4lcrL+lxUF2GLRwXcMikN0zAQOA+6kD/nRI+vlHsCkX0KvHaKvfae79Q==' },
  { owner: 'sharp', name: '@img/sharp-linux-arm64', version: '0.35.4',
    integrity: 'De4jpEnAU8Hd5oT0j1G3uL4ZvTuipVMn7YC6vPaJhy6/7EwEae0SVAoBrUMYQbkLGDm85taVWwuPc1a44LTzCQ==' },
  { owner: 'sharp', name: '@img/sharp-libvips-linux-arm64', version: '1.3.3',
    integrity: '0DaL0A6Xu6sQSQFwe4iVCrKWU2cCTItnRsYsCdxAMm9NF6twAA9BKnoqy4hqz4+azQ0JHuA26qiUKsf1XJ/v5A==' },
  { owner: 'node-addon-require-builtin', name: 'node-addon-require-builtin-linux-arm64-gnu', version: '0.1.6',
    integrity: 'DrQA3aS1LBn4NgrewbZkzSAWdSSRPD/fYO5AkQfvriQ/TQD3E2adB012sZ5eac6p9TAcTjUIYhk395AYVxo4Zw==' },
  { owner: '@vscode/ripgrep', name: '@vscode/ripgrep-linux-arm64', version: '1.18.0',
    integrity: 'lQ/5zTG++U0E3IhVgS4EPTTn/U4okncaRMM5GOFfOYZywS4nuD31GhkHbNYlDk5CuDC68+hYJ0/eQeyCKJDA+g==' },
  { owner: 'sherpa-onnx-node', name: 'sherpa-onnx-linux-arm64', version: '1.13.8',
    integrity: 'Tlg7a70b/Wge3OF8IgTHF9jhSVCsLyKQKhwc4BsJ5A+dL/SrFtGBjzuHp4XeLhiiOT7afCxX5PdSn/D4c8Lnuw==' }
]

export function applyArm64Native(output, downloads) {
  const inventory = JSON.parse(readFileSync(join(output, 'production-closure.json'), 'utf8'))
  const evidence = []
  const installed = new Map()
  for (const spec of specifications) {
    const owners = inventory.packages.filter(record => record.name === spec.owner && (!spec.ownerVersion || record.version === spec.ownerVersion))
    if (owners.length === 0) continue
    const archive = join(downloads, `${spec.name.replace(/[^a-zA-Z0-9.-]/g, '_')}-${spec.version}.tgz`)
    if (!existsSync(archive)) throw new Error(`Download exact ARM64 optional dependency first: ${archive}`)
    if (createHash('sha512').update(readFileSync(archive)).digest('base64') !== spec.integrity) throw new Error(`Native npm tarball integrity mismatch: ${archive}`)
    for (const owner of owners) {
      const destination = join(output, owner.directory, 'node_modules', spec.name)
      mkdirSync(destination, { recursive: true })
      extract(archive, destination, 1)
      const manifest = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))
      if (manifest.name !== spec.name || manifest.version !== spec.version) throw new Error(`Native package identity mismatch: ${archive}`)
      if (!installed.has(spec.name)) installed.set(spec.name, new Map())
      installed.get(spec.name).set(spec.version, destination)
      evidence.push({ owner: `${owner.name}@${owner.version}`, name: spec.name, version: spec.version, integrity: `sha512-${spec.integrity}` })
    }
  }
  // Shared native loaders resolve from their own package, not the API wrapper.
  // Expose unambiguous platform packages at the installation root as pnpm does,
  // while keeping versioned bindings next to each importing owner.
  for (const [name, versions] of installed) {
    if (versions.size !== 1) continue
    const target = join(output, 'node_modules', name)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(relative(dirname(target), versions.values().next().value), target, 'dir')
  }
  const sqliteArchive = join(downloads, 'better-sqlite3-v12.11.1-node-v137-linux-arm64.tar.gz')
  const sqlite = inventory.packages.filter(record => record.name === 'better-sqlite3')
  if (sqlite.length === 0) throw new Error('Production closure is missing better-sqlite3')
  for (const record of sqlite) {
    if (record.version !== '12.11.1') throw new Error(`Unpinned SQLite dependency: ${record.version}`)
    extract(sqliteArchive, join(output, record.directory), 0)
    evidence.push({ name: 'better-sqlite3', version: record.version, nodeAbi: 137, architecture: 'linux-arm64',
      sha256: createHash('sha256').update(readFileSync(sqliteArchive)).digest('hex') })
  }
  writeFileSync(join(output, 'arm64-native-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  return evidence
}

function extract(archive, destination, strip) {
  const result = spawnSync('tar', ['-xzf', archive, '--strip-components', String(strip), '-C', destination], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Native archive extraction failed: ${archive}`)
}
