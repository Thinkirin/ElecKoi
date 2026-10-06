import { RoleplayInputMenu, RoleplayMenuItems } from "./RoleplayInputMenu.jsx";
import { createPortal } from 'react-dom';
import { useChatMenuPosition } from '../hooks/useChatMenuPosition.js';
import { ChatModelPicker } from "./ChatModelPicker.jsx";
import { ChatTurnError } from './ChatTurnError.jsx';
import { ConversationWidthControls } from "./ConversationWidthControls.tsx";
import conversationWidthCss from "./ConversationWidthControls.module.css";
import { PinnedAvatar } from "./PinnedAvatar.jsx";
import { AgentProcessDialog } from "./AgentProcessDialog.jsx";
import { VariableViewerDialog } from "./VariableViewerDialog.jsx";
import { AgentToolsDialog } from "./AgentToolsDialog.jsx";
import { MessageBubble } from "../../../ui/messages/MessageBubble.jsx";
import { ConfirmationDialog } from "../../../ui/ui/ConfirmationDialog.jsx";
import { Avatar } from "../../../ui/ui/Avatar.jsx";
import logoIcon from "../../../assets/eleckoi-app-icon.png";
import { DshAgentPresetIcon, DshNewChatIcon } from "../../../ui/icons/dshComposerIcons.jsx";
import { ArrowLeft, ImageSquare, ClockCounterClockwise, SlidersHorizontal, ChatCircleDots, Path, ArrowClockwise } from "@phosphor-icons/react";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  chatDisplayCssVariables,
  chatTextColorCssVariables,
  messageFloorNumber,
  resolveChatAvatar,
  resolveChatAvatarShape,
  resolveChatDisplayProfile,
} from "../../appearance/index.js";
import { findLatestRegenerateTargetMessageId } from "../model/chatRegeneration.js";
import { useMobileComposerKeyboard } from '../hooks/useMobileComposerKeyboard.js';
import { selectRoleplayChatSeat, selectRoleplayPendingInput } from "../model/chatViewSeats.js";
import { revealChatFile } from "../api/chatApi.js";
import { useFrontendWorkspace, AdvancedFrontendFrame, FrontendProjectManager, AdaptiveChatSheet, AdaptiveMessageEditor, createMessageSurfaceFormatter } from '../../authorFrontend/index.js';
import { createAppearanceThemeFromImageSource } from '../../appearance/index.js';
import { normalizeMarkdownForRendering } from '../../../ui/messages/normalizeMarkdownForRendering.js';

const TrajectoryView = lazy(() => import("./TrajectoryDialog.jsx").then((module) => ({
  default: module.TrajectoryView,
})));
const EMPTY_CHARACTER_RECORDS = Object.freeze([]);
const isHiddenMessage = (message) => message?.metadata?.is_hidden === true || message?.is_hidden === true;
export function ChatPanel({
  hasActiveChat,
  hasCharacters,
  currentTitle,
  conversationId,
  characterId = '',
  conversationModel,
  presetCatalog,
  persona,
  characterRecords = EMPTY_CHARACTER_RECORDS,
  messages,
  input,
  setInput,
  inputImages = [],
  onAddImages,
  onRemoveImage,
  inputFiles = [],
  onAddFiles,
  onRemoveFile,
  filesUploading = false,
  fileUploadProgress = null,
  isSending,
  modelConfigs,
  selectedModelConfigId,
  selectedModel,
  modelOptionsByKey,
  onLoadModelOptions,
  onSelectModel,
  onNotify,
  onSend,
  onStop,
  onCreateChat,
  onOpenChat,
  onCloseChat,
  onOpenHistory,
  onCloseHistory,
  onOpenChatBackground,
  onOpenPresetTools,
  onRegenerate,
  onDeleteMessages,
  onEditMessage,
  onEditOpening,
  onSelectOpening,
  onGoCharacterSettings,
  scrollRef,
  isLoadingOlderMessages = false,
  chatDisplay,
  runtimeSessionId = "",
  renderRoleplaySlot,
  renderRoleplaySlotChain,
  renderRoleplayMessage,
  dshComposerOwner,
  dshInputZone,
  dshConversation,
  isSwitchingChat = false,
  conversationTransitionRevision = 0,
}) {
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuPopupRef = useRef(null);
  const [processMessage, setProcessMessage] = useState(null);
  const [fallbackView, setFallbackView] = useState("chat");
  const activeView = dshConversation ? dshConversation.activeView : fallbackView;
  const viewTabs = dshConversation?.tabs ?? [{ id: "chat", label: "对话" }, { id: "trajectory", label: "轨迹" }];
  const selectView = (id) => {
    setHeaderMenuOpen(false);
    setDeleteMode(false);
    setDeleteFromMessageId("");
    if (dshConversation) dshConversation.selectView(id);
    else setFallbackView(id);
  };
  const [activePresetName, setActivePresetName] = useState("");
  const [trajectoryRevision, setTrajectoryRevision] = useState(0);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [messageScrollElement, setMessageScrollElement] = useState(null);
  const [frontendManagerOpen, setFrontendManagerOpen] = useState(false);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [frontendEditMessage, setFrontendEditMessage] = useState(null);
  const modelApiRef = useRef(null);
  const inputStateRef = useRef(input); inputStateRef.current = input;
  const frontend = useFrontendWorkspace(characterId);
  const selectedFrontend = frontend.workspace.projects.find(project => project.id === frontend.workspace.selectedProjectId);
  const openPluginUi = useCallback(entry => frontend.runtime.openPanel(entry.pluginId, entry.id)
    .catch(error => onNotify?.('error', error.message || String(error))), [frontend.runtime, onNotify]);
  const loadImage = useCallback((id, image) => {
    if (!conversationModel) return Promise.reject(new Error('DSH 图片服务尚未就绪。'));
    return conversationModel.readImage(id, image);
  }, [conversationModel]);
  const openFile = useCallback((id, attachmentId, name) => {
    return revealChatFile(id, attachmentId, name, { model: conversationModel });
  }, [conversationModel]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteFromMessageId, setDeleteFromMessageId] = useState("");
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [pinnedAvatar, setPinnedAvatar] = useState(null);
  const [conversationBody, setConversationBody] = useState(null);
  const [runningStatusTarget, setRunningStatusTarget] = useState(null);
  const chatPanelRef = useRef(null);
  const composerRegionRef = useRef(null);
  useMobileComposerKeyboard(composerRegionRef, runtimeSessionId || conversationId);
  const headerMenuRef = useRef(null);
  const headerMenuStyle = useChatMenuPosition(headerMenuOpen, headerMenuRef, { align: 'end', placement: 'below' });
  const settingsImageInputRef = useRef(null);
  const useAdvanced = Boolean(selectedFrontend && activeView === 'chat' && !deleteMode);

  useEffect(() => {
    if (!frontend.runtime || !conversationId) return undefined;
    const findMessage = id => {
      const message = messages.find((value, index) => value.id === id || index === id);
      if (!message) throw new Error(`显示消息不存在：${id}`);
      return message;
    };
    return frontend.runtime.registerChatUi(conversationId, {
      'input.get': () => ({ text: inputStateRef.current || '' }),
      'input.set': params => { const text = String(params.text || ''); inputStateRef.current = text; setInput(text); return { text }; },
      'input.append': params => { const text = String(inputStateRef.current || '') + String(params.text || ''); inputStateRef.current = text; setInput(text); return { text }; },
      'input.clear': () => { inputStateRef.current = ''; setInput(''); return { text: '' }; },
      'input.send': () => { const text = inputStateRef.current; if (!String(text || '').trim() && !inputImages.length && !inputFiles.length) return { submitted: false };
        Promise.resolve(onSend({ preventDefault() {} }, text)).catch(error => onNotify?.('error', error.message || String(error)));
        return { submitted: true }; },
      'presentation.current': () => ({ conversationId, characterId, characters: characterRecords, title: currentTitle, messages,
        isGenerating: isSending, persona, chatDisplay }),
      'ui.openSettings': () => { setChatSettingsOpen(true); return null; },
      'ui.openModels': () => { if (!modelApiRef.current) throw new Error('模型选择器尚未就绪'); modelApiRef.current.open(); return null; },
      'ui.openBackground': () => { onOpenChatBackground(); return null; },
      'ui.openHistory': () => { onOpenHistory(); return null; },
      'ui.createChat': async () => { await onCreateChat(); return null; },
      'ui.editMessage': params => {
        const message = findMessage(params.id);
        if (message.id === 'opening' ? message.canChangeOpening !== true : !Number.isSafeInteger(message.sessionEventSeq)) {
          throw new Error('这条消息当前不可编辑。');
        }
        setFrontendEditMessage(message); return null;
      },
      'ui.showProcess': params => { setProcessMessage(findMessage(params.id)); return null; },
      'ui.chatPanels': params => {
        if (params.action === 'toggle') setHeaderMenuOpen(value => !value);
        else if (params.action === 'reset') {
          setHeaderMenuOpen(false); setChatSettingsOpen(false); setFrontendManagerOpen(false);
          setVariablesOpen(false); setToolsOpen(false); setProcessMessage(null); setFrontendEditMessage(null);
          modelApiRef.current?.close?.(); onCloseHistory?.();
        } else throw new Error(`未知菜单操作：${params.action}`);
        return { accepted: true };
      },
      'appearance.createPalette': async params => {
        const resolve = window.__ElecKoiResolveAsset || (value => value);
        return createAppearanceThemeFromImageSource(resolve(params.image), { name: params.name });
      },
      'chats.open': async params => { if (!onOpenChat) throw new Error('当前页面没有会话导航服务'); await onOpenChat(params.id); return null; },
      'chats.close': () => { if (!onCloseChat) throw new Error('当前页面没有关闭会话服务'); onCloseChat(); return null; },
      'chats.openHistory': () => { onOpenHistory(); return null; },
    });
  }, [chatDisplay, characterId, characterRecords, conversationId, currentTitle, frontend.runtime, input, inputFiles.length, inputImages.length,
    isSending, messages, onCloseChat, onCloseHistory, onCreateChat, onOpenChat, onOpenChatBackground, onOpenHistory, onSend, persona, setInput]);

  useEffect(() => {
    if (!conversationId || !frontend.runtime || frontend.status !== 'ready' || !messageScrollElement || useAdvanced || activeView !== 'chat') return undefined;
    let disposed = false, stop;
    frontend.runtime.initialized?.then(() => {
      if (disposed) return;
      const sdk = window.ElecKoi;
      const retrieve = id => [...messageScrollElement.querySelectorAll('[data-message-id]')].find(node => node.dataset.messageId === id);
      const format = createMessageSurfaceFormatter(window);
      stop = sdk.ui.registerMessageSurface({ root: messageScrollElement, retrieve, conversationId,
        format: text => format(normalizeMarkdownForRendering(text)),
        refresh: (id, html) => { const node = retrieve(id)?.querySelector('.mes_text'); if (node) node.innerHTML = html; },
        syncMetadata: rows => { rows.forEach((row, index) => {
          const node = retrieve(row.native_id); if (node) { node.setAttribute('mesid', String(index)); node.setAttribute('is_user', String(row.is_user)); }
        }); },
      });
    }).catch(error => onNotify?.('error', error.message || String(error)));
    return () => { disposed = true; stop?.(); };
  }, [activeView, conversationId, frontend.runtime, frontend.status, messageScrollElement, onNotify, useAdvanced]);

  useLayoutEffect(() => {
    const panel = chatPanelRef.current;
    const composerRegion = composerRegionRef.current;
    const scroller = composerRegion?.parentElement;
    if (!panel || !composerRegion || !scroller || typeof ResizeObserver === "undefined") return undefined;
    const updateComposerHeight = () => {
      scroller.style.setProperty("--dsh-composer-height", `${composerRegion.offsetHeight}px`);
      scroller.style.setProperty("--dsh-conversation-viewport-height", `${scroller.clientHeight}px`);
    };
    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composerRegion);
    observer.observe(scroller);
    updateComposerHeight();
    return () => {
      observer.disconnect();
      scroller.style.removeProperty("--dsh-composer-height");
      scroller.style.removeProperty("--dsh-conversation-viewport-height");
    };
  }, [conversationBody]);
  const displayedMessages = useMemo(() => messages.filter((item) => !isHiddenMessage(item) && !(
    item.role === "assistant" && !item.pending && !String(item.content || "").trim() && !(item.process || []).length
  )), [messages]);
  const regenerateFrom = useCallback(async (message) => {
    const result = await onRegenerate?.(message);
    if (result !== false) setTrajectoryRevision((revision) => revision + 1);
    return result;
  }, [onRegenerate]);
  const bindMessageScrollElement = useCallback((element) => {
    scrollRef.current = element;
    setMessageScrollElement(element);
  }, [scrollRef]);

  useEffect(() => {
    setFallbackView("chat");
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    const load = () => presetCatalog.refresh()
      .then((catalog) => {
        if (!active) return;
        setActivePresetName(catalog.presets.find((preset) => preset.id === catalog.activePresetId)?.name || "");
      })
      .catch(() => {
        if (active) setActivePresetName("");
      });
    void load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, [conversationId, presetCatalog]);

  useEffect(() => {
    setDeleteMode(false);
    setDeleteFromMessageId("");
    setDeletingMessages(false);
    setDeleteConfirmationOpen(false);
  }, [conversationId]);

  useEffect(() => setPinnedAvatar(null), [conversationId]);

  useEffect(() => {
    if (!deleteMode || deleteConfirmationOpen) return undefined;
    const cancelDelete = (event) => {
      if (event.key !== "Escape" || deletingMessages) return;
      setDeleteMode(false);
      setDeleteFromMessageId("");
    };
    window.addEventListener("keydown", cancelDelete);
    return () => window.removeEventListener("keydown", cancelDelete);
  }, [deleteConfirmationOpen, deleteMode, deletingMessages]);

  useEffect(() => {
    if (!headerMenuOpen) return undefined;
    const close = (event) => {
      if (!headerMenuRef.current?.contains(event.target) && !headerMenuPopupRef.current?.contains(event.target)) {
        setHeaderMenuOpen(false);
      }
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setHeaderMenuOpen(false);
      headerMenuRef.current?.querySelector('[aria-haspopup="menu"]')?.focus();
    };
    window.addEventListener("click", close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener("click", close); window.removeEventListener('keydown', escape); };
  }, [headerMenuOpen]);

  const openingMessage = messages.find((item) => item.id === "opening" && item.openingOptions?.length > 1);
  useEffect(() => {
    if (!openingMessage?.canChangeOpening || isSending || deleteMode || String(input || "").length || processMessage || headerMenuOpen) return undefined;
    const options = openingMessage.openingOptions || [];
    const selectedIndex = options.findIndex((item) => item.id === openingMessage.selectedOpeningId);
    const switchOpening = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      const nextIndex = event.key === "ArrowLeft" ? selectedIndex - 1 : selectedIndex + 1;
      if (nextIndex < 0 || nextIndex >= options.length) return;
      event.preventDefault();
      const pagerButton = scrollRef.current?.querySelector(
        event.key === "ArrowLeft" ? ".has-opening-pager .opening-pager-prev" : ".has-opening-pager .opening-pager-next",
      );
      if (pagerButton instanceof HTMLButtonElement) {
        if (!pagerButton.disabled) pagerButton.click();
        return;
      }
      onSelectOpening?.(openingMessage, options[nextIndex].id);
    };
    window.addEventListener("keydown", switchOpening);
    return () => window.removeEventListener("keydown", switchOpening);
  }, [deleteMode, headerMenuOpen, input, isSending, onSelectOpening, openingMessage, processMessage]);

  if (!hasActiveChat) {
    return (
      <section className="chat-panel chat-panel-empty-state" aria-label="未选择聊天">
        <div className="chat-empty-guide">
          <img src={logoIcon} alt="" draggable="false" />
          {hasCharacters ? (
            <>
              <strong>选择一个角色开始聊天</strong>
              <button type="button" onClick={onGoCharacterSettings}>选择角色</button>
            </>
          ) : (
            <>
              <strong>还没有聊天角色</strong>
              <button type="button" onClick={onGoCharacterSettings}>去创建角色</button>
            </>
          )}
        </div>
      </section>
    );
  }

  const { layout: layoutMode, profile } = resolveChatDisplayProfile(chatDisplay);
  const avatarShape = resolveChatAvatarShape(layoutMode, profile?.avatar_shape || "portrait");
  const displayStyle = {
    ...chatDisplayCssVariables(layoutMode, profile),
    ...chatTextColorCssVariables(chatDisplay?.text_colors),
  };
  const userAvatar = resolveChatAvatar(persona, "user", avatarShape);
  const assistantAvatar = resolveChatAvatar(persona, "assistant", avatarShape);
  const selectedModelLabel = typeof selectedModel === 'string' ? selectedModel : selectedModel?.label || selectedModel?.name || selectedModel?.id || '';
  const regenerateTargetMessageId = findLatestRegenerateTargetMessageId(messages);

  function openChatBackground(event) {
    event.preventDefault();
    event.stopPropagation();
    setHeaderMenuOpen(false);
    onOpenChatBackground?.();
  }

  function enterDeleteMode(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (isSending || !displayedMessages.some((message) => message.id !== "opening")) return;
    setHeaderMenuOpen(false);
    setProcessMessage(null);
    setDeleteFromMessageId("");
    setDeleteMode(true);
  }

  function cancelDeleteMode() {
    if (deletingMessages) return;
    setDeleteMode(false);
    setDeleteFromMessageId("");
    setDeleteConfirmationOpen(false);
  }

  async function confirmDeleteMessages() {
    if (!deleteFromMessageId || deletingMessages) return;
    setDeletingMessages(true);
    const deleted = await onDeleteMessages?.(deleteFromMessageId);
    if (deleted !== false) {
      setTrajectoryRevision((revision) => revision + 1);
      setDeleteMode(false);
      setDeleteFromMessageId("");
      setDeleteConfirmationOpen(false);
    }
    setDeletingMessages(false);
  }

  const deleteFromIndex = displayedMessages.findIndex((message) => message.id === deleteFromMessageId);
  const selectedDeleteCount = deleteFromIndex < 0 ? 0 : displayedMessages.length - deleteFromIndex;

  const roleplayMenu = <RoleplayInputMenu
    isSending={isSending}
    onCreateChat={onCreateChat}
    onOpenHistory={onOpenHistory}
    onAddImages={onAddImages}
    onOpenTools={() => setToolsOpen(true)}
    onOpenVariables={() => setVariablesOpen(true)}
    onOpenFrontends={() => setFrontendManagerOpen(true)}
    onEnterDeleteMode={enterDeleteMode}
    canDeleteMessages={displayedMessages.some((message) => message.id !== "opening")}
    onRegenerate={regenerateFrom}
    regenerateTargetMessageId={regenerateTargetMessageId}
    pluginEntries={frontend.uiEntries}
    onOpenPluginUi={openPluginUi}
  />;
  const roleplayModel = <ChatModelPicker
    apiRef={modelApiRef}
    configs={modelConfigs}
    selectedConfigId={selectedModelConfigId}
    selectedModel={selectedModel}
    modelOptionsByKey={modelOptionsByKey}
    onLoadModels={onLoadModelOptions}
    onSelect={onSelectModel}
    onNotify={onNotify}
  />;
  const roleplayDock = chatDisplay?.generation_stats_enabled === false
    ? renderRoleplaySlot?.("eleckoi.roleplay.conversation.composer.dock", { generationStatsEnabled: false })
    : undefined;
  const residentComposer = renderRoleplaySlot?.(
    "eleckoi.roleplay.conversation.composer.bar",
    {
      variant: "composer",
      placeholder: "输入消息",
      leadingAccessory: roleplayMenu,
      modelAccessory: roleplayModel,
      dockAccessory: roleplayDock,
      renderBridgeSlot: renderRoleplaySlot,
    },
  ) ?? null;
  const composedInput = renderRoleplaySlotChain && dshComposerOwner
    ? renderRoleplaySlotChain(
      "eleckoi.roleplay.conversation.composer",
      { ...dshComposerOwner, renderBridgeSlot: renderRoleplaySlot },
      { fallback: residentComposer, overlay: true },
    ) ?? residentComposer
    : residentComposer;

  const rowProps = {
    conversationId, messages: displayedMessages, layoutMode, profile, avatarShape,
    userAvatar, assistantAvatar, characterRecords,
    userPinImage: persona.user_portrait || persona.user_square || userAvatar,
    assistantPinImage: persona.assistant_cover || persona.assistant_square || assistantAvatar,
    onPinAvatar: setPinnedAvatar, userName: persona.user_name, assistantName: persona.assistant_name,
    showRoleplayTimestamp: chatDisplay?.roleplay_timestamps_enabled !== false,
    showRoleplayFloor: chatDisplay?.roleplay_message_floors_enabled !== false,
    onOpenProcess: setProcessMessage, onEditMessage,
    onEditOpening: isSending ? undefined : onEditOpening,
    onSelectOpening: isSending ? undefined : onSelectOpening,
    onRegenerate: regenerateFrom, deleteMode, deleteFromMessageId,
    onSelectDeleteFrom: setDeleteFromMessageId, runtimeSessionId,
    renderRoleplaySlot, renderRoleplayMessage, loadImage, onOpenFile: openFile,
    renderRichMessages: frontend.workspace.messageRendererEnabled,
  };
  const opening = <MessageList {...rowProps} openingOnly />;
  const officialChat = isSwitchingChat ? null : renderRoleplaySlot?.("eleckoi.roleplay.chat", {
    ...dshConversation?.viewOwner,
    before: opening,
    runningStatusTarget,
    renderChatNode: ({ node }) => {
      // Explicit product visibility still applies when the official node exists
      // before its visible metadata projection. Admission remains owned by DSH.
      if (isHiddenMessage(selectRoleplayChatSeat(messages, runtimeSessionId, node)?.item)) return null;
      const seat = selectRoleplayChatSeat(displayedMessages, runtimeSessionId, node);
      if (seat && !seat.item.conversationId) seat.item = { ...seat.item, conversationId };
      return seat === undefined ? undefined : seat ? <MessageList {...rowProps} seat={seat} officialNode /> : null;
    },
    renderPendingInput: ({ input: pendingInput }) => {
      if (isHiddenMessage(selectRoleplayPendingInput(messages, runtimeSessionId, pendingInput)?.item)) return null;
      const seat = selectRoleplayPendingInput(displayedMessages, runtimeSessionId, pendingInput);
      return <MessageList {...rowProps} seat={{ ...seat, item: { ...seat.item, conversationId } }} />;
    },
  });

  return (
    <section
      ref={chatPanelRef}
      className={`chat-panel layout-${layoutMode} view-${activeView}${useAdvanced ? ' has-advanced-frontend' : ''}${profile?.assistant_bubble_enabled ? " assistant-bubble-enabled" : ""}${deleteMode ? " message-delete-mode" : ""}`}
      style={displayStyle}
    >
      <header className="chat-header">
        <div className="chat-header-title-row">
          {onCloseChat ? <button type="button" className="chat-mobile-back" aria-label="返回会话列表" onClick={onCloseChat}><ArrowLeft size={20} /></button> : null}
          <Avatar className={`chat-identity-avatar${isSending ? ' is-running' : ''}`} src={assistantAvatar} name={currentTitle} />
          <div className="chat-header-title-cluster">
            <h1>{currentTitle}</h1>
            <div className="chat-header-metadata">
            {selectedModelLabel ? <span className="chat-header-model" title={selectedModelLabel}>{selectedModelLabel}</span> : null}
            {activePresetName ? <span className="chat-header-preset" title={activePresetName}>
              <DshAgentPresetIcon size={14} className="chat-header-preset-icon" />
              <span>{activePresetName}</span>
            </span> : null}
            </div>
          </div>
        </div>
          <div className="chat-header-actions" ref={headerMenuRef}>
            <button className="chat-header-action chat-mobile-shortcut" type="button" aria-label="对话历史" onClick={onOpenHistory}><ClockCounterClockwise size={20} /></button>
            <button className="chat-header-action" type="button" aria-label="对话操作" title="对话操作" aria-haspopup="menu" aria-expanded={headerMenuOpen} onClick={() => setHeaderMenuOpen((value) => !value)}>
              <SlidersHorizontal size={20} weight="bold" />
            </button>
            <button className="chat-header-action chat-header-regenerate" type="button" aria-label="重新生成最新回复" title="重新生成最新回复" disabled={isSending || !onRegenerate || !regenerateTargetMessageId} onClick={() => regenerateFrom({ targetMessageId: regenerateTargetMessageId })}>
              <ArrowClockwise size={20} />
            </button>
            <button className="chat-header-action chat-header-new" type="button" aria-label="新建对话" title="新建对话" disabled={isSending || !onCreateChat} onClick={onCreateChat}>
              <DshNewChatIcon size={20} />
            </button>
            {renderRoleplaySlot?.("eleckoi.roleplay.conversation.header.corner", {})}
            {headerMenuOpen && headerMenuStyle ? createPortal(
              <div
                ref={headerMenuPopupRef}
                style={headerMenuStyle}
                className="chat-header-menu"
                role="menu"
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" role="menuitem" disabled={!onOpenHistory} onClick={() => { setHeaderMenuOpen(false); onOpenHistory?.(); }}><ClockCounterClockwise size={18} />对话历史</button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => { setHeaderMenuOpen(false); openChatBackground(event); }}
                >
                  <ImageSquare size={18} />自定义背景
                </button>
                <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); setFrontendManagerOpen(true); }}>高级 HTML 前端</button>
              </div>, document.body
            ) : null}
          </div>
        <div className="chat-header-tabs" role="tablist" aria-label="对话视图" data-conversation-tabs="">
          {viewTabs.map((view) => <button key={view.id} data-view-id={view.id} type="button" role="tab" title={view.label} aria-label={view.label} aria-selected={activeView === view.id} onClick={() => selectView(view.id)}>
            {view.id === 'chat' ? <ChatCircleDots className="chat-tab-icon" size={19} weight={activeView === view.id ? 'fill' : 'regular'} aria-hidden="true" /> : view.id === 'trajectory' ? <Path className="chat-tab-icon" size={19} aria-hidden="true" /> : null}
            <span className="chat-tab-label">{view.label}</span>
          </button>)}
        </div>
      </header>

      <div className={`chat-conversation-body ${conversationWidthCss.root}`} ref={setConversationBody}>
        <div id="chat" className={`message-area layout-${layoutMode}`}
          ref={bindMessageScrollElement}
          data-conversation-scroll=""
          aria-busy={isSwitchingChat || isLoadingOlderMessages || undefined}
        >
          <div className="chat-transcript-region">
            {useAdvanced ? <AdvancedFrontendFrame key={selectedFrontend.id} project={selectedFrontend} runtime={frontend.runtime} request={frontend.request} /> : activeView === "chat" ? officialChat ?? (isSwitchingChat ? null : opening) : activeView === "trajectory" ? <Suspense fallback={<div className="trajectory-state">正在加载轨迹...</div>}>
              <TrajectoryView
                key={`${conversationId}:${trajectoryRevision}`}
                conversationId={conversationId}
                isSending={isSending}
                refreshRevision={trajectoryRevision}
                renderSlot={renderRoleplaySlot}
                viewOwner={dshConversation?.viewOwner}
              />
            </Suspense> : activeView === undefined ? null : dshConversation?.renderView(activeView)}
          </div>

          <div className="chat-composer-region" ref={composerRegionRef} data-composer-seat="" style={useAdvanced ? { display: 'none' } : undefined}>
            {deleteMode ? (
              <div className="chat-message-delete-bar" aria-label="删除消息">
                <button
                  className="delete-confirm"
                  type="button"
                  disabled={!deleteFromMessageId || deletingMessages}
                  onClick={() => setDeleteConfirmationOpen(true)}
                >
                  {deletingMessages ? "删除中" : "删除"}
                </button>
                <button type="button" disabled={deletingMessages} onClick={cancelDeleteMode}>取消</button>
              </div>
            ) : (
              <>
                <div className="chat-running-seat" ref={setRunningStatusTarget} data-chat-running-seat="" />
                {dshInputZone
                  ? renderRoleplaySlot?.("eleckoi.roleplay.conversation.input.dock", dshInputZone)
                  : null}
                {composedInput}
              </>
            )}
          </div>
        </div>
        <ConversationWidthControls
          container={conversationBody}
          phase={activeView === "chat" ? "active" : "hero"}
        />
      </div>
      {activeView === "chat" && pinnedAvatar ? <PinnedAvatar src={pinnedAvatar.src} name={pinnedAvatar.name} containerRef={chatPanelRef} onClose={() => setPinnedAvatar(null)} /> : null}
      {frontend.error ? <p className="adaptive-chat-error" role="alert">HTML 前端服务：{frontend.error}</p> : null}
      {frontendManagerOpen ? <FrontendProjectManager workspace={frontend.workspace} request={frontend.request} onClose={() => setFrontendManagerOpen(false)} /> : null}
      {chatSettingsOpen ? <AdaptiveChatSheet title="对话设置" onClose={() => setChatSettingsOpen(false)}>
        <div className="adaptive-roleplay-menu"><RoleplayMenuItems
          run={action => { setChatSettingsOpen(false); action?.(); }} isSending={isSending} onCreateChat={onCreateChat}
          onOpenHistory={onOpenHistory} onAddImages={onAddImages ? () => settingsImageInputRef.current?.click() : undefined} onOpenTools={() => setToolsOpen(true)} onOpenVariables={() => setVariablesOpen(true)}
          onOpenFrontends={() => setFrontendManagerOpen(true)} onEnterDeleteMode={enterDeleteMode}
          canDeleteMessages={displayedMessages.some(message => message.id !== 'opening')}
          onRegenerate={regenerateFrom} regenerateTargetMessageId={regenerateTargetMessageId}
          pluginEntries={frontend.uiEntries} onOpenPluginUi={openPluginUi} /></div>
      </AdaptiveChatSheet> : null}
      {onAddImages ? <input ref={settingsImageInputRef} type="file" accept="image/*" multiple hidden onChange={event => {
        const files = [...event.target.files || []]; event.target.value = '';
        if (files.length) Promise.resolve(onAddImages(files)).catch(error => onNotify?.('error', error.message || String(error)));
      }} /> : null}
      {frontendEditMessage ? <AdaptiveMessageEditor message={frontendEditMessage}
        onSave={frontendEditMessage.id === 'opening' ? onEditOpening : onEditMessage}
        onRegenerate={frontendEditMessage.role === 'user' ? (message, replacementMessage) => regenerateFrom({ targetMessageId: message.turnId || message.id, replacementMessage }) : undefined}
        onClose={() => setFrontendEditMessage(null)} /> : null}
      {processMessage ? (
        <AgentProcessDialog
          message={messages.find((item) => (
            item.id === processMessage.id
            || item.renderKey === (processMessage.renderKey || processMessage.id)
          )) || processMessage}
          reasoningDisplayMode={chatDisplay?.reasoning_display_mode || "collapsed"}
          onClose={() => setProcessMessage(null)}
        />
      ) : null}
      {variablesOpen ? <VariableViewerDialog conversationId={conversationId} conversationModel={conversationModel} onClose={() => setVariablesOpen(false)} onNotify={onNotify} /> : null}
      {toolsOpen ? <AgentToolsDialog
        presetCatalog={presetCatalog}
        onClose={() => setToolsOpen(false)}
        onManage={onOpenPresetTools}
        onNotify={onNotify}
      /> : null}
      <ConfirmationDialog
        open={deleteConfirmationOpen}
        title="删除这些消息？"
        description={`将删除选中消息及其后的全部内容，共 ${selectedDeleteCount} 条。相关变量、设定状态、工具调用和媒体记录也会一起回退或清理。`}
        confirmLabel="删除消息"
        destructive
        busy={deletingMessages}
        onCancel={() => setDeleteConfirmationOpen(false)}
        onConfirm={confirmDeleteMessages}
      />
    </section>
  );
}

export function MessageList({
  conversationId,
  entering,
  messages,
  seat,
  officialNode = false,
  openingOnly = false,
  layoutMode,
  profile,
  avatarShape,
  userAvatar,
  assistantAvatar,
  characterRecords = EMPTY_CHARACTER_RECORDS,
  userPinImage,
  assistantPinImage,
  onPinAvatar,
  userName,
  assistantName,
  showRoleplayTimestamp,
  showRoleplayFloor,
  onOpenProcess,
  onEditMessage,
  onEditOpening,
  onSelectOpening,
  onRegenerate,
  deleteMode,
  deleteFromMessageId,
  onSelectDeleteFrom,
  runtimeSessionId,
  renderRoleplaySlot,
  renderRoleplayMessage,
  loadImage,
  onOpenFile,
  renderRichMessages = true,
}) {
  const [isEntering, setIsEntering] = useState(Boolean(entering));
  const latestAssistantIndex = messages.findLastIndex((message) => message.role === "assistant" && !message.pending);
  const regenerateMessage = useCallback((message, replacementMessage) => onRegenerate?.({
    targetMessageId: message.turnId || message.id,
    ...(replacementMessage === undefined ? {} : { replacementMessage }),
  }), [onRegenerate]);
  const deleteFromIndex = deleteMode
    ? messages.findIndex((message) => message.id === deleteFromMessageId)
    : -1;

  useEffect(() => {
    if (!entering) {
      setIsEntering(false);
      return undefined;
    }
    setIsEntering(true);
    const timer = window.setTimeout(() => setIsEntering(false), 220);
    return () => window.clearTimeout(timer);
  }, [conversationId, entering]);

  return (
    <div
      className={`message-flow${isEntering ? " is-conversation-entering" : ""}`}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setIsEntering(false);
      }}
    >
      {(seat ? [seat] : messages.map((item, index) => ({ item, index }))
        .filter(({ item }) => !openingOnly || item.id === "opening")).map(({ item, index }) => {
        const rowKey = item.renderKey || item.id || `${item.role || "message"}-${item.created_at || index}`;
        const selectedForDelete = deleteFromIndex >= 0 && index >= deleteFromIndex;
        const nextRole = messages[index + 1]?.role;
        const spacingAfter = nextRole
          ? layoutMode === "agent" && item.role === "user" && nextRole === "assistant"
            ? profile.reply_spacing
            : profile.turn_spacing
          : 0;
        return <MessageRow
          key={rowKey}
          item={item}
          anchorKey={officialNode ? undefined : String(rowKey)}
          index={index}
          spacingAfter={spacingAfter}
          selectedForDelete={selectedForDelete}
          deleteMode={deleteMode}
          layoutMode={layoutMode}
          avatarShape={avatarShape}
          userAvatar={userAvatar}
          assistantAvatar={assistantAvatar}
          characterRecords={characterRecords}
          userPinImage={userPinImage}
          assistantPinImage={assistantPinImage}
          userName={userName}
          assistantName={assistantName}
          isLatestAssistant={index === latestAssistantIndex}
          floorNumber={messageFloorNumber(messages, index)}
          showRoleplayTimestamp={showRoleplayTimestamp}
          showRoleplayFloor={showRoleplayFloor}
          onOpenProcess={onOpenProcess}
          onPinAvatar={onPinAvatar}
          onEditMessage={onEditMessage}
          onEditOpening={onEditOpening}
          onSelectOpening={onSelectOpening}
          onRegenerate={regenerateMessage}
          onSelectDeleteFrom={onSelectDeleteFrom}
          runtimeSessionId={runtimeSessionId}
          renderRoleplaySlot={renderRoleplaySlot}
          renderRoleplayMessage={renderRoleplayMessage}
          loadImage={loadImage}
          onOpenFile={onOpenFile}
          renderRichMessages={renderRichMessages}
        />;
      })}
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  item,
  anchorKey,
  index,
  spacingAfter,
  selectedForDelete,
  deleteMode,
  layoutMode,
  avatarShape,
  userAvatar,
  assistantAvatar,
  characterRecords,
  userPinImage,
  assistantPinImage,
  userName,
  assistantName,
  isLatestAssistant,
  floorNumber,
  showRoleplayTimestamp,
  showRoleplayFloor,
  onOpenProcess,
  onPinAvatar,
  onEditMessage,
  onEditOpening,
  onSelectOpening,
  onRegenerate,
  onSelectDeleteFrom,
  runtimeSessionId,
  renderRoleplaySlot,
  renderRoleplayMessage,
  loadImage,
  onOpenFile,
  renderRichMessages,
}) {
  const isTurnError = item.kind === 'turn-error';
  const pluginScopeActive = !isTurnError && !deleteMode && item.runtimeSessionId === runtimeSessionId;
  const pluginMessage = pluginScopeActive && renderRoleplaySlot && !item.pending;
  const pluginActions = pluginMessage && item.role === "assistant" && item.dshMessageId
    ? renderRoleplaySlot("eleckoi.roleplay.message.actions", {
      conversationId: item.conversationId, productMessageId: item.id, messageId: item.dshMessageId,
    }) : null;
  const pluginAfter = pluginMessage
    ? renderRoleplaySlot("eleckoi.roleplay.message.after", {
      conversationId: item.conversationId, productMessageId: item.id,
      messageId: item.dshMessageId || null, role: item.role,
    }) : null;
  const renderMessageContent = pluginScopeActive ? renderRoleplayMessage : undefined;
  // Rewind/edit/delete target the durable Session event. Historical rows can
  // legitimately have no projected turn until a closing tail is rebound.
  const canMutate = !isTurnError && (item.id === "opening" ? item.canChangeOpening === true : Number.isSafeInteger(item.sessionEventSeq));
  const speaker = characterRecords?.find(character => character.id === (item.speakerId || item.metadata?.speakerId));
  const speakerAvatar = speaker ? resolveChatAvatar({ ...speaker.persona, assistant_avatar: speaker.avatar || speaker.persona?.assistant_avatar }, 'assistant', avatarShape) : '';
  const bubble = isTurnError ? <ChatTurnError message={item} layoutMode={layoutMode} /> : <MessageBubble
    message={item}
    avatar={item.role === "user" ? userAvatar : speakerAvatar || assistantAvatar}
    pinSrc={item.role === "user" ? userPinImage : speaker?.persona?.assistant_cover || speakerAvatar || assistantPinImage}
    name={item.name || item.metadata?.name || (item.role === "user" ? userName : speaker?.name || assistantName)}
    layoutMode={layoutMode}
    avatarShape={avatarShape}
    isLatestAssistant={isLatestAssistant}
    floorNumber={floorNumber}
    showRoleplayTimestamp={showRoleplayTimestamp}
    showRoleplayFloor={showRoleplayFloor}
    onOpenProcess={onOpenProcess}
    onPinAvatar={onPinAvatar}
    onEdit={deleteMode || !canMutate ? undefined : item.id === "opening" ? onEditOpening : onEditMessage}
    onSelectOpening={deleteMode || !canMutate ? undefined : onSelectOpening}
    onRegenerate={deleteMode || !canMutate ? undefined : onRegenerate}
    pluginActions={pluginActions}
    pluginAfter={pluginAfter}
    renderMessageContent={renderMessageContent}
    loadImage={loadImage}
    onOpenFile={onOpenFile}
    renderRichMessages={renderRichMessages}
  />;

  return (
    <div
      className="message-flow-row"
      data-index={index}
      data-chat-anchor-key={anchorKey}
      data-chat-paging-anchor={anchorKey ? "true" : undefined}
      style={{ paddingBottom: `${spacingAfter}px` }}
    >
      {deleteMode ? (
        <div className={`message-delete-selection-row layout-${layoutMode}${selectedForDelete ? " is-selected" : ""}`}>
          <input
            className="message-delete-checkbox"
            type="checkbox"
            checked={selectedForDelete}
            disabled={item.id === "opening" || !canMutate}
            aria-label={`从这条消息开始删除${selectedForDelete ? "，已选中" : ""}`}
            onChange={() => onSelectDeleteFrom(item.id)}
          />
          {bubble}
        </div>
      ) : bubble}
    </div>
  );
});
