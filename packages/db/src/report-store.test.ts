import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReportStore, type ReportRecord } from './report-store';
import { referenceCapture } from './reference-capture';

async function refLog(db: Awaited<ReturnType<typeof makeMigratedDb>>, entityId: string) {
  return db.selectFrom('reference_change_log').selectAll().where('entity_id', '=', entityId).orderBy('seq').execute();
}

const base: ReportRecord = {
  id: 'r1', name: 'AMR Resistance', description: '', category: 'amr',
  designId: 'd1', primaryQueryId: 'q1', summaryMetrics: null, chart: null,
  paramOptions: null, status: 'published',
};

describe('createReportStore', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('creates and reads a record with JSON round-tripped', async () => {
    const store = createReportStore(db);
    await store.create({ ...base, summaryMetrics: [{ id: 'm', label: 'M', type: 'count' }], paramOptions: { facility: 'q-fac' } });
    const got = await store.get('r1');
    expect(got?.name).toBe('AMR Resistance');
    expect(got?.summaryMetrics).toEqual([{ id: 'm', label: 'M', type: 'count' }]);
    expect(got?.paramOptions).toEqual({ facility: 'q-fac' });
  });

  it('create is idempotent on duplicate id', async () => {
    const store = createReportStore(db);
    await store.create(base);
    await store.create({ ...base, name: 'changed' });
    expect((await store.get('r1'))?.name).toBe('AMR Resistance');
  });

  it('lists, updates and removes', async () => {
    const store = createReportStore(db);
    await store.create(base);
    await store.update('r1', { ...base, name: 'renamed' });
    expect((await store.get('r1'))?.name).toBe('renamed');
    expect(await store.list()).toHaveLength(1);
    await store.remove('r1');
    expect(await store.get('r1')).toBeUndefined();
  });

  it('without capture: no reference_change_log rows are written', async () => {
    const store = createReportStore(db);
    await store.create(base);
    await store.update('r1', { ...base, name: 'renamed' });
    await store.remove('r1');
    expect(await refLog(db, 'r1')).toHaveLength(0);
  });

  it('with capture: create → upsert, update → upsert, remove → delete', async () => {
    const store = createReportStore(db, referenceCapture);

    await store.create(base);
    let log = await refLog(db, 'r1');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'report', op: 'upsert' });
    expect(log[0].content_hash).toBeTruthy();
    const createHash = log[0].content_hash;

    // Idempotent re-create of the SAME content adds no new row (dedup on stable hash).
    await store.create(base);
    expect(await refLog(db, 'r1')).toHaveLength(1);

    await store.update('r1', { ...base, name: 'renamed' });
    log = await refLog(db, 'r1');
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ op: 'upsert' });
    expect(log[1].content_hash).not.toBe(createHash);

    await store.remove('r1');
    log = await refLog(db, 'r1');
    expect(log).toHaveLength(3);
    expect(log[2]).toMatchObject({ op: 'delete', content_hash: null });
  });
});
