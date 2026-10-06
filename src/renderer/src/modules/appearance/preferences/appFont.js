import { assetSrc } from '../../../app/services/assets.js';
import './app-font.css';

export const DEFAULT_APP_FONT_ID = 'lxgw-975yuan-sc';
export const BUNDLED_APP_FONT_URL = new URL('../assets/fonts/lxgw-975yuan-sc.ttf', import.meta.url).href;
export const SYSTEM_APP_FONT = Object.freeze({ fontId: '', scope: 'all' });

export function normalizeAppFont(selection = SYSTEM_APP_FONT) {
  if (!selection || typeof selection.fontId !== 'string') throw new Error('字体选择缺少 fontId。');
  if (selection.scope !== 'all' && selection.scope !== 'chat') throw new Error('字体应用范围不正确。');
  return { fontId: selection.fontId, scope: selection.scope, ...(selection.reference ? { reference: String(selection.reference) } : {}) };
}

/** One controller per document. Only loaded FontFace objects are published; stale async loads cannot overwrite a newer selection. */
export function createAppFontController({ document: target = document, FontFace: Font = globalThis.FontFace, resolveAsset = assetSrc } = {}) {
  let generation = 0, current = null, disposed = false;
  const cache = new Map();
  const children = new Map();
  const root = target.documentElement;
  const styleId = 'eleckoi-selected-app-font';
  function applyFrame(frame) {
    const doc = frame.contentDocument;
    if (!doc?.documentElement || !current) return;
    if (current.selection.scope === 'chat' && !frame.closest('.chat-panel, .chat-display-preview')) return;
    if (current.face) doc.fonts?.add(current.face);
    let style = doc.getElementById(styleId);
    if (!style) { style = doc.createElement('style'); style.id = styleId; doc.documentElement.appendChild(style); }
    const css = current.face
      ? `:root{--eleckoi-app-font:${current.family}}body{font-family:var(--eleckoi-app-font),sans-serif}button,input,textarea,select{font-family:inherit}`
      : '';
    if (style.textContent !== css) style.textContent = css;
  }
  function updateFrames() {
    for (const frame of target.querySelectorAll('iframe')) {
      if (!children.has(frame)) {
        const onLoad = () => applyFrame(frame);
        frame.addEventListener('load', onLoad); children.set(frame, onLoad);
      }
      applyFrame(frame);
    }
    for (const [frame, listener] of children) if (!frame.isConnected) { frame.removeEventListener('load', listener); children.delete(frame); }
  }
  const Observer = target.defaultView?.MutationObserver;
  const containsFrame = node => node.nodeType === 1 && (node.tagName === 'IFRAME' || node.querySelector('iframe'));
  const observer = Observer ? new Observer(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsFrame))) updateFrames();
  }) : null;
  observer?.observe(root, { childList: true, subtree: true });
  return {
    async apply(input, installed = []) {
      const token = ++generation;
      const selection = normalizeAppFont(input);
      let face = null, family = '';
      if (selection.fontId) {
        if (!Font || !target.fonts) throw new Error('当前 WebView 不支持字体加载。');
        const reference = selection.fontId === DEFAULT_APP_FONT_ID ? BUNDLED_APP_FONT_URL
          : selection.reference || installed.find(item => item.id === selection.fontId)?.reference;
        if (!reference) throw new Error(`找不到字体文件：${selection.fontId}`);
        const url = resolveAsset(reference);
        let loaded = cache.get(url);
        if (!loaded) {
          family = `ElecKoiSelectedFont${cache.size}`;
          face = new Font(family, `url(${JSON.stringify(url)})`);
          loaded = face.load().then(() => ({ face, family }));
          cache.set(url, loaded);
          loaded.catch(() => { if (cache.get(url) === loaded) cache.delete(url); });
        }
        ({ face, family } = await loaded);
      }
      if (disposed || token !== generation) return false;
      if (current?.face && current.face !== face) {
        target.fonts.delete(current.face);
        for (const frame of children.keys()) frame.contentDocument?.fonts?.delete(current.face);
      }
      current = { selection, face, family };
      if (face) { target.fonts.add(face); root.style.setProperty('--eleckoi-app-font', family); root.dataset.eleckoiFontScope = selection.scope; }
      else { root.style.removeProperty('--eleckoi-app-font'); delete root.dataset.eleckoiFontScope; }
      // Remove an earlier all-scope font from frames when switching to chat-only.
      for (const frame of children.keys()) {
        if (selection.scope === 'chat' && !frame.closest('.chat-panel, .chat-display-preview')) frame.contentDocument?.getElementById(styleId)?.remove();
      }
      updateFrames();
      return true;
    },
    dispose() {
      disposed = true; generation++; observer?.disconnect();
      if (current?.face) target.fonts.delete(current.face);
      root.style.removeProperty('--eleckoi-app-font'); delete root.dataset.eleckoiFontScope;
      for (const [frame, listener] of children) {
        frame.removeEventListener('load', listener); const doc = frame.contentDocument;
        if (current?.face) doc?.fonts?.delete(current.face); doc?.getElementById(styleId)?.remove();
      }
      children.clear();
    }
  };
}
