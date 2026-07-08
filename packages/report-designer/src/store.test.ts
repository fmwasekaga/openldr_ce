import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from './store';
import type { ReportDesign } from './schema';

let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('report_designs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('paper', 'text')
    .addColumn('orientation', 'text')
    .addColumn('pages', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('margins', 'jsonb')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

function makeDesign(id: string, name: string): ReportDesign {
  return {
    id,
    name,
    paper: 'A4',
    orientation: 'portrait',
    pages: [{ id: `${id}-p1`, elements: [] }],
    parameters: [],
  };
}

describe('ReportDesignStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createReportDesignStore(db);
    const created = await store.create(makeDesign('d1', 'Main'));
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    expect((await store.get('d1'))?.paper).toBe('A4');

    await store.update('d1', { ...created, name: 'Renamed', orientation: 'landscape' });
    const updated = await store.get('d1');
    expect(updated?.name).toBe('Renamed');
    expect(updated?.orientation).toBe('landscape');

    await store.remove('d1');
    expect(await store.get('d1')).toBeUndefined();
  });

  it('round-trips pages + parameters + margins JSON', async () => {
    const store = createReportDesignStore(db);
    const d = makeDesign('d2', 'Bound');
    d.margins = { top: 40, right: 48, bottom: 40, left: 48 };
    d.parameters = [{ key: 'facility', label: 'Facility', value: 'Ndola' }];
    d.pages = [{
      id: 'd2-p1',
      elements: [{ id: 'e1', kind: 'text', name: 'Title', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'Hi' }],
    }];
    await store.create(d);
    const got = await store.get('d2');
    expect(got?.margins).toMatchObject({ top: 40, left: 48 });
    expect(got?.parameters[0]).toMatchObject({ key: 'facility', value: 'Ndola' });
    expect(got?.pages[0].elements[0].kind).toBe('text');
  });

  it('create is idempotent on id — the second create returns the existing row', async () => {
    const store = createReportDesignStore(db);
    const first = await store.create(makeDesign('dup', 'First'));
    const second = await store.create(makeDesign('dup', 'Second'));
    expect(second.id).toBe('dup');
    expect(second.name).toBe(first.name);
    expect((await store.list()).length).toBe(1);
  });
});
