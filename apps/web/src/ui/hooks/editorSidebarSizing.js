export const DEFAULT_INSPECTOR_WIDTH = 760;
export const MIN_INSPECTOR_WIDTH = 520;
export const MAX_INSPECTOR_WIDTH = 1040;

export function inspectorWidthBounds(containerWidth) {
  const availableWidth = Math.max(280, Number(containerWidth) || window.innerWidth || 1280);
  const max = Math.max(280, Math.min(MAX_INSPECTOR_WIDTH, Math.floor(availableWidth * 0.72)));
  return { min: Math.min(MIN_INSPECTOR_WIDTH, max), max };
}
