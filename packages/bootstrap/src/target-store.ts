import type { Config } from '@openldr/config';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import { createMysqlStore } from '@openldr/adapter-mysql-store';
import { ConfigError } from '@openldr/core';
import type { TargetEngine } from '@openldr/db';
import type { TargetStorePort } from '@openldr/ports';

export interface SelectedTargetStore {
  store: TargetStorePort & { close(): Promise<void> };
  engine: TargetEngine;
}

// The composition-root seam (DP-1): the only place that chooses a concrete target-store adapter.
// `engineOverride` lets the CLI `target-store test --engine` probe a specific engine.
export function selectTargetStore(cfg: Config, engineOverride?: TargetEngine): SelectedTargetStore {
  // Config's TARGET_STORE_ADAPTER is 'pg'|'mssql'|'mysql'; TargetEngine is 'postgres'|'mssql'|'mysql' — map 'pg'→'postgres'.
  const engine: TargetEngine = engineOverride ?? (
    cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql'
    : cfg.TARGET_STORE_ADAPTER === 'mysql' ? 'mysql'
    : 'postgres'
  );
  if (engine === 'mssql') {
    // loadConfig() guards these for adapter=mssql, but an explicit --engine mssql override can
    // reach here under a pg-validated config; fail with a readable message instead of a raw crash.
    const missing = (['MSSQL_HOST', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'] as const).filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new ConfigError(`mssql target store requires ${missing.join(', ')} (set TARGET_STORE_ADAPTER=mssql + the MSSQL_* vars)`);
    }
    return {
      engine,
      store: createMssqlStore({
        host: cfg.MSSQL_HOST!,
        port: cfg.MSSQL_PORT,
        database: cfg.MSSQL_DATABASE!,
        user: cfg.MSSQL_USER!,
        password: cfg.MSSQL_PASSWORD!,
        encrypt: cfg.MSSQL_ENCRYPT,
        trustServerCertificate: cfg.MSSQL_TRUST_SERVER_CERT,
      }),
    };
  }
  if (engine === 'mysql') {
    // loadConfig() guards these for adapter=mysql, but an explicit --engine mysql override can
    // reach here under a pg-validated config; fail with a readable message instead of a raw crash.
    const missing = (['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'] as const).filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new ConfigError(`mysql target store requires ${missing.join(', ')} (set TARGET_STORE_ADAPTER=mysql + the MYSQL_* vars)`);
    }
    return {
      engine,
      store: createMysqlStore({
        host: cfg.MYSQL_HOST!,
        port: cfg.MYSQL_PORT,
        database: cfg.MYSQL_DATABASE!,
        user: cfg.MYSQL_USER!,
        password: cfg.MYSQL_PASSWORD!,
        ssl: cfg.MYSQL_SSL,
        rejectUnauthorized: cfg.MYSQL_SSL_REJECT_UNAUTHORIZED,
      }),
    };
  }
  if (!cfg.TARGET_DATABASE_URL) {
    throw new ConfigError('postgres target store requires TARGET_DATABASE_URL');
  }
  return { engine, store: createDbStore({ url: cfg.TARGET_DATABASE_URL }) };
}
