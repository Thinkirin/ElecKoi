export { ThemePaletteModal } from "./components/ThemePaletteModal.jsx";
export {
  applyAppearanceMode,
  initializeAppearanceMode,
  normalizeAppearanceMode,
} from "./theme/appearanceMode.js";
export { applyAppearanceTheme, createAppearanceThemeFromImageSource } from "./theme/appearanceTheme.js";
export { createAppFontController, DEFAULT_APP_FONT_ID, SYSTEM_APP_FONT, normalizeAppFont } from './preferences/appFont.js';
export { AppearanceProvider, useDshAppearance } from "./model/AppearanceContext.jsx";
export {
  DEFAULT_SIDEBAR_CHARACTER_ARTWORK,
  normalizeSidebarCharacterArtwork,
} from "./preferences/sidebarCharacterArtwork.js";
export {
  chatDisplayCssVariables,
  chatTextColorCssVariables,
  messageFloorNumber,
  resolveChatAvatar,
  resolveChatAvatarShape,
  resolveChatDisplayProfile,
} from "./preferences/chatDisplay.js";
export {
  APP_DEFAULT_CHAT_BACKGROUND,
  CHAT_WALLPAPER_DEFAULTS,
  CUSTOM_CHAT_BACKGROUND,
  DEFAULT_NEW_CHARACTER_BACKGROUND,
  GLOBAL_CHAT_BACKGROUND,
  chatWallpaperMode,
  characterArtwork,
  fileToDataUrl,
  normalizeGlobalChatWallpaper,
  normalizeNewCharacterBackground,
  resolveChatWallpaper,
} from "./preferences/chatWallpaper.js";
