import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function readSessionSnapshot(root, sessionId) {
  if (!root) throw new Error('ELECKOI_SESSION_SNAPSHOT_ROOT is required')
  const value = JSON.parse(readFileSync(snapshotPath(root, sessionId), 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ElecKoi Session snapshot: ${sessionId}`)
  }
  return value
}

export function writeSessionSnapshot(root, sessionId, value) {
  if (!root) throw new Error('ELECKOI_SESSION_SNAPSHOT_ROOT is required')
  mkdirSync(root, { recursive: true })
  const path = snapshotPath(root, sessionId)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function commitSessionPreset(root, sessionId, mountedPresetId, mountedPresetRevision) {
  const snapshot = readSessionSnapshot(root, sessionId)
  const {
    pendingPresetId: _pendingId,
    pendingPresetRevision: _pendingRevision,
    ...rest
  } = snapshot
  const path = snapshotPath(root, sessionId)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({
      ...rest,
      mountedPresetId,
      mountedPresetRevision
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * Materialize the immutable request/tool authority inherited by one in-process
 * child before DSH publishes the child Session or starts its first model step.
 */
export function inheritSessionSnapshot(root, parentSessionId, childSessionId) {
  const snapshot = readSessionSnapshot(root, parentSessionId)
  const path = snapshotPath(root, childSessionId)
  const content = `${JSON.stringify({
    ...snapshot,
    inheritedFromSessionId: String(parentSessionId),
    rootRuntimeThreadId: snapshot.rootRuntimeThreadId ?? snapshot.runtimeThreadId ?? String(parentSessionId)
  }, null, 2)}\n`
  mkdirSync(root, { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content, 'utf8')
  rmSync(path, { force: true })
  renameSync(temporary, path)
  return snapshot
}

export function removeSessionSnapshot(root, sessionId) {
  if (!root) return
  rmSync(snapshotPath(root, sessionId), { force: true })
}

export function snapshotPath(root, sessionId) {
  if (!root) throw new Error('ELECKOI_SESSION_SNAPSHOT_ROOT is required')
  const safeId = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160) || 'default'
  return join(root, `${safeId}.json`)
}
