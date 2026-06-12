import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './index';

function fakePool() {
  return { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(), end: vi.fn(async () => {}) };
}

describe('event-bus publish', () => {
  it('inserts an outbox row with batch_id and notifies', async () => {
    const pool = fakePool();
    const bus = createEventBus({ url: 'x' }, { pool: pool as never });
    await bus.publish({ type: 'ingest.received', payload: { batchId: 'b1', foo: 1 } });
    const calls = pool.query.mock.calls as unknown[][];
    const insert = calls.find((c) => String(c[0]).includes('insert into outbox_events'));
    expect(insert).toBeDefined();
    const insertArgs = insert?.[1] as unknown[] | undefined;
    expect(insertArgs?.[1]).toBe('ingest.received');
    expect(insertArgs?.[3]).toBe('b1');
    const notify = calls.find((c) => String(c[0]).includes('pg_notify'));
    const notifyArgs = notify?.[1] as unknown[] | undefined;
    expect(notifyArgs?.[0]).toBe('ingest.received');
  });
});
