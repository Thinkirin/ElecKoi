import { openProductWindow } from '../../../app/services/platform.js';
const CREATOR_STUDIO_WINDOW_NAME = "creator-studio";

export function openCreatorStudioWindow() {
  const studioUrl = new URL(window.location.href);
  studioUrl.search = "?view=creator-studio";
  openProductWindow(
    studioUrl.toString(),
    CREATOR_STUDIO_WINDOW_NAME,
    "width=1536,height=1070",
  );
}
