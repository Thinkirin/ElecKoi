import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBackgroundModal, ChatWallpaperLayer, HistoryModal } from "../../modules/chat/index.js";
import { resolveChatWallpaper } from "../../modules/appearance/index.js";
import { useChatClient } from "../hooks/useChatClient.js";
import { useWindowAppearance } from "../hooks/useWindowAppearance.js";
import { AppToast } from "../../ui/ui/AppToast.jsx";
import { SidebarRail } from "./shell/components/SidebarRail.jsx";
import { CommunityDialog } from "./shell/components/CommunityDialog.jsx";
import { SidePanelShell } from "./shell/components/SidePanelShell.jsx";
import { PluginCenterSurface, PluginListPanel } from "./shell/components/PluginCenter.jsx";
import { SidePanelResizeHandle } from "./shell/components/SidePanelResizeHandle.jsx";
import { TitleBar, WindowControls } from "./shell/components/TitleBar.jsx";
import { useRightbarLayout } from "./shell/hooks/useRightbarLayout.js";
import { useSidePanelLayout } from "./shell/hooks/useSidePanelLayout.js";
import { useMobilePageTransition } from './shell/hooks/mobilePageTransition.js';
import { AppUpdateController, useAppUpdates } from "../../modules/updates/index.js";
import { openCreatorStudioWindow } from "../../modules/creatorStudio/index.js";
import { MainPageContext } from "./MainPageContext.jsx";
import { getDesktopService } from '../services/platform.js';
import { appWindow } from '../services/windowControls.js';
import { registerOverlayBack } from '../../ui/hooks/overlayBack.js';

class MainPageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export function MainWindow({ conversations, characters, characterConfiguration, models, persona, presets, settingsSections = [], navigation, rightbar, renderSettingsSection, renderUserProfileEditor, renderCharacterPageSection, renderConversationList, renderPresetEditorSection, renderRoleplay }) {
  const chat = useChatClient({ conversations, characters, models, persona, navigation });
  const appearance = useWindowAppearance({ notify: chat.notify });
  const sidePanelLayout = useSidePanelLayout();
  const isFrontendPage = Boolean(navigation?.frontendPageIds?.includes(chat.activeSection));
  const isPluginPanel = isFrontendPage || Boolean(navigation && !navigation.productPanelIds?.includes(chat.activeSection) && chat.activeSection !== "plugins");
  const rightbarLayout = useRightbarLayout({
    model: rightbar,
    shellRef: sidePanelLayout.shellRef,
    sidePanelCollapsed: sidePanelLayout.sidePanelCollapsed || isPluginPanel,
    sidePanelWidth: sidePanelLayout.sidePanelWidth,
    compact: sidePanelLayout.compact,
  });
  const appUpdates = useAppUpdates();
  const [chatBackgroundOpen, setChatBackgroundOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState("chat");
  const [presetRequestedTab, setPresetRequestedTab] = useState("");
  const presetNavigationGuardRef = useRef(null);
  const modelNavigationGuardRef = useRef(null);
  const mainPanelContentRef = useMobilePageTransition(chat.activeSection, sidePanelLayout.compact);
  const sidePanelContentRef = useMobilePageTransition(chat.activeSection, sidePanelLayout.compact);

  useEffect(() => {
    document.title = "ElecKoi";
  }, []);

  useEffect(() => {
    if (!sidePanelLayout.compact || chat.activeSection !== 'messages') return;
    if (chat.sessionId || chat.chatCharacter?.character_id) sidePanelLayout.collapseSidePanel();
    else sidePanelLayout.expandSidePanel();
  }, [sidePanelLayout.compact, sidePanelLayout.collapseSidePanel, sidePanelLayout.expandSidePanel,
    chat.activeSection, chat.sessionId, chat.chatCharacter?.character_id]);

  useEffect(() => getDesktopService('host')?.subscribeFailure((message) => {
    chat.notify("error", message);
  }), [chat.notify]);

  const changeActiveSection = useCallback((section) => {
    const navigate = () => {
      chat.setActiveSection(section);
      if (sidePanelLayout.compact) {
        if (['plugins', 'settings', 'character', 'presets', 'model'].includes(section) || (section === 'messages' && !chat.sessionId && !chat.chatCharacter?.character_id)) sidePanelLayout.expandSidePanel();
        else sidePanelLayout.collapseSidePanel();
      }
    };
    if (chat.activeSection === "model" && section !== "model" && modelNavigationGuardRef.current) {
      modelNavigationGuardRef.current(navigate);
      return;
    }
    if (chat.activeSection === "presets" && section !== "presets" && presetNavigationGuardRef.current) {
      presetNavigationGuardRef.current(navigate);
      return;
    }
    // On a phone the navigation is an overlay drawer. Selecting a destination
    // must reveal it immediately instead of leaving the drawer over a blank
    // zero-width main track.
    navigate();
  }, [chat, sidePanelLayout]);

  const closeChat = useCallback(() => {
    chat.clearActiveChat();
    if (sidePanelLayout.compact) sidePanelLayout.expandSidePanel();
  }, [chat, sidePanelLayout]);

  const onMobileDetailOpen = useCallback(() => {
    if (sidePanelLayout.compact) sidePanelLayout.collapseSidePanel();
  }, [sidePanelLayout]);

  const openCharacterChat = useCallback((characterId) => {
    onMobileDetailOpen();
    return chat.openCharacterChat(characterId);
  }, [chat, onMobileDetailOpen]);

  const selectCharacter = useCallback((characterId) => {
    const result = chat.selectCharacter(characterId);
    onMobileDetailOpen();
    return result;
  }, [chat, onMobileDetailOpen]);

  useEffect(() => {
    if (!sidePanelLayout.compact) return undefined;
    function onPlatformBack(event) {
      if (event.defaultPrevented) return false;
      if (event.type === 'keydown' && (event.key !== 'Escape' || event.target?.closest?.('input, textarea, select, [contenteditable="true"]'))) return false;
      if (chat.activeSection !== 'messages') {
        event.preventDefault();
        const showList = () => sidePanelLayout.expandSidePanel();
        const guard = chat.activeSection === 'model' ? modelNavigationGuardRef.current : chat.activeSection === 'presets' ? presetNavigationGuardRef.current : null;
        if (!sidePanelLayout.sidePanelCollapsed) changeActiveSection('messages');
        else if (guard) guard(showList);
        else showList();
        return true;
      } else if (sidePanelLayout.sidePanelCollapsed && (chat.sessionId || chat.chatCharacter?.character_id)) {
        event.preventDefault();
        closeChat();
        return true;
      } else if (!sidePanelLayout.sidePanelCollapsed && (chat.sessionId || chat.chatCharacter?.character_id)) {
        event.preventDefault();
        sidePanelLayout.collapseSidePanel();
        return true;
      }
      return false;
    }
    return registerOverlayBack(onPlatformBack, window, 0);
  }, [chat, closeChat, changeActiveSection, sidePanelLayout]);

  const chatWallpaper = useMemo(() => resolveChatWallpaper({
    character: chat.chatBackgroundCharacter,
    persona: chat.chatPersona,
    globalWallpaper: appearance.globalChatWallpaper,
  }), [appearance.globalChatWallpaper, chat.chatBackgroundCharacter, chat.chatPersona]);
  const showChatWallpaper = chat.activeSection === "messages" && Boolean(chat.sessionId || chat.chatCharacter?.character_id) && Boolean(chatWallpaper.image);

  function selectConversation(chatId) {
    if (sidePanelLayout.compact) sidePanelLayout.collapseSidePanel();
    if (chatId === chat.sessionId) {
      closeChat();
      return;
    }
    chat.loadChat(chatId);
  }

  function renderNavigationRail(renderSidebarSlot) {
    return (
      <section className="navigation-rail-shell" aria-label="功能导航栏">
        <div className="navigation-rail-title" data-tauri-drag-region />
        <SidebarRail
          activeSection={chat.activeSection}
          compact={sidePanelLayout.compact}
          onNotify={chat.notify}
          navigationItems={navigation?.items}
          renderSidebarSlot={renderSidebarSlot}
          profileActive={chat.activeSection === "settings" && settingsPage === "profile"}
          onSectionChange={changeActiveSection}
          onNavigationAction={(id) => {
            if (id === "creatorStudio") return openCreatorStudioWindow();
            if (id === "community") setCommunityOpen(true);
          }}
          persona={chat.persona}
          onOpenProfile={() => {
            setSettingsPage("profile");
            changeActiveSection("settings");
            onMobileDetailOpen();
          }}
          onOpenSettings={() => {
            setSettingsPage("chat");
            changeActiveSection("settings");
          }}
        />
      </section>
    );
  }

  function renderWindowLayout({ sidePanel, mainPanel, overlays = null }) {
    const renderSidebarContent = (renderSidebarSlot) => <>
      {!sidePanelLayout.compact ? renderNavigationRail(renderSidebarSlot) : null}
      <SidePanelShell
        compact={sidePanelLayout.compact}
        contentRef={sidePanelContentRef}
        sectionTitle={navigation?.items?.find(item => item.id === chat.activeSection)?.label}
        collapsed={sidePanelLayout.sidePanelCollapsed || isPluginPanel}
        onCollapse={sidePanelLayout.collapseSidePanel}
        renderSidebarSlot={renderSidebarSlot}
        footerActions={navigation?.hasSidebarFooterActions ? renderSidebarSlot?.("sidebar.footer.action", { wide: true }) : null}
      >
        {renderSidebarSlot?.("sidebar.workspaces", { wide: true, content: sidePanel }) || sidePanel}
      </SidePanelShell>
    </>;
    return (
      <>
        {sidePanelLayout.compact && !sidePanelLayout.sidePanelCollapsed ? (
          <button className="mobile-navigation-backdrop" type="button" aria-label="关闭导航菜单" onClick={sidePanelLayout.collapseSidePanel} />
        ) : null}
        {navigation?.renderSidebar ? navigation.renderSidebar(renderSidebarContent) : renderSidebarContent(null)}

        <section className="main-panel-shell" aria-label="主功能界面">
          <TitleBar
            splitSurface
            showWindowControls={false}
            sidePanelCollapsed={sidePanelLayout.compact || (sidePanelLayout.sidePanelCollapsed && !isPluginPanel)}
            onToggleSidePanel={sidePanelLayout.expandSidePanel}
          />
          <div className="main-panel-content" ref={mainPanelContentRef}>{mainPanel}</div>
        </section>
        <div className="dsh-rightbar-column">
          {rightbar?.render?.({
            width: rightbarLayout.width,
            viewportWidth: rightbarLayout.viewportWidth,
            canShow: rightbarLayout.canShow,
          })}
        </div>
        {overlays}
      </>
    );
  }

  const pageView = {
    chat,
    appearance,
    appUpdates,
    conversations,
    characters,
    characterConfiguration,
    models,
    presets,
    settingsSections,
    renderSettingsSection,
    renderUserProfileEditor,
    renderCharacterPageSection,
    renderConversationList,
    renderPresetEditorSection,
    renderRoleplay,
    settingsPage,
    setSettingsPage: (page) => {
      setSettingsPage(page);
      onMobileDetailOpen();
    },
    presetNavigationGuardRef,
    modelNavigationGuardRef,
    presetRequestedTab,
    setPresetRequestedTab,
    changeActiveSection,
    closeChat,
    onMobileDetailOpen,
    onMobileListOpen: () => sidePanelLayout.expandSidePanel(),
    openCharacterChat,
    selectCharacter,
    renderLayout: renderWindowLayout,
    selectConversation,
    openChatBackground: () => setChatBackgroundOpen(true),
    openPresetTools: () => {
      setPresetRequestedTab("tools");
      changeActiveSection("presets");
      onMobileDetailOpen();
    },
    openCharacterSection: () => changeActiveSection("character"),
  };

  let windowLayout;
  if (chat.activeSection === "plugins" && !isFrontendPage) {
    windowLayout = renderWindowLayout({
      sidePanel: <PluginListPanel onNotify={chat.notify} onOpenDetail={onMobileDetailOpen} />,
      mainPanel: <PluginCenterSurface>{navigation?.renderPanel("plugins")}</PluginCenterSurface>,
    });
  } else if (isPluginPanel) {
    windowLayout = renderWindowLayout({
      sidePanel: null,
      mainPanel: navigation.renderPanel(chat.activeSection),
    });
  } else if (navigation) {
    windowLayout = navigation.renderPanel(chat.activeSection);
  } else {
    windowLayout = renderWindowLayout({
      sidePanel: null,
      mainPanel: <div className="chat-empty-guide" role="alert">客户端插件未加载。</div>,
    });
  }
  return (
    <main
      ref={sidePanelLayout.shellRef}
      className={`qq-shell main-window-shell section-${isPluginPanel ? "plugin" : chat.activeSection}${showChatWallpaper ? " has-chat-wallpaper" : ""}${sidePanelLayout.sidePanelCollapsed || isPluginPanel ? " side-panel-collapsed" : ""}`}
      style={{
        ...(isPluginPanel ? { ...sidePanelLayout.shellStyle, "--side-panel-width": "0px" } : sidePanelLayout.shellStyle),
        ...rightbarLayout.shellStyle,
      }}
      data-side-panel-dragging={sidePanelLayout.sidePanelDragging || undefined}
      data-compact={sidePanelLayout.compact || undefined}
      data-native-window={appWindow.available || undefined}
      data-mobile-chat-active={sidePanelLayout.compact && chat.activeSection === 'messages' && Boolean(chat.sessionId || chat.chatCharacter?.character_id) || undefined}
      data-mobile-detail-active={sidePanelLayout.compact && sidePanelLayout.sidePanelCollapsed && ['model', 'presets', 'character', 'plugins', 'settings'].includes(chat.activeSection) || undefined}
      data-navigation-open={sidePanelLayout.compact && !sidePanelLayout.sidePanelCollapsed || undefined}
      data-rightbar-animating={rightbarLayout.animating || undefined}
      data-rightbar-dragging={rightbarLayout.dragging || undefined}
      data-rightbar-fullscreen={rightbarLayout.fullscreen || undefined}
      data-rightbar-shown={rightbarLayout.shown || undefined}
      data-rightbar-overlay={rightbarLayout.overlay || undefined}
      data-rightbar-instant={rightbarLayout.instant || undefined}
    >
      {showChatWallpaper ? <ChatWallpaperLayer wallpaper={chatWallpaper} /> : null}
      <MainPageContext.Provider value={pageView}>
        {sidePanelLayout.compact ? (navigation?.renderSidebar ? navigation.renderSidebar(renderNavigationRail) : renderNavigationRail(null)) : null}
        <MainPageErrorBoundary
          key={chat.activeSection}
          fallback={(error) => renderWindowLayout({
            sidePanel: null,
            mainPanel: <div className="chat-empty-guide" role="alert">页面加载失败：{error?.message || String(error)}</div>,
          })}
        >
          <Suspense fallback={renderWindowLayout({ sidePanel: null, mainPanel: null })}>
            {windowLayout}
          </Suspense>
        </MainPageErrorBoundary>
      </MainPageContext.Provider>
      {!sidePanelLayout.compact && !sidePanelLayout.sidePanelCollapsed && !isPluginPanel ? (
        <SidePanelResizeHandle
          onStart={sidePanelLayout.startSidePanelResize}
          onDrag={sidePanelLayout.resizeSidePanel}
          onEnd={sidePanelLayout.endSidePanelResize}
        />
      ) : null}
      {rightbarLayout.showResizeHandle ? rightbarLayout.resizeHandle : null}
      <div className="main-window-controls">
        <WindowControls />
      </div>
      <HistoryModal
        open={chat.historyOpen}
        sessions={chat.sessions}
        sessionId={chat.sessionId}
        chatCharacter={chat.chatCharacter}
        conversationModel={conversations}
        onClose={chat.closeHistory}
        onLoadChat={chat.loadChat}
        onDeleteChat={chat.removeHistoryChat}
        onHistoryPolicyChange={() => chat.refreshSessionsOnly({ keepSection: true })}
      />
      <ChatBackgroundModal
        open={chatBackgroundOpen}
        character={chat.chatBackgroundCharacter}
        persona={chat.chatPersona}
        messages={chat.messages}
        chatDisplay={appearance.chatDisplay}
        globalWallpaper={appearance.globalChatWallpaper}
        newCharacterBackground={appearance.newCharacterBackground}
        onClose={() => setChatBackgroundOpen(false)}
        onSaveCharacter={chat.updateChatBackground}
        onSaveGlobal={appearance.saveGlobalChatWallpaper}
        onSaveNewCharacterBackground={appearance.saveNewCharacterBackground}
        onNotify={chat.notify}
      />
      <CommunityDialog
        open={communityOpen}
        onClose={() => setCommunityOpen(false)}
        onNotify={chat.notify}
      />
      <AppToast notice={chat.notice} onDismiss={chat.dismissNotice} />
      <AppUpdateController updates={appUpdates} />
    </main>
  );
}
