import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createDhis2MetadataCache } from './dhis2-metadata-cache';

const sample = {
  dataElements: [{ id: 'de1', name: 'DE 1' }],
  orgUnits: [{ id: 'ou1', name: 'Clinic A' }, { id: 'ou2', name: 'Clinic B' }],
  categoryOptionCombos: [{ id: 'coc1', name: 'default' }],
  programs: [],
  programStages: [],
};

describe('dhis2-metadata-cache', () => {
  it('returns null before anything is saved', async () => {
    const db = await makeMigratedDb();
    const cache = createDhis2MetadataCache(db);
    expect(await cache.get()).toBeNull();
    await db.destroy();
  });

  it('round-trips the snapshot and keeps a single row across saves', async () => {
    const db = await makeMigratedDb();
    const cache = createDhis2MetadataCache(db);
    await cache.save(sample);
    const got = await cache.get();
    expect(got?.metadata.orgUnits).toHaveLength(2);
    expect(typeof got?.pulledAt).toBe('string');

    // Second save replaces the single row (no duplicate).
    await cache.save({ ...sample, orgUnits: [{ id: 'ou1', name: 'Clinic A' }] });
    const got2 = await cache.get();
    expect(got2?.metadata.orgUnits).toHaveLength(1);
    const count = await db.selectFrom('dhis2_metadata_cache').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
    await db.destroy();
  });
});
