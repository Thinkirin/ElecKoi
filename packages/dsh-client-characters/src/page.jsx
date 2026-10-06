import { CharacterListPanel, CharacterProfilePanel, openCharacterEditorWindow } from "../../../src/renderer/src/modules/persona/index.js";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";
export { PersonNavIcon as NavigationIcon } from "../../../src/renderer/src/ui/icons/navIcons.jsx";

export function CharacterPage() {
  const view = useMainPageView();
  const { chat, appearance, selectCharacter, openCharacterChat, renderCharacterPageSection, renderLayout } = view;
  const listOwner = {
    characters: chat.characters,
    activeCharacterId: chat.selectedCharacterId || chat.characters.active_character_id,
    artworkMode: appearance.sidebarCharacterArtwork,
    onSelectCharacter: selectCharacter,
    onOpenCharacterChat: openCharacterChat,
    onSaveCharacterGroups: chat.saveCharacterGroups,
    onImportPreparedCharacters: chat.importPreparedCharacters,
    onPrepareCharacterImports: chat.prepareCharacterImports,
    onDiscardCharacterImports: chat.discardCharacterImports,
    onCreateCharacter: chat.createCharacter,
    onDeleteCharacters: chat.deleteCharacterIds,
  };
  const listFallback = <CharacterListPanel {...listOwner} />;
  const profileOwner = {
    onBack: view.onMobileListOpen,
    characters: chat.characters,
    selectedCharacterId: chat.selectedCharacterId,
    onSelectCharacter: selectCharacter,
    onStartConversation: openCharacterChat,
    onEditCharacter: openCharacterEditorWindow,
    onCreateFirstCharacter: () => chat.createCharacter(),
  };
  const profileFallback = <CharacterProfilePanel {...profileOwner} />;
  return renderLayout({
    sidePanel: renderCharacterPageSection?.("list", listOwner, listFallback) ?? listFallback,
    mainPanel: renderCharacterPageSection?.("profile", profileOwner, profileFallback) ?? profileFallback,
  });
}
