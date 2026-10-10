// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VariableConfigPanel } from '../apps/web/src/modules/variables/components/VariableConfigPanel.jsx';
import { createObjectDraft, createVariableDraft } from '../apps/web/src/modules/variables/model/variableConfigEditing.js';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function renderPanel() {
  const empty = { objects: [], variables: [] };
  const version = {
    id: 'version-a', name: '配置 A', initialStateJson: '{}', schemaCode: '',
    objects: [{ ...createObjectDraft(empty), id: 'group-a', name: '状态组' }],
    variables: [{ ...createVariableDraft(empty), id: 'variable-a', title: 'count', type: 'number', defaultValue: '1' }],
    expandedObjectIds: [], createdAt: '', updatedAt: '',
  };
  const config = { ...version, characterId: 'synthetic-character', activeVersionId: version.id, versions: [version] };
  const model = {
    getSnapshot: () => ({ status: 'ready', value: config }), subscribe: () => () => {}, read: async () => config,
    save: vi.fn(async (_id, value) => value), saveViewState: vi.fn().mockResolvedValue(undefined),
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<VariableConfigPanel characterId="synthetic-character" variables={model} />));
  return { container, model, async dispose() { await act(async () => root.unmount()); container.remove(); } };
}

async function select(container, title) {
  const row = [...container.querySelectorAll('[role="treeitem"]')].find(item => item.textContent.includes(title));
  expect(row).toBeTruthy();
  await act(async () => row.click());
}

async function close(container) {
  await act(async () => container.querySelector('[aria-label="关闭编辑器"]').click());
}

describe('variable sidebar integration', () => {
  it('uses the shared resizable sidebar for variables, groups and runtime configuration while preserving editing and saving', async () => {
    let measuredWidth = 1400;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: measuredWidth }));
    const view = await renderPanel();
    try {
      await select(view.container, 'count');
      const layout = view.container.querySelector('.variable-layout');
      const separator = view.container.querySelector('[role="separator"]');
      const width = () => Number(separator.getAttribute('aria-valuenow'));
      expect(width()).toBe(760);
      expect(view.container.querySelector('.variable-inspector').parentElement.classList.contains('editor-sidebar-pane')).toBe(true);
      expect(view.container.querySelector('.variable-tree').classList.contains('editor-sidebar-directory')).toBe(true);
      await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
      expect(width()).toBe(784);
      expect(layout.style.getPropertyValue('--editor-sidebar-width')).toBe('784px');
      measuredWidth = 640;
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(width()).toBe(460);
      measuredWidth = 1400;
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(width()).toBe(784);

      const value = [...view.container.querySelectorAll('.variable-field')].find(item => item.firstChild.textContent === '默认值').querySelector('input');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(value, '5');
        value.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const save = [...view.container.querySelectorAll('button')].find(item => item.textContent === '保存');
      await act(async () => save.click());
      expect(view.model.save.mock.lastCall[1].variables[0].defaultValue).toBe('5');
      expect(view.model.save.mock.lastCall[1].versions.find(item => item.id === 'version-a').variables[0].defaultValue).toBe('5');

      await close(view.container);
      const closing = view.container.querySelector('.editor-sidebar-pane.is-closing');
      expect(closing.hasAttribute('inert')).toBe(true);
      expect(closing.querySelector('.variable-inspector')).toBeTruthy();
      await act(async () => new Promise(resolve => setTimeout(resolve, 200)));
      expect(view.container.querySelector('.variable-inspector')).toBeNull();
      expect(layout.classList.contains('is-inspector-open')).toBe(false);

      await select(view.container, '变量运行配置');
      expect(view.container.querySelector('[role="separator"]').getAttribute('aria-valuenow')).toBe('784');
      expect(view.container.querySelector('.variable-init-editor')).toBeTruthy();
      await close(view.container);
      await select(view.container, '状态组');
      expect(view.container.querySelector('.is-closing')).toBeNull();
      expect(view.container.querySelector('.variable-inspector input[maxlength="40"]').value).toBe('状态组');
      expect(view.container.querySelector('[role="separator"]').getAttribute('aria-valuenow')).toBe('784');
    } finally { await view.dispose(); }
  });

  it('removes the closed sidebar immediately when reduced motion is enabled', async () => {
    vi.spyOn(window, 'matchMedia', 'get').mockReturnValue(() => ({ matches: true }));
    const view = await renderPanel();
    try {
      await select(view.container, 'count');
      await close(view.container);
      expect(view.container.querySelector('.variable-inspector')).toBeNull();
      expect(view.container.querySelector('.variable-layout')).toBeTruthy();
    } finally { await view.dispose(); }
  });
});
