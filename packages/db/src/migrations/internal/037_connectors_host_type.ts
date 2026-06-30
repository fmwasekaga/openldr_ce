import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('connectors').alterColumn('plugin_id', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('connectors').addColumn('type', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // NOT NULL on plugin_id is intentionally NOT restored: host rows have plugin_id=null and would violate it.
  await db.schema.alterTable('connectors').dropColumn('type').execute();
}
