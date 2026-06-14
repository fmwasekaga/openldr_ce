import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dhis2_orgunit_map')
    .ifNotExists()
    .addColumn('facility_id', 'text', (c) => c.primaryKey())
    .addColumn('orgunit_id', 'text', (c) => c.notNull())
    .addColumn('orgunit_name', 'text')
    .execute();

  await db.schema
    .createTable('dhis2_mappings')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('definition', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dhis2_mappings').ifExists().execute();
  await db.schema.dropTable('dhis2_orgunit_map').ifExists().execute();
}
