import { Kysely } from 'kysely';
import type { MigrationResultSet } from 'kysely';
import type { Config } from '@openldr/config';
import { createLogger, ConfigError } from '@openldr/core';
import type { TargetStorePort } from '@openldr/ports';
import { selectTargetStore } from './target-store';
import {
  createInternalDb,
  createFhirStore,
  createFlatWriter,
  createMigrator,
  migrateAllDown,
  persistResource,
  internalMigrations,
  externalMigrations,
  type InternalSchema,
  type ExternalSchema,
  type FhirStore,
  type FlatWriter,
  type Provenance,
  type PersistResult,
} from '@openldr/db';

export interface DbContext {
  internalDb: Kysely<InternalSchema>;
  externalStore: TargetStorePort;
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  persist(resource: unknown, prov?: Provenance): Promise<PersistResult>;
  migrateAll(): Promise<{ internal: MigrationResultSet; external: MigrationResultSet }>;
  reset(opts?: { force?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function createDbContext(cfg: Config): Promise<DbContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const { store: externalStore, engine } = selectTargetStore(cfg);
  const externalDb = externalStore.db as unknown as Kysely<ExternalSchema>;

  const fhirStore = createFhirStore(internal.db);
  const flatWriter = createFlatWriter(externalDb, engine);
  const internalMigrator = createMigrator(internal.db, internalMigrations);
  const externalMigrator = createMigrator(externalDb, externalMigrations(engine));

  return {
    internalDb: internal.db,
    externalStore,
    fhirStore,
    flatWriter,
    persist: (resource, prov) => persistResource({ fhirStore, flatWriter, logger }, resource, prov),
    async migrateAll() {
      const internalRes = await internalMigrator.migrateToLatest();
      const externalRes = await externalMigrator.migrateToLatest();
      return { internal: internalRes, external: externalRes };
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
