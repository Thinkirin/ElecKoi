import { apply as applyBridge } from './host/agent-preset-bridge.mjs'
import { RequestPreviewStore } from './host/request-preview.mjs'
import { conversationPreviewProjection } from './host/conversation-preview.mjs'
import { retireRequestContextCache } from './host/request-cache-retirement.mjs'
import { migrateLegacyGlobalModelSelection } from './host/model-selection-migration.mjs'

export const name = 'eleckoi-roleplay'
export const inject = [
  'agents',
  'agentPresets',
  'agentDefaultModel',
  'eleckoiProductData',
  'llm',
  'settings',
  'sessionController',
  'sessions',
  'eleckoiConversationLifecycle',
  'eleckoiConversationChanges',
  'eleckoiCharacterConfigurationChanges',
  'sessionProjections'
]

export async function apply(ctx) {
  await migrateLegacyGlobalModelSelection(ctx)
  const previews = new RequestPreviewStore()
  ctx.provide('eleckoiRequestPreviews', previews)
  ctx.effect(() => () => previews.close())
  ctx.sessionProjections.register(conversationPreviewProjection)
  ctx.inject(['sessionProjectionCache', 'storageDomain'], retireRequestContextCache)
  return applyBridge(ctx)
}
