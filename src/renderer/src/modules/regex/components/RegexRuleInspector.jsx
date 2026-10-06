import { useEffect, useState } from "react";
import { ArrowsLeftRight, Code, Copy, DotsThree, Play, Tag, Trash } from "@phosphor-icons/react";
import { EditorHeader } from '../../../ui/ui/EditorHeader.jsx';
import { REGEX_SCOPES, REGEX_TARGETS } from "../model/regexRulesEditing.js";

function Switch({ checked, onChange, label }) {
  return (
    <label className="regex-inline-switch">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function RegexRuleInspector({ scope, rule, scopeLocked = false, onChange, onMoveScope, onClose, saveAction, onDuplicate, onDelete, onTest }) {
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setTestInput("");
    setTestOutput("");
    setTestError("");
  }, [rule.id]);

  async function runTest() {
    setTesting(true);
    setTestError("");
    try {
      if (typeof onTest !== "function") throw new Error("正则测试服务尚未就绪");
      const result = await onTest(testInput, rule, rule.targets[0] || "AiOutput");
      setTestOutput(result.output);
      setTestError(result.validationMessage || "");
    } catch (error) {
      setTestError(error?.message || "测试失败");
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    if (!rule.runOnEdit || !testInput) return undefined;
    const timeout = window.setTimeout(runTest, 220);
    return () => window.clearTimeout(timeout);
  }, [rule.pattern, rule.replacement, rule.targets, rule.runOnEdit, testInput]);

  function toggleTarget(target) {
    const selected = new Set(rule.targets);
    if (selected.has(target) && selected.size > 1) selected.delete(target);
    else selected.add(target);
    onChange({ targets: [...selected] });
  }

  return (
    <aside className="regex-inspector" aria-label="正则详情">
      <EditorHeader className="catalog-editor-header" onBack={onClose} backLabel="返回正则列表" title={rule.name.trim() || "未命名规则"} saveAction={saveAction}
        moreAction={<details className="compact-editor-more"><summary aria-label="规则操作"><DotsThree size={22} /></summary><div><button type="button" onClick={onDuplicate}><Copy size={15} />复制规则</button><button type="button" className="is-destructive" onClick={onDelete}><Trash size={15} />删除规则</button></div></details>} />
      <div className="regex-inspector-scroll">
        <div className="regex-rule-fields">
        <label className="regex-field">
          <span>名称</span>
          <input value={rule.name} maxLength={60} onChange={(event) => onChange({ name: event.target.value })} />
        </label>
        {!scopeLocked ? <label className="regex-field">
          <span className="regex-field-caption is-scope"><Tag size={14} weight="duotone" aria-hidden="true" />分类</span>
          <select value={scope} onChange={(event) => onMoveScope(event.target.value)}>
            {REGEX_SCOPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label> : null}
        <label className="regex-field">
          <span className="regex-field-caption is-pattern"><Code size={14} weight="duotone" aria-hidden="true" />匹配表达式</span>
          <textarea className="is-code" value={rule.pattern} spellCheck="false" placeholder="/pattern/g" onChange={(event) => onChange({ pattern: event.target.value })} />
        </label>
        <label className="regex-field">
          <span className="regex-field-caption is-replacement"><ArrowsLeftRight size={14} weight="duotone" aria-hidden="true" />替换为</span>
          <textarea className="is-code" value={rule.replacement} spellCheck="false" onChange={(event) => onChange({ replacement: event.target.value })} />
        </label>

        <fieldset className="regex-targets">
          <legend>应用于</legend>
          <div>
            {REGEX_TARGETS.map((target) => (
              <label key={target.id}>
                <input type="checkbox" checked={rule.targets.includes(target.id)} onChange={() => toggleTarget(target.id)} />
                <span>{target.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="regex-behavior">
          <Switch checked={rule.displayOnly} label="仅修改显示内容" onChange={(checked) => onChange({ displayOnly: checked })} />
          <Switch checked={rule.promptOnly} label="仅修改提示词内容" onChange={(checked) => onChange({ promptOnly: checked })} />
          <Switch checked={rule.runOnEdit} label="编辑测试时自动运行" onChange={(checked) => onChange({ runOnEdit: checked })} />
        </div>

        </div>
        <section className="regex-test" aria-label="测试正则">
          <div className="regex-test-heading">
            <strong>测试</strong>
            <button type="button" onClick={runTest} disabled={testing}><Play size={14} weight="fill" />{testing ? "运行中…" : "运行"}</button>
          </div>
          <label className="regex-field"><span>输入</span><textarea value={testInput} onChange={(event) => setTestInput(event.target.value)} /></label>
          <label className="regex-field"><span>结果</span><textarea value={testOutput} readOnly /></label>
          {testError ? <p className="regex-test-error" role="alert">{testError}</p> : null}
        </section>
      </div>
    </aside>
  );
}
