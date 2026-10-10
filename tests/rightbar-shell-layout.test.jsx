import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TitleBar } from "../apps/web/src/app/windows/shell/components/TitleBar.jsx";

globalThis.React = React;

const mainWindowSource = readFileSync(
  new URL("../apps/web/src/app/windows/MainWindow.jsx", import.meta.url),
  "utf8",
);
const rightbarLayoutSource = readFileSync(
  new URL("../apps/web/src/app/windows/shell/hooks/useRightbarLayout.js", import.meta.url),
  "utf8",
);
const titlebarStyles = readFileSync(
  new URL("../apps/web/src/app/windows/shell/styles/titlebar.css", import.meta.url),
  "utf8",
);
const shellStyles = readFileSync(
  new URL("../apps/web/src/app/windows/shell/styles/client-shell.css", import.meta.url),
  "utf8",
);
const chatStyles = readFileSync(
  new URL("../apps/web/src/modules/chat/styles/chat-panel.css", import.meta.url),
  "utf8",
);
const mainWindowPluginSource = readFileSync(
  new URL("../apps/desktop/src/main/platform/electron/mainWindowPlugin.ts", import.meta.url),
  "utf8",
);
const preloadSource = readFileSync(
  new URL("../apps/desktop/src/preload/preload.ts", import.meta.url),
  "utf8",
);
const desktopShellSource = readFileSync(
  new URL("../packages/product-shared/src/contracts/desktopShell.ts", import.meta.url),
  "utf8",
);

describe("right sidebar shell layout", () => {
  it("keeps the window controls outside the shrinking main-panel titlebar", () => {
    const embedded = renderToStaticMarkup(<TitleBar splitSurface />);
    const detached = renderToStaticMarkup(<TitleBar splitSurface showWindowControls={false} />);

    expect(embedded).toContain('title="最小化"');
    expect(detached).not.toContain('title="最小化"');
    expect(mainWindowSource).toMatch(/<TitleBar[\s\S]*?showWindowControls=\{false\}/);
    expect(mainWindowSource).toContain('className="main-window-controls"');
    expect(mainWindowSource).toMatch(/className="main-window-controls"[\s\S]*?<WindowControls \/>/);
    expect(titlebarStyles).toMatch(
      /\.main-window-controls\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*right:\s*0;/,
    );
  });

  it("adapts only the projected trigger appearance to the ElecKoi header", () => {
    expect(chatStyles).toMatch(
      /\.chat-header-actions\s+\[data-sidebar-right-expand\]\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*color:\s*var\(--chat-header-fg\);/,
    );
    expect(chatStyles).toMatch(
      /\.chat-header-actions\s+\[data-sidebar-right-expand\]\s+svg\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/,
    );
  });

  it("uses the collapsed left-sidebar width immediately on narrow windows", () => {
    expect(rightbarLayoutSource).toContain(
      "sidePanelCollapsed || geometry.viewportWidth < SIDEBAR_AUTO_COLLAPSE",
    );
    expect(rightbarLayoutSource).toContain(
      '"--dsh-windows-sidebar-width": `${geometry.railWidth + effectiveSidePanelWidth}px`',
    );
  });

  it("places the official right-sidebar surface above the custom main column", () => {
    const mainPanel = shellStyles.match(/\.main-panel-shell\s*\{([^}]*)\}/)?.[1] ?? "";
    const rightbarColumn = shellStyles.match(/\.dsh-rightbar-column\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(mainPanel).not.toContain("z-index");
    expect(rightbarColumn).toContain("position: relative");
    expect(rightbarColumn).toContain("overflow: visible");
    expect(rightbarColumn).toContain("z-index: 10");
  });

  it("keeps the right-sidebar title strip draggable", () => {
    expect(shellStyles).toMatch(
      /\.dsh-rightbar-column::before\s*\{[^}]*top:\s*-40px;[^}]*height:\s*40px;[^}]*-webkit-app-region:\s*drag;/,
    );
  });

  it("provides the official desktop browser bridge instead of an iframe-only fallback", () => {
    expect(desktopShellSource).toContain("browserAcquire: 'dsh-desktop:browser-acquire'");
    expect(desktopShellSource).toContain("browserRelease: 'dsh-desktop:browser-release'");
    expect(preloadSource).toContain("function createDesktopBrowserBridge()");
    expect(preloadSource).toContain("browser: createDesktopBrowserBridge()");
    expect(mainWindowPluginSource).toContain("webviewTag: !child");
    expect(mainWindowPluginSource).toContain("ipcMain.handle(DESKTOP_SHELL_IPC.browserAcquire");
    expect(mainWindowPluginSource).toContain("ipcMain.handle(DESKTOP_SHELL_IPC.browserRelease");
  });
});
