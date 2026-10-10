import type { ComponentType } from 'react'

export interface UiPreferences {
  conversation_content_width?: number
  [key: string]: unknown
}

export const SettingsPanel: ComponentType<Record<string, unknown>>
export interface DisplayPreferencesSnapshot {
  status: 'loading' | 'ready' | 'error'
  ui: UiPreferences
  chatDisplay: Record<string, unknown>
  writable: boolean
  revision?: number
  error: string
}
export interface DisplayPreferencesModel {
  getSnapshot(): DisplayPreferencesSnapshot
  subscribe(listener: () => void): () => void
  refresh(): Promise<DisplayPreferencesSnapshot>
  updateUi(update: Partial<UiPreferences> | ((current: UiPreferences) => UiPreferences)): Promise<DisplayPreferencesSnapshot>
  setChatDisplay(value: Record<string, unknown>): Promise<DisplayPreferencesSnapshot>
}
export const DisplayPreferencesProvider: ComponentType<{
  model: DisplayPreferencesModel | null
  children?: unknown
}>
export function useDshDisplayPreferences(): DisplayPreferencesModel | null
