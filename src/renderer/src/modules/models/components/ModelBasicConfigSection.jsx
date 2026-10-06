import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeSlash, GlobeSimple, Key, PlugsConnected } from "@phosphor-icons/react";
import { ChevronRightIcon, DownloadIcon, PlugIcon, PlusIcon, TrashIcon } from "../../../ui/icons/index.jsx";

const API_FORMATS = [
  { id: "responses", label: "Responses API" },
  { id: "chat_completions", label: "Chat Completions" },
  { id: "anthropic_messages", label: "Messages API" },
  { id: "google_gemini", label: "Generate Content" },
];

export function ModelBasicConfigSection({ editor }) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState("");
  const [readingApiKey, setReadingApiKey] = useState(false);
  const revealGeneration = useRef(0);
  const apiKeyInputId = useId();
  const {
    form,
    activeProvider,
    isImageProvider,
    selectedConfigId,
    modelPickerRef,
    manualModelRef,
    modelMenuOpen,
    setModelMenuOpen,
    modelItems,
    removableModelIds,
    selectModel,
    deleteModel,
    loadingModels,
    fetchModels,
    manualModelOpen,
    setManualModelOpen,
    manualModelName,
    setManualModelName,
    addManualModel,
    connectionTest,
    testingConnection,
    testConnection,
    updateField,
    onRevealApiKey,
    onCredentialError,
  } = editor;
  const isDedicatedDeepSeek = activeProvider.id === "deepseek";
  const isNovelAi = ["novelai_image", "novelai"].includes(activeProvider.id);

  useEffect(() => {
    revealGeneration.current += 1;
    setShowApiKey(false);
    setSavedApiKey("");
    setReadingApiKey(false);
    return () => { revealGeneration.current += 1; };
  }, [form.id, form.credentialRef, form.credentialConfigured, selectedConfigId, activeProvider.id]);

  async function toggleApiKey() {
    if (showApiKey) {
      revealGeneration.current += 1;
      setShowApiKey(false);
      setSavedApiKey("");
      return;
    }
    if (form.api_key || !form.credentialConfigured) {
      setShowApiKey(true);
      return;
    }
    const generation = ++revealGeneration.current;
    setReadingApiKey(true);
    try {
      const value = await onRevealApiKey(form.id);
      if (generation !== revealGeneration.current) return;
      setSavedApiKey(value);
      setShowApiKey(true);
    } catch (error) {
      if (generation === revealGeneration.current) onCredentialError?.(error.message);
    } finally {
      if (generation === revealGeneration.current) setReadingApiKey(false);
    }
  }

  return (
    <section className="model-form-section model-basic-section">
      <div className="model-form-single-row">
        <label className="model-config-name-field">
          <span>配置名称</span>
          <input value={form.name || ""} onChange={(event) => updateField("name", event.target.value)} placeholder="待命名" />
        </label>
      </div>
      <div className="model-connection-fields" role="group" aria-label="连接配置">
      {!isImageProvider ? <div className="model-form-single-row">
        <label>
          <span className="model-connection-label"><PlugsConnected size={15} aria-hidden="true" />接口格式</span>
          <div className="model-api-format-control">
            <select disabled={isDedicatedDeepSeek} title={isDedicatedDeepSeek ? "DeepSeek 官方配置使用 DSH Messages 专用适配器；其他协议可在自定义模型提供商中选择" : "选择服务商支持的 API 协议"} value={form.api_format === "deepseek_messages" ? "anthropic_messages" : form.api_format || "responses"} onChange={(event) => updateField("api_format", event.target.value)}>
              {(isDedicatedDeepSeek ? API_FORMATS.filter((format) => format.id === "anthropic_messages") : API_FORMATS)
                .map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
            </select>
            {!isDedicatedDeepSeek ? <ChevronRightIcon /> : null}
          </div>
        </label>
      </div> : null}
      {isNovelAi ? <div className="model-form-single-row">
        <label>
          <span className="model-connection-label"><PlugsConnected size={15} aria-hidden="true" />请求格式</span>
          <div className="model-api-format-control">
            <select value={form.image_settings?.transport === "json" ? "json" : "multipart"} onChange={(event) => updateField("image_settings", { ...form.image_settings, transport: event.target.value })}>
              <option value="json">JSON兼容</option>
              <option value="multipart">Multipart官方</option>
            </select>
            <ChevronRightIcon />
          </div>
        </label>
      </div> : null}
      <div className="model-form-single-row">
        <label>
          <span className="model-connection-label"><GlobeSimple size={15} aria-hidden="true" />API 地址</span>
          <input value={form.base_url || ""} onChange={(event) => updateField("base_url", event.target.value)} placeholder={activeProvider.baseUrlPlaceholder} />
        </label>
      </div>
      <div className="model-form-single-row">
        <div className="model-api-key-field">
          <label htmlFor={apiKeyInputId}><span className="model-connection-label"><Key size={15} aria-hidden="true" />API Key</span></label>
          <div className="model-api-key-control">
            <input id={apiKeyInputId} type={showApiKey ? "text" : "password"} autoComplete="off" value={form.api_key || (showApiKey ? savedApiKey : "")} onChange={(event) => { revealGeneration.current += 1; setReadingApiKey(false); setSavedApiKey(""); updateField("api_key", event.target.value); }} placeholder={form.credentialConfigured ? "已保存，留空保留" : activeProvider.apiKeyPlaceholder} />
            <button type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} aria-pressed={showApiKey} aria-busy={readingApiKey} disabled={readingApiKey} onClick={toggleApiKey}>
              {showApiKey ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
      </div>
      {isImageProvider ? (
        <div className="model-form-single-row">
          <label>
            <span>模型</span>
            <input value={form.model || ""} onChange={(event) => updateField("model", event.target.value)} placeholder={activeProvider.modelPlaceholder} />
          </label>
        </div>
      ) : <div className="model-form-single-row">
        <label className="model-picker-field">
          <span>模型列表</span>
          <div className="model-picker-control">
            <div className="model-picker-shell" ref={modelPickerRef}>
              <button className={`model-picker-value ${(form.model || "").trim() ? "" : "empty"}`} type="button" onClick={() => setModelMenuOpen((current) => !current)}>
                {(form.model || "").trim() || activeProvider.modelPlaceholder}
              </button>
              <button type="button" title="展开模型列表" onClick={() => setModelMenuOpen((current) => !current)}><ChevronRightIcon /></button>
              <div className={`model-picker-menu ${modelMenuOpen ? "open" : ""}`}>
                {modelItems.length ? modelItems.map((item) => (
                  <div key={item.id} className={`model-picker-option ${item.id === form.model ? "active" : ""}`}>
                    <button className="model-picker-option-select" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectModel(item.id)}>
                      <b>{item.id}</b>
                      {item.name !== item.id ? <span>{item.name}</span> : null}
                    </button>
                    {removableModelIds.has(item.id) ? (
                      <button
                        className="model-picker-option-delete"
                        type="button"
                        title={`删除模型 ${item.id}`}
                        aria-label={`删除模型 ${item.id}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteModel(item.id);
                        }}
                      ><TrashIcon /></button>
                    ) : null}
                  </div>
                )) : <div className="model-picker-empty">读取模型后会显示在这里</div>}
              </div>
            </div>
            <div className="model-manual-add-anchor" ref={manualModelRef}>
              <button
                className="model-add-button"
                type="button"
                title="添加模型"
                aria-label="添加模型"
                aria-expanded={manualModelOpen}
                aria-controls="model-manual-add-popover"
                onClick={() => {
                  setModelMenuOpen(false);
                  setManualModelOpen((current) => !current);
                }}
              ><PlusIcon /><span className="model-control-label">添加模型</span></button>
              {manualModelOpen ? (
                <div className="model-manual-add" id="model-manual-add-popover">
                  <input
                    autoFocus
                    value={manualModelName}
                    onChange={(event) => setManualModelName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); addManualModel(); }
                      if (event.key === "Escape") setManualModelOpen(false);
                    }}
                    placeholder="填写服务商提供的完整模型名"
                    aria-label="模型名"
                  />
                  <div>
                    <button type="button" onClick={() => setManualModelOpen(false)}>取消</button>
                    <button type="button" onClick={addManualModel}>添加并使用</button>
                  </div>
                </div>
              ) : null}
            </div>
            <button className="model-fetch-button" type="button" title="读取模型" aria-label={loadingModels ? "读取中" : "读取模型"} onClick={fetchModels} disabled={loadingModels}>
              <DownloadIcon /><span className="model-control-label">{loadingModels ? "读取中" : "读取模型"}</span>
            </button>
            <button className={`model-test-button ${connectionTest.status === "success" ? "success" : ""}`} type="button" title="测试连接" aria-label={testingConnection ? "测试中" : connectionTest.status === "success" ? "连接成功" : "测试连接"} onClick={testConnection} disabled={testingConnection}>
              {testingConnection ? <span className="model-test-spinner" aria-hidden="true" /> : connectionTest.status === "success" ? <span className="model-test-check" aria-hidden="true" /> : <PlugIcon size={17} />}
              <span className="model-control-label">{testingConnection ? "测试中" : connectionTest.status === "success" ? "成功" : "测试连接"}</span>
            </button>
          </div>
        </label>
      </div>}
    </section>
  );
}
