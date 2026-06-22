import { describe, it, expect, vi, afterEach } from 'vitest';
import { logReportRun, fetchReportRuns } from './api';

afterEach(() => vi.restoreAllMocks());

describe('run history api', () => {
  it('logReportRun POSTs the beacon and resolves even on failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await logReportRun('amr-resistance', { format: 'preview', rowCount: 2, params: { from: '2026-01-01' } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/amr-resistance/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(logReportRun('amr-resistance', { format: 'csv' })).resolves.toBeUndefined();
  });

  it('fetchReportRuns builds the query and returns runs+total', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ runs: [], total: 0 }), { status: 200 })));
    await expect(fetchReportRuns({ reportId: 'amr-resistance', limit: 25 })).resolves.toEqual({ runs: [], total: 0 });
  });
});
