import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from './store';
import { seedReportDesigns, SEED_DESIGNS } from './seed';

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

describe('seedReportDesigns', () => {
  it('seeds the defaults once, then is idempotent', async () => {
    const store = createReportDesignStore(db);

    const first = await seedReportDesigns(store);
    expect(first).toBe(SEED_DESIGNS.length);
    expect(first).toBe(3);
    expect((await store.list()).length).toBe(3);

    const second = await seedReportDesigns(store);
    expect(second).toBe(0);
    expect((await store.list()).length).toBe(3);
  });

  it('every seed design parses and has a stable id + non-empty name', () => {
    const ids = new Set(SEED_DESIGNS.map((d) => d.id));
    expect(ids.size).toBe(SEED_DESIGNS.length);
    for (const d of SEED_DESIGNS) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.name.length).toBeGreaterThan(0);
    }
  });
});
