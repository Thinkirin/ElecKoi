export const DEFAULT_APPEARANCE_MODE = "light";
export const APPEARANCE_MODES = ["light", "dark", "system"];

export function normalizeAppearanceMode(mode) {
  return APPEARANCE_MODES.includes(mode) ? mode : DEFAULT_APPEARANCE_MODE;
}

export function applyAppearanceMode() {
  const root = document.documentElement;
  const source = root.dataset.dsThemeSource;
  const resolved = document.body?.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
  root.dataset.appearanceMode = source === "system" ? "system" : resolved;
  root.dataset.theme = resolved;
  return { mode: root.dataset.appearanceMode, resolved };
}

export async function initializeAppearanceMode() {
  const update = () => applyAppearanceMode();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ds-theme-source"] });
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
  update();
  return () => observer.disconnect();
}
