import { ConversationList } from "../../../apps/web/src/modules/chat/index.js";
import { RoleplayPanel } from "../../../apps/web/src/app/windows/RoleplayPanel.jsx";
import { useMainPageView } from "../../../apps/web/src/app/windows/MainPageContext.jsx";
export { MessageNavIcon as NavigationIcon } from "../../../apps/web/src/ui/icons/navIcons.jsx";

export function MessagesPage() {
  const view = useMainPageView();
  const { chat, appearance, conversations, presets, renderRoleplay, renderConversationList, renderLayout, selectConversation, openChatBackground, openPresetTools, openCharacterSection } = view;
  const listOwner = {
    keyword: chat.keyword,
    setKeyword: chat.setKeyword,
    sessions: chat.filteredSessions,
    sessionId: chat.sessionId,
    pinnedIds: chat.pinnedIds,
    characters: chat.characters,
    artworkMode: appearance.sidebarCharacterArtwork,
    onLoadChat: selectConversation,
    onOpenCharacterChat: chat.openCharacterChat,
    onGoCharacterSettings: openCharacterSection,
    onTogglePinChat: chat.togglePinChat,
    onOpenChatWindow: chat.openChatWindow,
    onHideChat: chat.hideChatEntry,
  };
  const listFallback = <ConversationList {...listOwner} />;
  return renderLayout({
    sidePanel: renderConversationList?.(listOwner, listFallback) ?? listFallback,
    mainPanel: <RoleplayPanel
      renderRoleplay={renderRoleplay}
      hasActiveChat={Boolean(chat.sessionId || chat.chatCharacter?.character_id)}
      conversationId={chat.sessionId}
      isSwitchingChat={chat.isSwitchingChat}
      conversationTransitionRevision={chat.conversationTransitionRevision}
      runtimeSessionId={chat.runtimeSessionId}
      conversationModel={conversations}
      presetCatalog={presets}
      hasCharacters={Boolean(chat.characters?.items?.length)}
      currentTitle={chat.currentTitle}
      persona={chat.chatPersona}
      messages={chat.messages}
      input={chat.input}
      setInput={chat.setInput}
      inputImages={chat.inputImages}
      inputFiles={chat.inputFiles}
      filesUploading={chat.filesUploading}
      fileUploadProgress={chat.fileUploadProgress}
      onAddImages={chat.addInputImages}
      onAddFiles={chat.addInputFiles}
      onRemoveImage={chat.removeInputImage}
      onRemoveFile={chat.removeInputFile}
      isSending={chat.isSending}
      modelConfigs={chat.chatModelConfigs}
      selectedModelConfigId={chat.selectedChatModelConfigId}
      selectedModel={chat.selectedChatModel}
      modelOptionsByKey={chat.modelOptionsByKey}
      onLoadModelOptions={chat.loadModelOptions}
      onSelectModel={chat.selectChatModel}
      onNotify={chat.notify}
      onSend={chat.sendMessage}
      onStop={chat.stopSend}
      onCreateChat={chat.createChat}
      onOpenHistory={chat.openHistory}
      onOpenChatBackground={openChatBackground}
      onOpenPresetTools={openPresetTools}
      onRegenerate={chat.regenerateReply}
      onDeleteMessages={chat.deleteMessagesFrom}
      onEditMessage={chat.editMessage}
      onEditOpening={chat.editOpening}
      onSelectOpening={chat.selectOpening}
      onGoCharacterSettings={openCharacterSection}
      scrollRef={chat.scrollRef}
      scrollRequest={chat.scrollRequest}
      hasOlderMessages={chat.hasOlderMessages}
      isLoadingOlderMessages={chat.isLoadingOlderMessages}
      onLoadOlderMessages={chat.loadOlderMessages}
      chatDisplay={appearance.chatDisplay}
    />,
  });
}
