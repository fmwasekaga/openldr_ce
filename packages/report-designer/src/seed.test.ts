import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from './store';
import { seedReportDesigns, removeRetiredDemoDesigns, SEED_DESIGNS, RETIRED_DEMO_DESIGN_IDS } from './seed';

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
  it('seeds nothing (SEED_DESIGNS is empty as of Slice S5 — the 3 demo designs were retired)', async () => {
    const store = createReportDesignStore(db);

    expect(SEED_DESIGNS).toHaveLength(0);
    const first = await seedReportDesigns(store);
    expect(first).toBe(0);
    expect((await store.list()).length).toBe(0);
  });

  it('every seed design (if any are added) parses and has a stable id + non-empty name', () => {
    const ids = new Set(SEED_DESIGNS.map((d) => d.id));
    expect(ids.size).toBe(SEED_DESIGNS.length);
    for (const d of SEED_DESIGNS) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.name.length).toBeGreaterThan(0);
    }
  });
});

describe('removeRetiredDemoDesigns', () => {
  async function seedLegacyDemoDesign(store: ReturnType<typeof createReportDesignStore>, id: string): Promise<void> {
    await store.create({ id, name: id, paper: 'A4', orientation: 'portrait', parameters: [], pages: [] });
  }

  it('is a no-op on a fresh install (the demo designs were never seeded)', async () => {
    const store = createReportDesignStore(db);
    const removed = await removeRetiredDemoDesigns(store, { list: async () => [] });
    expect(removed).toBe(0);
  });

  it('removes retired demo designs left over from a pre-S5 install when unreferenced', async () => {
    const store = createReportDesignStore(db);
    for (const id of RETIRED_DEMO_DESIGN_IDS) await seedLegacyDemoDesign(store, id);

    const removed = await removeRetiredDemoDesigns(store, { list: async () => [] });
    expect(removed).toBe(RETIRED_DEMO_DESIGN_IDS.length);
    for (const id of RETIRED_DEMO_DESIGN_IDS) expect(await store.get(id)).toBeUndefined();
  });

  it('skips a design still referenced by a reports record (guard against deleting a linked design)', async () => {
    const store = createReportDesignStore(db);
    for (const id of RETIRED_DEMO_DESIGN_IDS) await seedLegacyDemoDesign(store, id);

    const [keep, ...rest] = RETIRED_DEMO_DESIGN_IDS;
    const removed = await removeRetiredDemoDesigns(store, { list: async () => [{ designId: keep }] });
    expect(removed).toBe(rest.length);
    expect(await store.get(keep)).toBeDefined();
    for (const id of rest) expect(await store.get(id)).toBeUndefined();
  });

  it('is idempotent — re-running after cleanup removes nothing more', async () => {
    const store = createReportDesignStore(db);
    for (const id of RETIRED_DEMO_DESIGN_IDS) await seedLegacyDemoDesign(store, id);

    await removeRetiredDemoDesigns(store, { list: async () => [] });
    const second = await removeRetiredDemoDesigns(store, { list: async () => [] });
    expect(second).toBe(0);
  });
});
