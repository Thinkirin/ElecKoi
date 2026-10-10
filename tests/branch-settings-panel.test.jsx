// @vitest-environment jsdom
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DynamicSettingsPanel } from '../apps/web/src/modules/settingLibraries/components/DynamicSettingsPanel.jsx'
import { createEntryDraft } from '../apps/web/src/modules/settingLibraries/model/settingLibraryEditing.js'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { document.body.innerHTML = '' })

describe('automatic chat branch settings', () => {
  it('sizes the chat identity to its content instead of reserving an empty fixed column', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/modules/settingLibraries/styles/dynamic-settings.css'), 'utf8')
    const row = css.match(/\.dynamic-settings-conversation-row\s*\{([^}]+)\}/)?.[1]
    expect(row).toContain('grid-template-columns: fit-content(220px) minmax(0, 1fr) auto;')
    expect(row).toContain('gap: 16px;')
  })

  it('has no branch creation action and refreshes persisted branches with the full editor', async () => {
    let notify
    const entry = { ...createEntryDraft('', 1, []), id: 'synthetic-preference',
      title: '偏好', content: '喜欢茶。', enabled: true }
    const library = { characterId: 'synthetic-character', name: '设定库', entries: [entry],
      groups: [], promptPositions: [], versions: [], activeVersionId: 'main', expandedGroupIds: [], listAllExpanded: false }
    const item = { sessionId: 'synthetic-chat', title: '合成聊天', characterName: '合成角色',
      summary: '测试对话', updatedAt: new Date().toISOString(), library }
    const model = {
      readConversations: vi.fn().mockResolvedValue([]),
      subscribe(listener) { notify = listener; return () => {} },
      saveConversation: vi.fn().mockResolvedValue(library)
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const button = text => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text)
    try {
      await act(async () => root.render(<DynamicSettingsPanel characterId="synthetic-character" settingLibraries={model} />))
      expect(container.textContent).toContain('还没有分支设定')
      expect(container.querySelectorAll('button')).toHaveLength(0)
      await act(async () => notify('conversations', 'synthetic-character', { status: 'ready', value: [item] }))
      expect(container.textContent).toContain('合成聊天')
      expect(container.querySelector('.dynamic-settings-conversation-row').getAttribute('aria-label')).toBe('分支 1：合成聊天')
      await act(async () => container.querySelector('.dynamic-settings-conversation-row').click())
      expect(container.querySelector('[aria-label="设定编辑区域"]')).toBeNull()
      expect(container.querySelector('[role="separator"]')).toBeNull()
      await act(async () => container.querySelector('[role="treeitem"]').click())
      expect(container.querySelector('[aria-label="设定编辑区域"]')).not.toBeNull()
      expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1)
      expect(container.querySelector('[role="separator"]').getAttribute('aria-valuenow')).toBe('737')
      expect(container.querySelector('.dynamic-settings-inspector > header strong').textContent).toBe('偏好')
      expect(container.textContent).toContain('条目标题')
      await act(async () => button('2触发').click())
      expect(container.querySelector('[aria-label="读取策略"]')).not.toBeNull()
      expect(container.textContent).toContain('关键词命中')
      await act(async () => button('3正文').click())
      expect(container.textContent).toContain('设定正文')
      expect(container.textContent).toContain('EJS')
      await act(async () => container.querySelector('[aria-label="关闭详情"]').click())
      expect(container.querySelector('.is-closing').hasAttribute('inert')).toBe(true)
      await act(async () => new Promise(resolve => setTimeout(resolve, 200)))
      expect(container.querySelector('.dynamic-settings-editor-pane')).toBeNull()
      expect(container.querySelector('[role="separator"]')).toBeNull()
      await act(async () => container.querySelector('[role="treeitem"]').click())
      expect(container.querySelector('.dynamic-settings-inspector')).not.toBeNull()
      await act(async () => container.querySelector('[role="treeitem"]').click())
      expect(container.querySelector('.dynamic-settings-inspector')).not.toBeNull()
      await act(async () => container.querySelector('[role="tree"]').dispatchEvent(new MouseEvent('mousedown', { clientX: 32, bubbles: true })))
      await act(async () => new Promise(resolve => setTimeout(resolve, 200)))
      expect(container.querySelector('.dynamic-settings-inspector')).toBeNull()
      await act(async () => container.querySelector('[aria-label="返回对话列表"]').click())
      await act(async () => container.querySelector('.dynamic-settings-conversation-row').click())
      expect(container.querySelector('.dynamic-settings-inspector')).toBeNull()
      await act(async () => container.querySelector('[aria-label="返回对话列表"]').click())
      await act(async () => notify('conversations', 'synthetic-character', { status: 'ready', value: [] }))
      expect(container.textContent).toContain('还没有分支设定')
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('keeps branch-to-chat labels through search, activity reordering and deletion', async () => {
    let notify
    const library = { characterId: 'synthetic-character', name: '设定库', entries: [], groups: [],
      promptPositions: [], versions: [], activeVersionId: 'main', expandedGroupIds: [], listAllExpanded: false }
    const first = { sessionId: 'synthetic-chat-first', title: '第一段聊天', characterName: '合成角色',
      summary: '<FINAL>最后一条 AI\n回复</FINAL>', updatedAt: new Date().toISOString(), library }
    const second = { ...first, sessionId: 'synthetic-chat-second', title: '第二段聊天', summary: '另一段真实摘要' }
    const model = { readConversations: vi.fn().mockResolvedValue([first, second]),
      subscribe(listener) { notify = listener; return () => {} } }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<DynamicSettingsPanel characterId="synthetic-character" settingLibraries={model} />))
      const record = container.querySelector('.dynamic-settings-conversation-row')
      expect(record.querySelector('.dynamic-settings-conversation-copy strong').textContent).toBe('第一段聊天')
      expect(record.querySelector('.dynamic-settings-conversation-summary').textContent).toBe('最后一条 AI 回复')
      expect(record.querySelector('.dynamic-settings-conversation-identity .dynamic-settings-conversation-summary')).toBeNull()
      expect(record.querySelector('.dynamic-settings-conversation-identity .dynamic-settings-avatar')).not.toBeNull()
      expect(record.querySelector('.dynamic-settings-conversation-copy .dynamic-settings-branch-label').textContent).toBe('分支 1')
      expect(record.querySelector('.dynamic-settings-conversation-activity time')).not.toBeNull()
      expect(container.querySelector('.dynamic-settings-conversation-heading')).toBeNull()
      const input = container.querySelector('input')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '第二段')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(container.querySelectorAll('.dynamic-settings-conversation-row')).toHaveLength(1)
      expect(container.querySelector('.dynamic-settings-branch-label').textContent).toBe('分支 2')
      await act(async () => notify('conversations', 'synthetic-character', { status: 'ready', value: [second, first] }))
      expect(container.querySelector('.dynamic-settings-branch-label').textContent).toBe('分支 2')
      await act(async () => notify('conversations', 'synthetic-character', { status: 'ready', value: [second] }))
      await act(async () => container.querySelector('.dynamic-settings-conversation-row').click())
      expect(container.querySelector('.dynamic-settings-detail-toolbar .dynamic-settings-branch-label').textContent).toBe('分支 2')
      expect(container.querySelector('.dynamic-settings-toolbar-copy').textContent).toBe('第二段聊天')
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('shows refresh errors instead of leaving the panel waiting forever', async () => {
    let notify
    const model = { readConversations: vi.fn().mockResolvedValue([]),
      subscribe(listener) { notify = listener; return () => {} } }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<DynamicSettingsPanel characterId="synthetic-character" settingLibraries={model} />))
      await act(async () => notify('conversations', 'synthetic-character', { status: 'error', error: '读取失败' }))
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('读取失败')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
