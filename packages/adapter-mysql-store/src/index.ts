import { Kysely, MysqlDialect, sql, type MysqlPool } from 'kysely';
import { createPool } from 'mysql2';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

export interface MysqlStoreConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface MysqlStoreDeps {
  // Injectable health probe for unit tests; defaults to `select 1` over the real connection.
  ping?: () => Promise<void>;
}

export interface MysqlStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createMysqlStore(cfg: MysqlStoreConfig, deps: MysqlStoreDeps = {}): MysqlStore {
  const pool = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  // mysql2 callback Pool is runtime-correct for kysely (getConnection(callback)); cast bridges the structural type gap.
  const db = new Kysely<TargetSchema>({ dialect: new MysqlDialect({ pool: pool as unknown as MysqlPool }) });
  const ping = deps.ping ?? (async () => { await sql`select 1`.execute(db); });

  return {
    db,
    async transaction(fn) {
      return db.transaction().execute(fn);
    },
    async healthCheck() {
      return probe(ping);
    },
    async close() {
      await db.destroy();
    },
  };
}

export {
  SUPPORTED_MYSQL_VERSIONS,
  isSupportedMysqlEngine,
  demoMysqlImage,
  type MysqlEngineVersion,
} from './supported-versions';
