import { createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { Unzip, UnzipInflate } from 'fflate'

export interface AndroidBackupEntry { name: string; kind: string; bytes: number; sha256: string; owner_id?: string }
export interface AndroidBackupManifest {
  format: 'eleckoi-backup'; version: 3 | 4; entries: AndroidBackupEntry[]; directories: string[]; excluded: string[]
  character_count: number; session_count: number; creator_workspace_count: number; creator_conversation_count: number
}
export interface ExtractedAndroidBackup { root: string; manifest: AndroidBackupManifest; sourceHash: string }

export function androidArchivePath(root: string, name: string): string {
  if (!name || name.includes('\\') || isAbsolute(name) || /^[A-Za-z]:/.test(name)) throw new Error(`Invalid archive path: ${name}`)
  const path = resolve(root, name), suffix = relative(resolve(root), path)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(suffix)) throw new Error(`Archive path leaves its root: ${name}`)
  return path
}

/** Incremental inflate and SHA: large backups never become a single in-memory ZIP or file map. */
export async function extractAndroidBackup(archivePath: string, root: string): Promise<ExtractedAndroidBackup> {
  mkdirSync(root, { recursive: true })
  const archiveHash = createHash('sha256'), actual = new Map<string, { bytes: number; sha256: string }>()
  const handles = new Set<number>()
  let failure: Error | undefined
  const unzip = new Unzip(file => {
    if (failure) return
    try {
      if (file.name.endsWith('/')) { mkdirSync(androidArchivePath(root, file.name), { recursive: true }); return }
      if (actual.has(file.name)) throw new Error(`Duplicate backup entry: ${file.name}`)
      const path = androidArchivePath(root, file.name)
      mkdirSync(dirname(path), { recursive: true })
      const descriptor = openSync(path, 'w'), digest = createHash('sha256')
      handles.add(descriptor); actual.set(file.name, { bytes: 0, sha256: '' })
      file.ondata = (error, chunk, final) => {
        if (failure) return
        if (error) { failure = error; return }
        try {
          let offset = 0
          while (offset < chunk.length) offset += writeSync(descriptor, chunk, offset)
          digest.update(chunk); actual.get(file.name)!.bytes += chunk.length
          if (final) { closeSync(descriptor); handles.delete(descriptor); actual.get(file.name)!.sha256 = digest.digest('hex') }
        } catch (error) { failure = error as Error }
      }
      file.start()
    } catch (error) { failure = error as Error }
  })
  unzip.register(UnzipInflate)
  try {
    for await (const chunk of createReadStream(archivePath)) {
      archiveHash.update(chunk); unzip.push(new Uint8Array(chunk))
      if (failure) throw failure
    }
    unzip.push(new Uint8Array(), true)
    if (failure) throw failure
    if (handles.size) throw new Error('Backup ZIP contains incomplete entries')
    const manifestPath = join(root, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error('Backup has no manifest.json; use the original app v3/v4 export')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AndroidBackupManifest
    if (manifest.format !== 'eleckoi-backup' || ![3, 4].includes(manifest.version) || !Array.isArray(manifest.entries)) throw new Error('Unsupported Android backup format')
    if (new Set(manifest.entries.map(entry => entry.name)).size !== manifest.entries.length) throw new Error('Duplicate manifest entries')
    const contents = new Map(actual); contents.delete('manifest.json')
    if (contents.size !== manifest.entries.length) throw new Error('Backup manifest and actual entries differ')
    for (const entry of manifest.entries) {
      androidArchivePath(root, entry.name)
      const actualEntry = contents.get(entry.name)
      if (!actualEntry || actualEntry.bytes !== entry.bytes || ((manifest.version === 4 || entry.kind !== 'symlink') && actualEntry.sha256 !== entry.sha256)) throw new Error(`Backup size/hash mismatch: ${entry.name}`)
    }
    return { root, manifest, sourceHash: archiveHash.digest('hex') }
  } finally { for (const descriptor of handles) closeSync(descriptor) }
}
