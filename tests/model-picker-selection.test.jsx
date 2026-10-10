// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { configDefaultModel, ModelPicker } from '../apps/web/src/modules/models/components/ModelPicker.jsx';

describe('model picker configuration selection', () => {
  it('shows an unselected state honestly and saves parameter changes through the supplied model service', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('React', React);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const save = vi.fn(async config => config);
    const select = vi.fn(async () => {});
    try {
      await act(async () => root.render(<ModelPicker configs={[{ id: 'config-test', name: 'Example', model: 'example-model',
        model_options: [{ id: 'example-model', topP: 0.9, reasoningEfforts: { high: 'high' } }] }]}
        selectedConfigId="removed-config" selectedModel="removed-model" onSelect={select} onSaveModelConfig={save} />));
      expect(container.textContent).toContain('选择模型');
      expect(container.textContent).not.toContain('example-model');
      await act(async () => container.querySelector('button[title="选择模型"]').click());
      const dialog = document.querySelector('.chat-model-panel');
      await act(async () => dialog.querySelector('.chat-model-list button').click());
      expect(dialog.querySelector('.chat-model-save').disabled).toBe(false);
      await act(async () => [...dialog.querySelectorAll('[role="tab"]')].find(button => button.textContent === '参数').click());
      const field = [...dialog.querySelectorAll('label')].find(label => label.textContent.startsWith('Top P')).querySelector('input');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '0.96');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => dialog.querySelector('.chat-model-save').click());
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ model_options: [expect.objectContaining({ id: 'example-model', topP: 0.96 })] }));
      expect(select).toHaveBeenCalledWith({ capability: 'chat', configId: 'config-test', model: 'example-model' });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
  it('activates the model saved on the selected configuration', () => {
    expect(configDefaultModel({
      id: 'config-a',
      model: 'model-saved',
      model_options: [{ id: 'model-other' }],
    }, {})).toBe('model-saved');
  });

  it('falls back to the first model when the configuration has no saved model', () => {
    expect(configDefaultModel({
      id: 'config-a',
      model: '',
      model_options: [{ id: 'model-first' }, { id: 'model-second' }],
    }, {})).toBe('model-first');
  });

  it('uses a refreshed model as the fallback without persisting the catalog', () => {
    expect(configDefaultModel({
      id: 'config-a',
      provider: 'custom',
      model: '',
      model_options: [],
    }, {
      'config-a': [{ id: 'model-refreshed' }],
    })).toBe('model-refreshed');
  });
});
