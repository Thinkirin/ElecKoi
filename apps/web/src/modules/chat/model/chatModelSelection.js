export function resolveModelConfig(modelConfigs, modelSelection) {
  const requested = (modelConfigs || []).find((item) => item.id === modelSelection.configId) || null;
  return requested ? { ...requested, model: modelSelection.model || requested.model || "" } : null;
}

export function normalizeModelSelection(nextSelection) {
  return {
    capability: nextSelection.capability || "chat",
    configId: nextSelection.configId || "",
    model: nextSelection.model || "",
  };
}
