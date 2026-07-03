import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportTemplateStore } from './store';
import { createEmptyTemplate } from './helpers';

let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('report_templates')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('description', 'text')
    .addColumn('category', 'text')
    .addColumn('status', 'text')
    .addColumn('page', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('dataset', 'jsonb').addColumn('rows', 'jsonb')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

describe('ReportTemplateStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createReportTemplateStore(db);
    const created = await store.create(createEmptyTemplate('rt1', 'Main'));
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    expect((await store.get('rt1'))?.status).toBe('draft');

    await store.update('rt1', { ...created, name: 'Renamed', status: 'published' });
    const updated = await store.get('rt1');
    expect(updated?.name).toBe('Renamed');
    expect(updated?.status).toBe('published');

    await store.remove('rt1');
    expect(await store.get('rt1')).toBeUndefined();
  });

  it('round-trips dataset + rows JSON', async () => {
    const store = createReportTemplateStore(db);
    const t = createEmptyTemplate('rt2', 'Bound');
    t.dataset = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] };
    t.rows = [{ id: 'r1', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi', style: {} } }] }];
    await store.create(t);
    const got = await store.get('rt2');
    expect(got?.dataset).toMatchObject({ mode: 'builder', model: 'observations' });
    expect(got?.rows[0].cells[0].block.kind).toBe('title');
  });

  it('create is idempotent on id — the second create returns the existing row', async () => {
    const store = createReportTemplateStore(db);
    const first = await store.create(createEmptyTemplate('dup', 'First'));
    const second = await store.create({ ...createEmptyTemplate('dup', 'Second') });
    expect(second.id).toBe('dup');
    expect(second.name).toBe(first.name);
    expect((await store.list()).length).toBe(1);
  });
});
