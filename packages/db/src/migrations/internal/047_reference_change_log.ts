import { type Kysely, sql } from 'kysely';

// Distributed sync S2: reference-data change-capture substrate. Central authors config
// (forms, dashboards, reports, settings) → these rows → labs pull them. Append-only log in
// the public/default schema (reference data is NOT FHIR, so it lives outside the `fhir` schema).
// Mirrors fhir.change_log's shape (bigserial seq cursor, content_hash, recorded_at default now()).

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('reference_change_log')
    .addColumn('seq', 'bigserial', (c) => c.primaryKey())
    .addColumn('entity_type', 'text', (c) => c.notNull())
    .addColumn('entity_id', 'text', (c) => c.notNull())
    .addColumn('op', 'text', (c) => c.notNull())
    .addColumn('content_hash', 'text')
    .addColumn('recorded_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('reference_change_log_entity_idx')
    .on('reference_change_log')
    .columns(['entity_type', 'entity_id', 'seq'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('reference_change_log').execute();
}
