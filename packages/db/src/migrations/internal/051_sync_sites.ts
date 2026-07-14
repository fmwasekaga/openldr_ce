import { type Kysely, sql } from 'kysely';

// Distributed sync S4d: central-side registry of enrolled labs. One row per site: its site_id,
// the Keycloak client_id minted for it, who/when enrolled, and an active/revoked status. This table
// NEVER stores the client secret — the secret is returned once at enroll/rotate time and never
// persisted. The enrollment orchestrator (Task 4) writes here alongside ctx.auth.clients.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_sites')
    .addColumn('site_id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('client_id', 'text', (c) => c.notNull())
    .addColumn('enrolled_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('enrolled_by', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_sites').execute();
}
