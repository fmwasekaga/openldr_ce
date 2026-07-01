import { describe, it, expect, vi } from 'vitest';

vi.mock('../screenshots', () => ({ resolveImg: () => null }));

import { renderDocx, pngSize } from './toDocx';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('toDocx', () => {
  it('produces a non-empty docx blob from blocks', async () => {
    const blob = await renderDocx('Overview', '# Overview\n\nHello world.\n\n- a\n- b');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(100);
    // docx Packer sets the wordprocessing MIME (some environments omit it; size check is the primary assertion).
    if (blob.type) expect(blob.type).toBe(DOCX_MIME);
  });
});

describe('pngSize', () => {
  it('reads width and height from a PNG IHDR header', () => {
    // PNG signature (8 bytes) + IHDR: len(4)=13 + "IHDR"(4) + width(4 BE) + height(4 BE) + ...
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
    // width = 1440 (0x000005A0) at offset 16, height = 3000 (0x00000BB8) at offset 20
    bytes.set([0x00, 0x00, 0x05, 0xa0], 16);
    bytes.set([0x00, 0x00, 0x0b, 0xb8], 20);
    expect(pngSize(bytes)).toEqual({ width: 1440, height: 3000 });
  });

  it('returns null for non-PNG bytes', () => {
    expect(pngSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
