// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelConfigPanel } from '../apps/web/src/modules/models/components/ModelConfigPanel.jsx';
import { initialConfigForProvider } from '../apps/web/src/modules/models/model/modelConfigDraft.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('React', React);
vi.mock('../apps/web/src/modules/settings/index.js', () => ({
  LIST_COLLAPSE_AREAS: { models: 'models' },
  usePersistentCollapseState: (_area, initial) => [...React.useState(initial), true],
}));

let root;
let container;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});
const draft = () => ({ id: 'config-example', provider: 'custom', name: 'Example', model: '', model_options: [],
  api_format: 'chat_completions', api_key: '', base_url: 'https://models.example/v1', custom_headers: {} });
const layout = ({ mainPanel, overlays }) => <>{mainPanel}{overlays}</>;
const button = text => [...container.querySelectorAll('button')].find(element => element.textContent.trim() === text);
const field = text => [...container.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(text))?.querySelector('input,select');
async function change(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(props) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ModelConfigPanel config={draft()} configs={[]} renderLayout={layout} {...props} />));
}

describe('model configuration form', () => {
  it('creates the DeepSeek card as the dedicated DSH provider', () => {
    expect(initialConfigForProvider('deepseek')).toMatchObject({
      id: 'deepseek-official', provider: 'deepseek', api_format: 'deepseek_messages',
      base_url: 'https://api.deepseek.com/anthropic',
    });
  });

  it('shows a migrated generic profile as a custom-provider configuration version', async () => {
    const migrated = { ...draft(), id: 'config-legacy', name: '旧版配置', provider: 'custom', model: 'legacy-model' };
    await mount({ config: migrated, configs: [migrated] });
    expect(container.querySelector('.model-split-select-value').textContent.trim()).toBe('旧版配置');
    await act(async () => container.querySelector('[title="展开配置版本"]').click());
    expect([...container.querySelectorAll('.model-version-menu button')].map(item => item.textContent.trim()))
      .toEqual(['旧版配置']);
  });

  it('refreshes saved credential state when the catalog finishes loading after the page', async () => {
    const fallback = {
      ...initialConfigForProvider('deepseek'),
      name: '',
      model: '',
      model_options: [],
      credentialConfigured: false,
    };
    const configured = {
      ...fallback,
      name: 'DeepSeek',
      model: 'deepseek-flash',
      model_options: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }],
      credentialConfigured: true,
      credentialRef: 'DEEPSEEK_API_KEY',
    };
    await mount({ config: fallback, configs: [] });
    expect(container.querySelector('.model-api-key-control input').placeholder).toBe('填写 DeepSeek API Key');

    await act(async () => root.render(
      <ModelConfigPanel config={fallback} configs={[configured]} renderLayout={layout} />,
    ));

    expect(container.querySelector('.model-api-key-control input').placeholder).toBe('已保存，留空保留');
    expect(field('配置名称').value).toBe('DeepSeek');
    expect(container.querySelector('.model-split-select-value').textContent.trim()).toBe('DeepSeek');
  });

  it('reveals a saved credential on demand without dirtying or saving its plaintext', async () => {
    const config = { ...draft(), credentialConfigured: true, credentialRef: 'SYNTHETIC_REF' };
    const onRevealApiKey = vi.fn(async () => 'synthetic-stored-value');
    const onSave = vi.fn(async value => value);
    const onDirtyChange = vi.fn();
    await mount({ config, configs: [config], onRevealApiKey, onSave, onDirtyChange });
    const key = container.querySelector('.model-api-key-control input');
    const eye = container.querySelector('.model-api-key-control button');
    expect(key.value).toBe('');
    expect(onRevealApiKey).not.toHaveBeenCalled();
    await act(async () => eye.click());
    expect(onRevealApiKey).toHaveBeenCalledExactlyOnceWith(config.id);
    expect(key.value).toBe('synthetic-stored-value');
    expect(key.type).toBe('text');
    expect(onDirtyChange.mock.calls.some(([dirty]) => dirty)).toBe(false);
    await change(field('配置名称'), 'Renamed');
    await act(async () => button('保存配置').click());
    expect(onSave.mock.calls[0][0].api_key).toBe('');
    await act(async () => eye.click());
    expect(key.value).toBe('');
    expect(key.type).toBe('password');
  });

  it('ignores an outstanding credential read after typing a replacement and reports read errors', async () => {
    let finish;
    const read = new Promise(resolve => { finish = resolve; });
    const onRevealApiKey = vi.fn().mockReturnValueOnce(read).mockRejectedValueOnce(new Error('Synthetic credential read failed'));
    const notify = vi.fn();
    const config = { ...draft(), credentialConfigured: true };
    await mount({ config, configs: [config], onRevealApiKey, onNotify: notify });
    const key = container.querySelector('.model-api-key-control input');
    const eye = container.querySelector('.model-api-key-control button');
    await act(async () => eye.click());
    expect(eye.disabled).toBe(true);
    await change(key, 'synthetic-replacement');
    await act(async () => { finish('synthetic-obsolete-value'); await read; });
    expect(key.value).toBe('synthetic-replacement');
    expect(key.type).toBe('password');
    await change(key, '');
    await act(async () => eye.click());
    expect(notify).toHaveBeenCalledWith('error', 'Synthetic credential read failed');
    expect(key.value).toBe('');
    expect(eye.disabled).toBe(false);
  });

  it('keeps the DeepSeek official card on the dedicated Messages adapter', async () => {
    await mount({ config: { ...draft(), id: 'deepseek-official', provider: 'deepseek', api_format: 'deepseek_messages',
      base_url: 'https://api.deepseek.com/anthropic' } });
    const select = field('接口格式');
    expect([...select.options].map(option => option.textContent)).toEqual(['Messages API']);
    expect(select.value).toBe('anthropic_messages');
    expect(select.disabled).toBe(true);
    expect(field('API 地址').value).toBe('https://api.deepseek.com/anthropic');
    expect(container.querySelector('.model-reasoning-profile')).toBeNull();
  });
  it('selects discovered models, enables parameters, and preserves values after saving and reopening', async () => {
    const onSave = vi.fn(async value => ({ ...value }));
    const onFetchModels = vi.fn(async () => [{ id: 'example-model', name: 'Example Model', contextWindowTokens: 65536,
      reasoningEfforts: { off: null, high: 'high' } }]);
    await mount({ onSave, onFetchModels });
    expect(field('Top P').disabled).toBe(true);
    await act(async () => button('读取模型').click());
    expect(field('Top P').disabled).toBe(false);
    for (const name of ['上下文窗口', '自动压缩阈值', '单次最大输出', '温度', '图片输入']) expect(field(name).disabled).toBe(false);
    expect([...field('推理强度').options].map(option => option.value)).toEqual(['', 'off', 'high']);
    await change(field('Top P'), '0.96');
    await change(field('温度'), '0.4');
    await act(async () => button('保存配置').click());
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ model: 'example-model', model_options: [{ id: 'example-model', topP: 0.96, temperature: 0.4 }] });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<ModelConfigPanel config={saved} configs={[saved]} renderLayout={layout} onSave={onSave} onFetchModels={onFetchModels} />));
    expect(field('Top P').value).toBe('0.96');
    expect(field('温度').value).toBe('0.4');
  });

  it('lets a custom model explicitly declare and persist its pi-ai reasoning efforts', async () => {
    const config = { ...draft(), model: 'example-manual-model', model_options: [{ id: 'example-manual-model', isUserAdded: true }] };
    const onSave = vi.fn(async value => ({ ...value }));
    await mount({ config, configs: [config], onSave });

    const reasoning = field('推理强度');
    expect(reasoning.disabled).toBe(true);
    expect(container.querySelector('.model-reasoning-profile')).not.toBeNull();

    await act(async () => container.querySelector('[aria-label="声明支持关闭档位"]').click());
    expect(button('保存配置').disabled).toBe(true);
    expect(container.querySelector('.model-parameter-error').textContent).toContain('至少选择一个非关闭档位');

    await act(async () => container.querySelector('[aria-label="声明支持低档位"]').click());
    await act(async () => container.querySelector('[aria-label="声明支持高档位"]').click());
    expect(reasoning.disabled).toBe(false);
    expect([...reasoning.options].map(option => option.value)).toEqual(['', 'off', 'low', 'high']);
    await act(async () => {
      reasoning.value = 'high';
      reasoning.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('保存配置').click());

    const saved = onSave.mock.calls[0][0];
    expect(saved.model_options[0]).toMatchObject({
      id: 'example-manual-model',
      reasoningEfforts: { off: null, low: 'low', high: 'high' },
      reasoningEffort: 'high',
    });

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(
      <ModelConfigPanel config={saved} configs={[saved]} renderLayout={layout} onSave={onSave} />,
    ));
    expect(field('推理强度').value).toBe('high');
    expect(container.querySelector('[aria-label="取消高档位"]')).not.toBeNull();
  });

  it('does not overwrite a newer draft with a late discovery response', async () => {
    let finish;
    const discovery = new Promise(resolve => { finish = resolve; });
    await mount({ onFetchModels: () => discovery });
    await act(async () => button('读取模型').click());
    await change(field('API 地址'), 'https://changed.example/v1');
    await act(async () => { finish([{ id: 'example-stale-model' }]); await discovery; });
    expect(field('API 地址').value).toBe('https://changed.example/v1');
    expect(field('Top P').disabled).toBe(true);
  });

  it('keeps the existing selection on empty discovery and never invents reasoning capabilities', async () => {
    const config = { ...draft(), model: 'example-manual-model', model_options: [{ id: 'example-manual-model', isUserAdded: true, topP: 0.95 }] };
    const notify = vi.fn();
    await mount({ config, configs: [config], onFetchModels: async () => [], onNotify: notify });
    await act(async () => button('读取模型').click());
    expect(field('Top P').value).toBe('0.95');
    expect(field('Top P').disabled).toBe(false);
    expect(field('推理强度').disabled).toBe(true);
    expect(container.querySelector('.model-reasoning-profile')).not.toBeNull();
    expect(notify).toHaveBeenCalledWith('error', '未读取到模型，当前配置已保留。');
  });
});
