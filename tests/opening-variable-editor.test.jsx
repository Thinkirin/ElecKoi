// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpeningEditor } from '../apps/web/src/modules/settingLibraries/components/OpeningEditor.jsx';
import { BranchSettingsSplitView } from '../apps/web/src/modules/settingLibraries/components/BranchSettingsSplitView.jsx';
import { SettingLibraryPanel } from '../apps/web/src/modules/settingLibraries/components/SettingLibraryPanel.jsx';
import { createEntryDraft } from '../apps/web/src/modules/settingLibraries/model/settingLibraryEditing.js';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function render(component) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(component));
  return { container, root, async dispose() { await act(async () => root.unmount()); container.remove(); } };
}

describe('opening configuration editor', () => {
  it('binds openings independently and preserves the binding when duplicating an opening', async () => {
    const changed = vi.fn();
    function Harness() {
      const [entry, setEntry] = useState({ defaultOpeningMessageId: 'opening-a', openingMessages: [
        { id: 'opening-a', title: '开场 A', content: '', variableVersionId: 'version-a', initialVariableStateJson: '' },
        { id: 'opening-b', title: '开场 B', content: '', variableVersionId: '', initialVariableStateJson: '{"seed":1}' },
      ] });
      return <OpeningEditor entry={entry} variableVersions={[{ id: 'version-a', name: '配置 A' }, { id: 'version-b', name: '配置 B' }]}
        onChange={(next) => { changed(next); setEntry(next); }} onRequestDelete={() => {}} />;
    }
    const view = await render(<Harness />);
    try {
      expect(view.container.querySelector('select').value).toBe('version-a');
      expect([...view.container.querySelector('select').options].filter((option) => !option.disabled).map((option) => option.value)).toEqual(['version-a', 'version-b']);
      await act(async () => [...view.container.querySelectorAll('.setting-library-opening-toggle')][1].click());
      const select = view.container.querySelector('select');
      await act(async () => { select.value = 'version-b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(changed.mock.lastCall[0].openingMessages).toMatchObject([
        { variableVersionId: 'version-a' }, { variableVersionId: 'version-b', initialVariableStateJson: '' },
      ]);
      await act(async () => view.container.querySelector('.setting-library-opening-item.is-expanded [aria-label="复制开场白"]').click());
      expect(changed.mock.lastCall[0].openingMessages.at(-1).variableVersionId).toBe('version-b');
    } finally { await view.dispose(); }
  });

  it('shows an unbound opening without inventing a version or changing its initial data', async () => {
    const changed = vi.fn();
    const entry = { defaultOpeningMessageId: 'opening-a', openingMessages: [
      { id: 'opening-a', title: '开场 A', content: '', variableVersionId: '', initialVariableStateJson: '{"seed":1}' },
    ] };
    const view = await render(<OpeningEditor entry={entry}
      variableVersions={[{ id: 'version-b', name: '配置 B' }, { id: 'version-a', name: '配置 A' }]}
      onChange={changed} onRequestDelete={() => {}} />);
    try {
      const select = view.container.querySelector('select');
      expect(select.value).toBe('');
      expect(select.selectedOptions[0].textContent).toBe('请选择变量版本');
      expect(select.selectedOptions[0].disabled).toBe(true);
      expect(select.selectedOptions[0].hidden).toBe(true);
      expect([...select.options].filter((option) => !option.disabled).map((option) => [option.value, option.textContent]))
        .toEqual([['version-b', '配置 B'], ['version-a', '配置 A']]);
      expect(view.container.textContent).not.toContain('当前变量版本');
      expect(changed).not.toHaveBeenCalled();
      await act(async () => { select.value = 'version-a'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(changed.mock.lastCall[0].openingMessages[0]).toMatchObject({ variableVersionId: 'version-a', initialVariableStateJson: '' });
    } finally { await view.dispose(); }
  });

  it('keeps a missing binding visible and preserves data when no versions are available', async () => {
    const changed = vi.fn();
    const entry = { defaultOpeningMessageId: 'opening-a', openingMessages: [
      { id: 'opening-a', title: '开场 A', content: '', variableVersionId: 'missing-version', initialVariableStateJson: '{"seed":1}' },
    ] };
    const view = await render(<OpeningEditor entry={entry} variableVersions={[]}
      onChange={changed} onRequestDelete={() => {}} />);
    try {
      const select = view.container.querySelector('select');
      expect(select.disabled).toBe(true);
      expect(select.value).toBe('missing-version');
      expect(select.selectedOptions[0].textContent).toBe('版本不存在');
      expect([...select.options].filter((option) => !option.disabled)).toEqual([]);
      expect(changed).not.toHaveBeenCalled();
    } finally { await view.dispose(); }
  });

  it('keeps a closing branch inspector inert until exit and handles a quick reopen without losing the editor', async () => {
    vi.useFakeTimers();
    const widthChanged = vi.fn();
    const content = (open) => <BranchSettingsSplitView preferredWidth={760} onWidthChange={widthChanged}>
      <section>设定目录</section>
      {open ? <aside><input aria-label="设定正文" defaultValue="合成正文" /></aside> : null}
    </BranchSettingsSplitView>;
    const view = await render(content(false));
    try {
      expect(view.container.querySelector('aside')).toBeNull();
      await act(async () => view.root.render(content(true)));
      const resizer = view.container.querySelector('[aria-label="调整编辑器宽度"]');
      expect(resizer.getAttribute('aria-valuemin')).toBe('520');
      expect(resizer.getAttribute('aria-valuenow')).toBe('737');
      await act(async () => view.root.render(content(false)));
      const closing = view.container.querySelector('.is-closing');
      expect(closing.hasAttribute('inert')).toBe(true);
      expect(closing.querySelector('input')).toBeTruthy();
      await act(async () => view.root.render(content(true)));
      await act(async () => vi.advanceTimersByTime(200));
      expect(view.container.querySelector('.is-closing')).toBeNull();
      expect(view.container.querySelector('input')).toBeTruthy();
      await act(async () => view.root.render(content(false)));
      await act(async () => vi.advanceTimersByTime(200));
      expect(view.container.querySelector('aside')).toBeNull();
    } finally { await view.dispose(); }
  });

  it('clamps the library inspector and its reset to the available pane while retaining its preferred desktop width', async () => {
    let measuredWidth = 1400;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: measuredWidth }));
    const library = { characterId: 'synthetic-character', name: '', entries: [
      { ...createEntryDraft('', 0, []), id: 'synthetic-setting', title: '合成设定', enabled: true },
    ], groups: [], promptPositions: [], versions: [], activeVersionId: 'library-a', expandedGroupIds: [], listAllExpanded: false };
    const model = { getSnapshot: () => ({ status: 'ready', value: library }), subscribe: () => () => {}, read: async () => library };
    const view = await render(<SettingLibraryPanel characterId="synthetic-character" settingLibraries={model} />);
    try {
      await act(async () => view.container.querySelector('[role="treeitem"]').click());
      const separator = view.container.querySelector('[aria-label="调整编辑器宽度"]');
      const width = () => Number(separator.getAttribute('aria-valuenow'));
      expect(width()).toBe(760);
      measuredWidth = 640;
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(width()).toBe(460);
      expect(separator.getAttribute('aria-valuemin')).toBe('460');
      expect(separator.getAttribute('aria-valuemax')).toBe('460');
      await act(async () => separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(width()).toBe(460);
      measuredWidth = 1400;
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(width()).toBe(760);
    } finally { await view.dispose(); }
  });
})
