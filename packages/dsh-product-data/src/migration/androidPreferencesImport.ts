import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { appearanceUiPreferencesSchema, chatDisplayPreferencesSchema, DEFAULT_CHAT_DISPLAY_PREFERENCES } from '../../../../src/shared/contracts/settings/schemas'

type ObjectRecord = Record<string, unknown>
function object(value: unknown, label: string): ObjectRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as ObjectRecord
}
function validateSection(section: unknown, format: string): ObjectRecord {
  const input = object(section, format)
  if (input.format !== format || input.version !== 1) throw new Error(`Unsupported ${format} format/version`)
  return input
}
function color(value: unknown, opaque = false): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('Android color must be an ARGB integer')
  const argb = value >>> 0, r = (argb >>> 16) & 255, g = (argb >>> 8) & 255, b = argb & 255
  return opaque || argb >>> 24 === 255
    ? '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
    : `rgba(${r}, ${g}, ${b}, ${Number(((argb >>> 24) / 255).toFixed(4))})`
}

/** Map only preferences consumed by the common client; the migration host also preserves the entire source. */
export function decodeAndroidPreferences(options: {
  section: unknown, currentUi?: unknown, currentChatDisplay?: unknown
}) {
  const source = object(validateSection(options.section, 'eleckoi.ui-preferences').values, 'preferences.values')
  const values = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, object(value, key).value]))
  const ui = { ...appearanceUiPreferencesSchema.parse(options.currentUi ?? {}) }
  const parsed = chatDisplayPreferencesSchema.safeParse(options.currentChatDisplay)
  const chatDisplay = structuredClone(parsed.success ? parsed.data : DEFAULT_CHAT_DISPLAY_PREFERENCES)
  const applied = new Set<string>()
  const has = (key: string) => Object.hasOwn(values, key)
  function apply(key: string, setter: (value: unknown) => void) {
    if (has(key)) { setter(values[key]); applied.add(key) }
  }
  for (const key of ['new_character_background', 'sidebar_character_artwork']) apply(key, value => { ui[key] = value })
  for (const [from, to] of [['pinned_chat_ids_json', 'pinned_chat_ids'], ['hidden_chat_ids_json', 'hidden_chat_ids']]) {
    apply(from!, value => {
      if (typeof value !== 'string') throw new Error(`${from} must contain JSON text`)
      ui[to!] = JSON.parse(value)
    })
  }
  const fields = {
    chat_layout_mode: 'layout', chat_reasoning_display_mode: 'reasoning_display_mode',
    chat_generation_stats_enabled: 'generation_stats_enabled', chat_roleplay_timestamps_enabled: 'roleplay_timestamps_enabled',
    chat_roleplay_message_floors_enabled: 'roleplay_message_floors_enabled'
  } as const
  for (const [from, to] of Object.entries(fields)) apply(from, value => { (chatDisplay as unknown as ObjectRecord)[to] = value })
  const profileKeys = {
    assistant_bubble_enabled: 'assistant_bubble_enabled', chat_bubble_corner_radius: 'bubble_corner_radius',
    chat_avatar_size: 'avatar_size', chat_avatar_shape: 'avatar_shape', chat_name_font_size: 'name_font_size',
    chat_name_avatar_spacing: 'name_avatar_spacing', chat_area_horizontal_padding: 'horizontal_padding',
    chat_reply_spacing: 'reply_spacing', chat_turn_spacing: 'turn_spacing', chat_message_font_size: 'message_font_size',
    chat_line_height_multiplier: 'line_height_multiplier', chat_letter_spacing: 'letter_spacing', chat_paragraph_spacing: 'paragraph_spacing'
  } as const
  for (const scope of ['social', 'agent', 'roleplay'] as const) {
    for (const [from, to] of Object.entries(profileKeys)) apply(`${from}_${scope}`, value => {
      (chatDisplay.profiles[scope] as unknown as ObjectRecord)[to] = value
    })
  }
  for (const [from, to] of Object.entries({ appearance_markdown_italic_color: 'italics', appearance_markdown_underline_color: 'underline', appearance_markdown_quote_color: 'quote' } as const)) {
    apply(from, value => { chatDisplay.text_colors[to] = color(value, true) })
  }
  let themeMode: 'light' | 'dark' | 'system' | undefined
  apply('appearance_mode', value => {
    if (value !== 'light' && value !== 'dark' && value !== 'system') throw new Error(`Invalid appearance_mode: ${String(value)}`)
    themeMode = value; ui.appearance_mode = value
  })
  if (values.appearance_theme_stored === true) {
    const colors: ObjectRecord = {}
    const palette: Record<string, string[]> = {
      appearance_mobile_root_bg: ['shellBackdrop'], appearance_mobile_surface: ['rail', 'list'],
      appearance_mobile_text: ['titleFg', 'railFg', 'chatHeaderFg', 'composerIconFg'],
      appearance_mobile_chat_bg: ['chat'], appearance_mobile_pinned_bg: ['active'],
      appearance_mobile_blue: ['blue', 'blueHover'], appearance_mobile_search_bg: ['controlBg'],
      appearance_mobile_tabbar_bg: ['controlBgHover'], appearance_mobile_chat_message_bg: ['bubbleBg', 'bubbleWhite'],
      appearance_mobile_chat_message_fg: ['bubbleFg'], appearance_mobile_chat_user_bg: ['bubbleBlue'],
      appearance_mobile_line: ['glassBorder']
    }
    for (const [from, targets] of Object.entries(palette)) apply(from, value => {
      for (const target of targets) colors[target] = color(value)
    })
    if (Object.keys(colors).length) {
      ui.appearance_theme = { version: 2, mode: values.appearance_is_dark === true ? 'deep' : 'light', colors }
      applied.add('appearance_theme_stored'); if (has('appearance_is_dark')) applied.add('appearance_is_dark')
    }
  } else if (has('appearance_theme_stored') && values.appearance_theme_stored === false) {
    ui.appearance_theme = null; applied.add('appearance_theme_stored')
  }
  apply('appearance_texture_image_path', value => {
    if (typeof value !== 'string') throw new Error('appearance_texture_image_path must be text')
    const wallpaper: ObjectRecord = { image: value }
    for (const [from, to] of Object.entries({ appearance_texture_opacity: 'opacity', appearance_texture_blur: 'blur', appearance_texture_scrim: 'scrim' })) {
      apply(from, next => { if (typeof next !== 'number' || !Number.isFinite(next)) throw new Error(`${from} must be numeric`); wallpaper[to] = next })
    }
    ui.global_chat_wallpaper = wallpaper
  })
  return {
    ui: appearanceUiPreferencesSchema.parse(ui), chatDisplay: chatDisplayPreferencesSchema.parse(chatDisplay), themeMode,
    appliedKeys: [...applied], unmappedKeys: Object.keys(values).filter(key => !applied.has(key))
  }
}

export const ANDROID_DEFAULT_FONT_ID = 'lxgw-975yuan-sc'
const CATALOG_NAMES: Record<string, string> = { 'lxgw-yozai': '悠哉字体', 'lxgw-wenkai': '霞鹜文楷', 'lxgw-xiaolai': '小赖字体' }
export interface MigratedAppFont { id: string, name: string, reference: string }
export interface MigratedAppFontSelection { fontId: string, scope: 'all' | 'chat', reference?: string }

/** The host copies these bytes permanently before this helper runs; no temporary archive URL is persisted. */
export function prepareAndroidFontSelection(options: { section: unknown, sourceFilesRoot?: string }) {
  const source = validateSection(options.section, 'eleckoi.app-font')
  const fontId = source.font_id === undefined ? ANDROID_DEFAULT_FONT_ID : source.font_id
  if (typeof fontId !== 'string' || fontId !== basename(fontId) && fontId !== '') throw new Error('Invalid Android font_id')
  if (source.scope !== undefined && source.scope !== 'All' && source.scope !== 'ChatOnly') throw new Error('Invalid Android font scope')
  const installed: MigratedAppFont[] = []
  if (options.sourceFilesRoot) {
    for (const kind of ['downloaded', 'imported']) {
      const directory = resolve(options.sourceFilesRoot, 'fonts', kind)
      if (!existsSync(directory)) continue
      for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name)
        if (!/\.(ttf|otf|ttc|woff2?)$/i.test(name) || !statSync(path).isFile()) continue
        if (statSync(path).size === 0) throw new Error(`Android font file is empty: ${name}`)
        const id = kind === 'downloaded' ? name.replace(/\.ttf$/i, '') : name
        if (installed.some(font => font.id === id)) throw new Error(`Duplicate Android font ID: ${id}`)
        installed.push({ id, name: CATALOG_NAMES[id] ?? name, reference: path })
      }
    }
  }
  const selection: MigratedAppFontSelection = { fontId, scope: source.scope === 'ChatOnly' ? 'chat' : 'all' }
  if (fontId && fontId !== ANDROID_DEFAULT_FONT_ID) {
    const selected = installed.find(font => font.id === fontId)
    if (!selected) throw new Error(`Selected Android font file was not included: ${fontId}`)
    selection.reference = selected.reference
  }
  return { selection, installed }
}
