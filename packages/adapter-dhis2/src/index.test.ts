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
  it('pushAggregate reads import status from nested response (WARNING with conflicts)', async () => {
    const summary = { httpStatus: 'OK', status: 'OK', response: { status: 'WARNING', importCount: { imported: 1, updated: 0, ignored: 2, deleted: 0 }, conflicts: [{ object: 'dataElement', value: 'bad' }] } };
    const fetchMock = vi.fn(async () => jsonResponse(summary));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushAggregate({ dataValues: [] });
    expect(r.status).toBe('warning');
    expect(r.imported).toBe(1);
    expect(r.ignored).toBe(2);
    expect(r.conflicts).toEqual([{ object: 'dataElement', value: 'bad' }]);
  });
  it('pushAggregate maps a nested ERROR response to status error', async () => {
    const summary = { status: 'WARNING', httpStatus: 'Conflict', response: { status: 'ERROR', importCount: { imported: 0, updated: 0, ignored: 1, deleted: 0 }, conflicts: [] } };
    const fetchMock = vi.fn(async () => jsonResponse(summary));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    expect((await t.pushAggregate({ dataValues: [] })).status).toBe('error');
  });
  it('pushAggregate throws a clear error on a non-OK HTTP response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Unauthorized' } as Response));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    await expect(t.pushAggregate({ dataValues: [] })).rejects.toThrow(/401/);
  });
  it('pushAggregate returns a structured warning when DHIS2 responds 409 with an import summary', async () => {
    const summary = { httpStatus: 'Conflict', httpStatusCode: 409, status: 'WARNING', response: { responseType: 'ImportSummary', status: 'WARNING', importCount: { imported: 1, updated: 1, ignored: 6, deleted: 1 }, conflicts: [{ object: 'a57FmdPj3Zl', value: 'Data value is not a valid option' }] } };
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409, json: async () => summary, text: async () => JSON.stringify(summary) } as Response));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushAggregate({ dataValues: [] });
    expect(r.status).toBe('warning');
    expect(r.imported).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.ignored).toBe(6);
    expect(r.conflicts).toEqual([{ object: 'a57FmdPj3Zl', value: 'Data value is not a valid option' }]);
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
  it('pushEvents parses the DHIS2 tracker import report (success)', async () => {
    const report = { status: 'OK', stats: { created: 2, updated: 1, deleted: 0, ignored: 0 }, validationReport: { errorReports: [] } };
    const fetchMock = vi.fn(async () => jsonResponse(report));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushEvents({ events: [] });
    expect(r).toMatchObject({ status: 'success', imported: 2, updated: 1 });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/tracker'), expect.objectContaining({ method: 'POST' }));
  });
  it('pushEvents maps a 409 validation report to an error with conflicts', async () => {
    const report = { status: 'ERROR', stats: { created: 0, updated: 0, deleted: 0, ignored: 1 }, validationReport: { errorReports: [{ message: 'bad event', uid: 'E1' }] } };
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409, json: async () => report, text: async () => JSON.stringify(report) } as Response));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushEvents({ events: [] });
    expect(r.status).toBe('error');
    expect(r.ignored).toBe(1);
    expect(r.conflicts).toEqual([{ object: 'E1', value: 'bad event' }]);
  });
  it('pullMetadata includes programs + programStages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('dataElements')) return jsonResponse({ dataElements: [{ id: 'DE1', name: 'd' }] });
      if (url.includes('organisationUnits')) return jsonResponse({ organisationUnits: [{ id: 'OU1', name: 'o' }] });
      if (url.includes('programStages')) return jsonResponse({ programStages: [{ id: 'PS1', name: 'ps', program: { id: 'PR1' } }] });
      if (url.includes('programs')) return jsonResponse({ programs: [{ id: 'PR1', name: 'pr' }] });
      return jsonResponse({ categoryOptionCombos: [{ id: 'COC1', name: 'c' }] });
    });
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const m = await t.pullMetadata();
    expect(m.programs?.[0].id).toBe('PR1');
    expect(m.programStages?.[0]).toMatchObject({ id: 'PS1', program: 'PR1' });
  });
});
