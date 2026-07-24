import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('roles')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('role_capabilities')
    .ifNotExists()
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addColumn('capability', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('role_capabilities_pk', ['role_id', 'capability'])
    .execute();

  await db.schema
    .createTable('user_roles')
    .ifNotExists()
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('user_roles_pk', ['user_id', 'role_id'])
    .execute();

  await db.schema
    .createIndex('role_capabilities_role_idx').ifNotExists()
    .on('role_capabilities').column('role_id').execute();
  await db.schema
    .createIndex('user_roles_user_idx').ifNotExists()
    .on('user_roles').column('user_id').execute();

  // One-time backfill guard (see auth-plugin login backfill). Default false so
  // existing users get their token roles mapped to system roles on next login.
  await db.schema
    .alterTable('users')
    .addColumn('rbac_initialized', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('rbac_initialized').execute();
  await db.schema.dropTable('user_roles').ifExists().execute();
  await db.schema.dropTable('role_capabilities').ifExists().execute();
  await db.schema.dropTable('roles').ifExists().execute();
}
