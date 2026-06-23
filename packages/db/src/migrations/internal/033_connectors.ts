import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('connectors')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('plugin_id', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull()) // the bound sink plugin's flavor, e.g. 'sink'
    // AES-256-GCM sealed JSON of the secret connection config (baseUrl/username/password).
    .addColumn('config_encrypted', 'text', (c) => c.notNull())
    // Derived from baseUrl, kept in clear so the host can pin egress without decrypting.
    .addColumn('allowed_host', 'text')
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('connectors').ifExists().execute();
}
