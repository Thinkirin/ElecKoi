import { CaretRight, UsersThree } from '@phosphor-icons/react';

export function SubagentSettingsLink({ onBeforeOpen, onOpen, onNotify }) {
  function openSettings() {
    if (onBeforeOpen?.() === false) return;
    const detail = { id: 'subagent', kind: 'item', opened: false, error: null };
    window.dispatchEvent(new CustomEvent('eleckoi:dsh-plugins:select', { detail }));
    if (!detail.opened) {
      onNotify?.('error', detail.error || '子智能体设置暂时无法打开');
      return;
    }
    onOpen?.();
  }

  return <button type="button" className="subagent-settings-link" onClick={openSettings}>
    <UsersThree size={23} aria-hidden="true" />
    <strong>前往子智能体设置</strong>
    <CaretRight size={17} aria-hidden="true" />
  </button>;
}
