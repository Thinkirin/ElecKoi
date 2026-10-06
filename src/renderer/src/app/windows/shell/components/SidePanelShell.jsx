import React from "react";
import { DshPanelLeftIcon } from "../../../../ui/icons/dshComposerIcons.jsx";

import logoIcon from '../../../../assets/eleckoi-app-icon.png';

function stopDrag(event) {
  event.stopPropagation();
}

export function SidePanelShell({ collapsed = false, compact = false, onCollapse, footerActions, renderSidebarSlot, children, sectionTitle, contentRef }) {
  return (
    <section
      className={`side-panel-shell${collapsed ? " collapsed" : ""}${footerActions ? " has-footer-actions" : ""}`}
      aria-label="侧边栏"
      aria-hidden={collapsed || undefined}
      inert={collapsed ? "" : undefined}
    >
      <header className="side-panel-header" data-tauri-drag-region>
        <div className="side-panel-brand">
          {compact ? <img className="side-panel-brand-icon" src={logoIcon} alt="" draggable="false" /> : null}
          {renderSidebarSlot?.("sidebar.brand.name", { content: <strong>ElecKoi</strong> }) || <strong>ElecKoi</strong>}
          {sectionTitle ? <span className="side-panel-section-title">{sectionTitle}</span> : null}
        </div>
        <button
          className="side-panel-collapse-button"
          type="button"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          onPointerDown={stopDrag}
          onClick={onCollapse}
        >
          <DshPanelLeftIcon size={16} />
        </button>
      </header>
      <div className="side-panel-content" ref={contentRef}>{children}</div>
      {footerActions ? <div className="side-panel-footer-actions" aria-label="侧边栏插件操作">{footerActions}</div> : null}
    </section>
  );
}
