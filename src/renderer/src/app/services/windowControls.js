import { closeProductWindow, getDesktopService } from './platform.js';

let resizeModeInstalled = false;

export function installResizePerformanceMode() {
  if (resizeModeInstalled || typeof window === "undefined") {
    return;
  }

  resizeModeInstalled = true;
  let resizeTimer = 0;

  function markResizing() {
    document.documentElement.classList.add("is-window-resizing");
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      document.documentElement.classList.remove("is-window-resizing");
    }, 140);
  }

  window.addEventListener("resize", markResizing, { passive: true });
}

export async function ensureInitialWindowSizeOnce() {
  return false;
}

export async function showCurrentWindow() {
  return undefined;
}

export const appWindow = {
  get available() {
    return Boolean(getDesktopService('windowControls'));
  },
  async minimize() {
    const controls = getDesktopService('windowControls');
    if (!controls) throw new Error('当前平台不提供桌面窗口控制。');
    await controls.minimize();
  },

  async maximizeToggle() {
    const controls = getDesktopService('windowControls');
    if (!controls) throw new Error('当前平台不提供桌面窗口控制。');
    await controls.maximizeToggle();
  },

  async close() {
    if (closeProductWindow()) return;
    const controls = getDesktopService('windowControls');
    if (!controls) throw new Error('当前平台不提供桌面窗口控制。');
    await controls.close();
  },
};
