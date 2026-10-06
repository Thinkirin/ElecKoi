import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, NotePencil, Sparkle } from "@phosphor-icons/react";
import logoIcon from "../../assets/eleckoi-app-icon.png";
import {
  CanvasDotGrid,
  CreatorStudioCanvas,
  CreatorStudioProjectHome,
  DEFAULT_CANVAS_VIEWPORT,
} from "../../modules/creatorStudio/index.js";
import { DshPanelLeftIcon } from "../../ui/icons/dshComposerIcons.jsx";
import { appWindow, showCurrentWindow } from "../services/windowControls.js";
import { WindowControls } from "./shell/components/TitleBar.jsx";
import { ProductWindowBackButton } from "./ProductWindowTitleBar.jsx";
import { UnsavedChangesDialog } from "../../ui/ui/UnsavedChangesDialog.jsx";
import { registerOverlayBack } from "../../ui/hooks/overlayBack.js";

function CreatorStudioDevelopmentNotice({ onEnter }) {
  return <main className="qq-shell creator-studio-shell creator-studio-development-shell" aria-label="AI创作工作室">
    <header className="creator-studio-development-header" data-tauri-drag-region>
      <div className="creator-studio-development-brand" data-tauri-drag-region>
        <ProductWindowBackButton />
        <img src={logoIcon} alt="" draggable="false" />
        <strong>AI创作工作室</strong>
      </div>
      <div data-tauri-drag-region />
      <WindowControls />
    </header>
    <section className="creator-studio-development-content" aria-label="AI创作工作室开发状态">
      <div className="creator-studio-development-card">
        <h1>正在开发</h1>
        <p>AI助手已接入项目目录与对话历史，画布编辑仍在完善。</p>
        <button className="creator-studio-development-enter" type="button" onClick={onEnter}>
          进入创作工作室
        </button>
      </div>
    </section>
  </main>;
}

export function CreatorStudioWindow({ characterCatalog, projectCatalog }) {
  const [showDevelopmentNotice, setShowDevelopmentNotice] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeProject, setActiveProject] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [canvasAssetsOpen, setCanvasAssetsOpen] = useState(false);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [leaveDraftOpen, setLeaveDraftOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState('project');
  const allowCloseRef = useRef(false);
  const [canvasViewport, setCanvasViewport] = useState(DEFAULT_CANVAS_VIEWPORT);
  const titlebarGridId = useId().replace(/:/g, "");

  useEffect(() => {
    document.title = "AI创作工作室 - ElecKoi";
    showCurrentWindow().catch(() => {});
  }, []);

  useEffect(() => {
    const beforeUnload = event => {
      if (!canvasDirty || allowCloseRef.current) return;
      event.preventDefault(); event.returnValue = '';
      setPendingExit('window'); setLeaveDraftOpen(true);
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [canvasDirty]);

  useEffect(() => {
    if (!activeProject) return undefined;
    return registerOverlayBack(event => {
      if (event?.type === 'keydown' && document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
      if (canvasDirty) { setPendingExit('project'); setLeaveDraftOpen(true); }
      else {
        setActiveProject(null); setAssistantOpen(false); setCanvasAssetsOpen(false);
        setCanvasViewport({ ...DEFAULT_CANVAS_VIEWPORT });
      }
      return true;
    }, window, 0);
  }, [activeProject, canvasDirty]);

  if (showDevelopmentNotice) return <CreatorStudioDevelopmentNotice onEnter={() => setShowDevelopmentNotice(false)} />;

  const openProject = (project) => {
    setActiveProject(project);
    setAssistantOpen(false);
    setCanvasAssetsOpen(false);
    setCanvasDirty(false);
    setCanvasViewport({ ...DEFAULT_CANVAS_VIEWPORT });
  };

  const closeProject = () => {
    setActiveProject(null);
    setAssistantOpen(false);
    setCanvasAssetsOpen(false);
    setCanvasDirty(false);
    setCanvasViewport({ ...DEFAULT_CANVAS_VIEWPORT });
  };
  const requestExit = kind => {
    if (canvasDirty) { setPendingExit(kind); setLeaveDraftOpen(true); return; }
    if (kind === 'project') closeProject();
    else { allowCloseRef.current = true; void appWindow.close(); }
  };

  const titlebarGridViewport = {
    x: canvasViewport.x + (canvasAssetsOpen ? 320 : 0),
    y: canvasViewport.y + 52,
    zoom: canvasViewport.zoom,
  };

  return <main className="qq-shell creator-studio-shell">
    <header className={`creator-studio-shell-header${sidebarCollapsed && !activeProject ? " is-sidebar-collapsed" : ""}${activeProject ? " is-canvas-mode" : ""}${activeProject && canvasAssetsOpen ? " has-canvas-assets" : ""}`} data-tauri-drag-region>
      {activeProject ? <>
        <CanvasDotGrid id={`${titlebarGridId}-titlebar`} viewport={titlebarGridViewport} className="is-titlebar" />
        <div className="creator-studio-canvas-titlebar" data-tauri-drag-region>
        <button className="creator-studio-canvas-back" type="button" aria-label="返回创作项目" title="返回创作项目" onClick={() => requestExit('project')}>
          <ArrowLeft size={17} weight="bold" aria-hidden="true" />
        </button>
        <img src={logoIcon} alt="" draggable="false" />
        <span className="creator-studio-canvas-brand">AI创作工作室</span>
        <span className="creator-studio-canvas-titlebar-divider" aria-hidden="true" />
        <strong title={activeProject.name}>{activeProject.name}</strong>
        <span className={`creator-studio-canvas-save-state${canvasDirty ? " is-dirty" : ""}`}>
          <NotePencil size={14} aria-hidden="true" />{canvasDirty ? "草稿有更改" : "本次草稿"}
        </span>
        </div>
      </> : <div className="creator-studio-shell-brand-area" data-tauri-drag-region>
          <div className="creator-studio-shell-identity" data-tauri-drag-region>
            <ProductWindowBackButton />
            <img src={logoIcon} alt="" draggable="false" />
            <strong>AI创作工作室</strong>
          </div>
          <button
            className="creator-studio-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <DshPanelLeftIcon size={16} />
          </button>
        </div>}
      <div className="creator-studio-shell-drag-space" data-tauri-drag-region />
      {activeProject ? <button
        className={`creator-studio-assistant-titlebar-toggle${assistantOpen ? " is-active" : ""}`}
        type="button"
        aria-pressed={assistantOpen}
        onClick={() => setAssistantOpen((open) => !open)}
      >
        <Sparkle size={15} weight="fill" aria-hidden="true" />AI助手
      </button> : null}
      <WindowControls onClose={() => requestExit('window')} />
    </header>
    <section className={`creator-studio-shell-workspace${sidebarCollapsed && !activeProject ? " is-sidebar-collapsed" : ""}${activeProject ? " is-canvas-mode" : ""}`} aria-label="AI创作工作室工作区">
      {activeProject ? <CreatorStudioCanvas
        project={activeProject}
        projectCatalog={projectCatalog}
        assistantOpen={assistantOpen}
        onAssistantOpenChange={setAssistantOpen}
        onAssetLibraryOpenChange={setCanvasAssetsOpen}
        onDirtyChange={setCanvasDirty}
        viewport={canvasViewport}
        onViewportChange={setCanvasViewport}
      /> : <CreatorStudioProjectHome sidebarCollapsed={sidebarCollapsed} characterCatalog={characterCatalog} projectCatalog={projectCatalog} onOpenProject={openProject} />}
    </section>
    <UnsavedChangesDialog open={leaveDraftOpen} title="离开本次画布草稿？" description="本次画布更改尚未保存到项目。"
      discardLabel="放弃草稿" cancelLabel="继续编辑" onCancel={() => setLeaveDraftOpen(false)}
      onDiscard={() => { setLeaveDraftOpen(false); closeProject();
        if (pendingExit === 'window') { allowCloseRef.current = true; void appWindow.close(); } }} />
  </main>;
}
