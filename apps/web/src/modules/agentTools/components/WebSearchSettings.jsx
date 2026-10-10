import { useState, useSyncExternalStore } from 'react';
import { CheckCircle, Eye, EyeSlash, SpinnerGap, Trash } from '@phosphor-icons/react';
import { useWebSearchModel } from '../model/WebSearchContext.jsx';

const RESULT_COUNTS = [3, 5, 8];

export function WebSearchSettings() {
  const model = useWebSearchModel();
  const settings = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function update(patch) {
    if (settings.status !== 'ready' || busy) return;
    setBusy('settings');
    setNotice('');
    setError('');
    try {
      await model.update(patch);
    } catch (cause) {
      setError(messageOf(cause, '保存联网搜索配置失败'));
    } finally {
      setBusy('');
    }
  }

  async function saveAndTest() {
    if (busy) return;
    const value = apiKey.trim();
    if (!value) {
      setError('请先填写 Tavily API Key');
      return;
    }
    setBusy('save');
    setNotice('');
    setError('');
    try {
      const result = await model.saveAndTest(value);
      setApiKey('');
      setNotice(connectionText(result.connection, 'API Key 已保存'));
    } catch (cause) {
      setError(messageOf(cause, 'Tavily 连接失败'));
    } finally {
      setBusy('');
    }
  }

  async function testConnection() {
    if (busy) return;
    setBusy('test');
    setNotice('');
    setError('');
    try {
      const result = await model.test(apiKey);
      setNotice(connectionText(result.connection, 'Tavily 连接正常'));
    } catch (cause) {
      setError(messageOf(cause, 'Tavily 连接失败'));
    } finally {
      setBusy('');
    }
  }

  async function removeKey() {
    if (busy) return;
    setBusy('remove');
    setNotice('');
    setError('');
    try {
      await model.removeKey();
      setApiKey('');
      setNotice('已移除 Tavily API Key');
    } catch (cause) {
      setError(messageOf(cause, '移除 Tavily API Key 失败'));
    } finally {
      setBusy('');
    }
  }

  if (settings.status !== 'ready') {
    return <div className="web-search-config-state" aria-live="polite">{error || settings.error || '正在读取配置'}</div>;
  }

  return <div className="web-search-config" aria-busy={Boolean(busy)}>
    <fieldset className="web-search-config-fieldset">
      <legend>搜索方式</legend>
      <div className="web-search-mode" role="radiogroup" aria-label="搜索方式">
        <button type="button" role="radio" disabled={!settings.writable || Boolean(busy)} aria-checked={settings.mode === 'provider_native'} onClick={() => update({ mode: 'provider_native' })}>
          <strong>模型原生</strong><span>DeepSeek 官方</span>
        </button>
        <button type="button" role="radio" disabled={!settings.writable || !settings.tavilyAvailable || Boolean(busy)} aria-checked={settings.mode === 'tavily'} onClick={() => update({ mode: 'tavily' })}>
          <strong>Tavily</strong><span>{settings.apiKeyConfigured ? '已配置' : '需要 API Key'}</span>
        </button>
      </div>
    </fieldset>

    {settings.mode === 'tavily' ? <fieldset className="web-search-config-fieldset">
      <legend>API Key</legend>
      <div className="web-search-key-field">
        <input
          type={showKey ? 'text' : 'password'}
          name="tavily-api-key"
          autoComplete="off"
          value={apiKey}
          maxLength={2048}
          placeholder={settings.apiKeyConfigured ? '已保存，填写可替换' : '填写 Tavily API Key'}
          aria-label="Tavily API Key"
          disabled={!settings.apiKeyWritable || Boolean(busy)}
          onChange={(event) => { setApiKey(event.target.value); setNotice(''); setError(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') saveAndTest(); }}
        />
        <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}>
          {showKey ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      <div className="web-search-key-actions">
        {apiKey.trim() ? <button type="button" className="is-primary" disabled={!settings.apiKeyWritable || Boolean(busy)} onClick={saveAndTest}>
          {busy === 'save' ? <SpinnerGap className="is-spinning" aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}保存并测试
        </button> : null}
        {settings.apiKeyConfigured ? <button type="button" disabled={Boolean(busy)} onClick={testConnection}>
          {busy === 'test' ? <SpinnerGap className="is-spinning" aria-hidden="true" /> : null}测试连接
        </button> : null}
        {settings.apiKeyConfigured ? <button type="button" className="is-danger" disabled={!settings.apiKeyWritable || Boolean(busy)} onClick={removeKey}>
          <Trash aria-hidden="true" />移除
        </button> : null}
      </div>
    </fieldset> : null}

    {settings.mode === 'tavily' ? <fieldset className="web-search-config-fieldset">
      <legend>返回结果</legend>
      <div className="web-search-results" role="radiogroup" aria-label="返回结果数量">
        {RESULT_COUNTS.map((count) => <button type="button" role="radio" disabled={!settings.writable || Boolean(busy)} aria-checked={settings.maxResults === count} key={count} onClick={() => update({ maxResults: count })}>{count} 条</button>)}
      </div>
    </fieldset> : null}

    {notice || error ? <div className={`web-search-config-message${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{notice || error}</div> : null}
  </div>;
}

function messageOf(error, fallback) {
  return typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : fallback;
}

function connectionText(connection, prefix) {
  return connection.limit > 0
    ? `${prefix} · ${connection.plan} · ${connection.used} / ${connection.limit} credits`
    : `${prefix} · ${connection.plan}`;
}
