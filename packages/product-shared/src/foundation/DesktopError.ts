export const DESKTOP_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  INTERNAL: 'INTERNAL'
} as const

export type DesktopErrorCode = typeof DESKTOP_ERROR_CODES[keyof typeof DESKTOP_ERROR_CODES]

export class DesktopError extends Error {
  constructor(
    readonly code: DesktopErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'DesktopError'
  }
}
