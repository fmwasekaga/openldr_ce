import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { makeMigratedDb } from '@openldr/db/testing';
import { referenceCapture } from '@openldr/db';
import { createDashboardStore } from './store';

const board = (over: Record<string, unknown> = {}) => ({
  id: 'd1', name: 'Main', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true, ownerId: null, ...over,
});
async function refLog(db: Kysely<any>, entityId: string) {
  return db.selectFrom('reference_change_log').selectAll().where('entity_id', '=', entityId).orderBy('seq').execute();
}

let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('dashboards')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('owner_id', 'text')
    .addColumn('name', 'text')
    .addColumn('layout', 'jsonb').addColumn('widgets', 'jsonb').addColumn('filters', 'jsonb')
    .addColumn('refresh_interval_sec', 'integer').addColumn('is_default', 'boolean')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

describe('DashboardStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createDashboardStore(db);
    const created = await store.create({ id: 'd1', name: 'Main', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true, ownerId: null });
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    const got = await store.get('d1');
    expect(got?.isDefault).toBe(true);
    await store.update('d1', { ...created, name: 'Renamed' });
    expect((await store.get('d1'))?.name).toBe('Renamed');
    await store.remove('d1');
    expect(await store.get('d1')).toBeUndefined();
  });

  it('create is idempotent on id — the second create returns the existing row, not a PK error', async () => {
    const store = createDashboardStore(db);
    const first = await store.create({ id: 'default', name: 'Sample', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true, ownerId: null });
    // Simulates the StrictMode double-seed: a second create of the same id must not throw.
    const second = await store.create({ id: 'default', name: 'Different Name', layout: [], widgets: [], filters: [], refreshIntervalSec: 99, isDefault: false, ownerId: null });
    expect(second.id).toBe('default');
    // ON CONFLICT DO NOTHING: the first-write wins; the existing row is returned unchanged.
    expect(second.name).toBe(first.name);
    expect(second.refreshIntervalSec).toBe(0);
    expect((await store.list()).length).toBe(1);
  });
});

describe('DashboardStore reference capture', () => {
  let mdb: Kysely<any>;
  beforeEach(async () => { mdb = await makeMigratedDb(); });

  it('without capture: no reference_change_log rows', async () => {
    const store = createDashboardStore(mdb);
    await store.create(board());
    await store.update('d1', board({ name: 'Renamed' }));
    await store.remove('d1');
    expect(await refLog(mdb, 'd1')).toHaveLength(0);
  });

  it('with capture: create → upsert, update → upsert, remove → delete', async () => {
    const store = createDashboardStore(mdb, referenceCapture);

    await store.create(board());
    let log = await refLog(mdb, 'd1');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'dashboard', op: 'upsert' });
    const createHash = log[0].content_hash;
    expect(createHash).toBeTruthy();

    // Re-create identical content → dedup, no new row.
    await store.create(board());
    expect(await refLog(mdb, 'd1')).toHaveLength(1);

    await store.update('d1', board({ name: 'Renamed' }));
    log = await refLog(mdb, 'd1');
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ op: 'upsert' });
    expect(log[1].content_hash).not.toBe(createHash);

    await store.remove('d1');
    log = await refLog(mdb, 'd1');
    expect(log).toHaveLength(3);
    expect(log[2]).toMatchObject({ op: 'delete', content_hash: null });
  });
});
