import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './index';

function fakePool(impl: () => Promise<unknown>) {
  return { query: vi.fn(impl), end: vi.fn(async () => {}) };
}

describe('createEventBus', () => {
  it('reports up when pg_notify succeeds', async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await bus.healthCheck();
    expect(r.status).toBe('up');
    expect(pool.query).toHaveBeenCalledWith("select pg_notify('openldr_health', 'ping')");
  });

  it('reports down when the connection fails', async () => {
    const pool = fakePool(async () => { throw new Error('ECONNREFUSED'); });
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await bus.healthCheck();
    expect(r.status).toBe('down');
  });
});
