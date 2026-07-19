import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { internalMigrations } from './migrations/internal';
import type { InternalSchema } from './schema/internal';
import { createSyncActivityStore } from './sync-activity-store';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

describe('createSyncActivityStore', () => {
  it('records a row and reads it back with parsed fields', async () => {
    const db = await makeMigratedDb();
    const store = createSyncActivityStore(db);
    const row = await store.record({
      direction: 'push',
      event: 'synced',
      records: 5,
      metadata: { seq: 42 },
    });
    expect(row.direction).toBe('push');
    expect(row.event).toBe('synced');
    expect(row.records).toBe(5);
    expect(row.error).toBeNull();
    expect(row.metadata).toEqual({ seq: 42 });
    expect(typeof row.occurredAt).toBe('string');

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(row.id);
  });

  it('trims to N most-recent rows PER DIRECTION on write', async () => {
    const db = await makeMigratedDb();
    const store = createSyncActivityStore(db, { retentionPerDirection: 3 });
    for (let i = 0; i < 5; i++) await store.record({ direction: 'push', event: 'synced', records: i });
    for (let i = 0; i < 2; i++) await store.record({ direction: 'pull', event: 'synced', records: i });
    expect(await store.list({ direction: 'push' })).toHaveLength(3); // trimmed
    expect(await store.list({ direction: 'pull' })).toHaveLength(2); // untouched by push trim
  });

  it('lists newest-first and filters by direction', async () => {
    const db = await makeMigratedDb();
    const store = createSyncActivityStore(db);
    const first = await store.record({ direction: 'pull', event: 'failed', error: 'boom' });
    // Force a strictly-older occurred_at on the first row so ordering is deterministic.
    await db.updateTable('sync_activity').set({ occurred_at: new Date('2020-01-01T00:00:00Z') }).where('id', '=', first.id).execute();
    const second = await store.record({ direction: 'pull', event: 'synced', records: 1 });
    await store.record({ direction: 'push', event: 'synced', records: 9 });

    const pull = await store.list({ direction: 'pull' });
    expect(pull.map((r) => r.id)).toEqual([second.id, first.id]); // newest first
    expect(pull.every((r) => r.direction === 'pull')).toBe(true);
  });
});
