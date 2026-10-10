import { useEffect, useRef, useState } from 'react';
import { DEFAULT_INSPECTOR_WIDTH, inspectorWidthBounds } from '../hooks/editorSidebarSizing.js';
import { useInspectorPresence } from '../hooks/useInspectorPresence.js';

/** 各编辑页共用宽度、拖动、键盘操作与开关生命周期，表单和数据仍由所属页面维护。 */
export function EditorSidebarLayout({
  as: Element = 'section', className = '', paneClassName = '', overlay = true,
  inspector, children, preferredWidth, onWidthChange, ...props
}) {
  const layoutRef = useRef(null);
  const [localWidth, setLocalWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth || 1024);
  const [drag, setDrag] = useState(null);
  const presence = useInspectorPresence(inspector);
  const { min, max } = inspectorWidthBounds(containerWidth);
  const width = Math.min(max, Math.max(min, preferredWidth ?? localWidth));
  const changeWidth = onWidthChange || setLocalWidth;

  useEffect(() => {
    if (!inspector) setDrag(null);
  }, [Boolean(inspector)]);

  useEffect(() => {
    const layout = layoutRef.current;
    const measure = () => {
      const measured = layout.getBoundingClientRect().width;
      if (measured > 0) setContainerWidth(measured);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(layout);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (!drag) return undefined;
    const move = (event) => {
      if (event.pointerId !== drag.pointerId) return;
      changeWidth(Math.min(max, Math.max(min, drag.width + drag.x - event.clientX)));
    };
    const finish = (event) => {
      if (event.type !== 'blur' && event.pointerId !== drag.pointerId) return;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
    };
  }, [drag, min, max, changeWidth]);

  const reset = () => changeWidth(DEFAULT_INSPECTOR_WIDTH);
  return (
    <Element {...props} ref={layoutRef}
      className={`editor-sidebar-layout ${className}${presence.content ? ' is-inspector-open' : ''}${drag ? ' is-resizing' : ''}`}
      style={{ '--editor-sidebar-width': `${width}px` }}>
      {children}
      {presence.content ? (
        <div className={`editor-sidebar-pane ${paneClassName}${overlay ? ' is-overlay' : ''}${presence.closing ? ' is-closing' : ''}`}
          inert={presence.closing} onAnimationEnd={presence.onAnimationEnd}>
          <div className="editor-sidebar-resizer" role="separator" aria-orientation="vertical" tabIndex={0}
            aria-label="调整编辑器宽度" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(width)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDrag({ x: event.clientX, width, pointerId: event.pointerId });
            }}
            onLostPointerCapture={() => setDrag(null)} onDoubleClick={reset}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 48 : 24;
              const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: min, End: max }[event.key];
              if (next !== undefined) {
                event.preventDefault();
                changeWidth(Math.min(max, Math.max(min, next)));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                reset();
              } else if (event.key === 'Escape') {
                setDrag(null);
              }
            }}>
            <span aria-hidden="true" />
          </div>
          {presence.content}
        </div>
      ) : null}
    </Element>
  );
}
