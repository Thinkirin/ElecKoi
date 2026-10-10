// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { OfficialMarkdown, OfficialMarkdownProvider } from '../apps/web/src/ui/messages/OfficialMarkdown.jsx'
import { MessageBubble } from '../apps/web/src/ui/messages/MessageBubble.jsx'
import { MarkdownTextareaField } from '../apps/web/src/modules/settingLibraries/components/MarkdownTextareaField.jsx'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { document.body.innerHTML = '' })

describe('official Markdown rendering', () => {
  it('requires the official component instead of silently using a second renderer', () => {
    expect(() => renderToStaticMarkup(<OfficialMarkdown content="正文" />))
      .toThrow('DSH 官方文字渲染组件未接入。')
    expect(() => renderToStaticMarkup(
      <OfficialMarkdownProvider component={null}>
        <OfficialMarkdown content="正文" />
      </OfficialMarkdownProvider>,
    ))
      .toThrow('DSH 官方文字渲染组件未接入。')
  })

  it('keeps the same official body mounted through chunks, slot activation and completion', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const labels = []
    function ObservedMarkdown(props) {
      labels.push(props.labels)
      return <MarkdownText {...props} />
    }
    const render = (tail, pending, scoped) => root.render(
      <OfficialMarkdownProvider component={ObservedMarkdown}>
        <MessageBubble message={{ id: 'reply-1', role: 'assistant', pending,
          content: `首段。\n\n中段。\n\n${tail}` }}
          renderMessageContent={scoped ? (_owner, content) => content : undefined} />
      </OfficialMarkdownProvider>,
    )
    try {
      await act(async () => render('尾段', true, false))
      const body = container.querySelector('.eleckoi-dsh-markdown')
      const firstParagraph = body.querySelector('p')
      expect(firstParagraph.textContent).toBe('首段。')
      await act(async () => render('尾段继续', true, true))
      expect(container.querySelector('.eleckoi-dsh-markdown')).toBe(body)
      expect(body.querySelector('p')).toBe(firstParagraph)
      await act(async () => render('尾段完成。', false, true))
      expect(container.querySelector('.eleckoi-dsh-markdown')).toBe(body)
      expect(body.querySelector('p')).toBe(firstParagraph)
      expect(body.textContent).toContain('尾段完成。')
      expect(new Set(labels).size).toBe(1)
    } finally { await act(async () => root.unmount()) }
  })

  it('renders the setting editor preview with the same official component', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<OfficialMarkdownProvider component={MarkdownText}>
        <MarkdownTextareaField label="正文" value="**合成设定**" onChange={() => {}} />
      </OfficialMarkdownProvider>))
      await act(async () => container.querySelector('button').click())
      await act(async () => document.querySelectorAll('[role="tab"]')[1].click())
      expect(document.querySelector('.immersive-markdown-preview .eleckoi-dsh-markdown strong')?.textContent)
        .toBe('合成设定')
    } finally { await act(async () => root.unmount()) }
  })
})
