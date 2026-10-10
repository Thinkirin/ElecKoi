import { useEffect, useRef, useState } from 'react';

/** 保留退出中的编辑器，关闭后撤销交互；快速重开时取消待卸载任务。 */
export function useInspectorPresence(content) {
  const lastContent = useRef(null);
  const [mounted, setMounted] = useState(Boolean(content));
  const open = Boolean(content);
  if (content) lastContent.current = content;

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const remove = () => { lastContent.current = null; setMounted(false); };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      remove();
      return undefined;
    }
    const timeout = window.setTimeout(remove, 180);
    return () => window.clearTimeout(timeout);
  }, [open]);

  return {
    content: content || (mounted ? lastContent.current : null),
    closing: !open,
    onAnimationEnd(event) {
      if (!open && event.target === event.currentTarget) {
        lastContent.current = null;
        setMounted(false);
      }
    },
  };
}
