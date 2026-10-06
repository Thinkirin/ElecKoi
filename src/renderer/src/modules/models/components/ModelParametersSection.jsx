import { reasoningEffortIds, reasoningEffortLabel, reasoningOptions } from "../model/modelReasoningOptions.js";
import { CaretRight, SlidersHorizontal, Stack, Funnel, ArrowUpRight, Brain, Thermometer, ChartLineUp, ImageSquare } from '@phosphor-icons/react';

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
        <h3 title={form.model ? `仅作用于 ${form.model}` : "先选择模型后设置"}><SlidersHorizontal size={16} aria-hidden="true" />模型参数</h3>
      </div>
      <div className="model-parameter-grid">
        <label data-model-parameter="context" title={`自动 ${automaticContextWindow.toLocaleString()} tokens`}>
          <span className="model-parameter-label"><Stack size={16} aria-hidden="true" />上下文窗口</span>
          <input type="number" min="4096" max="4000000" disabled={!form.model} value={activeModelOption?.contextWindowTokens ?? ""} onChange={(event) => onChange({ contextWindowTokens: optionalNumber(event.target.value) })} placeholder={String(automaticContextWindow)} />
        </label>
        <label data-model-parameter="compression" title="默认占上下文 80%">
          <span className="model-parameter-label"><Funnel size={16} aria-hidden="true" />自动压缩阈值</span>
          <input type="number" min="1024" max={effectiveContextWindow} disabled={!form.model} value={activeModelOption?.autoCompactTokenLimit ?? ""} onChange={(event) => onChange({ autoCompactTokenLimit: optionalNumber(event.target.value) })} placeholder={String(Math.floor(effectiveContextWindow * 0.8))} />
        </label>
        <label data-model-parameter="output" title="留空由上游决定">
          <span className="model-parameter-label"><ArrowUpRight size={16} aria-hidden="true" />单次最大输出</span>
          <input type="number" min="1" max="4000000" disabled={!form.model} value={activeModelOption?.maxOutputTokens ?? ""} onChange={(event) => onChange({ maxOutputTokens: optionalNumber(event.target.value) })} placeholder="自动" />
        </label>
        <label data-model-parameter="reasoning" title="应用于当前请求 · DSH / pi-ai">
          <span className="model-parameter-label"><Brain size={16} aria-hidden="true" />推理强度</span>
          <select disabled={!form.model || !reasoningAvailable} value={selectedEffort} onChange={(event) => updateReasoningEffort(event.target.value)}>
            {options.map((effort) => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
          </select>
        </label>
        <label data-model-parameter="temperature" title="范围 0–2；留空使用上游默认值">
          <span className="model-parameter-label"><Thermometer size={16} aria-hidden="true" />温度</span>
          <input type="number" min="0" max="2" step="0.01" disabled={!form.model} value={activeModelOption?.temperature ?? ""} onChange={(event) => onChange({ temperature: optionalNumber(event.target.value) })} placeholder="上游默认" />
        </label>
        <label data-model-parameter="sampling" title="范围 0–1；留空使用上游默认值">
          <span className="model-parameter-label"><ChartLineUp size={16} aria-hidden="true" />Top P</span>
          <input type="number" min="0" max="1" step="0.01" disabled={!form.model} value={activeModelOption?.topP ?? ""} onChange={(event) => onChange({ topP: optionalNumber(event.target.value) })} placeholder="上游默认" />
        </label>
        <label className="model-capability-toggle" data-model-parameter="image" title="声明当前模型接受图片">
          <span className="model-parameter-label"><ImageSquare size={16} aria-hidden="true" />图片输入</span>
          <input type="checkbox" disabled={!form.model} checked={activeModelOption?.supportsImageInput === true} onChange={(event) => onChange({ supportsImageInput: event.target.checked })} />
        </label>
        {showReasoningProfileEditor && modelCapabilities.canDeclareReasoning ? (
          <details className="model-capabilities-disclosure">
            <summary title="声明模型接口支持的能力；当前请求仍使用上方选择的推理强度"><SlidersHorizontal size={16} aria-hidden="true" /><span>模型能力</span><CaretRight size={14} aria-hidden="true" /></summary>
          <fieldset className="model-reasoning-profile" disabled={!form.model}>
            <legend title="按当前模型实际能力声明">
              <span>支持的推理档位</span>
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
          </details>
        ) : null}
      </div>
      {parameterError ? <p className="model-parameter-error">上下文需为 4,096–4,000,000；压缩不能超过上下文；输出需为 1–4,000,000；温度为 0–2，Top P 为 0–1；已声明推理能力时至少选择一个非关闭档位。</p> : null}
    </section>
  );
}
