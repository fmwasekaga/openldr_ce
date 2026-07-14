import { type Kysely, sql } from 'kysely';

// Workflow secret store (SEC-06): encrypted at-rest store for workflow-definition secrets. Each row
// holds a sealed value (AES-256-GCM via @openldr/core seal/open); the plaintext NEVER lands here.
// Secrets are extracted from a workflow definition on save (→ 'wsec_<uuid>' refs) and resolved at
// use time. `workflow_id` groups a workflow's secrets so they can be GC'd / cascade-deleted together.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('workflow_secrets')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workflow_id', 'text', (c) => c.notNull())
    .addColumn('sealed_value', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('workflow_secrets_workflow_id_idx')
    .on('workflow_secrets')
    .column('workflow_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('workflow_secrets').execute();
}
