import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { externalMigrations } from './migrations/external/index';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection.
// We run each external migration's up() function directly in order — same approach as
// migrations/internal/test-helpers.ts:makeMigratedDb.
export async function makeMigratedExternalDb(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const migration of Object.values(externalMigrations('postgres'))) {
    await migration.up(db);
  }
  return db;
}
