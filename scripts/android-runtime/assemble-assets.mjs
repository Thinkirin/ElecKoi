#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const flags = new Map()
const args = process.argv.slice(2)
if (args.length % 2 !== 0) throw new Error('Runtime assembly arguments must be flag/value pairs')
for (let i = 0; i < args.length; i += 2) {
  if (!['--rootfs', '--node', '--app', '--version', '--output'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`)
  flags.set(args[i], args[i + 1])
}
for (const name of ['--rootfs', '--node', '--app', '--version', '--output']) {
  if (!flags.get(name)) throw new Error(`Missing ${name}: provide verified rootfs.tar.gz, node.tar.gz and app.tar.gz`)
}
const output = join(resolve(flags.get('--output')), 'runtime')
mkdirSync(output, { recursive: true })
const archives = []
// AAPT2 interprets asset names ending in .gz: it gunzips the content and strips
// that suffix. Keep gzip bytes opaque so the manifest checksum and toybox tar
// input refer to the exact staged archive, rather than AAPT2's transformed file.
for (const [flag, filename, target] of [['--rootfs', 'rootfs.archive', 'rootfs'],
  ['--node', 'node.archive', 'rootfs'], ['--app', 'app.archive', 'app']]) {
  const source = resolve(flags.get(flag))
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Runtime archive missing: ${source}`)
  const destination = join(output, filename)
  if (source !== destination) copyFileSync(source, destination)
  archives.push({ asset: `runtime/${filename}`, target,
    sha256: createHash('sha256').update(readFileSync(destination)).digest('hex'), bytes: statSync(destination).size })
}
const manifest = { schemaVersion: 1, version: flags.get('--version'), architecture: 'arm64-v8a',
  nodeExecutable: '/usr/bin/node', hostEntrypoint: '/eleckoi/app/bin/eleckoi-host.mjs',
  protocolVersion: 1, archives }
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ assetsDirectory: resolve(flags.get('--output')), manifest })}\n`)
