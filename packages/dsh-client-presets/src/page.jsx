import { PresetListPanel, PresetProvider, PresetWorkspace } from "../../../apps/web/src/modules/presets/index.js";
import { useMainPageView } from "../../../apps/web/src/app/windows/MainPageContext.jsx";
export { PresetNavIcon as NavigationIcon } from "../../../apps/web/src/ui/icons/navIcons.jsx";

export function PresetsPage() {
  const view = useMainPageView();
  const { chat, characterConfiguration, presets, presetNavigationGuardRef, presetRequestedTab, setPresetRequestedTab, renderPresetEditorSection, renderLayout } = view;
  return <PresetProvider catalogModel={presets} navigationGuardRef={presetNavigationGuardRef}>
    {renderLayout({
      sidePanel: <PresetListPanel />,
      mainPanel: <PresetWorkspace
        onNotify={chat.notify}
        onTestRegex={(text, rule, target) => characterConfiguration.regexRules.test(text, rule, target)}
        requestedTab={presetRequestedTab}
        onRequestedTabHandled={() => setPresetRequestedTab("")}
        renderEditorSection={renderPresetEditorSection}
      />,
    })}
  </PresetProvider>;
}
