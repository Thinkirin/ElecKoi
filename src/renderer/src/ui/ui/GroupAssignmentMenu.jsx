import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "../icons/index.jsx";
import { DshFolderClosedIcon } from "../icons/dshTreeIcons.jsx";
import { MinusIcon } from "../icons/openSourceIcons.jsx";

export function GroupAssignmentMenu({ x, y, label, currentGroupId = "", groups, onMove }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ left:x, top:y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return undefined;
    const viewport = window.visualViewport;
    const place = () => {
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const offsetTop = viewport?.offsetTop ?? 0;
      menu.style.maxHeight = `${Math.max(0, Math.min(420, height - 16))}px`;
      menu.style.maxWidth = `${Math.max(0, width - 16)}px`;
      const rect = menu.getBoundingClientRect();
      const left = Math.max(offsetLeft + 8, Math.min(x, offsetLeft + width - rect.width - 8));
      const top = Math.max(offsetTop + 8, Math.min(y, offsetTop + height - rect.height - 8));
      setPosition(current => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
    };
  }, [x, y]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    menuRef.current?.querySelector("button:not(:disabled)")?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  function moveFocus(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...(menuRef.current?.querySelectorAll("button:not(:disabled)") || [])];
    if (!buttons.length) return;
    event.preventDefault();
    const currentIndex = buttons.indexOf(document.activeElement);
    if (event.key === "Home") buttons[0].focus();
    else if (event.key === "End") buttons.at(-1).focus();
    else {
      const step = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (Math.max(0, currentIndex) + step + buttons.length) % buttons.length;
      buttons[nextIndex].focus();
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      className="group-assignment-menu"
      role="menu"
      aria-label={label}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={moveFocus}
    >
      <button type="button" role="menuitem" disabled={!currentGroupId} onClick={() => void onMove("")}>
        {currentGroupId ? <MinusIcon /> : <CheckIcon />}
        <span>{currentGroupId ? "移出分组" : "未分组"}</span>
      </button>
      {groups.length ? <div className="group-assignment-menu-targets" role="group" aria-label="目标分组">
        {groups.map((group) => {
          const current = group.id === currentGroupId;
          return (
            <button key={group.id} type="button" role="menuitem" disabled={current} aria-current={current ? "true" : undefined} onClick={() => void onMove(group.id)}>
              {current ? <CheckIcon /> : <DshFolderClosedIcon />}
              <span>{group.name}</span>
            </button>
          );
        })}
      </div> : null}
    </div>, document.body
  );
}
