import { Check, Moon, Sun, Desktop, UserCircle, ImageSquare, Palette, CaretRight } from '@phosphor-icons/react';
import { AppFontSettings } from './AppFontSettings.jsx';

const modes = [
  { id: 'light', label: '浅色', Icon: Sun },
  { id: 'dark', label: '深色', Icon: Moon },
  { id: 'system', label: '跟随系统', Icon: Desktop },
];

export function AppearanceSettings({ mode, onModeChange, artwork, onArtworkChange }) {
  return <div className="settings-appearance-studio">
    <section className="settings-appearance-section" aria-label="外观模式">
      <div className="settings-section-label"><Palette size={18} /><strong>外观模式</strong></div>
      <div className="settings-theme-options" role="radiogroup" aria-label="外观模式">
        {modes.map(({ id, label, Icon }) => <button key={id} type="button" role="radio" aria-checked={mode === id}
          className={`settings-theme-option${mode === id ? ' is-selected' : ''}`} onClick={() => onModeChange(id)}>
          <span className={`settings-theme-miniature is-${id}`} aria-hidden="true">
            <span className="settings-mini-rail"><i /><i /><i /></span>
            <span className="settings-mini-chat"><i /><b /><i /><em /></span>
          </span>
          <span className="settings-theme-option-label"><Icon size={16} /><span>{label}</span><Check size={14} className="settings-choice-check" /></span>
        </button>)}
      </div>
    </section>
    <section className="settings-artwork-row" aria-label="侧栏角色图">
      <div className="settings-section-label tone-teal"><UserCircle size={19} /><strong>侧栏角色图</strong></div>
      <div className="settings-artwork-options" role="radiogroup" aria-label="侧栏角色图">
        {[{ id: 'cover', label: '封面立绘', Icon: ImageSquare }, { id: 'avatar', label: '头像', Icon: UserCircle }].map(({ id, label, Icon }) =>
          <button key={id} role="radio" type="button" aria-checked={artwork === id} onClick={() => onArtworkChange(id)}>
            <Icon size={20} weight={artwork === id ? 'duotone' : 'regular'} /><span>{label}</span>
          </button>)}
      </div>
    </section>
    <AppFontSettings />
    <div className="settings-coming-row">
      <Palette size={20} /><strong>超级调色盘</strong><span>开发中</span><CaretRight size={15} aria-hidden="true" />
    </div>
  </div>;
}
