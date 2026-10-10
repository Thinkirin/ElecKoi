import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SidePanelShell } from '../apps/web/src/app/windows/shell/components/SidePanelShell.jsx';

vi.mock('../apps/web/src/ui/icons/dshComposerIcons.jsx', () => ({ DshPanelLeftIcon: () => null }));

describe('sidebar footer actions', () => {
  it('keeps plugin actions after the scrollable side panel content', () => {
    const html = renderToStaticMarkup(
      <SidePanelShell footerActions={<button type="button">插件操作</button>}>
        <div>聊天列表</div>
      </SidePanelShell>,
    );
    expect(html).toContain('has-footer-actions');
    expect(html.indexOf('聊天列表')).toBeLessThan(html.indexOf('侧边栏插件操作'));
    expect(html).toContain('<button type="button">插件操作</button>');
  });

  it('does not reserve footer space without plugin actions', () => {
    const html = renderToStaticMarkup(<SidePanelShell><div>聊天列表</div></SidePanelShell>);
    expect(html).not.toContain('has-footer-actions');
    expect(html).not.toContain('侧边栏插件操作');
  });
});
