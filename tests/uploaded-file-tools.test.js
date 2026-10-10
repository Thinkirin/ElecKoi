import { describe, expect, it } from 'vitest';
import { apply } from '../apps/desktop/resources/dsh/uploaded-file-tools.mjs';

describe('uploaded file tool', () => {
  it('reads only a file referenced by the current user surface', async () => {
    const file = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'notes.md', bytes: 11 };
    let tool;
    const ctx = {
      tools: { register(value) { tool = value; return () => {}; } },
      sessionQuery: { async readSurface() { return { events: [{ type: 'user/message', data: {
        message: { source: { kind: 'user' }, content: [{ type: 'file', attachment: file }] },
      } }] }; } },
      attachments: {
        fileHostPath() { return '/files/notes.md'; },
        async *readFileStream() { yield Buffer.from('hello world'); },
      },
      fs: { processPathFromHostPath(path) { return path; } },
    };
    apply(ctx);
    const exec = { agent: { session: { id: 'session' } }, signal: new AbortController().signal };
    expect(await tool.execute({ file_path: '/files/notes.md' }, exec)).toMatchObject({ status: 'ok', content: 'hello world' });
    expect(await tool.execute({ file_path: '/files/other.md' }, exec)).toMatchObject({ status: 'error' });
  });
});
