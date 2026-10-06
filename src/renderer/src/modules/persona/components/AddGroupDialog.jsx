import { useEffect, useId, useRef } from "react";
import { createPortal } from 'react-dom';
import { useCharacterDialogFocus } from '../hooks/useCharacterDialogFocus.js';
import { registerOverlayBack } from "../../../ui/hooks/overlayBack.js";

export function AddGroupDialog({ title = "添加分组", value, onChange, onConfirm, onCancel }) {
  const titleId = useId(), dialogRef = useRef(null);
  useCharacterDialogFocus(dialogRef);
  useEffect(() => registerOverlayBack(() => { onCancel(); return true; }), [onCancel]);
  return createPortal(
    <div className="character-group-dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <form
        ref={dialogRef}
        role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId}
        className="character-group-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h3 id={titleId}>{title}</h3>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="填写分组"
          aria-label="分组名称"
          autoFocus
        />
        <div>
          <button className="character-dialog-confirm" type="submit" disabled={!value.trim()}>
            确定
          </button>
          <button type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </form>
    </div>, document.body
  );
}
