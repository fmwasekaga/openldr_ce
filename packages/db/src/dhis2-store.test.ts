import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createOrgUnitMapStore, createMappingStore } from './dhis2-store';

describe('orgUnit map store', () => {
  it('upserts then removes a mapping', async () => {
    const db = await makeMigratedDb();
    const store = createOrgUnitMapStore(db);
    await store.upsert([{ facilityId: 'f1', orgUnitId: 'ou1', orgUnitName: 'Clinic A' }]);
    expect(await store.list()).toHaveLength(1);

    await store.remove('f1');
    expect(await store.list()).toEqual([]);

    // Removing a non-existent facility is a no-op (no throw).
    await store.remove('nope');
    await db.destroy();
  });
});

describe('mapping store', () => {
  it('upserts, lists with kind, gets, and removes', async () => {
    const db = await makeMigratedDb();
    const store = createMappingStore(db);
    await store.upsert({ id: 'm1', name: 'Agg One', definition: { kind: 'aggregate', id: 'm1', name: 'Agg One' } });
    await store.upsert({ id: 'm2', name: 'Trk', definition: { kind: 'tracker', id: 'm2', name: 'Trk' } });

    const list = await store.list();
    expect(list).toEqual(expect.arrayContaining([
      { id: 'm1', name: 'Agg One', kind: 'aggregate' },
      { id: 'm2', name: 'Trk', kind: 'tracker' },
    ]));

    expect((await store.get('m1'))?.definition).toMatchObject({ kind: 'aggregate' });

    await store.remove('m1');
    expect((await store.list()).map((r) => r.id)).toEqual(['m2']);
    await store.remove('nope'); // no-op, no throw
    await db.destroy();
  });
});
