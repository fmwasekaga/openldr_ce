import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createCustomQueryStore } from './custom-query-store';

describe('CustomQueryStore', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('creates, gets, lists, updates and removes', async () => {
    const store = createCustomQueryStore(db);
    await store.create({ id: 'cq_1', name: 'AMR by facility', connectorId: 'c1',
      sql: 'select 1', params: [{ id: 'facility', label: 'Facility', type: 'select', required: false }] });
    const got = await store.get('cq_1');
    expect(got?.name).toBe('AMR by facility');
    expect(got?.params[0].id).toBe('facility');

    expect((await store.list()).length).toBe(1);
    expect((await store.getByName('AMR by facility'))?.id).toBe('cq_1');

    await store.update('cq_1', { name: 'Renamed', sql: 'select 2', params: [] });
    const upd = await store.get('cq_1');
    expect(upd?.name).toBe('Renamed');
    expect(upd?.sql).toBe('select 2');
    expect(upd?.params).toEqual([]);

    await store.remove('cq_1');
    expect(await store.get('cq_1')).toBeNull();
  });
});
