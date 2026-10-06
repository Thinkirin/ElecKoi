import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useDshDisplayPreferences } from "../../settings/index.js";
import { HistoryExportIcon, HistoryImportIcon, TrashIcon, XIcon } from "../../../ui/icons/index.jsx";
import { Avatar } from "../../../ui/ui/Avatar.jsx";
import { DshSearchField } from "../../../ui/ui/DshSearchField.jsx";
import { applyChatHistoryPolicy, exportChatHistory, importChatHistory } from "../api/chatApi.js";
import { useAnimatedClose } from "../../../ui/hooks/useAnimatedClose.js";

const EMPTY_SNAPSHOT = Object.freeze({ status: "loading", ui: Object.freeze({}) });
const EMPTY_SUBSCRIBE = () => () => {};
const GET_EMPTY_SNAPSHOT = () => EMPTY_SNAPSHOT;

function dateTitle(value) {
  if (!value) return "未知日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知日期";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "/");
}

function timeTitle(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function HistoryModal({ open, sessions, sessionId, chatCharacter, conversationModel, onClose, onLoadChat, onDeleteChat, onHistoryPolicyChange }) {
  const { closing, close } = useAnimatedClose(onClose, 200, open);
  const preferences = useDshDisplayPreferences();
  const preferenceSnapshot = useSyncExternalStore(
    preferences?.subscribe || EMPTY_SUBSCRIBE,
    preferences?.getSnapshot || GET_EMPTY_SNAPSHOT,
  );
  const [keyword, setKeyword] = useState("");
  const [saveMode, setSaveMode] = useState("all");
  const [confirmAction, setConfirmAction] = useState(null);
  const [transferError, setTransferError] = useState("");
  const [transferring, setTransferring] = useState(false);
  const importInput = useRef(null);
  const currentSession = (sessions || []).find((item) => item.id === sessionId);
  const currentCharacterId = currentSession?.character_id || chatCharacter?.character_id || "";
  const characterName = currentSession?.character_name || chatCharacter?.assistant_name || chatCharacter?.character_name || "";

  useEffect(() => {
    if (!open || preferenceSnapshot.status !== "ready") return;
    setSaveMode(preferenceSnapshot.ui?.history_save_mode === "recent10" ? "recent10" : "all");
  }, [open, preferenceSnapshot.status, preferenceSnapshot.ui]);

  useEffect(() => {
    if (!open) return;
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (confirmAction) setConfirmAction(null);
      else close();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [close, confirmAction, open]);

  const filteredGroups = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    const filtered = (sessions || [])
      .filter((item) => item.character_id && item.character_id === currentCharacterId)
      .filter((item) => {
        const text = `${item.character_name || ""} ${item.title || ""} ${item.summary || ""} ${item.id || ""} ${dateTitle(item.updated_at)}`.toLowerCase();
        return !key || text.includes(key);
      })
      .sort((a, b) => {
        if (a.id === sessionId) return -1;
        if (b.id === sessionId) return 1;
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
    const visible = saveMode === "recent10" ? filtered.slice(0, 10) : filtered;
    const groups = new Map();
    for (const item of visible) {
      const date = dateTitle(item.updated_at);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(item);
    }
    return [...groups.entries()];
  }, [currentCharacterId, sessions, keyword, sessionId, saveMode]);

  async function chooseSaveMode(mode) {
    if (mode === saveMode) return;
    if (mode === "recent10") {
      const relatedCount = (sessions || []).filter((item) => item.character_id && item.character_id === currentCharacterId).length;
      if (relatedCount > 10) {
        setConfirmAction({ type: "policy", mode });
        return;
      }
    }
    await applySaveMode(mode);
  }

  async function applySaveMode(mode) {
    setSaveMode(mode);
    await preferences?.updateUi({ history_save_mode: mode });
    if (mode === "recent10" && currentCharacterId) {
      await applyChatHistoryPolicy(currentCharacterId);
      await onHistoryPolicyChange?.();
    }
  }

  function requestDeleteChat(item) {
    setConfirmAction({ type: "delete", item });
  }

  async function exportHistory(item) {
    if (transferring) return;
    setTransferError("");
    setTransferring(true);
    try {
      const { json } = await exportChatHistory(item.id, { model: conversationModel });
      const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `eleckoi-chat-${item.id}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setTransferError(error?.message || "导出聊天记录失败。");
    } finally {
      setTransferring(false);
    }
  }

  async function importHistory(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || transferring) return;
    setTransferError("");
    if (!currentCharacterId) {
      setTransferError("请先选择角色，再导入聊天记录。");
      return;
    }
    setTransferring(true);
    try {
      const { conversationId } = await importChatHistory(currentCharacterId, await file.text(), { model: conversationModel });
      await onHistoryPolicyChange?.();
      await onLoadChat?.(conversationId);
      close();
    } catch (error) {
      setTransferError(error?.message || "导入聊天记录失败。");
    } finally {
      setTransferring(false);
    }
  }

  async function confirmPendingAction() {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    if (action.type === "policy") {
      await applySaveMode(action.mode);
      return;
    }
    if (action.type === "delete" && action.item?.id) {
      await onDeleteChat?.(action.item.id);
    }
  }

  if (!open) return null;

  return createPortal((
    <div className={`history-overlay${closing ? " closing" : ""}`} onMouseDown={close}>
      <section className="history-window" role="dialog" aria-modal="true" aria-label="对话历史" onMouseDown={(event) => event.stopPropagation()}>
        <header className="history-titlebar">
          <strong>{characterName}</strong>
          <button type="button" onClick={close} title="关闭">
            <XIcon />
          </button>
        </header>

        <DshSearchField
          className="history-search"
          value={keyword}
          onValueChange={setKeyword}
          placeholder="搜索历史对话…"
          ariaLabel="搜索历史对话"
          autoFocus
        />

        <div className="history-toolbar">
          <div className="history-retention" role="radiogroup" aria-label="当前策略">
            <b>当前策略</b>
            <button
              className={saveMode === "all" ? "active" : ""}
              type="button"
              role="radio"
              aria-checked={saveMode === "all"}
              onClick={() => chooseSaveMode("all")}
            >
              <span />
              保留全部记录
            </button>
            <button
              className={saveMode === "recent10" ? "active" : ""}
              type="button"
              role="radio"
              aria-checked={saveMode === "recent10"}
              onClick={() => chooseSaveMode("recent10")}
            >
              <span />
              仅保留最新10条
            </button>
          </div>
          <div className="history-actions" aria-label="历史对话操作">
            <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={importHistory} />
            <button type="button" title="导入聊天记录" aria-label="导入聊天记录" disabled={transferring} onClick={() => importInput.current?.click()}>
              <HistoryImportIcon />
            </button>
          </div>
        </div>

        {transferError ? <div className="history-transfer-error" role="alert">{transferError}</div> : null}

        <div className="history-list">
          {!filteredGroups.length ? (
            <div className="history-empty">
              <strong>暂无历史对话</strong>
              <span>当前角色还没有本地保存的对话。</span>
            </div>
          ) : null}
          {filteredGroups.map(([date, items]) => (
            <section className="history-day" key={date}>
              <h3>{date}</h3>
              {items.map((item) => {
                const active = item.id === sessionId;
                const itemCharacterName = item.character_name || characterName || "角色";
                const itemCharacterAvatar = item.character_avatar || "";
                return (
                  <div className={`history-item ${active ? "active" : ""}`} key={item.id}>
                    <button
                      className="history-item-main"
                      type="button"
                      onClick={() => {
                        onLoadChat(item.id);
                        close();
                      }}
                    >
                      <Avatar src={itemCharacterAvatar} name={itemCharacterName} />
                      <div>
                        <p>
                          <b>{active ? "当前" : itemCharacterName}</b>
                          <time>{timeTitle(item.updated_at)}</time>
                        </p>
                        <span>{item.summary || item.title || "新对话"}</span>
                      </div>
                    </button>
                    <button className="history-item-export" type="button" title="导出这条记录" aria-label="导出这条记录" disabled={transferring} onClick={() => exportHistory(item)}>
                      <HistoryExportIcon />
                    </button>
                    <button className="history-item-delete" type="button" title="删除这条记录" onClick={() => requestDeleteChat(item)}>
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        {confirmAction ? (
          <div className="history-confirm-backdrop" onMouseDown={() => setConfirmAction(null)}>
            <section className="history-confirm" onMouseDown={(event) => event.stopPropagation()}>
              <strong>{confirmAction.type === "policy" ? "切换保留策略" : "删除历史对话"}</strong>
              <span>
                {confirmAction.type === "policy"
                  ? "仅保留最新 10 条会删除更早的历史记录，删除后无法恢复。"
                  : "这条历史记录会被删除，删除后无法恢复。"}
              </span>
              <div>
                <button type="button" onClick={() => setConfirmAction(null)}>
                  取消
                </button>
                <button className="danger" type="button" onClick={confirmPendingAction}>
                  {confirmAction.type === "policy" ? "确认切换" : "确认删除"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  ), document.body);
}
