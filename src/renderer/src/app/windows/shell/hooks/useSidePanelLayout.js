import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ensureInitialWindowSizeOnce } from "../../../services/windowControls.js";
import { COMPACT_WIDTH, MAIN_PANEL_MIN, RAIL_MIN, SIDE_PANEL_DEFAULT, SIDE_PANEL_MIN, SIDE_PANEL_MAX } from './shellLayout.js';

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

export function useSidePanelLayout() {
  const shellRef = useRef(null);
  const [shellWidth, setShellWidth] = useState(() => typeof window === 'undefined' ? COMPACT_WIDTH : window.innerWidth);
  const [sidePanelWidth, setSidePanelWidth] = useState(SIDE_PANEL_DEFAULT);
  // Temporary compact navigation never overwrites the user's docked-sidebar preference.
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(true);
  const [sidePanelDragging, setSidePanelDragging] = useState(false);
  const sidePanelDragBaseRef = useRef(SIDE_PANEL_DEFAULT);
  const sidePanelDragMaxRef = useRef(SIDE_PANEL_MAX);
  const compact = shellWidth <= COMPACT_WIDTH;
  const railWidth = shellWidth <= 1280 ? RAIL_MIN : 56;
  const sidePanelCollapsed = compact ? drawerCollapsed : desktopCollapsed;

  useLayoutEffect(() => {
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const width = shellRef.current?.getBoundingClientRect().width || window.innerWidth;
      if (width > 0) setShellWidth(width);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (shellRef.current) observer?.observe(shellRef.current);
    window.addEventListener('resize', measure);
    ensureInitialWindowSizeOnce().finally(measure);
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const collapseSidePanel = useCallback(() => (compact ? setDrawerCollapsed : setDesktopCollapsed)(true), [compact]);
  const expandSidePanel = useCallback(() => (compact ? setDrawerCollapsed : setDesktopCollapsed)(false), [compact]);
  const sidePanelMax = Math.max(SIDE_PANEL_MIN, Math.min(SIDE_PANEL_MAX, shellWidth - railWidth - MAIN_PANEL_MIN - 4));
  const effectiveSidePanelWidth = compact ? shellWidth : clamp(sidePanelWidth, SIDE_PANEL_MIN, sidePanelMax);

  const startSidePanelResize = useCallback(() => {
    const shell = shellRef.current;
    const renderedWidth = shell ? parseFloat(getComputedStyle(shell).getPropertyValue('--side-panel-width')) : effectiveSidePanelWidth;
    sidePanelDragBaseRef.current = Number.isFinite(renderedWidth) ? renderedWidth : effectiveSidePanelWidth;
    sidePanelDragMaxRef.current = sidePanelMax;
    setSidePanelDragging(true);
  }, [effectiveSidePanelWidth, sidePanelMax]);
  const resizeSidePanel = useCallback(deltaX => {
    setSidePanelWidth(clamp(sidePanelDragBaseRef.current + deltaX, SIDE_PANEL_MIN, sidePanelDragMaxRef.current));
  }, []);

  return {
    shellRef, shellWidth, sidePanelWidth:effectiveSidePanelWidth,
    shellStyle: {
      '--rail-column-width': `${railWidth}px`,
      '--side-panel-width': sidePanelCollapsed ? '0px' : `${effectiveSidePanelWidth}px`,
      '--side-panel-content-width': `${effectiveSidePanelWidth}px`,
    },
    sidePanelCollapsed, compact, sidePanelDragging, collapseSidePanel, expandSidePanel,
    startSidePanelResize, resizeSidePanel, endSidePanelResize: () => setSidePanelDragging(false),
  };
}