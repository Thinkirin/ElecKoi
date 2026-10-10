import { EditorSidebarLayout } from "../../../ui/ui/EditorSidebarLayout.jsx";

export function BranchSettingsSplitView({ children, preferredWidth, onWidthChange }) {
  return (
    <EditorSidebarLayout as="div" className="dynamic-settings-editor-layout" paneClassName="dynamic-settings-editor-pane"
      overlay={false} inspector={children[1]} preferredWidth={preferredWidth} onWidthChange={onWidthChange}>
      {children[0]}
    </EditorSidebarLayout>
  );
}
