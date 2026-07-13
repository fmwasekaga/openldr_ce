import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

// v2-core read-model tables (R3a), engine-aware. Mirrors 001_flat_tables' withCommon so PG/MSSQL/
// MySQL emit valid DDL from one definition. FHIR-id keyed; provenance columns; no enforced FKs.
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
  const float = sql.raw(floatType(engine));

  await withCommon(
    db.schema.createTable('v2_patients').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('patient_guid', text)
      .addColumn('surname', text)
      .addColumn('firstname', text)
      .addColumn('date_of_birth', text)
      .addColumn('sex', text)
      .addColumn('national_id', text)
      .addColumn('phone', text)
      .addColumn('email', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('v2_lab_requests').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('request_id', text)
      .addColumn('patient_id', text)
      .addColumn('panel_code', text)
      .addColumn('panel_system', text)
      .addColumn('panel_desc', text)
      .addColumn('status', text)
      .addColumn('priority', text)
      .addColumn('authored_at', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('v2_lab_results').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('request_id', text)
      .addColumn('observation_code', text)
      .addColumn('observation_system', text)
      .addColumn('observation_desc', text)
      .addColumn('result_type', text)
      .addColumn('numeric_value', float)
      .addColumn('numeric_units', text)
      .addColumn('coded_value', text)
      .addColumn('text_value', text)
      .addColumn('abnormal_flag', text)
      .addColumn('result_timestamp', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('v2_facilities').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('facility_code', text)
      .addColumn('facility_name', text)
      .addColumn('facility_type', text)
      .addColumn('source_resource', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['v2_patients', 'v2_lab_requests', 'v2_lab_results', 'v2_facilities']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
