import { ArrowLeft } from '@phosphor-icons/react';

/** Layout only: callers retain navigation guards, save state and menu ownership. */
export function EditorHeader({ title, onBack, backLabel = '返回', saveAction, moreAction, className = '', titleId }) {
  return <header className={`editor-header${onBack ? ' editor-header--with-back' : ''} ${className}`}>
    {onBack ? <button type="button" className="editor-header-back" onClick={onBack} aria-label={backLabel}>
      <ArrowLeft size={20} aria-hidden="true" />
    </button> : null}
    <h2 id={titleId} className="editor-header-title" title={typeof title === 'string' ? title : undefined}>{title}</h2>
    {saveAction ? <div className="editor-header-save">{saveAction}</div> : null}
    {moreAction ? <div className="editor-header-more">{moreAction}</div> : null}
  </header>;
}

/** A single scroll owner keeps page actions outside the editor's clipping area. */
export function EditorPage({ header, children, footer, className = '', bodyClassName = '', ...props }) {
  return <section className={`editor-page ${className}`} {...props}>
    {header}
    <div className={`editor-page-body ${bodyClassName}`}>{children}</div>
    {footer ? <footer className="editor-page-footer">{footer}</footer> : null}
  </section>;
}
