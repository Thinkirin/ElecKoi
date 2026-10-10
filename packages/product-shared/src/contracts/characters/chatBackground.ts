export const APP_DEFAULT_CHAT_BACKGROUND = 'eleckoi://chat-background/app-default'
export const GLOBAL_CHAT_BACKGROUND = 'eleckoi://chat-background/global'
export const CUSTOM_CHAT_BACKGROUND = 'eleckoi://chat-background/custom'
export const DEFAULT_NEW_CHARACTER_BACKGROUND = 'app'

export function normalizeNewCharacterBackground(value: unknown): 'app' | 'character' {
  return value === 'character' ? 'character' : DEFAULT_NEW_CHARACTER_BACKGROUND
}
