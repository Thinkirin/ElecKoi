import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { applyAppearanceMode, applyAppearanceTheme, normalizeAppearanceMode, useDshAppearance } from '../../modules/appearance/index.js';
import { useDshDisplayPreferences } from '../../modules/settings/index.js';

const EMPTY = Object.freeze({ status: 'loading', ui: Object.freeze({}) });
const emptySnapshot = () => EMPTY;
const emptySubscribe = () => () => {};

/** One document-level owner also covers managers/editors opened as separate views. */
export function AppearanceDocumentController() {
  const appearance = useDshAppearance();
  const preferences = useDshDisplayPreferences();
  const snapshot = useSyncExternalStore(preferences?.subscribe || emptySubscribe, preferences?.getSnapshot || emptySnapshot);
  const mode = snapshot.ui?.appearance_mode;
  const palette = snapshot.ui?.appearance_theme;
  const [themeError, setThemeError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (snapshot.status !== 'ready' || !appearance) return;
    let current = true;
    setThemeError('');
    // Missing product preference is not a request to overwrite DSH's durable
    // preference. A fresh DSH host itself defaults to system + matchMedia.
    if (mode === undefined) applyAppearanceMode();
    else {
      Promise.resolve().then(() => appearance.setPreference(normalizeAppearanceMode(mode)))
        .then(() => { if (current) applyAppearanceMode(); })
        .catch(error => { if (current) setThemeError(error?.message || '外观模式切换失败。'); });
    }
    return () => { current = false; };
  }, [appearance, snapshot.status, mode, retry]);

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    applyAppearanceTheme(palette);
  }, [snapshot.status, palette]);

  return themeError ? <div role="alert" style={{ position: 'fixed', top: 16, left: 16, right: 16,
    zIndex: 2147483647, padding: 12, color: 'CanvasText', background: 'Canvas', border: '1px solid GrayText', borderRadius: 8 }}>
    {themeError} <button type="button" onClick={() => setRetry(value => value + 1)}>重试主题设置</button>
  </div> : null;
}
