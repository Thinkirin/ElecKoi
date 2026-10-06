import { useCallback, useEffect, useRef } from 'react';

/** DSH slot anchors are display:contents and cannot paint a transition. */
export function animateMobilePage(root, { compact, reducedMotion = false } = {}) {
  if (reducedMotion || !root) return () => {};
  const animations = [];
  const visit = node => {
    const display = getComputedStyle(node).display;
    if (display === 'none') return;
    if (display === 'contents') {
      for (const child of node.children) visit(child);
    } else if (typeof node.animate === 'function') {
      animations.push(node.animate([
        { opacity: 0, transform: `translateY(${compact ? 12 : 6}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: compact ? 220 : 180, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    }
  };
  for (const child of root.children) visit(child);
  return () => { for (const animation of animations) animation.cancel(); };
}

export function useMobilePageTransition(section, compact) {
  const root = useRef(null), pending = useRef(null), stop = useRef(() => {});
  const cancel = useCallback(() => {
    if (pending.current !== null) cancelAnimationFrame(pending.current);
    pending.current = null;
    stop.current();
    stop.current = () => {};
  }, []);
  const schedule = useCallback(() => {
    cancel();
    if (!root.current) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      stop.current = animateMobilePage(root.current, {
        compact,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    });
  }, [cancel, compact]);
  const ref = useCallback(node => {
    root.current = node;
    // The real content shell may mount after a lazy page finishes loading.
    schedule();
  }, [schedule]);
  useEffect(() => { schedule(); return cancel; }, [section, schedule, cancel]);
  return ref;
}
