import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, PencilSimple, ArrowClockwise, X } from '@phosphor-icons/react';
import '../styles/advancedFrontends.css';
import { useAnimatedClose } from '../../../ui/hooks/useAnimatedClose.js';
import { isMobileProductHost } from '../../../app/services/platform.js';

/** Natural content height, capped by the real CSS viewport; backdrop follows the actual sheet edge. */
export function AdaptiveChatSheet({ title, icon, children, actions, onClose, busy = false, compact = false }) {
  const [entered, setEntered] = useState(false);
  const { closing, close } = useAnimatedClose(onClose, 200, true, { busy });
  const titleId = useId(), sheet = useRef(null), returnFocus = useRef(null);
  useEffect(() => {
    returnFocus.current = document.activeElement;
    const frame = requestAnimationFrame(() => setEntered(true));
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const nodes = [...sheet.current?.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || []];
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key); returnFocus.current?.focus?.(); };
  }, [close]);
  return createPortal(<div className={`adaptive-chat-backdrop${entered ? ' entered' : ''}${closing ? ' closing' : ''}`}
    onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={sheet} className={`adaptive-chat-sheet${compact ? ' is-message-editor' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined}>
      <header><h2 id={titleId}>{icon}<span>{title}</span></h2><button type="button" className="adaptive-chat-close" aria-label="关闭" disabled={busy} onClick={close}><X size={18} /></button></header>
      <div className="adaptive-chat-sheet-content">{children}</div>
      {actions ? <footer>{actions}</footer> : null}
    </section>
  </div>, document.body);
}

export function AdaptiveMessageEditor({ message, onSave, onRegenerate, onClose }) {
  const [draft, setDraft] = useState(message.content || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const textarea = useRef(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const resize = () => {
      const limit = parseFloat(getComputedStyle(field).maxHeight);
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, Number.isFinite(limit) ? limit : field.scrollHeight)}px`;
    };
    resize(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(field.parentElement); return () => observer?.disconnect();
  }, [draft]);
  const save = async regenerate => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (regenerate) {
        if (await onRegenerate?.(message, draft) === false) throw new Error('重新生成没有开始');
      } else if (draft !== (message.content || '') && await onSave?.(message, draft) === false) throw new Error('消息没有保存成功');
      onClose();
    } catch (failure) { setError(failure.message || String(failure)); }
    finally { setBusy(false); }
  };
  return <AdaptiveChatSheet title={message.role === 'user' ? '修改输入' : '修改输出'} icon={<PencilSimple size={16} />}
    onClose={onClose} busy={busy} compact actions={<>
      {message.role === 'user' && onRegenerate ? <button type="button" aria-label="保存并重新生成" disabled={busy} onClick={() => save(true)}><ArrowClockwise size={17} /></button> : null}
      <button type="button" aria-label="保存修改" disabled={busy} onClick={() => save(false)}><Check size={18} /></button>
    </>}>
    <textarea ref={textarea} rows={1} value={draft} onChange={event => setDraft(event.target.value)} autoFocus={!isMobileProductHost()} disabled={busy}
      aria-label={message.role === 'user' ? '修改输入' : '修改输出'} onKeyDown={event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(false); }
      }} />
    {error ? <p role="alert" className="adaptive-chat-error">{error}</p> : null}
  </AdaptiveChatSheet>;
}
