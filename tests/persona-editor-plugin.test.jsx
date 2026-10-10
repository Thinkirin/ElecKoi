// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from '../apps/web/src/modules/settings/components/SettingsPanel.jsx'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => {
  document.body.innerHTML = ''
})

describe('persona editor client extension', () => {
  it('hands the real profile editor and its save operation to a DSH client plugin', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    let extensionOwner
    const renderUserProfileEditor = vi.fn((owner, fallback) => {
      extensionOwner = owner
      return <div data-testid="persona-extension">{fallback}</div>
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(<SettingsPanel
        activePage="profile"
        onPageChange={() => {}}
        persona={{ user_name: '用户甲', user_avatar: '', user_square: '', user_portrait: '' }}
        onUpdateUserProfile={save}
        renderUserProfileEditor={renderUserProfileEditor}
        settingsSections={[]}
        renderLayout={({ mainPanel }) => mainPanel}
      />))
      expect(container.querySelector('[data-testid="persona-extension"]')).not.toBeNull()
      expect(container.textContent).toContain('用户资料')

      const avatars = { circle: 'avatar.png', square: '', portrait: '' }
      let saved
      await act(async () => { saved = await extensionOwner.onSave({ name: '用户乙', avatars }) })
      expect(saved).toBe(true)
      expect(save).toHaveBeenCalledWith({ name: '用户乙', avatars })
    } finally {
      await act(async () => root.unmount())
    }
  })
})
