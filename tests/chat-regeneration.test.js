import { describe, expect, it } from "vitest";
import {
  findLatestRegenerateTargetMessageId,
  findRegenerateBranchUserIndex,
} from "../apps/web/src/modules/chat/model/chatRegeneration.js";

describe("chat regeneration targets", () => {
  it('uses the explicit continuation input identity instead of a later same-turn or same-content row', () => {
    const messages = [
      { id: 'original', role: 'user', runtimeSessionId: 'session-1', sessionEventSeq: 5, dshTurn: 1, content: '相同合成输入' },
      { id: 'other-session', role: 'user', runtimeSessionId: 'session-2', sessionEventSeq: 5, dshTurn: 2, content: '相同合成输入' },
      { id: 'later', role: 'user', runtimeSessionId: 'session-1', sessionEventSeq: 15, dshTurn: 2, content: '相同合成输入' },
      { id: 'reply', role: 'assistant', runtimeSessionId: 'session-1', inputEventSeq: 5, dshTurn: 2 }
    ];
    expect(findRegenerateBranchUserIndex(messages, 'reply')).toBe(0);
    expect(findRegenerateBranchUserIndex(messages.slice(1), 'reply')).toBe(-1);
    expect(findRegenerateBranchUserIndex(messages, 'original', true)).toBe(0);
  });

  it("allows regeneration directly from a sent user message without an assistant reply", () => {
    const messages = [{ id: "user-1", role: "user", content: "测试消息" }];

    expect(findLatestRegenerateTargetMessageId(messages)).toBe("user-1");
    expect(findRegenerateBranchUserIndex(messages, "user-1")).toBe(0);
  });

  it("uses the newest unanswered user message instead of an older assistant reply", () => {
    const messages = [
      { id: "user-1", role: "user", content: "第一条" },
      { id: "assistant-1", role: "assistant", content: "第一条回复" },
      { id: "user-2", role: "user", content: "第二条" },
    ];

    expect(findLatestRegenerateTargetMessageId(messages)).toBe("user-2");
    expect(findRegenerateBranchUserIndex(messages, "user-2")).toBe(2);
  });

  it("keeps the normal assistant-reply regeneration path", () => {
    const messages = [
      { id: "opening", role: "assistant", content: "开场白" },
      { id: "user-1", role: "user", content: "测试消息", runtimeSessionId: 'session-1', dshTurn: 1 },
      { id: "assistant-1", role: "assistant", content: "测试回复", runtimeSessionId: 'session-1', dshTurn: 1 },
    ];

    expect(findLatestRegenerateTargetMessageId(messages)).toBe("assistant-1");
    expect(findRegenerateBranchUserIndex(messages, "assistant-1")).toBe(1);
  });

  it("uses the durable turn id shared by a user message and its assistant response", () => {
    const messages = [
      { id: "user-message", turnId: "turn-1", role: "user", content: "测试消息" },
      { id: "assistant-response", turnId: "turn-1", role: "assistant", content: "测试回复" },
    ];

    expect(findLatestRegenerateTargetMessageId(messages)).toBe("turn-1");
    expect(findRegenerateBranchUserIndex(messages, "turn-1")).toBe(0);
  });

  it('never chooses the nearest user without the matching Session turn identity', () => {
    const messages = [
      { id: 'selected', role: 'user', runtimeSessionId: 'session-1', dshTurn: 1 },
      { id: 'other', role: 'user', runtimeSessionId: 'session-1', dshTurn: 2 },
      { id: 'reply', role: 'assistant', runtimeSessionId: 'session-1', dshTurn: 1 },
    ];
    expect(findRegenerateBranchUserIndex(messages, 'reply')).toBe(0);
    expect(findRegenerateBranchUserIndex(messages.slice(1), 'reply')).toBe(-1);
    expect(findRegenerateBranchUserIndex([
      { id: 'input', role: 'user' }, { id: 'reply', role: 'assistant' },
    ], 'reply')).toBe(-1);
  });

  it("ignores opening messages and pending replies", () => {
    const messages = [
      { id: "opening", role: "assistant", content: "开场白" },
      { id: "user-1", role: "user", content: "测试消息" },
      { id: "pending-1", role: "assistant", content: "", pending: true },
    ];

    expect(findLatestRegenerateTargetMessageId(messages)).toBe("user-1");
  });
});
