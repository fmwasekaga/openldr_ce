import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createOrgUnitMapStore } from './dhis2-store';

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
