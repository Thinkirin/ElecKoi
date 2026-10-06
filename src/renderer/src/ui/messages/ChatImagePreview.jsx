import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { useAnimatedClose } from '../hooks/useAnimatedClose.js';

export function ChatImagePreview({ src, label, onClose }) {
  const { closing, close } = useAnimatedClose(onClose, 200, true);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [close]);
  return createPortal(<div className={`chat-image-preview-backdrop${closing ? ' closing' : ''}`}
    onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="chat-image-preview-dialog" role="dialog" aria-modal="true" aria-label={label || '图片预览'}>
      <img src={src} alt={label || '消息图片'} />
      <button ref={closeRef} type="button" onClick={close} aria-label="关闭图片预览"><X size={20} /></button>
    </section>
  </div>, document.body);
}
