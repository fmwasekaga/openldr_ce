import { type Kysely, sql } from 'kysely';

// R0 of the FHIR storage restructure: relocate the canonical FHIR store from the
// `public` schema into a dedicated `fhir` schema. Real Postgres uses
// `ALTER TABLE ... SET SCHEMA` (instant metadata move, preserves PK + data). Engines
// that cannot parse it (pg-mem in unit tests) fall back to create-in-fhir + copy + drop.
// Column set mirrors 001_fhir_resources exactly (no later migration alters it).

const COLUMNS = [
  'resource_type',
  'id',
  'version_id',
  'resource',
  'source_system',
  'plugin_id',
  'plugin_version',
  'batch_id',
  'created_at',
  'updated_at',
] as const;

async function createFhirResourcesIn(db: Kysely<any>, schema: 'fhir' | 'public'): Promise<void> {
  await db.schema
    .withSchema(schema)
    .createTable('fhir_resources')
    .ifNotExists()
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('id', 'text', (c) => c.notNull())
    .addColumn('version_id', 'text')
    .addColumn('resource', 'jsonb', (c) => c.notNull())
    .addColumn('source_system', 'text')
    .addColumn('plugin_id', 'text')
    .addColumn('plugin_version', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('fhir_resources_pkey', ['resource_type', 'id'])
    .execute();
}

export async function up(db: Kysely<any>): Promise<void> {
  await sql`create schema if not exists fhir`.execute(db);
  try {
    await sql`alter table public.fhir_resources set schema fhir`.execute(db);
  } catch {
    // Fallback path (pg-mem / engines without SET SCHEMA): recreate in fhir, copy, drop.
    await createFhirResourcesIn(db, 'fhir');
    const rows = await db.selectFrom('fhir_resources').select(COLUMNS as unknown as string[]).execute();
    if (rows.length > 0) {
      await db.insertInto('fhir.fhir_resources').values(rows).execute();
    }
    await db.schema.dropTable('fhir_resources').ifExists().execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await sql`alter table fhir.fhir_resources set schema public`.execute(db);
  } catch {
    await createFhirResourcesIn(db, 'public');
    const rows = await db.selectFrom('fhir.fhir_resources').select(COLUMNS as unknown as string[]).execute();
    if (rows.length > 0) {
      await db.insertInto('fhir_resources').values(rows).execute();
    }
    await db.schema.withSchema('fhir').dropTable('fhir_resources').ifExists().execute();
  }
  await sql`drop schema if exists fhir restrict`.execute(db).catch(() => undefined);
}
