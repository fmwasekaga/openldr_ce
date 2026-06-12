import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

export interface DbStoreConfig {
  url: string;
}

export interface DbStoreDeps {
  pool?: pg.Pool;
}

export interface DbStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createDbStore(cfg: DbStoreConfig, deps: DbStoreDeps = {}): DbStore {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });
  const db = new Kysely<TargetSchema>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    async transaction(fn) {
      return db.transaction().execute(fn);
    },
    async healthCheck() {
      return probe(async () => {
        await pool.query('select 1');
      });
    },
    async close() {
      await db.destroy();
    },
  };
}
