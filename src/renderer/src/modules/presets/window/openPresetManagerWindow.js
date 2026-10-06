import { openProductWindow } from '../../../app/services/platform.js';
const PRESET_MANAGER_WINDOW_NAME = "preset-manager";

export function openPresetManagerWindow() {
  const managerUrl = new URL(window.location.href);
  managerUrl.search = "?view=preset-manager";
  openProductWindow(
    managerUrl.toString(),
    PRESET_MANAGER_WINDOW_NAME,
    "width=1500,height=1040",
  );
}
