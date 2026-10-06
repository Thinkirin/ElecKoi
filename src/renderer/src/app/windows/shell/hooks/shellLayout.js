export const SIDE_PANEL_DEFAULT = 328;
export const SIDE_PANEL_MIN = 264;
export const SIDE_PANEL_MAX = 420;
export const MAIN_PANEL_MIN = 640;
export const RAIL_MIN = 52;
// A rail, usable catalog, main editor and divider must all fit before docking.
export const COMPACT_WIDTH = RAIL_MIN + SIDE_PANEL_MIN + MAIN_PANEL_MIN + 4;

export function solveRightbarGeometry(shellWidth, leftWidth, preferredWidth, compact) {
  const available = shellWidth - leftWidth - 400;
  const overlay = compact || available < 300;
  const preferred = Math.max(300, Math.min(preferredWidth, shellWidth * .7));
  return {
    overlay,
    width: compact ? shellWidth : Math.max(0, Math.min(preferred, overlay ? shellWidth : available)),
  };
}
