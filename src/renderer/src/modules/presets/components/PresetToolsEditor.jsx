import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CaretRight, MagnifyingGlass, MinusCircle, Plus, X } from '@phosphor-icons/react';
import { normalizeRoleplayPlanDraft } from '@shared/contracts/presets/roleplayPlan';
import { AgentToolGroupIcon } from '../../../ui/icons/index.jsx';
import { RoleplayPlanEditor, SubagentSettingsLink, WebSearchSettings } from '../../agentTools/index.js';
import { PresetContextMenu, usePresetContextMenu } from './PresetContextMenu.jsx';
import { MainPageContext } from '../../../app/windows/MainPageContext.jsx';

const EMPTY_MODEL_CATALOG = { status: 'loading', configs: [], error: '' };
const subscribeEmptyModels = () => () => {};
const getEmptyModels = () => EMPTY_MODEL_CATALOG;
const IMAGE_GROUP = 'builtin:auto-illustration';

export function PresetToolsEditor({
  preset,
  onChange,
  onNotify,
  onBeforeOpenSubagentSettings,
  savePromptOpen = false,
  saveAction,
  modelCatalog,
}) {
  const view = useContext(MainPageContext);
  const models = modelCatalog || view?.models;
  const modelSnapshot = useSyncExternalStore(
    models?.subscribe || subscribeEmptyModels,
    models?.getSnapshot || getEmptyModels,
    models?.getSnapshot || getEmptyModels,
  );
  const imageModels = modelSnapshot.configs.filter((config) => ['novelai_image', 'openai_image'].includes(config.provider));
  const imageModelId = preset.toolModelConfigIds?.[IMAGE_GROUP] || '';
  const imageModel = imageModels.find((config) => config.id === imageModelId);
  const imageModelLabel = imageModel?.name || imageModel?.model || (!imageModelId ? '选择图片模型'
    : modelSnapshot.status === 'ready' ? '图片模型已删除'
      : modelSnapshot.error ? '无法读取图片模型' : '图片模型加载中');
  const [query, setQuery] = useState('');
  const [configGroupId, setConfigGroupId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const context = usePresetContextMenu();
  const selectedGroups = useMemo(() => preset.toolGroups.filter((group) => group.included), [preset.toolGroups]);
  const availableGroups = useMemo(() => preset.toolGroups.filter((group) => !group.included), [preset.toolGroups]);
  const visibleGroups = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    return selectedGroups.filter((group) => !key || `${group.name} ${group.description} ${group.members.map((member) => member.name).join(' ')}`.toLocaleLowerCase().includes(key));
  }, [query, selectedGroups]);

  function updateGroup(groupId, patch) {
    onChange({
      ...preset,
      toolGroups: preset.toolGroups.map((group) => group.id === groupId ? { ...group, ...patch } : group),
    });
  }

  function addGroup(groupId) {
    updateGroup(groupId, { included: true, enabled: true });
    setAddOpen(false);
    setQuery('');
  }

  const menuGroup = context.menu?.target;
  const configGroup = selectedGroups.find((group) => group.id === configGroupId);

  function closeConfig() {
    if (configGroupId === 'builtin:roleplay-workflow') {
      const roleplayPlan = normalizeRoleplayPlanDraft(preset.roleplayPlan);
      if (JSON.stringify(roleplayPlan) !== JSON.stringify(preset.roleplayPlan)) {
        onChange({ ...preset, roleplayPlan });
      }
    }
    setConfigGroupId('');
  }

  return (
    <section className="preset-tools-editor" aria-label="工具" onMouseDown={() => setAddOpen(false)}>
      <div className="preset-subtoolbar preset-tools-toolbar" onMouseDown={(event) => event.stopPropagation()}>
        <label>
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input value={query} placeholder="搜索工具" aria-label="搜索工具" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="preset-tools-add-wrap">
          <button type="button" className="preset-tools-add-button preset-toolbar-add" aria-label="添加工具" title="添加工具" aria-expanded={addOpen} onClick={() => setAddOpen((value) => !value)}>
            <Plus size={18} aria-hidden="true" />
          </button>
          {addOpen ? <div className="preset-tools-add-popover" role="menu" aria-label="添加工具组">
            {availableGroups.map((group) => <button type="button" role="menuitem" key={group.id} onClick={() => addGroup(group.id)}>
              <span className="preset-tool-icon"><AgentToolGroupIcon groupId={group.id} size={16} /></span>
              <span><strong>{group.name}</strong><small>{group.members.length} 个工具</small></span>
              <Plus size={15} aria-hidden="true" />
            </button>)}
            {!availableGroups.length ? <p>没有可添加的工具组</p> : null}
          </div> : null}
        </div>
        {saveAction}
      </div>

      <div className="preset-tools-list" tabIndex={0} aria-label="当前预设工具列表" onContextMenu={(event) => { setAddOpen(false); context.open(event); }}>
        {visibleGroups.length ? <div className="preset-tools-section-heading"><strong>预设自带</strong></div> : null}
        {visibleGroups.map((group) => <section className={`preset-tool-row${group.enabled ? '' : ' is-disabled'}`} data-tool-group-id={group.id} key={group.id} onContextMenu={(event) => { setAddOpen(false); context.open(event, group); }}>
          <button type="button" className="preset-tool-summary" title={group.description || group.name} aria-haspopup="dialog" onClick={() => setConfigGroupId(group.id)}>
            <span className="preset-tool-icon"><AgentToolGroupIcon groupId={group.id} size={17} /></span>
            <span><strong>{group.name}</strong><small className={group.id === IMAGE_GROUP ? 'preset-image-model-state' : undefined}>{group.id === IMAGE_GROUP
              ? imageModelLabel
              : group.description}</small></span>
            <span className="preset-tool-count">{group.members.length}</span>
            <CaretRight size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="preset-tool-toggle"
            role="switch"
            aria-checked={group.enabled}
            aria-label={`${group.enabled ? '关闭' : '开启'}${group.name}`}
            onClick={() => updateGroup(group.id, { enabled: !group.enabled })}
          ><i /></button>
        </section>)}
        {!visibleGroups.length ? <p className="setting-library-empty">{query ? '没有匹配的工具' : '还没有添加工具'}</p> : null}
      </div>

      {context.menu && menuGroup ? <PresetContextMenu menu={context.menu} onClose={context.close} actions={[
        { label: '从预设移除', icon: MinusCircle, run: () => updateGroup(menuGroup.id, { included: false, enabled: false }) },
      ]} /> : null}
      {configGroup ? <PresetToolConfigDialog
        group={configGroup}
        roleplayPlan={preset.roleplayPlan}
        closeBlocked={savePromptOpen}
        onClose={closeConfig}
        onEnabledChange={(enabled) => updateGroup(configGroup.id, { enabled })}
        onNotify={onNotify}
        onBeforeOpenSubagentSettings={onBeforeOpenSubagentSettings}
        onRoleplayPlanChange={(roleplayPlan) => onChange({ ...preset, roleplayPlan })}
        imageModels={imageModels}
        imageModelId={imageModelId}
        imageModelLabel={imageModelLabel}
        modelStatus={modelSnapshot.status}
        modelError={modelSnapshot.error}
        onImageModelChange={(configId) => {
          const bindings = { ...preset.toolModelConfigIds };
          if (configId) bindings[IMAGE_GROUP] = configId;
          else delete bindings[IMAGE_GROUP];
          onChange({ ...preset, toolModelConfigIds: bindings });
        }}
      /> : null}
    </section>
  );
}

function PresetToolConfigDialog({
  group,
  roleplayPlan,
  closeBlocked,
  onClose,
  onEnabledChange,
  onNotify,
  onBeforeOpenSubagentSettings,
  onRoleplayPlanChange,
  imageModels,
  imageModelId,
  imageModelLabel,
  modelStatus,
  modelError,
  onImageModelChange,
}) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !closeBlocked) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeBlocked, onClose]);

  return createPortal(<div className="preset-tool-config-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="preset-tool-config-dialog" role="dialog" aria-modal="true" aria-label={`${group.name}配置`} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <span className="preset-tool-config-title-icon"><AgentToolGroupIcon groupId={group.id} size={18} /></span>
        <h2>{group.name}</h2>
        <button type="button" aria-label="关闭" onClick={onClose}><X size={19} /></button>
      </header>
      <div className="preset-tool-config-body">
        <section className="preset-tool-config-card preset-tool-config-switch-row">
          <strong>启用此工具组</strong>
          <button
            type="button"
            className="preset-tool-toggle"
            role="switch"
            aria-checked={group.enabled}
            aria-label={`${group.enabled ? '关闭' : '开启'}${group.name}`}
            onClick={() => onEnabledChange(!group.enabled)}
          ><i /></button>
        </section>
        {group.description ? <p className="preset-tool-config-description">{group.description}</p> : null}
        {group.id === IMAGE_GROUP ? <>
          <label className="preset-tool-config-card preset-image-model-field">
            <span>图片模型</span>
            <select aria-label="图片模型" disabled={modelStatus !== 'ready'} value={imageModelId} onChange={(event) => onImageModelChange(event.target.value)}>
              <option value="">选择图片模型</option>
              {imageModelId && !imageModels.some((config) => config.id === imageModelId) ? <option value={imageModelId}>{imageModelLabel}</option> : null}
              {imageModels.map((config) => <option key={config.id} value={config.id}>{config.name || config.model}{config.name && config.model && config.name !== config.model ? ` · ${config.model}` : ''}</option>)}
            </select>
          </label>
          {modelError ? <p className="preset-image-model-error" role="alert">{modelError}</p> : null}
        </> : null}
        {group.id === 'builtin:collaboration' ? <SubagentSettingsLink
          onBeforeOpen={onBeforeOpenSubagentSettings}
          onOpen={onClose}
          onNotify={onNotify}
        /> : null}
        {group.id === 'builtin:web' ? <div className="preset-tool-web-config"><WebSearchSettings /></div> : <>
          {group.id === 'builtin:roleplay-workflow' ? <RoleplayPlanEditor
            value={roleplayPlan}
            onChange={onRoleplayPlanChange}
          /> : <>
            <h3>{group.members.length ? `包含 ${group.members.length} 个工具` : '工具'}</h3>
            <section className="preset-tool-config-card preset-tool-config-members">
              {group.members.length ? group.members.map((member) => <div key={member.name}>
                <code>{member.name}</code>
                {member.description ? <small>{member.description}</small> : null}
              </div>) : <p>此工具组没有独立调用项</p>}
            </section>

            <h3>来源</h3>
            <section className="preset-tool-config-card preset-tool-config-source">
              <span className="preset-tool-icon"><AgentToolGroupIcon groupId={group.id} size={17} /></span>
              <span>{group.source === 'built_in' ? 'ElecKoi 内置' : group.source === 'mcp' ? 'MCP 服务器' : '扩展'}</span>
            </section>
          </>}
        </>}
      </div>
    </section>
  </div>, document.body);
}
