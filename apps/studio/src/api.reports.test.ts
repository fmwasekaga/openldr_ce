import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReportOptions, fetchReportPdf, csvUrl } from './api';

afterEach(() => vi.restoreAllMocks());

describe('report api helpers', () => {
  it('csvUrl builds a query string', () => {
    expect(csvUrl('amr-resistance', { from: '2026-01-01' })).toBe('/api/reports/amr-resistance.csv?from=2026-01-01');
  });

  it('fetchReportOptions returns the option map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ facility: ['F1'] }), { status: 200 })));
    await expect(fetchReportOptions('amr-resistance')).resolves.toEqual({ facility: ['F1'] });
  });

  it('fetchReportPdf returns a Blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['%PDF']), { status: 200 })));
    const blob = await fetchReportPdf('amr-resistance', { from: '2026-01-01' });
    expect(blob).toBeInstanceOf(Blob);
  });
});
