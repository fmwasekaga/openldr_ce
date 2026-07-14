import { type Kysely } from 'kysely';

// Distributed sync S3 (Layer B): bulk change-SIGNAL for terminology. Concept imports touch
// thousands of rows per operation; rather than logging one reference_change_log row per code we
// keep a per-code-system and per-concept-map `generation` counter, bumped ONCE per import-operation.
// The mark* helpers (terminology-sync.ts) increment it and emit a single deduped reference_change_log
// row (content_hash = the new generation). A lab pulling from central sees one signal per bump and
// bulk-transfers the whole system when its generation advances.
//
// `generation` is a plain `bigint DEFAULT 0` (NOT bigserial) — the mark* helpers set it explicitly.
// `managed_origin` mirrors 049's per-row central/local stamp for the concept_map_state registry and
// gives terminology_systems its own stamp (049 only covered the admin metadata tables).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('terminology_systems')
    .addColumn('generation', 'bigint', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable('terminology_systems').addColumn('managed_origin', 'text').execute();

  await db.schema
    .createTable('concept_map_state')
    .addColumn('map_url', 'text', (c) => c.primaryKey())
    .addColumn('generation', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('managed_origin', 'text')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concept_map_state').execute();
  await db.schema.alterTable('terminology_systems').dropColumn('managed_origin').execute();
  await db.schema.alterTable('terminology_systems').dropColumn('generation').execute();
}
