import { describe, expect, it, vi } from 'vitest';
import type { SyncActivityStore } from '@openldr/db';
import { createSyncActivityTracker } from './sync-activity-tracker';

function fakeStore() {
  const rows: any[] = [];
  const store: SyncActivityStore = {
    record: vi.fn(async (input) => {
      rows.push(input);
      return { id: String(rows.length), occurredAt: '', ...input, records: input.records ?? 0, error: input.error ?? null, metadata: input.metadata ?? null } as any;
    }),
    list: vi.fn(async () => rows),
  };
  return { store, rows };
}
const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

describe('createSyncActivityTracker', () => {
  it('attempt() sets lastAttemptAt without persisting', () => {
    const { store, rows } = fakeStore();
    const tracker = createSyncActivityTracker(store, nullLogger);
    tracker.forDirection('push').attempt();
    expect(tracker.summary('push').lastAttemptAt).toBeTruthy();
    expect(rows).toHaveLength(0); // idle attempt writes no row
  });

  it('record(synced) persists and marks lastSuccessAt; record(failed) marks lastError', async () => {
    const { store, rows } = fakeStore();
    const tracker = createSyncActivityTracker(store, nullLogger);
    const push = tracker.forDirection('push');
    push.record({ event: 'synced', records: 3 });
    push.record({ event: 'failed', error: 'boom' });
    await Promise.resolve();
    await Promise.resolve();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ direction: 'push', event: 'synced', records: 3 });
    const s = tracker.summary('push');
    expect(s.lastSuccessAt).toBeTruthy();
    expect(s.lastErrorAt).toBeTruthy();
    expect(s.lastError).toBe('boom');
  });

  it('summaries are isolated per direction and default to nulls', () => {
    const { store } = fakeStore();
    const tracker = createSyncActivityTracker(store, nullLogger);
    tracker.forDirection('push').attempt();
    expect(tracker.summary('pull')).toEqual({ lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null });
  });

  it('never throws when the store rejects (fire-and-forget)', async () => {
    const store: SyncActivityStore = { record: vi.fn(async () => { throw new Error('db down'); }), list: vi.fn(async () => []) };
    const tracker = createSyncActivityTracker(store, nullLogger);
    expect(() => tracker.forDirection('pull').record({ event: 'synced', records: 1 })).not.toThrow();
    await Promise.resolve();
  });

  it('never throws when the store throws synchronously', () => {
    const store = { record: () => { throw new Error('sync boom'); }, list: async () => [] } as any;
    const tracker = createSyncActivityTracker(store, nullLogger);
    expect(() => tracker.forDirection('push').record({ event: 'synced', records: 1 })).not.toThrow();
  });
});
