import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ModelIdentityIcon } from "./ModelIdentityIcon.jsx";
import { UnsavedChangesDialog } from "../../../ui/ui/UnsavedChangesDialog.jsx";
import { modelOptionsKey } from "../model/modelProviderCatalog.js";
import { modelParameterState } from "../model/modelConfigDraft.js";
import { useModelCapabilities } from "../hooks/useModelCapabilities.js";
import { ModelParametersSection } from "./ModelParametersSection.jsx";
import {
  DshChevronDownIcon,
  DshCloseIcon,
  DshRefreshIcon,
  DshSearchIcon,
} from "../../../ui/icons/dshComposerIcons.jsx";

function configName(config) {
  return String(config?.name || config?.provider || "").trim() || "未命名";
}

function modelItems(config, modelOptionsByKey) {
  if (!config) return [];
  const cached = modelOptionsByKey?.[modelOptionsKey(config)] || [];
  const byId = new Map();
  for (const item of [...(config.model_options || []), ...cached]) {
    const id = String(item?.id || item?.name || "").trim();
    if (id) byId.set(id, { ...byId.get(id), ...item, id, name: item?.name || id });
  }
  const defaultModel = String(config.model || "").trim();
  if (defaultModel && !byId.has(defaultModel)) {
    byId.set(defaultModel, { id: defaultModel, name: defaultModel });
  }
  return [...byId.values()];
}

export function configDefaultModel(config, modelOptionsByKey) {
  const configured = String(config?.model || "").trim();
  if (configured) return configured;
  return modelItems(config, modelOptionsByKey)[0]?.id || "";
}

function cloneConfig(config) {
  return {
    ...config,
    model_options: (config.model_options || []).map((option) => ({ ...option })),
  };
}

export function ModelPicker({
  configs = [],
  selectedConfigId,
  selectedModel,
  modelOptionsByKey,
  title = "选择模型",
  allowFollowMain = false,
  elevated = false,
  renderTrigger,
  onLoadModels,
  onSelect,
  onSaveModelConfig,
  onNotify,
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("models");
  const [changedConfigIds, setChangedConfigIds] = useState([]);
  const [focusedConfigId, setFocusedConfigId] = useState("");
  const [query, setQuery] = useState("");
  const [loadingConfigId, setLoadingConfigId] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [draftConfigs, setDraftConfigs] = useState([]);
  const [draftSelection, setDraftSelection] = useState({ capability: "chat", configId: "", model: "" });
  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfigId) || null,
    [configs, selectedConfigId],
  );
  const committedConfig = selectedConfig;
  const committedSelection = useMemo(() => {
    if (allowFollowMain && !selectedConfig) {
      return { capability: "chat", configId: "", model: "" };
    }
    return {
      capability: "chat",
      configId: committedConfig?.id || "",
      model: String((selectedConfig ? selectedModel : "") || configDefaultModel(committedConfig, modelOptionsByKey)).trim(),
    };
  }, [allowFollowMain, committedConfig, modelOptionsByKey, selectedConfig, selectedModel]);
  const activeConfigs = open ? draftConfigs : configs;
  const draftSelectedConfig = activeConfigs.find((config) => config.id === draftSelection.configId) || null;
  const followingMain = allowFollowMain && !draftSelectedConfig;
  const focusedConfig = activeConfigs.find((config) => config.id === focusedConfigId)
    || draftSelectedConfig
    || activeConfigs[0]
    || null;
  const focusedModels = useMemo(
    () => modelItems(focusedConfig, modelOptionsByKey),
    [focusedConfig, modelOptionsByKey],
  );
  const visibleModels = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? focusedModels.filter((item) => `${item.name} ${item.id}`.toLocaleLowerCase().includes(needle))
      : focusedModels;
  }, [focusedModels, query]);
  const selectedModelId = followingMain
    ? ""
    : String(draftSelection.model || configDefaultModel(draftSelectedConfig, modelOptionsByKey)).trim();
  const parameterForm = { ...draftSelectedConfig, model: selectedModelId };
  const parameterState = modelParameterState(parameterForm);
  const modelCapabilities = useModelCapabilities(parameterForm, selectedModelId);
  const hasChanges = changedConfigIds.length > 0 || draftSelection.configId !== committedSelection.configId
    || draftSelection.model !== committedSelection.model;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape" || leaveDialogOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClosePicker();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [hasChanges, leaveDialogOpen, open, saving]);

  function openPicker() {
    const nextConfigs = configs.map(cloneConfig);
    setDraftConfigs(nextConfigs);
    setChangedConfigIds([]);
    setTab("models");
    setDraftSelection(committedSelection);
    setFocusedConfigId(committedSelection.configId || nextConfigs[0]?.id || "");
    setQuery("");
    setLeaveDialogOpen(false);
    setLeaveError("");
    setOpen(true);
  }

  function requestClosePicker() {
    if (saving) return;
    if (hasChanges) {
      setLeaveError("");
      setLeaveDialogOpen(true);
      return;
    }
    setOpen(false);
  }

  function discardAndClosePicker() {
    if (saving) return;
    setLeaveDialogOpen(false);
    setLeaveError("");
    setOpen(false);
  }

  function chooseModel(config, modelId) {
    setDraftSelection({ capability: "chat", configId: config.id, model: modelId });
    setFocusedConfigId(config.id);
  }

  function updateParameters(patch) {
    if (!draftSelectedConfig || !selectedModelId) return;
    const id = draftSelectedConfig.id;
    setDraftConfigs(current => current.map(config => {
      if (config.id !== id) return config;
      const options = modelItems(config, modelOptionsByKey);
      return { ...config, model_options: options.map(option => option.id === selectedModelId ? { ...option, ...patch } : option) };
    }));
    setChangedConfigIds(current => current.includes(id) ? current : [...current, id]);
  }

  function chooseConfig(config) {
    const modelId = configDefaultModel(config, modelOptionsByKey);
    setFocusedConfigId(config.id);
    setQuery("");
    if (!modelId) {
      onNotify?.("error", "这个提供商当前没有可用模型");
      return;
    }
    chooseModel(config, modelId);
  }

  function followMainModel() {
    setDraftSelection({ capability: "chat", configId: "", model: "" });
  }

  async function refreshModels() {
    if (!focusedConfig || loadingConfigId) return;
    setLoadingConfigId(focusedConfig.id);
    try {
      const models = await onLoadModels?.(focusedConfig);
      if (Array.isArray(models)) {
        setDraftConfigs((current) => current.map((config) => (
          config.id === focusedConfig.id
            ? { ...config, model_options: models.map((item) => ({ ...item })) }
            : config
        )));
      }
    } catch (error) {
      onNotify?.("error", error.message || "刷新模型目录失败");
    } finally {
      setLoadingConfigId("");
    }
  }

  async function saveChanges() {
    if (!hasChanges || saving) return false;
    setSaving(true);
    setLeaveError("");
    try {
      for (const id of changedConfigIds) {
        const config = draftConfigs.find(config => config.id === id);
        if (config.model_options.some(option => modelParameterState({ ...config, model: option.id }).parameterError)) {
          throw new Error("模型参数超出有效范围。");
        }
      }
      if (changedConfigIds.length && !onSaveModelConfig) throw new Error("模型参数保存功能不可用。");
      for (const id of changedConfigIds) await onSaveModelConfig(draftConfigs.find(config => config.id === id));
      setChangedConfigIds([]);
      await onSelect?.(draftSelection);
      setLeaveDialogOpen(false);
      setOpen(false);
      onNotify?.("success", "模型选择已保存，将从下一次请求生效。");
      return true;
    } catch (error) {
      const message = error.message || "保存模型选择失败";
      setLeaveError(message);
      onNotify?.("error", message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const triggerLabel = (selectedConfig ? selectedModel : "") || committedConfig?.model || "选择模型";
  const trigger = renderTrigger ? renderTrigger({
    open,
    openPicker,
    selectedConfig,
    selectedModel: selectedConfig ? selectedModel : "",
  }) : (
    <button
      className={`chat-model-trigger ${open ? "active" : ""}`}
      type="button"
      title="选择模型"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openPicker}
    >
      <ModelIdentityIcon
        modelName={triggerLabel === "选择模型" ? "" : triggerLabel}
        providerId={committedConfig?.provider}
        className="chat-model-trigger-icon"
      />
      <span className="chat-model-trigger-label">{triggerLabel}</span>
      <DshChevronDownIcon />
    </button>
  );

  return (
    <div className="chat-model-picker">
      {trigger}
      {open ? createPortal(
        <div className={`chat-model-backdrop${elevated ? " is-elevated" : ""}`} role="presentation" onMouseDown={requestClosePicker}>
          <section className="chat-model-panel" role="dialog" aria-modal="true" aria-label={title} aria-busy={saving} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div className="chat-model-title">
                <strong>{title}</strong>
                {selectedModelId ? (
                  <span>
                    <ModelIdentityIcon
                      modelName={selectedModelId}
                      providerId={draftSelectedConfig?.provider}
                      className="chat-model-title-icon"
                    />
                    {selectedModelId}
                  </span>
                ) : null}
              </div>
              <button type="button" className="chat-model-close" aria-label="关闭" disabled={saving} onClick={requestClosePicker}>
                <DshCloseIcon size={20} />
              </button>
            </header>

            <div className="chat-model-content">
            {onSaveModelConfig ? <div className="chat-model-tabs" role="tablist" aria-label="模型设置">
              <button type="button" role="tab" aria-selected={tab === "models"} onClick={() => setTab("models")}>模型</button>
              <button type="button" role="tab" aria-selected={tab === "parameters"} onClick={() => setTab("parameters")}>参数</button>
            </div> : null}
            {tab === "parameters" ? <div className="chat-model-parameters">
              <ModelParametersSection form={parameterForm} {...parameterState} modelCapabilities={modelCapabilities} onChange={updateParameters} />
            </div> : <div className="chat-model-browser">
              <div className="chat-model-configs">
                {allowFollowMain ? <section className="chat-model-provider-group chat-model-follow-group">
                  <button type="button" className={followingMain ? "active" : ""} aria-pressed={followingMain} onClick={followMainModel}>
                    <ModelSelectionIndicator selected={followingMain} />
                    <span className="chat-model-config-copy"><strong>跟随主模型</strong><small>使用当前对话选择的模型</small></span>
                  </button>
                </section> : null}
                {activeConfigs.length ? activeConfigs.map((config) => (
                  <section className="chat-model-provider-group" key={config.id}>
                    <h3>
                      <ModelIdentityIcon modelName="" providerId={config.provider} className="chat-model-provider-icon" />
                      {configName(config)}
                    </h3>
                    <div className={`chat-model-config-row${focusedConfig?.id === config.id ? " active" : ""}`}>
                      <button
                        type="button"
                        className="chat-model-config-select"
                        aria-label={`使用 ${configName(config)}`}
                        aria-pressed={draftSelectedConfig?.id === config.id}
                        onClick={() => chooseConfig(config)}
                      >
                        <ModelSelectionIndicator selected={draftSelectedConfig?.id === config.id} />
                      </button>
                      <button
                        type="button"
                        className="chat-model-config-open"
                        aria-label={`查看 ${configName(config)} 的模型`}
                        onClick={() => { setFocusedConfigId(config.id); setQuery(""); }}
                      >
                        <span className="chat-model-config-copy"><strong>{configName(config)}</strong><small>{config.model || "未选择模型"}</small></span>
                      </button>
                    </div>
                  </section>
                )) : <p className="chat-model-empty">请先在 DSH 模型设置中配置模型</p>}
              </div>

              <div className="chat-model-list-pane">
                <div className="chat-model-list-tools">
                  <label>
                    <DshSearchIcon size={16} />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" />
                  </label>
                  <button type="button" aria-label="刷新模型" title="刷新模型" disabled={!focusedConfig || Boolean(loadingConfigId)} onClick={refreshModels}>
                    <DshRefreshIcon size={17} />
                  </button>
                </div>
                <div className="chat-model-list">
                  {visibleModels.length ? visibleModels.map((model) => {
                    const selected = draftSelectedConfig?.id === focusedConfig?.id && selectedModelId === model.id;
                    return <button type="button" className={selected ? "active" : ""} aria-pressed={selected} key={model.id} onClick={() => chooseModel(focusedConfig, model.id)}>
                      <ModelSelectionIndicator selected={selected} />
                      <span className="chat-model-name">{model.name}</span>
                    </button>;
                  }) : <p className="chat-model-empty">{query ? "没有匹配模型" : "当前提供商没有可用模型"}</p>}
                </div>
              </div>
            </div>}
            </div>

            <footer className="chat-model-actions">
              <button type="button" className="chat-model-cancel" disabled={saving} onClick={requestClosePicker}>取消</button>
              <button type="button" className="chat-model-save" disabled={!hasChanges || saving} onClick={saveChanges}>
                {saving ? "保存中…" : "保存"}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
      <UnsavedChangesDialog
        open={leaveDialogOpen}
        title="保存修改？"
        description="离开前是否保存模型选择和参数修改？"
        error={leaveError}
        saving={saving}
        onCancel={() => {
          setLeaveDialogOpen(false);
          setLeaveError("");
        }}
        onDiscard={discardAndClosePicker}
        onSave={saveChanges}
      />
    </div>
  );
}

function ModelSelectionIndicator({ selected }) {
  return <span className={`chat-model-selection${selected ? " selected" : ""}`} aria-hidden="true">
    {selected ? <svg viewBox="0 0 14 14" fill="none">
      <path d="M2.5 7.2 5.65 10.25 11.55 3.85" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg> : null}
  </span>;
}
