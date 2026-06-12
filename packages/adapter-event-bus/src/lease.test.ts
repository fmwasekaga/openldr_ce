import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './index';

interface QueryCall {
  sql: string;
  params?: unknown[];
}

/**
 * Fake pool whose `connect()` hands back a client that routes queries by SQL
 * substring. `select` returns whatever rows the test seeds; everything else is
 * a no-op. Both client and pool queries are recorded so a test can assert the
 * exact SQL the reaper issues.
 */
function fakePool(selectRows: unknown[]) {
  const calls: QueryCall[] = [];
  const route = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (/^\s*select id, type, payload/i.test(sql)) return { rows: selectRows };
    return { rows: [] };
  };
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => route(sql, params)),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn((sql: string, params?: unknown[]) => route(sql, params)),
    end: vi.fn(async () => {}),
  };
  return { pool, client, calls };
}

describe('event-bus lease reaper', () => {
  it('the claim SELECT also matches stale processing rows past the lease', async () => {
    const { pool, calls } = fakePool([]);
    const bus = createEventBus({ url: 'x' }, { pool: pool as never });
    await bus.drain();
    const select = calls.find((c) => /^\s*select id, type, payload/i.test(c.sql));
    expect(select).toBeDefined();
    // Fresh pending rows OR stale processing rows past the lease window.
    expect(select?.sql).toMatch(/status='processing'/);
    expect(select?.sql).toMatch(/updated_at\s*<\s*now\(\)\s*-/);
    // Lease semantics must keep FOR UPDATE SKIP LOCKED.
    expect(select?.sql).toMatch(/for update skip locked/i);
  });

  it('reclaims a stale processing row as a retry and re-runs the handler', async () => {
    const stale = {
      id: 'evt-stale',
      type: 'ingest.received',
      payload: { batchId: 'b1' },
      attempts: 1,
      max_attempts: 5,
      status: 'processing',
    };
    const { pool, calls } = fakePool([stale]);
    const bus = createEventBus({ url: 'x' }, { pool: pool as never });
    const handler = vi.fn(async () => {});
    await bus.subscribe('ingest.received', handler);
    const res = await bus.drain();

    // Reclaim bumped attempts back to 'processing' (not a fresh claim).
    const reclaim = calls.find(
      (c) => /set status='processing', attempts=/i.test(c.sql) && c.params?.[0] === 'evt-stale',
    );
    expect(reclaim).toBeDefined();
    expect(reclaim?.params?.[1]).toBe(2); // attempts 1 -> 2
    // The reclaimed row was handed to the handler and completed.
    expect(handler).toHaveBeenCalledOnce();
    expect(res.processed).toBe(1);
  });

  it('marks a stale row failed when reclaiming would exceed max_attempts', async () => {
    const exhausted = {
      id: 'evt-dead',
      type: 'ingest.received',
      payload: { batchId: 'b2' },
      attempts: 4,
      max_attempts: 5,
      status: 'processing',
    };
    const { pool, calls } = fakePool([exhausted]);
    const bus = createEventBus({ url: 'x' }, { pool: pool as never });
    const handler = vi.fn(async () => {});
    await bus.subscribe('ingest.received', handler);
    const res = await bus.drain();

    // attempts 4 -> 5 == max_attempts: terminal failure, not re-run.
    const fail = calls.find(
      (c) => /set status='failed'/i.test(c.sql) && c.params?.[0] === 'evt-dead',
    );
    expect(fail).toBeDefined();
    expect(fail?.params?.[1]).toBe(5);
    expect(String(fail?.params?.[2] ?? '')).toMatch(/lease/i);
    expect(handler).not.toHaveBeenCalled();
    expect(res.processed).toBe(0);
  });
});
