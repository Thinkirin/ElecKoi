import { useLayoutEffect, useState } from 'react';

/** Keep portalled chat menus inside the viewport as their host panel resizes. */
export function useChatMenuPosition(open, anchorRef, { width = 212, align = 'start', placement = 'above' } = {}) {
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!open) { setStyle(null); return undefined; }
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
      const menuWidth = Math.min(width, viewportWidth - 24);
      const above = Math.max(0, rect.top - 20), below = Math.max(0, viewportHeight - rect.bottom - 20);
      const useAbove = placement === 'above' ? above >= Math.min(240, below) : below < Math.min(240, above);
      const desiredLeft = align === 'end' ? rect.right - menuWidth : rect.left;
      setStyle({
        position: 'fixed', left: Math.max(12, Math.min(desiredLeft, viewportWidth - menuWidth - 12)), right: 'auto',
        width: menuWidth, boxSizing: 'border-box',
        top: useAbove ? 'auto' : rect.bottom + 8,
        bottom: useAbove ? viewportHeight - rect.top + 8 : 'auto',
        maxHeight: useAbove ? above : below,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); observer?.disconnect(); };
  }, [open, anchorRef, width, align, placement]);
  return style;
}
