// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PresetProfileHeader } from '../apps/web/src/modules/presets/components/PresetProfileHeader.jsx';
import { PresetIntroductionEditor } from '../apps/web/src/modules/presets/components/PresetIntroductionEditor.jsx';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterAll(() => vi.unstubAllGlobals());
const roots = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
  document.body.replaceChildren();
});

const preset = {
  id: 'preset-layout', name: '测试预设', modelTags: [{ id: 'general', label: '通用' }],
  profile: { authorName: '测试作者', authorAvatarPath: '', usageInstructions: '选择角色后开始对话。', timeline: [] },
};

async function mount(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return { container, root };
}

describe('preset profile grouping', () => {
  it('keeps activation next to the name in the identity group for both states', async () => {
    const { container, root } = await mount(<PresetProfileHeader preset={preset} active={false} onActivate={() => {}} onEdit={() => {}} />);
    const heading = container.querySelector('.preset-profile-hero-heading');
    expect(heading.querySelector('h1').textContent).toBe(preset.name);
    expect(heading.querySelector('.preset-profile-hero-actions button').textContent).toBe('使用此预设');
    expect(container.querySelector('header > .preset-profile-use')).toBeNull();
    const tags = container.querySelector('.preset-profile-hero-tags');

    await act(async () => root.render(<PresetProfileHeader preset={preset} active onActivate={() => {}} onEdit={() => {}} />));
    expect(heading.querySelector('.preset-profile-hero-actions .preset-profile-active').textContent).toBe('使用中');
    expect(heading.querySelector('.preset-profile-use')).toBeNull();
    expect(container.querySelector('.preset-profile-hero-tags')).toBe(tags);
    expect(tags.textContent).toBe('通用');
  });

  it('preserves activation and profile editing without changing the model tags', async () => {
    const onActivate = vi.fn();
    const onEdit = vi.fn();
    const { container } = await mount(<PresetProfileHeader preset={preset} active={false} onActivate={onActivate} onEdit={onEdit} />);
    await act(async () => container.querySelector('.preset-profile-use').click());
    await act(async () => container.querySelector('[aria-label="编辑预设资料"]').click());
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(preset.modelTags).toEqual([{ id: 'general', label: '通用' }]);
  });

  it('retains the activation slot when there are no model tags and exposes the full name', async () => {
    const name = '测试预设名称'.repeat(12);
    const { container } = await mount(<PresetProfileHeader preset={{ ...preset, name, modelTags: [] }} active onEdit={() => {}} />);
    expect(container.querySelector('h1').title).toBe(name);
    expect(container.querySelector('.preset-profile-hero-actions').textContent).toBe('使用中');
    expect(container.querySelector('.preset-profile-hero-tags')).toBeNull();
  });

  it('uses a bounded two-column header with wrapping actions and visible keyboard focus', () => {
    const css = readFileSync(resolve('apps/web/src/modules/presets/styles/preset-panel.css'), 'utf8');
    const hero = css.match(/\.preset-profile-hero\s*\{([^}]+)\}/)?.[1];
    expect(hero).toContain('grid-template-columns: var(--preset-hero-avatar-size) minmax(0, 1fr);');
    expect(hero).toContain('border: 1px solid var(--line-strong);');
    expect(css).toMatch(/\.preset-profile-hero-heading\s*\{[^}]*flex-wrap: wrap;/s);
    expect(css).toMatch(/\.preset-profile-hero button:focus-visible\s*\{[^}]*outline:/s);
  });
});

describe('preset introduction regions', () => {
  it('contains the empty state and add action in the same update region', async () => {
    const { container } = await mount(<PresetIntroductionEditor preset={preset} saving={false} error="" onClearError={() => {}} onSaveProfile={async () => true} />);
    const region = container.querySelector('section[aria-label="更新记录"]');
    expect(region.classList.contains('preset-content-section')).toBe(true);
    expect(region.querySelector('h2').textContent).toBe('更新记录');
    expect(region.querySelector('button').textContent).toBe('添加更新');
    expect(region.querySelector('.preset-updates-empty').textContent).toBe('暂无更新记录');
    expect(container.querySelector('section[aria-label="使用说明"]').classList.contains('preset-content-section')).toBe(true);
  });

  it('keeps editing and saving inside the usage region with the existing save contract', async () => {
    const onSaveProfile = vi.fn(async () => true);
    const { container } = await mount(<PresetIntroductionEditor preset={preset} saving={false} error="" onClearError={() => {}} onSaveProfile={onSaveProfile} />);
    const region = container.querySelector('.preset-usage-section');
    await act(async () => region.querySelector('button').click());
    expect(region.querySelector('form')).not.toBeNull();
    expect(region.querySelector('textarea').value).toBe(preset.profile.usageInstructions);
    expect(region.querySelector('button[type="button"]').textContent).toBe('取消');
    await act(async () => {
      const textarea = region.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, '修改后的使用说明。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => region.querySelector('button[type="submit"]').click());
    expect(onSaveProfile).toHaveBeenCalledWith({ usageInstructions: '修改后的使用说明。' });
    expect(region.querySelector('form')).toBeNull();
    expect(region.querySelector('.preset-usage-copy').textContent).toBe(preset.profile.usageInstructions);
  });

  it('centers the empty state within a bordered section instead of an unbounded canvas', () => {
    const css = readFileSync(resolve('apps/web/src/modules/presets/styles/preset-usage.css'), 'utf8');
    expect(css).toMatch(/\.preset-content-section\s*\{[^}]*border: 1px solid var\(--line-strong\);/s);
    expect(css).toMatch(/\.preset-updates-empty\s*\{[^}]*place-items: center;[^}]*text-align: center;/s);
    expect(css).toMatch(/\.preset-usage-section > \.preset-content-composer\s*\{[^}]*border: 0;[^}]*box-shadow: none;/s);
  });
});
