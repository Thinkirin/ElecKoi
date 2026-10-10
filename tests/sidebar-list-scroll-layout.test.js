import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readStyles = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const shellStyles = readStyles('../apps/web/src/app/windows/shell/styles/client-shell.css');
const pluginStyles = readStyles('../apps/web/src/app/windows/shell/styles/plugin-center.css');
const characterStyles = readStyles('../apps/web/src/modules/persona/styles/character-list.css');
const modelStyles = readStyles('../apps/web/src/modules/models/styles/model-config.css');
const presetStyles = readStyles('../apps/web/src/modules/presets/styles/preset-panel.css');
const conversationStyles = readStyles('../apps/web/src/modules/chat/styles/conversation-list.css');

describe('sidebar list scrolling', () => {
  it('keeps the shared side-panel height bounded', () => {
    expect(shellStyles).toMatch(/\.side-panel-shell[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
    expect(shellStyles).toMatch(/\.side-panel-content\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
  });

  it('puts plugin items in the bounded third grid row', () => {
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll\s*\{[^}]*grid-row:\s*3;[^}]*overflow-y:\s*auto;/);
  });

  it('shows a dedicated scrollbar in every sidebar list', () => {
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*scrollbar-width:\s*thin;/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll::\-webkit-scrollbar-thumb\s*\{[^}]*background:/);
    expect(characterStyles).toMatch(/\.character-list-scroll\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*scrollbar-width:\s*thin;/);
    expect(characterStyles).toMatch(/\.character-list-scroll\s*\{[^}]*padding:\s*0 0 16px;/);
    expect(characterStyles).toMatch(/\.character-list-scroll::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;/);
    expect(characterStyles).toMatch(/\.character-list-scroll::\-webkit-scrollbar-thumb\s*\{[^}]*background:/);
    expect(modelStyles).toMatch(/\.model-config-list\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*scrollbar-width:\s*thin;/);
    expect(conversationStyles).toMatch(/\.conversation-scroll\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*scrollbar-width:\s*thin;/);
    expect(conversationStyles).toMatch(/\.conversation-scroll\s*\{[^}]*padding:\s*0;/);
    expect(presetStyles).toMatch(/\.preset-list-scroll\s*\{[^}]*scrollbar-gutter:\s*auto;/);
    expect(conversationStyles).toMatch(/\.conversation-scroll::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;/);
    expect(modelStyles).toMatch(/\.model-config-list::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;/);
    expect(modelStyles).toMatch(/\.model-config-list\s*\{[^}]*padding:\s*8px 0 18px;/);
  });

  it('keeps plugin, character, preset, and conversation lists wheel-scrollable', () => {
    expect(characterStyles).toMatch(/\.character-list-panel\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(characterStyles).toMatch(/\.character-list-scroll\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    expect(presetStyles).toMatch(/\.preset-list-panel\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\);/);
    expect(conversationStyles).toMatch(/\.conversation-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  });
});
