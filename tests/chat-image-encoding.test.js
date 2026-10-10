import { describe, expect, it } from 'vitest';
import { encodeImageDraft } from '../apps/web/src/modules/chat/hooks/useChatInputImages.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function draft(bytes, mediaType, name) {
  return {
    mediaType,
    name,
    file: { arrayBuffer: async () => Uint8Array.from(bytes).buffer },
  };
}

describe('chat image encoding', () => {
  it('uses the actual image format when the file type or extension is wrong', async () => {
    const encoded = await encodeImageDraft(draft(png, 'image/jpeg', 'image.jpg'));
    expect(encoded.mediaType).toBe('image/png');
  });

  it('rejects a non-image with an image filename before calling DSH', async () => {
    await expect(encodeImageDraft(draft(Buffer.from('not an image'), 'image/png', 'image.png')))
      .rejects.toThrow('图片格式');
  });
});
