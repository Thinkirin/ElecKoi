import { reasoningEffortIds, reasoningEffortLabel, reasoningOptions } from "../model/modelReasoningOptions.js";

function optionalNumber(value) {
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function ModelParametersSection({ form, activeModelOption, automaticContextWindow, effectiveContextWindow, parameterError, modelCapabilities, showReasoningProfileEditor = false, onChange }) {
  const options = reasoningOptions(modelCapabilities.reasoningEfforts);
  const selectedEffort = options.some((item) => item.id === activeModelOption?.reasoningEffort)
    ? activeModelOption.reasoningEffort
    : "";
  const reasoningAvailable = modelCapabilities.reasoningEfforts.length > 0;

  function updateReasoningEffort(value) {
    onChange({
      reasoningEffort: value || null,
    });
  }

  function toggleReasoningEffort(effort) {
    const current = activeModelOption?.reasoningEfforts && typeof activeModelOption.reasoningEfforts === "object"
      ? activeModelOption.reasoningEfforts
      : {};
    const next = { ...current };
    if (Object.hasOwn(next, effort)) delete next[effort];
    else next[effort] = effort === "off" ? null : effort;
    const selectedRemoved = activeModelOption?.reasoningEffort === effort && !Object.hasOwn(next, effort);
    onChange({
      reasoningEfforts: Object.keys(next).length ? next : undefined,
      ...(selectedRemoved ? { reasoningEffort: null } : {}),
    });
  }
  return (
    <section className="model-form-section">
      <div className="model-section-heading">
        <h3>模型参数</h3>
        <span>{form.model ? `仅作用于 ${form.model}` : "先选择模型后设置"}</span>
      </div>
      <div className="model-parameter-grid">
        <label>
          <span>上下文窗口 <small>自动 {automaticContextWindow.toLocaleString()}</small></span>
          <input type="number" min="4096" max="4000000" disabled={!form.model} value={activeModelOption?.contextWindowTokens ?? ""} onChange={(event) => onChange({ contextWindowTokens: optionalNumber(event.target.value) })} placeholder={String(automaticContextWindow)} />
        </label>
        <label>
          <span>自动压缩阈值 <small>默认占上下文 80%</small></span>
          <input type="number" min="1024" max={effectiveContextWindow} disabled={!form.model} value={activeModelOption?.autoCompactTokenLimit ?? ""} onChange={(event) => onChange({ autoCompactTokenLimit: optionalNumber(event.target.value) })} placeholder={String(Math.floor(effectiveContextWindow * 0.8))} />
        </label>
        <label>
          <span>单次最大输出 <small>留空由上游决定</small></span>
          <input type="number" min="1" max="4000000" disabled={!form.model} value={activeModelOption?.maxOutputTokens ?? ""} onChange={(event) => onChange({ maxOutputTokens: optionalNumber(event.target.value) })} placeholder="自动" />
        </label>
        <label>
          <span>推理强度 <small>当前请求 · DSH / pi-ai</small></span>
          <select disabled={!form.model || !reasoningAvailable} value={selectedEffort} onChange={(event) => updateReasoningEffort(event.target.value)}>
            {options.map((effort) => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
          </select>
        </label>
        <label>
          <span>温度 <small>0–2</small></span>
          <input type="number" min="0" max="2" step="0.01" disabled={!form.model} value={activeModelOption?.temperature ?? ""} onChange={(event) => onChange({ temperature: optionalNumber(event.target.value) })} placeholder="上游默认" />
        </label>
        <label>
          <span>Top P <small>0–1</small></span>
          <input type="number" min="0" max="1" step="0.01" disabled={!form.model} value={activeModelOption?.topP ?? ""} onChange={(event) => onChange({ topP: optionalNumber(event.target.value) })} placeholder="上游默认" />
        </label>
        <label className="model-capability-toggle">
          <span>图片输入 <small>声明当前模型接受图片</small></span>
          <input type="checkbox" disabled={!form.model} checked={activeModelOption?.supportsImageInput === true} onChange={(event) => onChange({ supportsImageInput: event.target.checked })} />
        </label>
        {showReasoningProfileEditor && modelCapabilities.canDeclareReasoning ? (
          <fieldset className="model-reasoning-profile" disabled={!form.model}>
            <legend>
              <span>接口支持档位</span>
              <small>按当前模型实际能力声明</small>
            </legend>
            <div className="model-reasoning-efforts">
              {reasoningEffortIds.map((effort) => {
                const selected = modelCapabilities.reasoningEfforts.includes(effort);
                return (
                  <button
                    key={effort}
                    className={selected ? "selected" : ""}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? "取消" : "声明支持"}${reasoningEffortLabel(effort)}档位`}
                    onClick={() => toggleReasoningEffort(effort)}
                  >
                    {reasoningEffortLabel(effort)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </div>
      {parameterError ? <p className="model-parameter-error">上下文需为 4,096–4,000,000；压缩不能超过上下文；输出需为 1–4,000,000；温度为 0–2，Top P 为 0–1；已声明推理能力时至少选择一个非关闭档位。</p> : null}
    </section>
  );
}
