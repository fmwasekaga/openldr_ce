import { Migrator, type Kysely, type Migration } from 'kysely';

// `db: Kysely<any>` — Kysely's DB generic is invariant, so a schema-typed Kysely is not
// assignable to Kysely<unknown>; the migrator is schema-agnostic, so accept any.
export function createMigrator(db: Kysely<any>, migrations: Record<string, Migration>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
}

/** Migrate a database down to empty (used by `db reset`). */
export async function migrateAllDown(migrator: Migrator): Promise<void> {
  for (;;) {
    const { results, error } = await migrator.migrateDown();
    if (error) throw error;
    if (!results || results.length === 0) break;
  }
}
