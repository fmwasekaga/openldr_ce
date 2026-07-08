import { describe, it, expect, vi } from 'vitest';
import { prepareSelect, runStoredQuery } from './run-stored-query';

const PARAMS = [{ id: 'facility', label: 'F', type: 'text' as const, required: true }];

describe('prepareSelect', () => {
  it('substitutes params then validates SELECT-only', () => {
    const sql = prepareSelect("select * from t where f = {{param.facility}}", PARAMS, { facility: 'HQ' });
    expect(sql).toContain("f = 'HQ'");
  });
  it('rejects non-SELECT', () => {
    expect(() => prepareSelect('delete from t', [], {})).toThrow();
  });
  it('throws on a missing required param', () => {
    expect(() => prepareSelect('select * from t where f = {{param.facility}}', PARAMS, {})).toThrow(/facility/);
  });
});

describe('runStoredQuery', () => {
  const rec = { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select * from t where f = {{param.facility}}', params: PARAMS };
  const deps = () => ({
    customQueries: { get: vi.fn(async (id: string) => (id === 'cq_1' ? rec : undefined)) } as never,
    runConnectorSql: vi.fn(async () => ({ columns: [{ key: 'f', label: 'f' }], rows: [{ f: 'HQ' }] })),
  });

  it('loads the record, substitutes, validates, runs against its connector', async () => {
    const d = deps();
    const out = await runStoredQuery(d, 'cq_1', { facility: 'HQ' });
    expect(out.rows).toEqual([{ f: 'HQ' }]);
    expect(d.runConnectorSql).toHaveBeenCalledWith({ connectorId: 'c1', sql: expect.stringContaining("'HQ'") });
  });
  it('throws when the query id is unknown', async () => {
    await expect(runStoredQuery(deps(), 'nope', {})).rejects.toThrow(/not found/);
  });
});
