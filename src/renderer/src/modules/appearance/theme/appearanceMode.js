import { refreshAppearanceTheme } from "./appearanceTheme.js";

export const DEFAULT_APPEARANCE_MODE = "system";
export const APPEARANCE_MODES = ["light", "dark", "system"];

export function normalizeAppearanceMode(mode) {
  return APPEARANCE_MODES.includes(mode) ? mode : DEFAULT_APPEARANCE_MODE;
}

export function applyAppearanceMode() {
  const root = document.documentElement;
  const source = root.dataset.dsThemeSource;
  const mode = normalizeAppearanceMode(source);
  // The DSH service owns its system resolution. Only use matchMedia before it mounts.
  const resolved = source === "dark" || source === "light"
    ? source
    : source === "system"
      ? (document.body?.hasAttribute("data-ds-dark-theme") ? "dark" : "light")
      : (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (root.dataset.appearanceMode !== mode) root.dataset.appearanceMode = mode;
  if (root.dataset.theme !== resolved) {
    root.dataset.theme = resolved;
    refreshAppearanceTheme();
  }
  root.style.colorScheme = resolved;
  return { mode, resolved };
}

export async function initializeAppearanceMode() {
  const update = () => applyAppearanceMode();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ds-theme-source"] });
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const updateSystem = () => {
    if (!document.documentElement.dataset.dsThemeSource) update();
  };
  media?.addEventListener?.("change", updateSystem);
  update();
  return () => {
    observer.disconnect();
    media?.removeEventListener?.("change", updateSystem);
  };
}
