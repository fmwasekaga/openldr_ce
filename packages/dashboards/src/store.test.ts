import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { createDashboardStore } from './store';

let db: Kysely<any>;
beforeEach(async () => {
  db = new Kysely<any>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) });
  await db.schema.createTable('dashboards')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('owner_id', 'text')
    .addColumn('name', 'text')
    .addColumn('layout', 'text').addColumn('widgets', 'text').addColumn('filters', 'text')
    .addColumn('refresh_interval_sec', 'integer').addColumn('is_default', 'integer')
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
});
