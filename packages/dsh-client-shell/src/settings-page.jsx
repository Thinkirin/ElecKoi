import { SettingsPanel } from "../../../apps/web/src/modules/settings/index.js";
import { useMainPageView } from "../../../apps/web/src/app/windows/MainPageContext.jsx";
export { CreatorStudioNavIcon as CreatorStudioNavigationIcon, CommunityNavIcon as CommunityNavigationIcon } from "../../../apps/web/src/ui/icons/navIcons.jsx";

export function SettingsPage() {
  const view = useMainPageView();
  const { chat, appearance, appUpdates, settingsSections, renderSettingsSection, renderUserProfileEditor, settingsPage, setSettingsPage, changeActiveSection, renderLayout } = view;
  return <SettingsPanel
    activePage={settingsPage}
    onPageChange={setSettingsPage}
    persona={chat.persona}
    onUpdateUserProfile={chat.updateUserProfile}
    renderUserProfileEditor={renderUserProfileEditor}
    chatDisplay={appearance.chatDisplay}
    onChatDisplayChange={appearance.changeChatDisplay}
    appearanceMode={appearance.appearanceMode}
    onAppearanceModeChange={appearance.changeAppearanceMode}
    sidebarCharacterArtwork={appearance.sidebarCharacterArtwork}
    onSidebarCharacterArtworkChange={appearance.changeSidebarCharacterArtwork}
    appUpdates={appUpdates}
    settingsSections={settingsSections}
    renderSettingsSection={renderSettingsSection}
    onClosePluginSection={() => changeActiveSection("messages")}
    renderLayout={renderLayout}
  />;
}
