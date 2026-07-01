import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createDashboardStore } from './store';

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
