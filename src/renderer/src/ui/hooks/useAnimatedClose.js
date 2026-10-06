import { useCallback, useEffect, useRef, useState } from 'react';
import { registerOverlayBack } from './overlayBack.js';

/** Keep a mounted overlay alive for its exit transition before notifying its owner. */
export function useAnimatedClose(onClose, duration = 200, active = true, { busy = false, onBack } = {}) {
  const [closing, setClosing] = useState(false);
  const callback = useRef(onClose);
  const timer = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const backRef = useRef(onBack);
  backRef.current = onBack;
  callback.current = onClose;
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (active) return;
    clearTimeout(timer.current);
    timer.current = null;
    setClosing(false);
  }, [active]);
  const close = useCallback(() => {
    if (timer.current !== null || busyRef.current) return;
    setClosing(true);
    const delay = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    timer.current = window.setTimeout(() => callback.current?.(), delay);
  }, [duration]);
  useEffect(() => {
    if (!active) return undefined;
    return registerOverlayBack(event => {
      if (busyRef.current) return true;
      if (backRef.current) return backRef.current(event);
      close(); return true;
    });
  }, [active, close]);
  return { closing, close };
}
