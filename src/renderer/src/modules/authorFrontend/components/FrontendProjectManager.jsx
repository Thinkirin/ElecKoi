import { useRef, useState } from 'react';
import { Check, Code, DownloadSimple, Palette, Plus, Trash } from '@phosphor-icons/react';
import { AdaptiveChatSheet } from './AdaptiveChatSheet.jsx';

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
export function FrontendProjectManager({ workspace, request, onClose }) {
  const input = useRef(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(failure.message || String(failure)); }
    finally { setBusy(false); }
  };
  const upload = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    void run(async () => request('frontends.import', { filename: file.name, name: file.name.replace(/\.(html?|zip)$/i, ''),
      data: base64(new Uint8Array(await file.arrayBuffer())) }));
  };
  const download = project => run(async () => {
    const result = await request('frontends.export', { projectId: project.id });
    const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
    if (window.ElecKoiPlatform?.saveBytes) { await window.ElecKoiPlatform.saveBytes(result.filename, bytes, 'application/zip'); return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename; anchor.click(); }
    finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });
  return <AdaptiveChatSheet title="高级 HTML 前端" icon={<Code size={16} />} onClose={onClose} busy={busy}>
    <div className="frontend-project-list" aria-busy={busy || undefined}>
      <div className="frontend-project-toolbar">
        <button className="frontend-project-import" type="button" disabled={busy} onClick={() => input.current?.click()}><Plus size={18} />导入 HTML / ZIP</button>
      </div>
      <button className={`frontend-project-default${workspace.selectedProjectId === null ? ' selected' : ''}`} type="button" disabled={busy}
        aria-pressed={workspace.selectedProjectId === null} onClick={() => run(() => request('frontends.select', { projectId: null }))}>
        <Palette size={18} /><span>默认主题</span>{workspace.selectedProjectId === null ? <Check size={16} /> : null}
      </button>
      {workspace.projects.map(project => <div key={project.id} className={`frontend-project-row${workspace.selectedProjectId === project.id ? ' selected' : ''}`}>
        <button type="button" disabled={busy} title={project.name} aria-pressed={workspace.selectedProjectId === project.id}
          onClick={() => run(() => request('frontends.select', { projectId: project.id }))}><Code size={18} /><span>{project.name}</span>
            {workspace.selectedProjectId === project.id ? <Check size={16} /> : null}</button>
        <button type="button" disabled={busy} title="导出" aria-label={`导出 ${project.name}`} onClick={() => download(project)}><DownloadSimple size={16} /></button>
        <button type="button" disabled={busy} title="删除" aria-label={`删除 ${project.name}`} onClick={() => run(() => request('frontends.delete', { projectId: project.id }))}><Trash size={16} /></button>
      </div>)}
      <input type="file" ref={input} accept=".html,.htm,.zip,text/html,application/zip" hidden onChange={upload} />
      <label><input type="checkbox" checked={workspace.messageRendererEnabled} disabled={busy}
        onChange={event => run(() => request('frontends.setMessageRenderer', { enabled: event.target.checked }))} />渲染消息中的 HTML 内容</label>
      {error ? <p className="adaptive-chat-error" role="alert">{error}</p> : null}
    </div>
  </AdaptiveChatSheet>;
}
