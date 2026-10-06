import { openProductWindow } from '../../../app/services/platform.js';
const CHARACTER_MANAGER_WINDOW_NAME = "character-manager";

export function openCharacterManagerWindow() {
  const managerUrl = new URL(window.location.href);
  managerUrl.search = "?view=character-manager";
  openProductWindow(
    managerUrl.toString(),
    CHARACTER_MANAGER_WINDOW_NAME,
    "width=1500,height=1040",
  );
}
