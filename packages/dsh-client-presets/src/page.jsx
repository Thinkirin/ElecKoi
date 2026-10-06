import { PresetListPanel, PresetProvider, PresetWorkspace } from "../../../src/renderer/src/modules/presets/index.js";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";
export { PresetNavIcon as NavigationIcon } from "../../../src/renderer/src/ui/icons/navIcons.jsx";

export function PresetsPage() {
  const view = useMainPageView();
  const { chat, characterConfiguration, presets, presetNavigationGuardRef, presetRequestedTab, setPresetRequestedTab, renderPresetEditorSection, renderLayout, onMobileDetailOpen } = view;
  return <PresetProvider catalogModel={presets} navigationGuardRef={presetNavigationGuardRef} onSelect={onMobileDetailOpen}>
    {renderLayout({
      sidePanel: <PresetListPanel />,
      mainPanel: <PresetWorkspace
        onBack={view.onMobileListOpen}
        onNotify={chat.notify}
        onTestRegex={(text, rule, target) => characterConfiguration.regexRules.test(text, rule, target)}
        requestedTab={presetRequestedTab}
        onRequestedTabHandled={() => setPresetRequestedTab("")}
        renderEditorSection={renderPresetEditorSection}
      />,
    })}
  </PresetProvider>;
}
