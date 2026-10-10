import { useSyncExternalStore } from "react";
import { useDshDisplayPreferences } from "../../settings/index.js";
import {
  hideConversationEntry,
  normalizeConversationEntryIds,
  restoreConversationEntry,
} from "../model/chatSessionView.js";

const EMPTY_SNAPSHOT = Object.freeze({ ui: Object.freeze({}) });
const EMPTY_SUBSCRIBE = () => () => {};
const GET_EMPTY_SNAPSHOT = () => EMPTY_SNAPSHOT;

export function useConversationListPreferences() {
  const preferences = useDshDisplayPreferences();
  const snapshot = useSyncExternalStore(
    preferences?.subscribe || EMPTY_SUBSCRIBE,
    preferences?.getSnapshot || GET_EMPTY_SNAPSHOT,
  );
  const pinnedIds = normalizeConversationEntryIds(snapshot.ui?.pinned_chat_ids);
  const hiddenIds = normalizeConversationEntryIds(snapshot.ui?.hidden_chat_ids);

  function updateIds(key, update) {
    void preferences?.updateUi((current) => ({
      ...current,
      [key]: update(normalizeConversationEntryIds(current?.[key])),
    })).catch(() => {});
  }

  function togglePinChat(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return;
    updateIds("pinned_chat_ids", (items) => (
      items.includes(id) ? items.filter((item) => item !== id) : [id, ...items]
    ));
  }

  function unpinChat(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return;
    updateIds("pinned_chat_ids", (items) => items.filter((item) => item !== id));
  }

  function hideChatEntry(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return;
    updateIds("hidden_chat_ids", (items) => hideConversationEntry(items, id));
  }

  function restoreChatEntry(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return;
    updateIds("hidden_chat_ids", (items) => restoreConversationEntry(items, id));
  }

  return {
    pinnedIds,
    hiddenIds,
    togglePinChat,
    unpinChat,
    hideChatEntry,
    restoreChatEntry,
  };
}
