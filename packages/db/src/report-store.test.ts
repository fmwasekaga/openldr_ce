import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReportStore, type ReportRecord } from './report-store';

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
});
