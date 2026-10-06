/** A backup File is streamed to the same Host; it never becomes a JSON/base64 RPC row. */
export async function uploadMigrationFile(file, { signal, fetch: send = globalThis.fetch } = {}) {
  const id = globalThis.crypto.randomUUID();
  const response = await send(`/eleckoi/migration/uploads/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-ElecKoi-Filename': encodeURIComponent(file.name) },
    body: file, signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`备份上传失败（HTTP ${response.status}）：${detail}`);
  }
  return response.json();
}

export async function saveMigrationReport(report, id = 'inspection') {
  const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
  const filename = `eleckoi-migration-${id}.json`;
  if (window.ElecKoiPlatform?.saveBytes) {
    await window.ElecKoiPlatform.saveBytes(filename, bytes, 'application/json');
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export const migrationIsActive = task => task?.status === 'pending' || task?.status === 'running';
