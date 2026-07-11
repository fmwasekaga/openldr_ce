import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  let built = b
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  // Pin the table storage charset to utf8mb4 explicitly. Without this, Unicode integrity
  // (CJK, emoji, any non-BMP clinical text) depends entirely on the server's default charset
  // (character-set-server), which self-hosted MySQL/MariaDB installs may set to latin1/utf8mb3.
  // No explicit COLLATE: MySQL 8.4's default utf8mb4 collation (utf8mb4_0900_ai_ci) doesn't
  // exist on MariaDB, so pinning a specific collation would break portability across engines.
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  // SQL Server has no CREATE TABLE ... IF NOT EXISTS; the Kysely migrator already guarantees
  // each migration runs once, so ifNotExists is only a Postgres convenience.
  return engine === 'postgres' ? built.ifNotExists() : built;
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  const float = sql.raw(floatType(engine));

  await withCommon(
    db.schema.createTable('patients').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_system', text)
      .addColumn('identifier_value', text)
      .addColumn('family_name', text)
      .addColumn('given_name', text)
      .addColumn('gender', text)
      .addColumn('birth_date', text)
      .addColumn('managing_organization', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('specimens').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('accession', text)
      .addColumn('status', text)
      .addColumn('type_code', text)
      .addColumn('type_text', text)
      .addColumn('subject_ref', text)
      .addColumn('parent_ref', text)
      .addColumn('received_time', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('service_requests').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('intent', text)
      .addColumn('priority', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('subject_ref', text)
      .addColumn('authored_on', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('diagnostic_reports').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('subject_ref', text)
      .addColumn('effective_date_time', text)
      .addColumn('issued', text)
      .addColumn('conclusion', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('observations').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('subject_ref', text)
      .addColumn('specimen_ref', text)
      .addColumn('value_quantity', float)
      .addColumn('value_unit', text)
      .addColumn('value_code', text)
      .addColumn('value_text', text)
      .addColumn('interpretation_code', text)
      .addColumn('effective_date_time', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('organizations').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('name', text)
      .addColumn('type_text', text)
      .addColumn('part_of_ref', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('locations').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('name', text)
      .addColumn('type_text', text)
      .addColumn('managing_organization', text)
      .addColumn('part_of_ref', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['patients', 'specimens', 'service_requests', 'diagnostic_reports', 'observations', 'organizations', 'locations']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
