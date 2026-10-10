// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyAppearanceMode, initializeAppearanceMode } from '../apps/web/src/modules/appearance/theme/appearanceMode.js';

afterEach(() => {
  delete globalThis.__ELECKOI_DSH_PLATFORM__;
  document.documentElement.removeAttribute('data-ds-theme-source');
  document.documentElement.removeAttribute('data-appearance-mode');
  document.documentElement.removeAttribute('data-theme');
  document.body.removeAttribute('data-ds-dark-theme');
});

describe('DSH theme ownership', () => {
  it('projects the active DSH palette without applying the old product preference', () => {
    document.documentElement.dataset.dsThemeSource = 'dark';
    document.documentElement.style.colorScheme = 'dark';
    document.body.setAttribute('data-ds-dark-theme', '');

    expect(applyAppearanceMode()).toEqual({ mode: 'dark', resolved: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('follows a DSH theme change in the embedded client', async () => {
    document.documentElement.dataset.dsThemeSource = 'system';
    const dispose = await initializeAppearanceMode();
    expect(document.documentElement.dataset.appearanceMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');

    document.body.setAttribute('data-ds-dark-theme', '');
    await new Promise((resolve) => new MutationObserver(resolve).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ['data-theme'] }
    ));
    expect(document.documentElement.dataset.appearanceMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    dispose();
  });
});
