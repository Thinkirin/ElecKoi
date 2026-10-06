import { ModelBasicConfigSection } from "./ModelBasicConfigSection.jsx";
import { ModelImageParametersSection } from "./ModelImageParametersSection.jsx";
import { ModelNetworkSection } from "./ModelNetworkSection.jsx";
import { ModelParametersSection } from "./ModelParametersSection.jsx";
import { ProviderLogo } from "./ProviderLogo.jsx";
import { Check, DotsThree, ArrowCounterClockwise, Plus, Trash } from '@phosphor-icons/react';
import { EditorHeader } from '../../../ui/ui/EditorHeader.jsx';
import { ConfirmationDialog } from '../../settingLibraries/index.js';
import { configVersionName } from '../model/modelProviderCatalog.js';

export function ModelConfigDetail({
  activeProvider,
  isImageProvider,
  hasUnsavedChanges,
  saving,
  saveBlockedByParameters,
  onCancel,
  onSave,
  onBack,
  basicEditor,
  parameterEditor,
  networkEditor,
}) {
  return (
    <section className="model-config-detail" data-model-provider={activeProvider.id}>
      <EditorHeader className="model-editor-header" title={<span className="model-header-identity"><ProviderLogo provider={activeProvider} className="model-header-icon" /><span>{basicEditor.form.name || activeProvider.label}</span></span>} onBack={onBack} backLabel="返回模型列表"
        saveAction={<button className="model-save-button" type="button" disabled={!hasUnsavedChanges || saving || saveBlockedByParameters} onClick={onSave}><Check size={18} /><span>{saving ? '保存中' : '保存'}</span></button>}
        moreAction={<details className="compact-editor-more"><summary aria-label="配置操作"><DotsThree size={22} /></summary><div>
          {!isImageProvider ? <div className="model-more-version" ref={basicEditor.versionPickerRef}>
            <span>配置版本</span>
            <button className="model-split-select-value" type="button" title="展开配置版本" aria-expanded={basicEditor.versionMenuOpen} onClick={() => basicEditor.setVersionMenuOpen(open => !open)}>{basicEditor.selectedVersionName}</button>
            <div className={`model-version-menu ${basicEditor.versionMenuOpen ? 'open' : ''}`}>
              {basicEditor.providerVersionItems.map(item => <button key={item.id} type="button" className={item.id === basicEditor.selectedConfigId ? 'active' : ''} onClick={event => {
                event.currentTarget.closest('details').open = false;
                basicEditor.setVersionMenuOpen(false); basicEditor.selectConfigId(item.id);
              }}>{configVersionName({ ...item, name: item.id === basicEditor.form.id ? basicEditor.form.name : item.name }, basicEditor.providerVersionItems)}</button>)}
              {!basicEditor.providerVersionItems.length ? <div className="model-picker-empty">暂无配置</div> : null}
            </div>
          </div> : null}
          <button type="button" disabled={!hasUnsavedChanges || saving} onClick={onCancel}><ArrowCounterClockwise size={16} />撤销修改</button>
          {!isImageProvider ? <button type="button" disabled={saving} onClick={() => basicEditor.createConfigPlaceholder()}><Plus size={16} />新建配置版本</button> : null}
          {!isImageProvider ? <button type="button" className="is-destructive" disabled={!basicEditor.canDeleteCurrent || saving} onClick={(event) => { event.currentTarget.closest('details').open = false; basicEditor.setDeleteTargetConfig(basicEditor.currentVersionConfig); basicEditor.setConfirmDeleteConfig(true); }}><Trash size={16} />{basicEditor.willClearCurrentConfig ? '清空配置' : '删除配置'}</button> : null}
        </div></details>} />
      <div className="model-detail-body">
        <form className="model-detail-form" onSubmit={(event) => event.preventDefault()}>
          <ModelBasicConfigSection editor={basicEditor} />
          {isImageProvider ? (
            <ModelImageParametersSection
              form={parameterEditor.form}
              validationMessage={parameterEditor.imageParameterError}
              onChange={parameterEditor.onUpdateImageSettings}
            />
          ) : (
            <ModelParametersSection
              form={parameterEditor.form}
              activeModelOption={parameterEditor.activeModelOption}
              automaticContextWindow={parameterEditor.automaticContextWindow}
              effectiveContextWindow={parameterEditor.effectiveContextWindow}
              parameterError={parameterEditor.parameterError}
              modelCapabilities={parameterEditor.modelCapabilities}
              showReasoningProfileEditor
              onChange={parameterEditor.onUpdateModelOption}
            />
          )}
          <ModelNetworkSection {...networkEditor} />
        </form>
      </div>
      <ConfirmationDialog target={basicEditor.confirmDeleteConfig ? {
        title: `${basicEditor.willClearCurrentConfig ? '清空配置' : '删除配置'}：${basicEditor.deleteTargetVersionName}`,
        message: basicEditor.willClearCurrentConfig ? '这是当前模型库的最后一个配置，会清空参数并还原成初始配置。' : '当前配置会从本地删除，其他模型配置不受影响。',
      } : null} confirmLabel={basicEditor.deleting ? '处理中…' : basicEditor.willClearCurrentConfig ? '确认清空' : '确认删除'} confirmDisabled={basicEditor.deleting}
        tone="destructive" onCancel={() => { basicEditor.setConfirmDeleteConfig(false); basicEditor.setDeleteTargetConfig(null); }} onConfirm={basicEditor.deleteCurrentConfig} />
    </section>
  );
}
