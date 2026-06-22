import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('plugins').addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true)).execute();
  await db.schema.alterTable('plugins').addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true)).execute();
  await db.schema.alterTable('plugins').addColumn('approved_by', 'text').execute();
  await db.schema.alterTable('plugins').addColumn('granted_at', 'timestamptz').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('plugins').dropColumn('granted_at').execute();
  await db.schema.alterTable('plugins').dropColumn('approved_by').execute();
  await db.schema.alterTable('plugins').dropColumn('active').execute();
  await db.schema.alterTable('plugins').dropColumn('enabled').execute();
}
