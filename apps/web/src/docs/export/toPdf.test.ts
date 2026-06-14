import { describe, it, expect, vi } from 'vitest';

// No screenshots resolve under test -> image blocks become caption lines (no fetch).
vi.mock('../screenshots', () => ({ resolveImg: () => null }));

import { renderPdf } from './toPdf';

describe('toPdf', () => {
  it('produces a non-empty PDF blob from blocks', async () => {
    const blob = await renderPdf('Overview', '# Overview\n\nHello world.\n\n- a\n- b\n\n![x](x.png)');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(100);
  });
});
