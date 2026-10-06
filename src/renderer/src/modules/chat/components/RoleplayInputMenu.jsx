import { useAnimatedClose } from "../../../ui/hooks/useAnimatedClose.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { useChatMenuPosition } from '../hooks/useChatMenuPosition.js';
import { DshNewChatIcon, DshRefreshIcon } from "../../../ui/icons/dshComposerIcons.jsx";
import { ChatHistoryIcon, MenuIcon, PictureFrameIcon, PlugIcon } from "../../../ui/icons/openSourceIcons.jsx";
import { TrashIcon } from "../../../ui/icons/index.jsx";
import { Code, Database } from "@phosphor-icons/react";

/** Roleplay-only actions placed immediately after the native DSH plus button. */
export function RoleplayInputMenu({
  isSending,
  onCreateChat,
  onOpenHistory,
  onAddImages,
  onOpenTools,
  onOpenVariables,
  onOpenFrontends,
  onEnterDeleteMode,
  canDeleteMessages = false,
  onRegenerate,
  regenerateTargetMessageId,
  pluginEntries = [],
  onOpenPluginUi,
}) {
  const [open, setOpen] = useState(false);
  const { closing, close } = useAnimatedClose(() => setOpen(false), 200, open);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const menuStyle = useChatMenuPosition(open, rootRef);
  const imageInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, close]);

  function run(action) {
    close();
    action?.();
  }

  function pickImages() {
    imageInputRef.current?.click();
  }

  function handleImages(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) onAddImages?.(files);
    close();
  }

  return (
    <div className="composer-more-anchor" ref={rootRef}>
      {onAddImages ? <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={handleImages} /> : null}
      <button
        className={`roleplay-menu-trigger composer-more-trigger ${open ? "active" : ""}`}
        type="button"
        aria-label={open ? "收起扮演菜单" : "扮演菜单"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="扮演菜单"
        onClick={() => open ? close() : setOpen(true)}
      >
        <MenuIcon size={17} weight="bold" />
      </button>
      {open && menuStyle ? createPortal(
        <div ref={menuRef} style={menuStyle} className={`composer-more-menu${closing ? ' is-closing' : ''}`} role="menu" aria-label="扮演菜单">
          <RoleplayMenuItems {...{ run, isSending, onCreateChat, onOpenHistory, onAddImages: pickImages, onOpenTools, onOpenVariables,
            onOpenFrontends, onEnterDeleteMode, canDeleteMessages, onRegenerate, regenerateTargetMessageId, pluginEntries, onOpenPluginUi }} />
        </div>, document.body
      ) : null}
    </div>
  );
}

export function RoleplayMenuItems({ run = action => action?.(), isSending, onCreateChat, onOpenHistory, onAddImages, onOpenTools,
  onOpenVariables, onOpenFrontends, onEnterDeleteMode, canDeleteMessages, onRegenerate, regenerateTargetMessageId,
  pluginEntries = [], onOpenPluginUi }) {
  return <>
          {onAddImages ? <button type="button" role="menuitem" onClick={() => run(onAddImages)}>
            <PictureFrameIcon size={18} /><span>图片</span>
          </button> : null}
          <button type="button" role="menuitem" onClick={() => run(onOpenHistory)}>
            <ChatHistoryIcon size={18} /><span>聊天记录</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenTools)}>
            <PlugIcon size={18} /><span>工具</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenVariables)}>
            <Database size={18} weight="regular" /><span>变量查看器</span>
          </button>
          {onOpenFrontends ? <button type="button" role="menuitem" onClick={() => run(onOpenFrontends)}>
            <Code size={18} /><span>高级 HTML 前端</span>
          </button> : null}
          {pluginEntries.map(entry => <button key={`${entry.pluginId}:${entry.id}`} type="button" role="menuitem"
            data-plugin-id={entry.pluginId} data-plugin-ui-id={entry.id} title={entry.scriptName || entry.pluginId}
            onClick={() => run(() => onOpenPluginUi?.(entry))}>
            <PlugIcon size={18} /><span>{entry.label || entry.id}</span>
          </button>)}
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
  </>;
}
