export type ModelReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface RuntimeModelSettings {
  configId: string
  provider: string
  model: string
  systemPrompt: string
  autoCompactTokenLimit?: number | undefined
  contextWindow?: number | undefined
  maxTokens?: number | undefined
  temperature?: number | undefined
  topP?: number | undefined
  reasoningEffort?: ModelReasoningEffort | undefined
  supportsImageInput: boolean
}
