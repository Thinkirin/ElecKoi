import { ArrowLeft } from '@phosphor-icons/react';
import { isMobileProductHost } from '../services/platform.js';
import { appWindow } from '../services/windowControls.js';
import { TitleBar } from './shell/components/TitleBar.jsx';

export function ProductWindowBackButton({ onBack, label = '返回' }) {
  if (!isMobileProductHost()) return null;
  return <button className="product-window-back" type="button" aria-label={label} title={label}
    onClick={onBack || (() => appWindow.close())}>
    <ArrowLeft size={21} aria-hidden="true" />
  </button>;
}

export function ProductWindowTitleBar({ title, onClose, ...props }) {
  if (!isMobileProductHost()) return <TitleBar {...props} onClose={onClose} />;
  return <header className="client-titlebar product-window-titlebar">
    <ProductWindowBackButton onBack={onClose} />
    <strong>{title || 'ElecKoi'}</strong>
  </header>;
}
