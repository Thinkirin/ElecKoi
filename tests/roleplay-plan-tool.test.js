import { describe, expect, it } from 'vitest'
import { apply as applyRoleplayPlanTool } from '../apps/desktop/resources/dsh/roleplay-plan-tool.mjs'

describe('DSH roleplay plan tool', () => {
  it('stays registered when the active preset has no plan steps', async () => {
    let definition
    applyRoleplayPlanTool({
      tools: {
        register(value) {
          definition = value
          return () => undefined
        }
      }
    }, { steps: [] })

    expect(definition?.name).toBe('update_roleplay_plan')
    await expect(definition.execute({ plan: [] })).resolves.toEqual({
      status: 'ok',
      plan: []
    })
  })
})
