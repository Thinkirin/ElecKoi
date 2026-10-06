import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OfficialMarkdown } from "../../../ui/messages/OfficialMarkdown.jsx";
import { ArrowsInSimple, ArrowsOutSimple, Eye, PencilSimple } from "@phosphor-icons/react";
import { useAnimatedClose } from "../../../ui/hooks/useAnimatedClose.js";

export function MarkdownTextareaField({ label, value, placeholder, onChange, preview = true, labelAction = null }) {
  const inputId = useId();
  const editorRef = useRef(null);
  const [immersive, setImmersive] = useState(false);
  const [mode, setMode] = useState("edit");
  const { closing, close: closeImmersive } = useAnimatedClose(() => setImmersive(false), 200, immersive);

  useEffect(() => {
    if (!immersive) return undefined;
    document.documentElement.classList.add("immersive-editor-open");
    setMode("edit");
    const focusFrame = requestAnimationFrame(() => {
      const editor = editorRef.current;
      editor?.focus();
      editor?.setSelectionRange(editor.value.length, editor.value.length);
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.documentElement.classList.remove("immersive-editor-open");
    };
  }, [immersive]);

  const overlayHost = immersive
    ? document.querySelector(".qq-character-editor-window-shell") || document.body
    : null;

  const overlay = immersive && overlayHost ? createPortal(
    <section className={`immersive-markdown-editor${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${inputId}-title`}>
      <header className="immersive-markdown-header">
        <strong id={`${inputId}-title`}>{label}</strong>
        <div className="immersive-markdown-actions">
          {preview ? (
            <div className="immersive-markdown-tabs" role="tablist" aria-label="编辑模式">
              <button type="button" role="tab" aria-selected={mode === "edit"} onClick={() => setMode("edit")}><PencilSimple size={15} />编辑</button>
              <button type="button" role="tab" aria-selected={mode === "preview"} onClick={() => setMode("preview")}><Eye size={15} />预览</button>
            </div>
          ) : null}
          <button type="button" className="immersive-markdown-exit" onClick={closeImmersive} aria-label="退出沉浸编辑" title="退出沉浸编辑"><ArrowsInSimple size={18} /></button>
        </div>
      </header>
      <div className="immersive-markdown-body">
        {mode === "preview" && preview ? (
          <article className="immersive-markdown-preview">
            {value.trim() ? <OfficialMarkdown content={value} /> : <p className="is-empty">暂无内容</p>}
          </article>
        ) : (
          <textarea
            ref={editorRef}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
    </section>,
    overlayHost,
  ) : null;

  return (
    <>
      <div className="setting-library-content-field">
        <div className="setting-library-content-heading">
          <label htmlFor={inputId}>{label}</label>
          <div className="setting-library-content-actions">
            {labelAction}
            <button type="button" onClick={() => setImmersive(true)} aria-label="沉浸编辑" title="沉浸编辑"><ArrowsOutSimple size={18} /></button>
          </div>
        </div>
        <textarea id={inputId} value={value} placeholder={placeholder} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      </div>
      {overlay}
    </>
  );
}
