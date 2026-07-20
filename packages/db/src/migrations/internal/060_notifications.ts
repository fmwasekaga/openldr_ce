import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Per-user read state. The reserved id '__cursor__' holds the mark-all-read
  // watermark: any notification with created_at <= its read_at is read.
  await db.schema
    .createTable('notification_reads')
    .ifNotExists()
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('notification_id', 'text', (c) => c.notNull())
    .addColumn('read_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('notification_reads_pk', ['user_id', 'notification_id'])
    .execute();

  // Per-user preferences. Absence of a (user_id, type) row = enabled. The reserved
  // type '__min_priority__' stores the floor in `value` ('info'|'warning'|'critical').
  await db.schema
    .createTable('notification_prefs')
    .ifNotExists()
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean')
    .addColumn('value', 'text')
    .addPrimaryKeyConstraint('notification_prefs_pk', ['user_id', 'type'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('notification_prefs').ifExists().execute();
  await db.schema.dropTable('notification_reads').ifExists().execute();
}
