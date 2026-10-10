// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BranchSettingsSplitView } from '../apps/web/src/modules/settingLibraries/components/BranchSettingsSplitView.jsx'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

function Harness({ open = true }) {
  const [width, setWidth] = useState(760)
  return <BranchSettingsSplitView preferredWidth={width} onWidthChange={setWidth}>
    <section>目录</section>{open ? <aside>编辑器</aside> : null}
  </BranchSettingsSplitView>
}

function pointer(target, type, clientX, pointerId = 1) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { clientX, pointerId, button: 0 })
  target.dispatchEvent(event)
}

describe('branch settings two-pane layout', () => {
  it('supports keyboard and pointer resizing, clamping, cancellation and reset', async () => {
    let measuredWidth = 1000
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: measuredWidth }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness />))
      const layout = container.firstChild
      const separator = container.querySelector('[role="separator"]')
      const width = () => Number(separator.getAttribute('aria-valuenow'))
      const key = async (value, shiftKey = false) => act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true })))
      expect(layout.children).toHaveLength(2)
      expect(separator.className).toBe('editor-sidebar-resizer')
      expect(separator.parentElement.classList.contains('dynamic-settings-editor-pane')).toBe(true)
      expect(width()).toBe(720)
      await key('ArrowRight')
      expect(width()).toBe(696)
      await key('ArrowLeft', true)
      expect(width()).toBe(720)
      await key('End')
      expect(width()).toBe(720)
      await key('Home')
      expect(width()).toBe(520)
      await act(async () => pointer(separator, 'pointerdown', 600))
      expect(layout.classList.contains('is-resizing')).toBe(true)
      await act(async () => pointer(window, 'pointermove', 520, 2))
      expect(width()).toBe(520)
      await act(async () => pointer(window, 'pointermove', 520))
      expect(width()).toBe(600)
      await act(async () => pointer(window, 'pointermove', 100))
      expect(width()).toBe(720)
      await act(async () => pointer(window, 'pointercancel', 100))
      expect(layout.classList.contains('is-resizing')).toBe(false)
      await act(async () => pointer(window, 'pointermove', 220))
      expect(width()).toBe(720)
      measuredWidth = 640
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(width()).toBe(460)
      expect(width()).toBeLessThanOrEqual(Number(separator.getAttribute('aria-valuemax')))
      measuredWidth = 1000
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(width()).toBe(720)
      await act(async () => separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(width()).toBe(720)
      await key('ArrowRight')
      await key('Enter')
      expect(width()).toBe(720)
      await act(async () => pointer(separator, 'pointerdown', 300))
      await act(async () => window.dispatchEvent(new Event('blur')))
      expect(layout.classList.contains('is-resizing')).toBe(false)
      await act(async () => root.render(<Harness open={false} />))
      expect(container.querySelector('.is-closing').hasAttribute('inert')).toBe(true)
      await act(async () => new Promise(resolve => setTimeout(resolve, 200)))
      expect(layout.children).toHaveLength(1)
      expect(layout.classList.contains('is-inspector-open')).toBe(false)
      expect(container.querySelector('[role="separator"]')).toBeNull()
      await act(async () => root.render(<Harness />))
      expect(container.querySelector('[role="separator"]').getAttribute('aria-valuenow')).toBe('720')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
