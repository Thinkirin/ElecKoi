import { useEffect, useRef, useState } from "react";
import { DshNewChatIcon, DshRefreshIcon } from "../../../ui/icons/dshComposerIcons.jsx";
import { ChatHistoryIcon, MenuIcon, PlugIcon } from "../../../ui/icons/openSourceIcons.jsx";
import { TrashIcon } from "../../../ui/icons/index.jsx";
import { Database, TextAlignLeft } from "@phosphor-icons/react";

/** Roleplay-only actions placed immediately after the native DSH plus button. */
export function RoleplayInputMenu({
  isSending,
  onCreateChat,
  onOpenHistory,
  onOpenTools,
  onOpenVariables,
  onOpenRequestPreview,
  onEnterDeleteMode,
  canDeleteMessages = false,
  onRegenerate,
  regenerateTargetMessageId,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function run(action) {
    setOpen(false);
    rootRef.current?.querySelector("button")?.focus();
    action?.();
  }

  return (
    <div className="composer-more-anchor" ref={rootRef}>
      <button
        className={`roleplay-menu-trigger composer-more-trigger ${open ? "active" : ""}`}
        type="button"
        aria-label={open ? "收起扮演菜单" : "扮演菜单"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="扮演菜单"
        onClick={() => setOpen((value) => !value)}
      >
        <MenuIcon size={17} weight="bold" />
      </button>
      {open ? (
        <div className="composer-more-menu" role="menu" aria-label="扮演菜单">
          <button type="button" role="menuitem" onClick={() => run(onOpenHistory)}>
            <ChatHistoryIcon size={18} /><span>聊天记录</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenTools)}>
            <PlugIcon size={18} /><span>工具</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenRequestPreview)}>
            <TextAlignLeft size={18} weight="regular" /><span>请求上下文预览</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenVariables)}>
            <Database size={18} weight="regular" /><span>变量查看器</span>
          </button>
          <button className="composer-new-chat-item" type="button" role="menuitem" onClick={() => run(onCreateChat)}>
            <DshNewChatIcon size={18} /><span>新建对话</span>
          </button>
          <button type="button" role="menuitem" disabled={isSending || !canDeleteMessages}
            onClick={() => run(onEnterDeleteMode)}>
            <TrashIcon size={18} /><span>删除消息</span>
          </button>
          <i aria-hidden="true" />
          <button type="button" role="menuitem" disabled={!regenerateTargetMessageId || isSending}
            onClick={() => run(() => onRegenerate?.({ targetMessageId: regenerateTargetMessageId }))}>
            <DshRefreshIcon size={18} /><span>重新生成</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
