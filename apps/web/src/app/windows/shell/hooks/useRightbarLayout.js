import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const CENTER_MIN = 400;
const RIGHTBAR_MIN = 300;
const RIGHTBAR_MAX_RATIO = 0.7;
const RIGHTBAR_DEFAULT_RATIO = 0.45;
const SIDEBAR_AUTO_COLLAPSE = 1024;
const EMPTY = Object.freeze({
  shown: false,
  track: false,
  fullscreen: false,
  instant: false,
  width: null,
  viewportWidth: typeof window === "undefined" ? 960 : window.innerWidth,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readLength(style, name) {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function solveRightbar(viewportWidth, leftWidth, preference) {
  const available = viewportWidth - leftWidth - CENTER_MIN;
  if (available < RIGHTBAR_MIN) return 0;
  return Math.min(
    available,
    clamp(preference, RIGHTBAR_MIN, viewportWidth * RIGHTBAR_MAX_RATIO),
  );
}

function RightbarResizeHandle({ onStart, onDrag, onEnd }) {
  const originRef = useRef(0);
  const latestRef = useRef(0);
  const frameRef = useRef(null);
  const captureRef = useRef(null);
  const callbacksRef = useRef({ onStart, onDrag, onEnd });
  callbacksRef.current = { onStart, onDrag, onEnd };

  const endDrag = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (capture.element.hasPointerCapture(capture.id)) capture.element.releasePointerCapture(capture.id);
    callbacksRef.current.onEnd();
  }, []);

  useEffect(() => endDrag, [endDrag]);

  return createElement("div", {
    className: "rightbar-resizer",
    onPointerDown(event) {
      if (event.button !== 0 || captureRef.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      captureRef.current = { element: event.currentTarget, id: event.pointerId };
      originRef.current = event.clientX;
      latestRef.current = event.clientX;
      callbacksRef.current.onStart();
    },
    onPointerMove(event) {
      if (captureRef.current?.id !== event.pointerId) return;
      latestRef.current = event.clientX;
      frameRef.current ??= requestAnimationFrame(() => {
        frameRef.current = null;
        callbacksRef.current.onDrag(latestRef.current - originRef.current);
      });
    },
    onPointerUp(event) {
      if (captureRef.current?.id !== event.pointerId) return;
      callbacksRef.current.onDrag(event.clientX - originRef.current);
      endDrag();
    },
    onPointerCancel(event) {
      if (captureRef.current?.id === event.pointerId) endDrag();
    },
    onLostPointerCapture(event) {
      if (captureRef.current?.id === event.pointerId) endDrag();
    },
  });
}

export function useRightbarLayout({ model, shellRef, sidePanelCollapsed, collapseSidePanel }) {
  const state = useSyncExternalStore(
    model?.subscribe || (() => () => {}),
    model?.getSnapshot || (() => EMPTY),
    model?.getSnapshot || (() => EMPTY),
  );
  const [geometry, setGeometry] = useState(() => ({
    viewportWidth: state.viewportWidth || EMPTY.viewportWidth,
    railWidth: 0,
    sidePanelWidth: 0,
  }));
  const [animating, setAnimating] = useState(0);
  const [dragging, setDragging] = useState(false);
  const previousTrackRef = useRef(Boolean(state.track));
  const previousViewportRef = useRef(geometry.viewportWidth);
  const widthRef = useRef(0);
  const dragBaseRef = useRef(0);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !model) return undefined;
    let frame = null;
    let disposed = false;
    const measure = () => {
      const viewportWidth = shell.getBoundingClientRect().width;
      if (!(viewportWidth > 0)) return;
      const style = getComputedStyle(shell);
      const next = {
        viewportWidth,
        railWidth: readLength(style, "--rail-column-width"),
        sidePanelWidth: readLength(style, "--side-panel-width"),
      };
      setGeometry((current) => (
        current.viewportWidth === next.viewportWidth
        && current.railWidth === next.railWidth
        && current.sidePanelWidth === next.sidePanelWidth
          ? current
          : next
      ));
      model.setViewportWidth(viewportWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      frame ??= requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });
    observer.observe(shell);
    return () => {
      disposed = true;
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [model, shellRef]);

  useLayoutEffect(() => {
    if (state.shown && geometry.viewportWidth < SIDEBAR_AUTO_COLLAPSE && !sidePanelCollapsed) {
      collapseSidePanel();
    }
  }, [collapseSidePanel, geometry.viewportWidth, sidePanelCollapsed, state.shown]);

  const effectiveSidePanelWidth = sidePanelCollapsed || geometry.viewportWidth < SIDEBAR_AUTO_COLLAPSE
    ? 0
    : geometry.sidePanelWidth;
  const preference = state.width ?? geometry.viewportWidth * RIGHTBAR_DEFAULT_RATIO;
  const width = solveRightbar(
    geometry.viewportWidth,
    geometry.railWidth + effectiveSidePanelWidth,
    preference,
  );
  const trackWidth = state.track ? width : 0;
  widthRef.current = width;

  useLayoutEffect(() => {
    const viewportChanged = previousViewportRef.current !== geometry.viewportWidth;
    previousViewportRef.current = geometry.viewportWidth;
    if (previousTrackRef.current === Boolean(state.track)) return;
    previousTrackRef.current = Boolean(state.track);
    if (!viewportChanged) setAnimating((token) => token + 1);
  }, [geometry.viewportWidth, state.track]);

  useEffect(() => {
    if (!animating) return undefined;
    const shell = shellRef.current;
    if (!shell) return undefined;
    const settle = () => setAnimating(0);
    const onTransitionEnd = (event) => {
      if (event.target === shell && event.propertyName === "--rightbar-track-width") settle();
    };
    shell.addEventListener("transitionend", onTransitionEnd);
    const timer = window.setTimeout(settle, 600);
    return () => {
      shell.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(timer);
    };
  }, [animating, shellRef]);

  const startResize = useCallback(() => {
    dragBaseRef.current = widthRef.current;
    setDragging(true);
  }, []);
  const resize = useCallback((deltaX) => {
    model?.setWidth(dragBaseRef.current - deltaX);
  }, [model]);
  const endResize = useCallback(() => setDragging(false), []);

  return {
    width,
    viewportWidth: geometry.viewportWidth,
    canShow: width > 0,
    fullscreen: Boolean(state.fullscreen),
    instant: Boolean(state.instant),
    animating: animating > 0,
    dragging,
    showResizeHandle: Boolean(model && state.shown && !state.fullscreen && width > 0),
    shellStyle: {
      "--rightbar-track-width": `${trackWidth}px`,
      "--rightbar-normal-width": `${width}px`,
      "--dsh-windows-sidebar-width": `${geometry.railWidth + effectiveSidePanelWidth}px`,
    },
    resizeHandle: createElement(RightbarResizeHandle, {
      onStart: startResize,
      onDrag: resize,
      onEnd: endResize,
    }),
  };
}
