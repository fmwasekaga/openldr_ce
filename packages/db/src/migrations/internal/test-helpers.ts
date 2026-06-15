import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './index';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection.
// We run each migration's up() function directly in order — same structure used by
// packages/dashboards/src/store.test.ts and other pg-mem tests in this repo.
export async function makeMigratedDb(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}
