import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { recordDivergence, createSyncDivergenceStore } from './sync-divergence-store';
import type { RecordDivergenceInput } from './sync-divergence-store';

const BODY = { resourceType: 'Observation', id: 'obs-1', status: 'final' };

const DEFAULTS: RecordDivergenceInput = {
  resourceType: 'Observation',
  resourceId: 'obs-1',
  version: 2,
  localHash: 'local-hash-aaa',
  incomingHash: 'incoming-hash-bbb',
  incomingBody: BODY,
  incomingSiteId: 'lab-a',
};

async function seed(db: Awaited<ReturnType<typeof makeMigratedDb>>, overrides: Partial<RecordDivergenceInput> = {}) {
  const input = { ...DEFAULTS, ...overrides };
  await db.transaction().execute((trx) => recordDivergence(trx, input));
}

describe('sync-divergence-store', () => {
  it('records a divergence and reads it back with the body', async () => {
    const db = await makeMigratedDb();
    await seed(db);

    const store = createSyncDivergenceStore(db);
    const row = await store.get('Observation', 'obs-1', 2);
    expect(row).toBeDefined();
    expect(row?.localHash).toBe('local-hash-aaa');
    expect(row?.incomingHash).toBe('incoming-hash-bbb');
    expect(row?.incomingBody).toEqual(BODY);
    expect(row?.incomingSiteId).toBe('lab-a');
    expect(row?.version).toBe(2);

    await db.destroy();
  });

  it('re-recording the same key is a no-op and does not churn detected_at', async () => {
    const db = await makeMigratedDb();
    await seed(db);

    const store = createSyncDivergenceStore(db);
    const first = await store.get('Observation', 'obs-1', 2);
    expect(first).toBeDefined();
    const firstDetectedAt = first!.detectedAt.getTime();

    // 2nd seed with DIFFERENT incomingHash/body — if the implementation upserts instead of
    // doNothing, this would silently overwrite the first detection with the second.
    await seed(db, {
      incomingHash: 'DIFFERENT-hash',
      incomingBody: { resourceType: 'Observation', id: 'obs-1', status: 'amended' },
    });

    const rows = await store.list();
    expect(rows).toHaveLength(1);

    const second = await store.get('Observation', 'obs-1', 2);
    expect(second?.incomingHash).toBe('incoming-hash-bbb'); // first write won
    expect(second?.incomingBody).toEqual(BODY);
    expect(second?.detectedAt.getTime()).toBe(firstDetectedAt);

    await db.destroy();
  });

  it('records a tombstone side as NULL hash and body', async () => {
    const db = await makeMigratedDb();
    await seed(db, { incomingHash: null, incomingBody: null });

    const store = createSyncDivergenceStore(db);
    const row = await store.get('Observation', 'obs-1', 2);
    expect(row?.incomingHash).toBeNull();
    expect(row?.incomingBody).toBeNull();

    await db.destroy();
  });

  it('treats each version as an independent row', async () => {
    const db = await makeMigratedDb();
    await seed(db, { version: 2 });
    await seed(db, { version: 5 });

    const store = createSyncDivergenceStore(db);
    const rows = await store.list();
    expect(rows).toHaveLength(2);

    await db.destroy();
  });

  it('clear removes only the targeted row', async () => {
    const db = await makeMigratedDb();
    await seed(db, { version: 2 });
    await seed(db, { version: 5 });

    const store = createSyncDivergenceStore(db);
    await store.clear('Observation', 'obs-1', 2);

    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(5);

    await db.destroy();
  });

  it('list is newest-first', async () => {
    const db = await makeMigratedDb();
    await seed(db, { version: 2 });
    await seed(db, { version: 5 });

    const store = createSyncDivergenceStore(db);
    const rows = await store.list();
    expect(rows.map((r) => r.version)).toEqual([5, 2]);

    await db.destroy();
  });

  it('get returns undefined for an unknown key', async () => {
    const db = await makeMigratedDb();

    const store = createSyncDivergenceStore(db);
    const row = await store.get('Observation', 'does-not-exist', 1);
    expect(row).toBeUndefined();

    await db.destroy();
  });

  it('list does NOT include incomingBody (PHI-free by construction)', async () => {
    const db = await makeMigratedDb();
    await seed(db);

    const store = createSyncDivergenceStore(db);
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'incomingBody')).toBe(false);

    await db.destroy();
  });
});
