import type { Config } from '@openldr/config';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import type { TargetEngine } from '@openldr/db';
import type { TargetStorePort } from '@openldr/ports';

export interface SelectedTargetStore {
  store: TargetStorePort & { close(): Promise<void> };
  engine: TargetEngine;
}

// The composition-root seam (DP-1): the only place that chooses a concrete target-store adapter.
// `engineOverride` lets the CLI `target-store test --engine` probe a specific engine.
export function selectTargetStore(cfg: Config, engineOverride?: TargetEngine): SelectedTargetStore {
  const engine: TargetEngine = engineOverride ?? (cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : 'postgres');
  if (engine === 'mssql') {
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
  return { engine, store: createDbStore({ url: cfg.TARGET_DATABASE_URL! }) };
}
