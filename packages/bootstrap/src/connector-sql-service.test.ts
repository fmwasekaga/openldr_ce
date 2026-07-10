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

  it('applies a Postgres LIMIT/OFFSET wrapper when rowCap is given (type=postgres)', async () => {
    const seen: string[] = [];
    const run = createConnectorSqlRunner({
      connectors: connectorsFake({ type: 'postgres', enabled: true }),
      secretsKey: 'k',
      createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
    });
    await run({ connectorId: 'c1', sql: 'select * from t', rowCap: 100, offset: 0 });
    expect(seen[0]).toBe('select * from (select * from t) as _q limit 100 offset 0');
  });

  it('applies a T-SQL OFFSET/FETCH wrapper when rowCap is given (type=microsoft-sql)', async () => {
    const seen: string[] = [];
    const run = createConnectorSqlRunner({
      connectors: connectorsFake({ type: 'microsoft-sql', enabled: true }),
      secretsKey: 'k',
      createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
    });
    await run({ connectorId: 'c1', sql: 'select * from t', rowCap: 100 });
    expect(seen[0]).toBe('select * from (select * from t) as _q order by (select null) offset 0 rows fetch next 100 rows only');
  });

  it('applies a LIMIT/OFFSET wrapper for mysql (shares Postgres syntax — row cap preserved)', async () => {
    const seen: string[] = [];
    const run = createConnectorSqlRunner({
      connectors: connectorsFake({ type: 'mysql', enabled: true }),
      secretsKey: 'k',
      createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
    });
    await run({ connectorId: 'c1', sql: 'select * from t', rowCap: 100 });
    expect(seen[0]).toBe('select * from (select * from t) as _q limit 100 offset 0');
  });

  it('runs raw SQL unwrapped when rowCap is omitted (workflow node path)', async () => {
    const seen: string[] = [];
    const run = createConnectorSqlRunner({
      connectors: connectorsFake({ type: 'postgres', enabled: true }),
      secretsKey: 'k',
      createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
    });
    await run({ connectorId: 'c1', sql: 'select 1' });
    expect(seen[0]).toBe('select 1');
  });
});
