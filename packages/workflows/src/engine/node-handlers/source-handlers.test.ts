import { describe, it, expect, vi } from 'vitest';
import { sqlHandler } from './sql';
import { fhirHandler } from './fhir';
import { httpHandler } from './http';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const services: WorkflowServices = {
  runSql: vi.fn(async (sql: string) => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1, sql }] })),
  fhirQuery: vi.fn(async (rt: string, limit: number) => ({ resources: [{ resourceType: rt, limit }] })),
  httpFetch: vi.fn(async (req) => ({ status: 200, headers: {}, data: { url: req.url } })),
};
const ctxWith = (svc?: WorkflowServices) => {
  const c = createContext(undefined, () => {}, [], undefined, svc);
  return c;
};

describe('source handlers', () => {
  it('sqlHandler templates the query and delegates to runSql', async () => {
    const ctx = ctxWith(services);
    const out = await sqlHandler({ id: 's', type: 'action', data: { action: 'sql-query', config: { sql: 'select {{ $input.n }}' } } }, ctx, { n: 5 });
    expect((out as { rows: { sql: string }[] }).rows[0].sql).toBe('select 5');
  });
  it('fhirHandler delegates to fhirQuery', async () => {
    const ctx = ctxWith(services);
    const out = await fhirHandler({ id: 'f', type: 'action', data: { action: 'fhir-query', config: { resourceType: 'Observation', limit: 10 } } }, ctx, undefined);
    expect(out).toEqual({ resources: [{ resourceType: 'Observation', limit: 10 }] });
  });
  it('httpHandler delegates to httpFetch with resolved url', async () => {
    const ctx = ctxWith(services);
    const out = await httpHandler({ id: 'h', type: 'action', data: { action: 'http-request', config: { url: 'https://x/{{ $input.id }}', method: 'GET' } } }, ctx, { id: 'abc' });
    expect((out as { data: { url: string } }).data.url).toBe('https://x/abc');
  });
  it('each throws a clear error when services are absent', async () => {
    const ctx = ctxWith(undefined);
    await expect(sqlHandler({ id: 's', type: 'action', data: { config: { sql: 'x' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
    await expect(fhirHandler({ id: 'f', type: 'action', data: { config: { resourceType: 'X' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
    await expect(httpHandler({ id: 'h', type: 'action', data: { config: { url: 'https://x' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
  });
});
