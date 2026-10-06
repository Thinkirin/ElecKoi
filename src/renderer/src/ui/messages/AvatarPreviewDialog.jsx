import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { assetSrc } from "../../app/services/assets.js";
import { useAnimatedClose } from "../hooks/useAnimatedClose.js";

export function AvatarPreviewDialog({ src, name, onClose, onPin }) {
  const closeRef = useRef(null);
  const pinRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const { closing, close } = useAnimatedClose(onClose);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        if (!onPin) {
          event.preventDefault();
          closeRef.current?.focus();
        } else if (event.shiftKey && document.activeElement === pinRef.current) {
          event.preventDefault();
          closeRef.current?.focus();
        } else if (!event.shiftKey && document.activeElement === closeRef.current) {
          event.preventDefault();
          pinRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`avatar-preview-backdrop${closing ? " is-closing" : ""}`} onPointerDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div className="avatar-preview-dialog" role="dialog" aria-modal="true" aria-label={`${name || "角色"}的头像预览`}>
        {failed ? <p className="avatar-preview-error">头像无法加载</p> : <img className="avatar-preview-image" src={assetSrc(src)} alt={`${name || "角色"}的头像`} onError={() => setFailed(true)} />}
        <div className="avatar-preview-actions">
          {onPin ? <button ref={pinRef} type="button" className="avatar-preview-pin" onClick={onPin}>固定在聊天中</button> : null}
          <button ref={closeRef} type="button" className="avatar-preview-close" onClick={close} aria-label="关闭头像预览"><span aria-hidden="true">×</span>关闭</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
