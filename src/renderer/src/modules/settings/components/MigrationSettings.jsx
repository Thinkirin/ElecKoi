import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowSquareIn, DownloadSimple, FileZip, ArrowsClockwise } from '@phosphor-icons/react';
import { useSharedFrontendRuntime } from '../../../ui/hooks/useSharedFrontendRuntime.js';
import { migrationIsActive, saveMigrationReport, uploadMigrationFile } from '../model/migrationClient.js';
import '../styles/migration-settings.css';

const statusLabels = { pending: '等待导入', running: '导入中', completed: '已完成', failed: '导入失败' };
const phaseLabels = { inspecting: '识别备份', inspect: '识别备份', queued: '等待执行', resuming: '恢复迁移', room: '原始数据库', sections: '转换备份条目',
  extracting: '解包', validating: '验证资料', importing: '导入资料',
  characters: '角色资料', models: '模型配置', presets: '预设', frontends: 'HTML 前端', conversations: '聊天记录',
  files: '媒体和文件', committing: '保存结果', completed: '完成', failed: '失败' };

/** Settings stays on the original application. Only an explicit import starts a Host job. */
export function MigrationSettings({ request: providedRequest, ready: providedReady, upload = uploadMigrationFile, saveReport = saveMigrationReport }) {
  const { runtime, state } = useSharedFrontendRuntime();
  // A fresh installation has no chat; migration depends on Host routes, not a selected chat.
  const ready = providedReady ?? (!!runtime?.adapter && state.methods.includes('migration.inspect'));
  const request = useCallback((method, params = {}) => {
    if (providedRequest) return providedRequest(method, params);
    if (!runtime?.adapter) throw new Error('迁移服务尚未就绪');
    return runtime.adapter.request(method, params);
  }, [providedRequest, runtime]);
  const input = useRef(null), uploadAbort = useRef(null), mounted = useRef(true);
  const [inspection, setInspection] = useState(null), [task, setTask] = useState(null), [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [conflicts, setConflicts] = useState('fail');
  const reportError = failure => setError(failure?.message || String(failure));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadAbort.current?.abort(); }; }, []);
  const refresh = useCallback(async () => {
    const list = await request('migration.list');
    if (mounted.current) { setJobs(list); setTask(current => current || list.find(migrationIsActive) || list[0] || null); }
    return list;
  }, [request]);
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    refresh().catch(failure => { if (live) reportError(failure); });
    return () => { live = false; };
  }, [ready, refresh]);
  useEffect(() => {
    if (!ready || !migrationIsActive(task)) return undefined;
    let live = true, timer;
    const poll = async () => {
      try {
        const next = await request('migration.status', { id: task.id });
        if (!live) return;
        setTask(next); setJobs(rows => [next, ...rows.filter(row => row.id !== next.id)]);
        if (migrationIsActive(next)) timer = window.setTimeout(poll, 750);
      } catch (failure) { if (live) reportError(failure); }
    };
    timer = window.setTimeout(poll, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [ready, request, task?.id, task?.status]);
  const selectFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy('正在上传备份'); setError(''); setInspection(null);
    const controller = new AbortController(); uploadAbort.current = controller;
    try {
      const received = await upload(file, { signal: controller.signal });
      if (!mounted.current) return;
      setBusy('正在识别备份');
      const result = await request('migration.inspect', { uploadId: received.uploadId });
      if (mounted.current) setInspection(result);
    } catch (failure) { if (mounted.current) reportError(failure); }
    finally { if (mounted.current) setBusy(''); uploadAbort.current = null; }
  };
  const start = async () => {
    setBusy('正在创建导入任务'); setError('');
    try {
      const result = await request('migration.start', { uploadId: inspection.uploadId, conflicts });
      if (mounted.current) { setTask(result); setJobs(rows => [result, ...rows.filter(row => row.id !== result.id)]); }
    } catch (failure) { if (mounted.current) reportError(failure); }
    finally { if (mounted.current) setBusy(''); }
  };
  const run = async operation => {
    setError(''); try { await operation(); } catch (failure) { reportError(failure); }
  };
  const canImport = inspection?.contents.some(item => item.supported && item.count > 0);
  const locked = !ready || !!busy || migrationIsActive(task);
  return <div className="migration-settings-page">
    <header className="app-settings-heading"><h1>旧版数据迁移</h1></header>
    <section className="app-settings-card migration-source" aria-label="选择迁移来源">
      <div className="migration-source-title"><FileZip size={24} /><strong>旧版备份或导出文件</strong></div>
      <p>选择旧版导出的 ZIP / JSON，导入前查看识别结果。</p>
      <input ref={input} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={selectFile} />
      <button type="button" className="settings-secondary-button" disabled={locked} onClick={() => input.current.click()}>选择备份文件</button>
      {busy ? <p role="status">{busy}</p> : null}
      {!ready ? <p role="status">{state.error || '正在启动迁移服务…'}</p> : null}
      {inspection ? <div className="migration-inspection">
        <h2>{inspection.source.label}</h2>
        <p className="migration-source-format"><code>{inspection.source.format || inspection.source.kind}</code>
          {inspection.source.version !== undefined ? ` · 版本 ${inspection.source.version}` : ''}</p>
        <table><thead><tr><th>资料</th><th>数量</th><th>识别结果</th></tr></thead><tbody>
          {inspection.contents.map(item => <tr key={item.id}><td>{item.label}</td><td>{item.count}</td>
            <td>{item.supported ? '可以导入' : (item.reason || '当前格式不能导入')}</td></tr>)}
        </tbody></table>
        {inspection.warnings?.length ? <ul className="migration-warnings">{inspection.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        <label className="migration-conflicts">已有同 ID 资料时<select value={conflicts} disabled={locked} onChange={event => setConflicts(event.target.value)}>
          <option value="fail">停止并报告冲突</option><option value="replace">用备份内容替换</option></select></label>
        <div className="migration-actions"><button type="button" className="settings-primary-button" disabled={locked || !canImport} onClick={start}><ArrowSquareIn size={16} />开始导入</button>
          <button type="button" className="settings-secondary-button" onClick={() => run(() => saveReport(inspection))}><DownloadSimple size={16} />导出识别报告</button></div>
      </div> : null}
    </section>
    <section className="app-settings-card migration-jobs" aria-label="迁移任务">
      <div className="migration-section-title"><h2>迁移任务</h2><button type="button" disabled={!ready} aria-label="刷新迁移任务" onClick={() => run(refresh)}><ArrowsClockwise size={18} /></button></div>
      {jobs.length ? <div className="migration-job-tabs">{jobs.map(row => <button type="button" key={row.id} aria-pressed={task?.id === row.id} onClick={() => { setTask(row); setError(''); }}>
        {row.filename || row.id} · {statusLabels[row.status] || row.status}</button>)}</div> : <p>尚未创建迁移任务。</p>}
      {task ? <div className="migration-task" role="status">
        <strong>{statusLabels[task.status] || task.status} · {phaseLabels[task.phase] || task.phase}</strong>
        {task.progress?.total > 0 ? <progress value={task.progress.completed} max={task.progress.total} /> : migrationIsActive(task) ? <progress /> : null}
        {task.progress ? <p>{task.progress.current || ''}{task.progress.total > 0 ? ` (${task.progress.completed}/${task.progress.total})` : ''}</p> : null}
        {migrationIsActive(task) ? <p>任务由宿主执行，离开此页面后仍可回来查看进度。</p> : null}
        {task.error ? <p role="alert">{task.error.code ? `${task.error.code}: ` : ''}{task.error.message}</p> : null}
        {task.report ? <><pre className="migration-report">{JSON.stringify(task.report, null, 2)}</pre>
          <button type="button" className="settings-secondary-button" onClick={() => run(() => saveReport(task, task.id))}><DownloadSimple size={16} />导出任务报告</button></> : null}
      </div> : null}
    </section>
    {error ? <p className="migration-error" role="alert">{error}</p> : null}
  </div>;
}
