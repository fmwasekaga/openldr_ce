import { type Kysely, type CreateTableBuilder, sql } from 'kysely';

function withCommon(b: CreateTableBuilder<string, never>): CreateTableBuilder<string, never> {
  return b
    .addColumn('source_system', 'text')
    .addColumn('plugin_id', 'text')
    .addColumn('plugin_version', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`));
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await withCommon(
    db.schema
      .createTable('patients')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_system', 'text')
      .addColumn('identifier_value', 'text')
      .addColumn('family_name', 'text')
      .addColumn('given_name', 'text')
      .addColumn('gender', 'text')
      .addColumn('birth_date', 'text')
      .addColumn('managing_organization', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('specimens')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('accession', 'text')
      .addColumn('status', 'text')
      .addColumn('type_code', 'text')
      .addColumn('type_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('parent_ref', 'text')
      .addColumn('received_time', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('service_requests')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('intent', 'text')
      .addColumn('priority', 'text')
      .addColumn('code_code', 'text')
      .addColumn('code_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('authored_on', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('diagnostic_reports')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('code_code', 'text')
      .addColumn('code_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('effective_date_time', 'text')
      .addColumn('issued', 'text')
      .addColumn('conclusion', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('observations')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('code_code', 'text')
      .addColumn('code_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('specimen_ref', 'text')
      .addColumn('value_quantity', 'double precision')
      .addColumn('value_unit', 'text')
      .addColumn('value_code', 'text')
      .addColumn('value_text', 'text')
      .addColumn('interpretation_code', 'text')
      .addColumn('effective_date_time', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('organizations')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('name', 'text')
      .addColumn('type_text', 'text')
      .addColumn('part_of_ref', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('locations')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('name', 'text')
      .addColumn('type_text', 'text')
      .addColumn('managing_organization', 'text')
      .addColumn('part_of_ref', 'text'),
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['patients', 'specimens', 'service_requests', 'diagnostic_reports', 'observations', 'organizations', 'locations']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
