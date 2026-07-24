import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// questionnaire_responses read-model table, engine-aware. Mirrors 003_v2_core's withCommon so
// PG/MSSQL/MySQL emit valid DDL from one definition. FHIR-id keyed; provenance columns; no
// enforced FKs. `items` is a plain text column holding a JSON string (portable across engines).
function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  let built = b
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  return engine === 'postgres' ? built.ifNotExists() : built;
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  await withCommon(
    db.schema.createTable('questionnaire_responses').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('questionnaire', text)
      .addColumn('form_code', text)
      .addColumn('subject_id', text)
      .addColumn('authored', text)
      .addColumn('based_on_id', text)
      .addColumn('items', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('questionnaire_responses').ifExists().execute();
}
