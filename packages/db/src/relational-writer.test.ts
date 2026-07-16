import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from './test-helpers-external';
import { createRelationalWriter } from './relational-writer';

describe('relational-writer', () => {
  it('writes/upserts a resource into its table and deletes by id', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');

    expect(await w.write({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] }, {})).toBe('written');
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    await w.write({ resourceType: 'Patient', id: 'p1', name: [{ family: 'B' }] }, {});
    const rows = await db.selectFrom('patients').select(['id', 'surname']).execute();
    expect(rows).toEqual([{ id: 'p1', surname: 'B' }]);
    expect(await w.write({ resourceType: 'Bundle', id: 'b1' }, {})).toBe('skipped');
    await w.deleteById('Patient', 'p1');
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await w.deleteById('Bundle', 'x');
    await db.destroy();
  });

  it('writeMany groups by table and returns per-item results', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    const results = await w.writeMany([
      { resource: { resourceType: 'Patient', id: 'p1' }, provenance: {} },
      { resource: { resourceType: 'Bundle', id: 'b1' }, provenance: {} },
      { resource: { resourceType: 'Observation', id: 'o1', code: { coding: [{ code: 'x' }] } }, provenance: {} },
    ]);
    expect(results).toEqual(['written', 'skipped', 'written']);
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('lab_results').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
