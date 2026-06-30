import { describe, it, expect, vi } from 'vitest';
import { createConnectorSqlRunner } from './connector-sql-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' })),
});

describe('createConnectorSqlRunner', () => {
  it('resolves + decrypts + queries + closes (rows → SqlResult)', async () => {
    let closed = false;
    const createDb = vi.fn(() => ({ query: async () => ({ rows: [{ a: 1, b: 'x' }] }), close: async () => { closed = true; } }));
    const run = createConnectorSqlRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', createDb });
    const res = await run({ connectorId: 'h1', sql: 'select 1' });
    expect(res.rows).toEqual([{ a: 1, b: 'x' }]);
    expect(res.columns).toEqual([{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }]);
    expect(createDb).toHaveBeenCalledWith('postgres', expect.objectContaining({ host: 'h' }));
    expect(closed).toBe(true);
  });
  it('closes the connection even when the query throws', async () => {
    let closed = false;
    const createDb = vi.fn(() => ({ query: async () => { throw new Error('boom'); }, close: async () => { closed = true; } }));
    const run = createConnectorSqlRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', createDb });
    await expect(run({ connectorId: 'h1', sql: 'x' })).rejects.toThrow('boom');
    expect(closed).toBe(true);
  });
  it('throws for a missing/disabled connector', async () => {
    const run = createConnectorSqlRunner({ connectors: connectorsFake(null), secretsKey: 'k', createDb: vi.fn() });
    await expect(run({ connectorId: 'x', sql: 's' })).rejects.toThrow(/not found or disabled/);
  });
  it('throws when the connector has no host type', async () => {
    const run = createConnectorSqlRunner({ connectors: connectorsFake({ type: null, enabled: true }), secretsKey: 'k', createDb: vi.fn() });
    await expect(run({ connectorId: 'p1', sql: 's' })).rejects.toThrow(/not a database connector/);
  });
});
