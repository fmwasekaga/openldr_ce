import { describe, it, expect } from 'vitest';
import { connectorSqlHandler } from './connector-sql';
import { createContext } from '../execution-context';

function fakeCtx(rows: Record<string, unknown>[]) {
  const calls: Array<{ connectorId: string; sql: string }> = [];
  const services = {
    runConnectorSql: async (input: { connectorId: string; sql: string }) => { calls.push(input); return { columns: [], rows }; },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'pg1', type: 'action', data: { action: 'postgres', config: cfg } });

describe('connectorSqlHandler', () => {
  it('runs the connector SQL and maps rows to items', async () => {
    const { ctx, calls } = fakeCtx([{ id: 1 }, { id: 2 }]);
    const result = await connectorSqlHandler(node({ connectorId: 'c1', sql: 'select id from t' }), ctx, []);
    expect(calls).toEqual([{ connectorId: 'c1', sql: 'select id from t' }]);
    expect(result).toEqual([{ json: { id: 1 } }, { json: { id: 2 } }]);
  });
  it('resolves {{ }} templates in the SQL against upstream items', async () => {
    const { ctx, calls } = fakeCtx([]);
    await connectorSqlHandler(node({ connectorId: 'c1', sql: 'select * from t where b = {{ $json.batch }}' }), ctx, [{ json: { batch: 'B7' } }]);
    expect(calls[0].sql).toBe('select * from t where b = B7');
  });
  it('throws when the connector is missing', async () => {
    const { ctx } = fakeCtx([]);
    await expect(connectorSqlHandler(node({ connectorId: '', sql: 'select 1' }), ctx, [])).rejects.toThrow(/connector is required/);
  });
  it('throws when SQL is empty', async () => {
    const { ctx } = fakeCtx([]);
    await expect(connectorSqlHandler(node({ connectorId: 'c1', sql: '' }), ctx, [])).rejects.toThrow(/SQL query is required/);
  });
  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(connectorSqlHandler(node({ connectorId: 'c1', sql: 'select 1' }), ctx, [])).rejects.toThrow(/requires server services/);
  });
});
