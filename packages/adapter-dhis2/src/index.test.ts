import { describe, it, expect, vi } from 'vitest';
import { createDhis2Target } from './index';

const cfg = { baseUrl: 'https://dhis2.example/dhis', username: 'admin', password: 'district' };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('createDhis2Target', () => {
  it('healthCheck up when system/info returns 200', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: '2.40.3' }));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    expect((await t.healthCheck()).status).toBe('up');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/system/info'), expect.objectContaining({ headers: expect.any(Object) }));
  });
  it('healthCheck down when fetch throws', async () => {
    const t = createDhis2Target(cfg, { fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
    const r = await t.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
  });
  it('pushAggregate parses the DHIS2 import summary', async () => {
    const summary = { status: 'SUCCESS', importCount: { imported: 3, updated: 1, ignored: 0, deleted: 0 }, conflicts: [] };
    const fetchMock = vi.fn(async () => jsonResponse(summary));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushAggregate({ dataValues: [] });
    expect(r).toMatchObject({ status: 'success', imported: 3, updated: 1, ignored: 0, deleted: 0 });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/dataValueSets'), expect.objectContaining({ method: 'POST' }));
  });
  it('pullMetadata maps dataElements/orgUnits/coc', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('dataElements')) return jsonResponse({ dataElements: [{ id: 'DE1', name: 'd' }] });
      if (url.includes('organisationUnits')) return jsonResponse({ organisationUnits: [{ id: 'OU1', name: 'o' }] });
      return jsonResponse({ categoryOptionCombos: [{ id: 'COC1', name: 'c' }] });
    });
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const m = await t.pullMetadata();
    expect(m.dataElements[0].id).toBe('DE1');
    expect(m.orgUnits[0].id).toBe('OU1');
    expect(m.categoryOptionCombos[0].id).toBe('COC1');
  });
});
