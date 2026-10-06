import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useAnimatedClose } from '../../../ui/hooks/useAnimatedClose.js';

export function ModelProviderDeleteDialog({ target, deleting = false, error = "", onCancel, onConfirm }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const deletingRef = useRef(deleting);
  const { closing, close } = useAnimatedClose(onCancel, 200, Boolean(target), { busy: deleting });

  deletingRef.current = deleting;

  useEffect(() => {
    if (!target) return undefined;
    cancelRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape" && !deletingRef.current) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll("button:not(:disabled)") || []);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      target.returnFocus?.focus?.();
    };
  }, [target]);

  if (!target) return null;

  const consequence = target.configCount > 0
    ? `该入口下的 ${target.configCount} 个模型配置将从本地永久删除。`
    : "这个尚未保存的模型入口将被移除。";

  return createPortal(
    <div className={`model-provider-delete-overlay${closing ? ' is-closing' : ''}`} role="presentation" onMouseDown={close}>
      <section
        ref={dialogRef}
        className="model-provider-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={deleting || undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>删除“{target.label}”入口？</h2>
        <p id={descriptionId}>
          {consequence}{target.hasUnsavedChanges ? " 未保存的修改也会丢失。" : ""}
        </p>
        {error ? <span className="model-provider-delete-error" role="alert">{error}</span> : null}
        <div>
          <button ref={cancelRef} type="button" disabled={deleting} onClick={close}>取消</button>
          <button type="button" className="danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? "删除中…" : "删除入口"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
