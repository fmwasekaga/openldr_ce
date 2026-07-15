import { Kysely } from 'kysely';
import type { MigrationResultSet } from 'kysely';
import type { Config } from '@openldr/config';
import { createLogger, ConfigError, type Logger } from '@openldr/core';
import type { TargetStorePort } from '@openldr/ports';
import { selectTargetStore } from './target-store';
import {
  createInternalDb,
  createFhirStore,
  createRelationalWriter,
  createMigrator,
  migrateAllDown,
  persistResource,
  internalMigrations,
  externalMigrations,
  type InternalSchema,
  type ExternalSchema,
  type FhirStore,
  type RelationalWriter,
  type Provenance,
  type PersistResult,
} from '@openldr/db';

export interface DbContext {
  internalDb: Kysely<InternalSchema>;
  externalStore: TargetStorePort;
  fhirStore: FhirStore;
  relationalWriter: RelationalWriter;
  logger: Logger;
  persist(resource: unknown, prov?: Provenance): Promise<PersistResult>;
  migrateAll(): Promise<{ internal: MigrationResultSet; external: MigrationResultSet }>;
  /** Names of migrations that exist in code but have not run against the database yet. */
  pendingMigrations(): Promise<{ internal: string[]; external: string[] }>;
  reset(opts?: { force?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function createDbContext(cfg: Config): Promise<DbContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const { store: externalStore, engine } = selectTargetStore(cfg);
  const externalDb = externalStore.db as unknown as Kysely<ExternalSchema>;

  const fhirStore = createFhirStore(internal.db);
  const relationalWriter = createRelationalWriter(externalDb, engine);
  const internalMigrator = createMigrator(internal.db, internalMigrations);
  const externalMigrator = createMigrator(externalDb, externalMigrations(engine));

  return {
    internalDb: internal.db,
    externalStore,
    fhirStore,
    relationalWriter,
    logger,
    persist: (resource, prov) => persistResource({ fhirStore, logger }, resource, prov),
    async migrateAll() {
      const internalRes = await internalMigrator.migrateToLatest();
      const externalRes = await externalMigrator.migrateToLatest();
      return { internal: internalRes, external: externalRes };
    },
    // Read-only sibling of migrateAll: a migration kysely knows about but has no
    // `executedAt` has not run yet. Reuses the migrator handles, so it opens no connections.
    async pendingMigrations() {
      const namesOf = async (migrator: typeof internalMigrator) =>
        (await migrator.getMigrations()).filter((m) => !m.executedAt).map((m) => m.name);
      return { internal: await namesOf(internalMigrator), external: await namesOf(externalMigrator) };
    },
    async reset(opts = {}) {
      if (cfg.NODE_ENV === 'production' && !opts.force) {
        throw new ConfigError('db reset refused in production without force');
      }
      await migrateAllDown(internalMigrator);
      await migrateAllDown(externalMigrator);
      await internalMigrator.migrateToLatest();
      await externalMigrator.migrateToLatest();
    },
    async close() {
      await Promise.allSettled([internal.close(), externalStore.close()]);
    },
  };
}
