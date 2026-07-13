import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// v2-specimen/diagnostic-report read-model tables (R3c), engine-aware. Mirrors 003_v2_core's
// withCommon so PG/MSSQL/MySQL emit valid DDL from one definition.
function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  let built = b
    .addColumn('source_system', text).addColumn('plugin_id', text).addColumn('plugin_version', text).addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  return engine === 'postgres' ? built.ifNotExists() : built;
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  await withCommon(
    db.schema.createTable('v2_specimens').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('patient_id', text)
      .addColumn('received_time', text)
      .addColumn('accession', text)
      .addColumn('status', text)
      .addColumn('type_code', text)
      .addColumn('type_text', text),
    engine,
  ).execute();
  await withCommon(
    db.schema.createTable('v2_diagnostic_reports').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('patient_id', text)
      .addColumn('status', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('issued', text)
      .addColumn('effective', text)
      .addColumn('conclusion', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['v2_specimens', 'v2_diagnostic_reports']) await db.schema.dropTable(t).ifExists().execute();
}
