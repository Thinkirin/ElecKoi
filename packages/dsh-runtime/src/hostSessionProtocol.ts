export type ParentHostMessage =
  | { type: 'update-tasks'; id: string; action: 'inspect' | 'lock' | 'unlock' }
  | { type: 'shutdown' }

export type ChildHostMessage =
  | { type: 'ready'; url: string; healthUrl?: string; injections: readonly unknown[] }
  | { type: 'fatal'; message: string }
  | { type: 'shutdown-complete' }
  | { type: 'update-tasks-complete'; id: string; active: boolean; message?: string }

export const HOST_CONTROL_PROTOCOL_VERSION = 1
export const HOST_CONTROL_STDOUT_PREFIX = 'ELECKOI_HOST\t'

/** The same controls are carried over Node IPC on desktop and JSONL on Android. */
export function isParentHostMessage(value: unknown): value is ParentHostMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const message = value as Record<string, unknown>
  if (message.type === 'shutdown') return true
  return message.type === 'update-tasks' && typeof message.id === 'string'
    && ['inspect', 'lock', 'unlock'].includes(String(message.action))
}
