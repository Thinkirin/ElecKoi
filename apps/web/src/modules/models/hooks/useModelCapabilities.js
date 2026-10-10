import { useMemo } from 'react';
import { reasoningEffortIds } from '../model/modelReasoningOptions.js';

export function useModelCapabilities(config, model = config?.model) {
  const option = config?.model_options?.find(item => item.id === model);
  return useMemo(() => ({
    provider: config?.id,
    source: option?.isUserAdded === true && !option?.reasoningEfforts ? 'explicit_profile' : 'catalog',
    reasoningEfforts: option?.reasoningEfforts && typeof option.reasoningEfforts === 'object'
      ? reasoningEffortIds.filter(id => Object.hasOwn(option.reasoningEfforts, id)) : [],
    canDeclareReasoning: config?.provider === 'custom',
  }), [config?.id, config?.provider, option]);
}
