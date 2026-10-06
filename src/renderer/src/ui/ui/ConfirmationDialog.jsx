import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useAnimatedClose } from "../hooks/useAnimatedClose.js";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  destructive = false,
  busy = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const busyRef = useRef(busy);
  const { closing, close } = useAnimatedClose(onCancel, 200, open, { busy });

  busyRef.current = busy;

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const previousFocus = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => cancelRef.current?.focus());

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll("button:not(:disabled)") || []);
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
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
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  const dialog = (
    <div className={`confirmation-overlay${closing ? " is-closing" : ""}`} role="presentation" onMouseDown={() => !busy && close()}>
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="confirmation-content"><p id={descriptionId}>{description}</p></div>
        <div className="confirmation-actions">
          <button ref={cancelRef} type="button" disabled={busy} onClick={close}>{cancelLabel}</button>
          <button
            type="button"
            className={destructive ? "is-destructive" : "is-primary"}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? "处理中" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );

  const portalTarget = typeof document === "undefined" ? null : document.body;
  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}
