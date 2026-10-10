import { describe, expect, it } from "vitest";
import {
  collapseSessionsByCharacter,
  filterHiddenConversationEntries,
  hideConversationEntry,
  restoreConversationEntry,
  selectSessionForCharacter,
  sortSessionsByPinned,
} from "../apps/web/src/modules/chat/model/chatSessionView.js";

function session(id, characterId, updatedAt) {
  return {
    id,
    character_id: characterId,
    character_name: characterId,
    updated_at: updatedAt,
  };
}

describe("conversation list entries", () => {
  it("prefers the chosen history over the newest record when reentering a character", () => {
    const allSessions = [
      session("newest-a", "character-a", "2026-09-19T03:00:00Z"),
      session("chosen-a", "character-a", "2026-09-19T01:00:00Z"),
      session("only-b", "character-b", "2026-09-19T02:00:00Z"),
    ];

    expect(selectSessionForCharacter(allSessions, "character-a", "chosen-a")?.id).toBe("chosen-a");
    expect(selectSessionForCharacter(allSessions, "character-b", "chosen-a")?.id).toBe("only-b");
    expect(selectSessionForCharacter(allSessions, "character-a", "deleted-a")?.id).toBe("newest-a");
  });

  it("keeps each character's chosen history in the collapsed message list", () => {
    const allSessions = [
      session("newest-a", "character-a", "2026-09-19T03:00:00Z"),
      session("chosen-a", "character-a", "2026-09-19T01:00:00Z"),
      session("active-b", "character-b", "2026-09-19T02:00:00Z"),
    ];
    const preferred = new Map([["character-a", "chosen-a"], ["character-b", "active-b"]]);
    expect(collapseSessionsByCharacter(sortSessionsByPinned(allSessions, []), "active-b", preferred)
      .map((item) => item.id)).toEqual(["chosen-a", "active-b"]);
  });

  it("hides the collapsed entry without deleting any conversation history", () => {
    const allSessions = [
      session("latest-session", "same-character", "2026-09-19T03:00:00Z"),
      session("older-session", "same-character", "2026-09-19T01:00:00Z"),
    ];

    const collapsed = collapseSessionsByCharacter(sortSessionsByPinned(allSessions, []), "");
    const visible = filterHiddenConversationEntries(collapsed, ["latest-session"]);

    expect(visible).toEqual([]);
    expect(allSessions.map((item) => item.id)).toEqual(["latest-session", "older-session"]);
  });

  it("restores only the matching hidden entry when that conversation becomes active again", () => {
    const hidden = ["other-session", "active-session", "older-session"];

    expect(restoreConversationEntry(hidden, "active-session")).toEqual([
      "other-session",
      "older-session",
    ]);
    expect(restoreConversationEntry(hidden, "missing")).toEqual(hidden);
  });

  it("adds one normalized hidden entry without duplicates", () => {
    expect(hideConversationEntry([" existing ", "existing"], " next ")).toEqual([
      "next",
      "existing",
    ]);
    expect(hideConversationEntry(["existing"], "existing")).toEqual(["existing"]);
  });
});
