async function loadActivePreset(presetCatalog) {
  const catalog = await presetCatalog.refresh();
  const preset = await presetCatalog.read(catalog.activePresetId);
  return { catalog, preset };
}

function asToolCatalog(preset) {
  return {
    characterId: '',
    scopeId: `agent-preset:${preset.id}`,
    groups: preset.toolGroups.filter((group) => group.included),
    roleplayPlan: preset.roleplayPlan,
  };
}

export async function loadAgentTools(presetCatalog) {
  const { preset } = await loadActivePreset(presetCatalog);
  return asToolCatalog(preset);
}

export async function setAgentToolGroupEnabled(presetCatalog, groupId, enabled) {
  const { preset } = await loadActivePreset(presetCatalog);
  const saved = await presetCatalog.save({
      ...preset,
      toolGroups: preset.toolGroups.map((group) => group.id === groupId ? { ...group, included: true, enabled } : group),
  }, preset.regexRules);
  return asToolCatalog(saved);
}

export async function setRoleplayPlanSettings(presetCatalog, roleplayPlan) {
  const { preset } = await loadActivePreset(presetCatalog);
  const saved = await presetCatalog.save({ ...preset, roleplayPlan }, preset.regexRules);
  return asToolCatalog(saved);
}
