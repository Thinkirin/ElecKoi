import { useEffect, useRef } from 'react';

export function applySidebarListWheel(element, event) {
  if (!element || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false;
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (maxScrollTop === 0) return false;
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
  const nextScrollTop = Math.max(0, Math.min(maxScrollTop, element.scrollTop + event.deltaY * multiplier));
  if (nextScrollTop === element.scrollTop) return false;
  element.scrollTop = nextScrollTop;
  event.preventDefault();
  return true;
}

export function useSidebarListScroll() {
  const scrollRef = useRef(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const handleWheel = (event) => applySidebarListWheel(element, event);
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  return scrollRef;
}
