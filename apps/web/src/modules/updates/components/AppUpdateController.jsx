import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VISIBLE_PHASES = new Set(["available", "downloading", "ready", "installing", "error"]);

export function AppUpdateController({ updates }) {
  const status = updates?.status ?? null;
  const [dismissedKey, setDismissedKey] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (status?.phase !== "error") setActionError("");
  }, [status?.phase]);

  const dialogKey = status?.availableVersion ? `${status.phase}:${status.availableVersion}` : "";
  const open = Boolean(
    status?.availableVersion
    && VISIBLE_PHASES.has(status.phase)
    && dismissedKey !== dialogKey
  );

  const close = useCallback(() => {
    if (!dialogKey || status?.phase === "installing") return;
    setDismissedKey(dialogKey);
    setActionError("");
  }, [dialogKey, status?.phase]);

  const download = useCallback(async () => {
    setActionError("");
    try {
      await updates?.download?.();
    } catch (error) {
      setActionError(error?.message || "下载更新失败，请稍后重试。");
    }
  }, [updates]);

  const install = useCallback(async () => {
    setActionError("");
    try {
      const result = await updates?.install?.();
      if (!result) throw new Error("更新服务暂时不可用。");
      if (!result.accepted) {
        setActionError(result.reason === "agent_running"
          ? "当前仍有回复正在生成，请停止生成后再重启更新。"
          : "更新尚未下载完成，请稍后再试。"
        );
      }
    } catch (error) {
      setActionError(error?.message || "无法启动安装，请稍后重试。");
    }
  }, [updates]);

  if (!open) return null;
  return (
    <UpdateDialog
      status={status}
      actionError={actionError}
      onClose={close}
      onDownload={download}
      onInstall={install}
    />
  );
}

function UpdateDialog({ status, actionError, onClose, onDownload, onInstall }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const secondaryRef = useRef(null);
  const lifecycleRef = useRef({ onClose, installing: false });
  const installing = status.phase === "installing";
  lifecycleRef.current = { onClose, installing };
  const downloading = status.phase === "downloading";
  const ready = status.phase === "ready";
  const failed = status.phase === "error";
  const progressPercent = Math.round(status.progress?.percent ?? 0);
  const title = installing ? "正在更新" : downloading ? "正在下载" : failed ? "更新失败" : "版本就绪";
  const releaseUrl = `https://github.com/eleckoi/ElecKoi/releases/tag/${encodeURIComponent(`v${status.availableVersion}`)}`;
  const description = useMemo(() => {
    if (installing) return "正在重启并安装更新…";
    if (ready) return "更新已下载，重启后即可完成安装。";
    if (downloading) return `正在后台下载更新${progressPercent > 0 ? ` · ${progressPercent}%` : "…"}`;
    if (failed) return status.message || "更新失败，请检查网络后重试。";
    return "新版本已准备好，下载期间仍可继续使用 ElecKoi。";
  }, [downloading, failed, installing, progressPercent, ready, status.message]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => secondaryRef.current?.focus());

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!lifecycleRef.current.installing) lifecycleRef.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') || []);
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
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const dialog = (
    <div className="app-update-overlay" role="presentation" onMouseDown={() => !installing && onClose()}>
      <section
        ref={dialogRef}
        className="app-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={downloading || installing || undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="app-update-heading">
          <h2 id={titleId}>v{status.availableVersion} {title}</h2>
          <a className="app-update-release-link" href={releaseUrl} target="_blank" rel="noopener noreferrer">前往下载</a>
        </header>
        <section className="app-update-notes-section" aria-label="本次更新" tabIndex={0}>
          <p className="app-update-notes">
            {status.releaseNotes || status.releaseName || "包含稳定性改进和问题修复。"}
          </p>
        </section>

        <footer className="app-update-footer">
          {downloading ? <div className="app-update-download-progress">
            <div className="app-update-progress" role="progressbar" aria-label="更新下载进度"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
              <i style={{ width: `${progressPercent}%` }} />
            </div>
            <span>{progressPercent}%</span>
          </div> : null}
          <p id={descriptionId} className="app-update-status" role={failed ? "alert" : "status"}>{description}</p>
          <span>
            当前版本 v{status.currentVersion}
            {status.downloadSizeBytes ? ` · 约 ${formatBytes(status.downloadSizeBytes)}` : ""}
          </span>
          {actionError ? <p className="app-update-error" role="alert">{actionError}</p> : null}
          <div className="app-update-actions">
            <button ref={secondaryRef} type="button" disabled={installing} onClick={onClose}>
              {downloading ? "隐藏" : ready ? "稍后重启" : "稍后"}
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={downloading || installing}
              onClick={ready ? onInstall : onDownload}
            >
              {installing
                ? "正在重启"
                : downloading
                  ? `下载中 ${progressPercent}%`
                  : ready
                    ? "重启并更新"
                    : failed
                      ? "重新下载"
                      : "下载更新"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 10 ? `${Math.round(megabytes)} MB` : `${megabytes.toFixed(1)} MB`;
}
