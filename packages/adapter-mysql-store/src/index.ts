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
  /** When ssl is on, verify the server certificate chain. Defaults to false because on-prem
   *  MySQL/MariaDB commonly uses self-signed certs (mirrors MSSQL's trustServerCertificate default).
   *  Set true to enforce strict TLS verification against a CA-signed cert. */
  rejectUnauthorized?: boolean;
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
    // Belt-and-suspenders alongside the utf8mb4 table charset pinned in the migration DDL:
    // ensures the client<->server connection itself negotiates utf8mb4, independent of the
    // server's default charset/collation. mysql2 requires a specific charset/collation name
    // (not the bare charset family) here; utf8mb4_unicode_ci is supported by both MySQL and
    // MariaDB (unlike MySQL 8's utf8mb4_0900_ai_ci default), matching the DDL's portability
    // stance of pinning charset without a MySQL-8-only collation. This is also mysql2's own
    // built-in default charsetNumber, so this makes that default explicit rather than implicit.
    charset: 'UTF8MB4_UNICODE_CI',
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: cfg.rejectUnauthorized ?? false } } : {}),
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
