import { describe, it, expect } from 'vitest';
import { internalMigrations } from './internal/index';
import { makeMigratedDb } from './internal/test-helpers';
import * as m036 from './internal/036_dhis2_to_plugin_data';

// pg-mem may return jsonb either parsed or as a string; normalize for assertions.
function asObj(doc: unknown): any {
  return typeof doc === 'string' ? JSON.parse(doc) : doc;
}

describe('036_dhis2_to_plugin_data migration', () => {
  it('is registered', () => {
    expect(internalMigrations['036_dhis2_to_plugin_data']).toBeDefined();
  });

  it('copies host DHIS2 tables into plugin_data', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('dhis2_orgunit_map')
      .values({ facility_id: 'F1', orgunit_id: 'OU1', orgunit_name: 'Clinic One' })
      .execute();
    await db
      .insertInto('dhis2_mappings')
      .values({ id: 'M1', name: 'Agg map', definition: { dataElements: ['de1'] } })
      .execute();
    await db
      .insertInto('dhis2_schedules')
      .values({
        id: 'S1',
        mapping_id: 'M1',
        mode: 'aggregate',
        period_type: 'Monthly',
        event_driven: false,
        enabled: true,
      })
      .execute();
    await db
      .insertInto('dhis2_metadata_cache')
      .values({ id: 'singleton', metadata: { orgUnits: 3 }, pulled_at: new Date() })
      .execute();

    // Re-run the migration up on the populated source tables.
    await m036.up(db);

    const all = await db
      .selectFrom('plugin_data')
      .selectAll()
      .where('plugin_id', '=', 'dhis2-sink')
      .execute();
    expect(all).toHaveLength(4);

    const mapping = all.find((r) => r.collection === 'mappings' && r.key === 'M1')!;
    expect(asObj(mapping.doc)).toEqual({
      id: 'M1',
      name: 'Agg map',
      definition: { dataElements: ['de1'] },
    });

    const ou = all.find((r) => r.collection === 'orgUnitMaps' && r.key === 'F1')!;
    expect(asObj(ou.doc)).toEqual({
      facilityId: 'F1',
      orgUnitId: 'OU1',
      orgUnitName: 'Clinic One',
    });

    const sched = all.find((r) => r.collection === 'schedules' && r.key === 'S1')!;
    expect(asObj(sched.doc)).toEqual({
      id: 'S1',
      mappingId: 'M1',
      mode: 'aggregate',
      periodType: 'Monthly',
      eventDriven: false,
      enabled: true,
      lastRunAt: null,
      nextDueAt: null,
    });

    const cache = all.find((r) => r.collection === 'metadataCache' && r.key === 'latest')!;
    expect(cache).toBeDefined();
    expect(asObj(cache.doc).metadata).toEqual({ orgUnits: 3 });

    await db.destroy();
  });

  it('is idempotent', async () => {
    const db = await makeMigratedDb();
    await db
      .insertInto('dhis2_mappings')
      .values({ id: 'M1', name: 'Agg map', definition: { dataElements: ['de1'] } })
      .execute();

    await m036.up(db);
    const after1 = await db
      .selectFrom('plugin_data')
      .selectAll()
      .where('plugin_id', '=', 'dhis2-sink')
      .execute();

    await m036.up(db);
    const after2 = await db
      .selectFrom('plugin_data')
      .selectAll()
      .where('plugin_id', '=', 'dhis2-sink')
      .execute();

    expect(after2).toHaveLength(after1.length);
    expect(after2).toHaveLength(1);

    await db.destroy();
  });

  it('no-ops when source tables are empty', async () => {
    const db = await makeMigratedDb(); // source tables exist but are empty
    await m036.up(db); // run the copy against empty source tables
    const rows = await db
      .selectFrom('plugin_data')
      .selectAll()
      .where('plugin_id', '=', 'dhis2-sink')
      .execute();
    expect(rows).toHaveLength(0);
    await db.destroy();
  });
});
