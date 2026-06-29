import { describe, it, expect, vi } from 'vitest';
import { sqlHandler } from './sql';
import { fhirHandler } from './fhir';
import { httpHandler } from './http';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

const services: WorkflowServices = {
  runSql: vi.fn(async (sql: string) => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1, sql }] })),
  fhirQuery: vi.fn(async (rt: string, limit: number) => ({ resources: [{ resourceType: rt, limit }] })),
  httpFetch: vi.fn(async (req) => ({ status: 200, headers: {}, data: { url: req.url } })),
  materializeDataset: vi.fn(async (name, _c, rows) => ({ dataset: name, rowCount: rows.length })),
  exportArtifact: vi.fn(async (i) => ({ objectKey: `k/${i.format}`, format: i.format, byteSize: 0 })),
  loadDataset: async () => ({ columns: [], rows: [] }),
};
const ctxWith = (svc?: WorkflowServices) => {
  const c = createContext(undefined, () => {}, [], undefined, svc);
  return c;
};

describe('source handlers', () => {
  it('sqlHandler templates the query and delegates to runSql', async () => {
    const ctx = ctxWith(services);
    const input: WorkflowItem[] = [{ json: { n: 5 } }];
    const out = await sqlHandler({ id: 's', type: 'action', data: { action: 'sql-query', config: { sql: 'select {{ $json.n }}' } } }, ctx, input);
    // out is WorkflowItem[]; sql row had field `sql` = the resolved query
    expect(Array.isArray(out)).toBe(true);
    expect((out[0].json as { sql: string }).sql).toBe('select 5');
  });
  it('fhirHandler delegates to fhirQuery', async () => {
    const ctx = ctxWith(services);
    const out = await fhirHandler({ id: 'f', type: 'action', data: { action: 'fhir-query', config: { resourceType: 'Observation', limit: 10 } } }, ctx, []);
    expect(out).toEqual([{ json: { resourceType: 'Observation', limit: 10 } }]);
  });
  it('httpHandler delegates to httpFetch with resolved url', async () => {
    const ctx = ctxWith(services);
    const input: WorkflowItem[] = [{ json: { id: 'abc' } }];
    const out = await httpHandler({ id: 'h', type: 'action', data: { action: 'http-request', config: { url: 'https://x/{{ $json.id }}', method: 'GET' } } }, ctx, input);
    expect(Array.isArray(out)).toBe(true);
    expect((out[0].json.data as { url: string }).url).toBe('https://x/abc');
  });
  it('each throws a clear error when services are absent', async () => {
    const ctx = ctxWith(undefined);
    await expect(sqlHandler({ id: 's', type: 'action', data: { config: { sql: 'x' } } }, ctx, [])).rejects.toThrow(/requires server services/);
    await expect(fhirHandler({ id: 'f', type: 'action', data: { config: { resourceType: 'X' } } }, ctx, [])).rejects.toThrow(/requires server services/);
    await expect(httpHandler({ id: 'h', type: 'action', data: { config: { url: 'https://x' } } }, ctx, [])).rejects.toThrow(/requires server services/);
  });
});
