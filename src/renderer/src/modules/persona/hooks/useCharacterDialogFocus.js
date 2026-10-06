import { useEffect, useRef } from 'react';

export function useCharacterDialogFocus(dialogRef) {
  const returnFocus = useRef(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const nodes = () => [...dialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []].filter(node => node.getClientRects().length);
    (nodes()[0] || dialogRef.current)?.focus();
    const key = event => {
      if (event.key !== 'Tab') return;
      const available = nodes();
      if (!available.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = available[0], last = available.at(-1);
      if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, [dialogRef]);
}
