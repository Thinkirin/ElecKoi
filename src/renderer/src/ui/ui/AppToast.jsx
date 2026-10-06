import React, { useEffect, useState } from "react";
import { AppErrorDialog } from "./AppErrorDialog.jsx";

export function AppToast({ notice, onDismiss }) {
  const [visibleNotice, setVisibleNotice] = useState(notice);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (notice?.message) { setVisibleNotice(notice); setClosing(false); return undefined; }
    setClosing(true);
    const timer = window.setTimeout(() => setVisibleNotice(null), window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const current = notice?.message ? notice : visibleNotice;
  if (!current?.message || (!notice?.message && current.type === 'error')) return null;
  if (current.type === "error") {
    return <AppErrorDialog key={current.id || current.message} notice={current} onDismiss={onDismiss} />;
  }

  return (
    <div className={`app-toast ${current.type || "info"}${closing && !notice?.message ? " is-closing" : ""}`} role="status" aria-live="polite">
      <span className="app-toast-icon" aria-hidden="true" />
      <span>{current.message}</span>
    </div>
  );
}
