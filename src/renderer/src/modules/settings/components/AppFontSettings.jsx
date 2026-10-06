import { useState, useSyncExternalStore } from 'react';
import { useDshDisplayPreferences } from '../model/DisplayPreferencesContext.jsx';
import { DEFAULT_APP_FONT_ID, SYSTEM_APP_FONT, normalizeAppFont } from '../../appearance/index.js';
import { TextT, CaretDown } from '@phosphor-icons/react';

const EMPTY = { ui: {}, writable: false };
const getEmpty = () => EMPTY;
const subscribeEmpty = () => () => {};

export function AppFontSettings({ client: suppliedClient } = {}) {
  const providedClient = useDshDisplayPreferences();
  const client = suppliedClient ?? providedClient;
  const snapshot = useSyncExternalStore(client?.subscribe || subscribeEmpty, client?.getSnapshot || getEmpty);
  const selected = snapshot.ui.app_font || SYSTEM_APP_FONT;
  const fonts = snapshot.ui.app_fonts || [];
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(patch) {
    setSaving(true); setError('');
    try {
      if (!client) throw new Error('显示偏好服务尚未就绪。');
      await client.updateUi({ app_font: normalizeAppFont({ ...selected, ...patch }) });
    } catch (failure) { setError(failure.message || String(failure)); }
    finally { setSaving(false); }
  }
  return <section className="app-font-settings settings-font-section" aria-label="字体设置">
    <div className="settings-section-label tone-warm"><TextT size={18} /><strong>界面字体</strong></div>
    <div className="settings-font-sample" aria-label="当前字体预览"><span>海风与星光</span><span>Aa 0123</span></div>
    <div className="settings-font-select">
    <select aria-label="界面字体" value={selected.fontId} disabled={!snapshot.writable || saving} onChange={event => {
      const fontId = event.target.value, font = fonts.find(item => item.id === fontId);
      save({ fontId, reference: font?.reference });
    }}>
      <option value="">系统字体</option>
      <option value={DEFAULT_APP_FONT_ID}>975 圆体</option>
      {fonts.filter(font => font.id !== DEFAULT_APP_FONT_ID).map(font => <option key={font.id} value={font.id}>{font.name || font.id}</option>)}
    </select>
    <CaretDown size={15} aria-hidden="true" /></div>
    <div className="settings-font-scope" role="radiogroup" aria-label="字体应用范围">
      {[['all', '全部界面'], ['chat', '仅聊天']].map(([scope, label]) => <button key={scope} type="button" role="radio" aria-checked={selected.scope === scope}
        className={selected.scope === scope ? 'active' : ''} disabled={!snapshot.writable || saving} onClick={() => save({ scope })}>{label}</button>)}
    </div>
    {error ? <p role="alert" className="app-font-error">{error}</p> : null}
  </section>;
}
