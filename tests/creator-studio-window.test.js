import { afterEach, describe, expect, it, vi } from "vitest";
import { openCreatorStudioWindow } from "../apps/web/src/modules/creatorStudio/window/openCreatorStudioWindow.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Creator studio window launcher", () => {
  it("opens or focuses the creator studio without navigating the current window", () => {
    const open = vi.fn(() => null);
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "http://127.0.0.1:5173/?view=chat&chat=conversation-1",
        assign,
      },
      open,
    });

    openCreatorStudioWindow();

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/?view=creator-studio",
      "creator-studio",
      "width=1536,height=1070",
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
