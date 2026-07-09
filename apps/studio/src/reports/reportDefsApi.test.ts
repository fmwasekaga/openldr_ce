import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authFetch } = vi.hoisted(() => ({
  authFetch: vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async (): Promise<unknown> => [] })),
}));
vi.mock('../api', () => ({ authFetch }));

import {
  listReportDefs, createReportDef, deleteReportDef, getReportDef, setReportStatus,
} from './reportDefsApi';

describe('reportDefsApi', () => {
  beforeEach(() => authFetch.mockClear());

  it('lists via GET /api/report-defs', async () => {
    await listReportDefs();
    expect(authFetch).toHaveBeenCalledWith('/api/report-defs');
  });

  it('creates via POST', async () => {
    authFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async (): Promise<unknown> => ({ id: 'r1' }) });
    await createReportDef({
      id: 'r1', name: 'AMR', description: '', category: 'amr',
      designId: 'd1', primaryQueryId: 'q1', status: 'published',
    });
    const [url, init] = authFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/report-defs');
    expect(init?.method).toBe('POST');
  });

  it('deletes via DELETE', async () => {
    authFetch.mockResolvedValueOnce({ ok: true, status: 204, json: async (): Promise<unknown> => null });
    await deleteReportDef('r1');
    const [url, init] = authFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/report-defs/r1');
    expect(init?.method).toBe('DELETE');
  });

  it('gets a single record via GET /api/report-defs/:id', async () => {
    authFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async (): Promise<unknown> => ({ id: 'r1', status: 'published' }) });
    const record = await getReportDef('r1');
    expect(authFetch).toHaveBeenCalledWith('/api/report-defs/r1');
    expect(record).toEqual({ id: 'r1', status: 'published' });
  });

  it('setReportStatus GETs then PUTs the full record with the new status', async () => {
    authFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async (): Promise<unknown> => ({
          id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1', primaryQueryId: 'q1', status: 'published',
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async (): Promise<unknown> => ({}) });

    await setReportStatus('r1', 'draft');

    expect(authFetch).toHaveBeenNthCalledWith(1, '/api/report-defs/r1');
    const [url, init] = authFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/report-defs/r1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual(expect.objectContaining({ id: 'r1', status: 'draft' }));
  });
});
