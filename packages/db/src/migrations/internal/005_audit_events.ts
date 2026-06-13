import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('audit_events')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('occurred_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('actor_type', 'text', (c) => c.notNull())
    .addColumn('actor_id', 'text')
    .addColumn('actor_name', 'text', (c) => c.notNull())
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('entity_type', 'text', (c) => c.notNull())
    .addColumn('entity_id', 'text', (c) => c.notNull())
    .addColumn('before', 'jsonb')
    .addColumn('after', 'jsonb')
    .addColumn('metadata', 'jsonb')
    .execute();
  await db.schema.createIndex('audit_events_occurred_idx').ifNotExists().on('audit_events').column('occurred_at').execute();
  await db.schema.createIndex('audit_events_entity_idx').ifNotExists().on('audit_events').columns(['entity_type', 'entity_id']).execute();
  await db.schema.createIndex('audit_events_actor_idx').ifNotExists().on('audit_events').column('actor_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_events').ifExists().execute();
}
