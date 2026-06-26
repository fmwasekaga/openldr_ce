import { type Kysely } from 'kysely';

const PLUGIN_ID = 'dhis2-sink';

type Row = { plugin_id: string; collection: string; key: string; doc: unknown; updated_at: Date };

// Swallow only "source table/relation does not exist" errors (expected on a
// fresh/cleaned DB); rethrow anything else (column typo, missing plugin_data,
// insert failure) so real bugs fail loudly. The regex covers Postgres
// (42P01 / "relation ... does not exist"), SQLite, and pg-mem variants.
function rethrowUnlessMissingTable(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  if (!/does not exist|relation|no such table|undefined_table|42P01/i.test(msg)) throw e;
}

// Insert one row idempotently. pg-mem's onConflict support is partial, so we
// pre-check for an existing (plugin_id, collection, key) and skip if present.
// This keeps the behaviour correct under both pg-mem and Postgres.
async function insertIfAbsent(d: Kysely<any>, row: Row): Promise<void> {
  const existing = await d
    .selectFrom('plugin_data')
    .select('key')
    .where('plugin_id', '=', row.plugin_id)
    .where('collection', '=', row.collection)
    .where('key', '=', row.key)
    .executeTakeFirst();
  if (existing) return;
  await d.insertInto('plugin_data').values(row).execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;
  const now = new Date();

  // dhis2_orgunit_map -> collection 'orgUnitMaps', key = facility_id
  try {
    const rows = await d
      .selectFrom('dhis2_orgunit_map')
      .select(['facility_id', 'orgunit_id', 'orgunit_name'])
      .execute();
    for (const r of rows) {
      await insertIfAbsent(d, {
        plugin_id: PLUGIN_ID,
        collection: 'orgUnitMaps',
        key: r.facility_id,
        doc: {
          facilityId: r.facility_id,
          orgUnitId: r.orgunit_id,
          orgUnitName: r.orgunit_name ?? null,
        },
        updated_at: now,
      });
    }
  } catch (e) {
    rethrowUnlessMissingTable(e);
  }

  // dhis2_mappings -> collection 'mappings', key = id
  try {
    const rows = await d
      .selectFrom('dhis2_mappings')
      .select(['id', 'name', 'definition'])
      .execute();
    for (const r of rows) {
      await insertIfAbsent(d, {
        plugin_id: PLUGIN_ID,
        collection: 'mappings',
        key: r.id,
        doc: { id: r.id, name: r.name, definition: r.definition },
        updated_at: now,
      });
    }
  } catch (e) {
    rethrowUnlessMissingTable(e);
  }

  // dhis2_schedules -> collection 'schedules', key = id
  try {
    const rows = await d
      .selectFrom('dhis2_schedules')
      .select([
        'id',
        'mapping_id',
        'mode',
        'period_type',
        'event_driven',
        'enabled',
        'last_run_at',
        'next_due_at',
      ])
      .execute();
    for (const r of rows) {
      await insertIfAbsent(d, {
        plugin_id: PLUGIN_ID,
        collection: 'schedules',
        key: r.id,
        doc: {
          id: r.id,
          mappingId: r.mapping_id,
          mode: r.mode,
          periodType: r.period_type,
          eventDriven: r.event_driven,
          enabled: r.enabled,
          lastRunAt: r.last_run_at ?? null,
          nextDueAt: r.next_due_at ?? null,
        },
        updated_at: now,
      });
    }
  } catch (e) {
    rethrowUnlessMissingTable(e);
  }

  // dhis2_metadata_cache (singleton) -> collection 'metadataCache', key = 'latest'
  try {
    const rows = await d
      .selectFrom('dhis2_metadata_cache')
      .select(['metadata', 'pulled_at'])
      .execute();
    for (const r of rows) {
      await insertIfAbsent(d, {
        plugin_id: PLUGIN_ID,
        collection: 'metadataCache',
        key: 'latest',
        doc: { metadata: r.metadata, pulledAt: r.pulled_at },
        updated_at: now,
      });
    }
  } catch (e) {
    rethrowUnlessMissingTable(e);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;
  await d
    .deleteFrom('plugin_data')
    .where('plugin_id', '=', PLUGIN_ID)
    .where('collection', 'in', ['orgUnitMaps', 'mappings', 'schedules', 'metadataCache'])
    .execute();
}
