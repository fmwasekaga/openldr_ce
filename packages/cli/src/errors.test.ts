import { describe, it, expect, vi } from 'vitest';
import { renderErrorCatalog } from './errors';

describe('renderErrorCatalog', () => {
  it('lists codes grouped by domain (text)', () => {
    const out = renderErrorCatalog({ json: false });
    expect(out).toContain('RP0001');
    expect(out).toContain('date range not selected');
    expect(out).toContain('reports');
  });
  it('emits JSON when asked', () => {
    const out = renderErrorCatalog({ json: true });
    const parsed = JSON.parse(out);
    expect(parsed.find((e: any) => e.code === 'SY0500')).toBeTruthy();
  });
});
