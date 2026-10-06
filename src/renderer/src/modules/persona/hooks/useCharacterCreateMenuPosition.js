import { useLayoutEffect, useState } from 'react';

export function useCharacterCreateMenuPosition(open, anchorRef) {
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!open) { setStyle(null); return undefined; }
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(200, window.innerWidth - 24);
      const below = Math.max(0, window.innerHeight - rect.bottom - 20);
      const useAbove = below < 112 && rect.top > below;
      setStyle({ position:'fixed', right:'auto', width, boxSizing:'border-box',
        left:Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top:useAbove ? 'auto' : rect.bottom + 6, bottom:useAbove ? window.innerHeight - rect.top + 6 : 'auto',
        maxHeight:useAbove ? rect.top - 18 : below });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); observer?.disconnect(); };
  }, [open, anchorRef]);
  return style;
}
