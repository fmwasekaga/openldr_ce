import type { Config } from '@openldr/config';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
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
  // Config's TARGET_STORE_ADAPTER is 'pg'|'mssql'; TargetEngine is 'postgres'|'mssql' — map 'pg'→'postgres'.
  const engine: TargetEngine = engineOverride ?? (cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : 'postgres');
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
  if (!cfg.TARGET_DATABASE_URL) {
    throw new ConfigError('postgres target store requires TARGET_DATABASE_URL');
  }
  return { engine, store: createDbStore({ url: cfg.TARGET_DATABASE_URL }) };
}
