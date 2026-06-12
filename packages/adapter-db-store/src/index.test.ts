import { describe, it, expect, vi } from 'vitest';
import { createDbStore } from './index';

function fakePool(impl: () => Promise<unknown>) {
  return { query: vi.fn(impl), end: vi.fn(async () => {}) };
}

describe('createDbStore', () => {
  it('reports up when SELECT 1 succeeds', async () => {
    const pool = fakePool(async () => ({ rows: [{ '?column?': 1 }] }));
    const store = createDbStore({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    expect(pool.query).toHaveBeenCalledWith('select 1');
  });

  it('reports down when the query throws', async () => {
    const pool = fakePool(async () => { throw new Error('ECONNREFUSED'); });
    const store = createDbStore({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
  });
});
