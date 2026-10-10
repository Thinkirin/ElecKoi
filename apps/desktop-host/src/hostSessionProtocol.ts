export type ParentHostMessage =
  | { type: 'update-tasks'; id: string; action: 'inspect' | 'lock' | 'unlock' }
  | { type: 'shutdown' }

export type ChildHostMessage =
  | { type: 'ready'; url: string; injections: readonly unknown[] }
  | { type: 'fatal'; message: string }
  | { type: 'shutdown-complete' }
  | { type: 'update-tasks-complete'; id: string; active: boolean; message?: string }
