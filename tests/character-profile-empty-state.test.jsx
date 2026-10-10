import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CharacterProfilePanel } from '../apps/web/src/modules/persona/components/CharacterProfilePanel.jsx'

vi.stubGlobal('React', React)

describe('character profile empty state', () => {
  it('uses the shared chat empty-state guide for a character-free profile', () => {
    const html = renderToStaticMarkup(
      <CharacterProfilePanel
        characters={{ items: [] }}
        selectedCharacterId=""
        onSelectCharacter={vi.fn()}
        onStartConversation={vi.fn()}
        onEditCharacter={vi.fn()}
        onCreateFirstCharacter={vi.fn()}
      />,
    )

    expect(html).toContain('class="chat-empty-guide"')
    expect(html).toContain('还没有角色')
    expect(html).toContain('先创建一个角色，再开始第一段对话。')
    expect(html).toContain('>新建角色</button>')
    expect(html).not.toContain('character-profile-create')
  })
})
