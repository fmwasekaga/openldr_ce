import { Kysely, MssqlDialect, sql } from 'kysely';
import * as tarn from 'tarn';
import * as tedious from 'tedious';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

export interface MssqlStoreConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface MssqlStoreDeps {
  // Injectable health probe for unit tests; defaults to `select 1` over the real connection.
  ping?: () => Promise<void>;
}

export interface MssqlStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createMssqlStore(cfg: MssqlStoreConfig, deps: MssqlStoreDeps = {}): MssqlStore {
  const dialect = new MssqlDialect({
    tarn: { ...tarn, options: { min: 0, max: 10 } },
    tedious: {
      ...tedious,
      connectionFactory: () =>
        new tedious.Connection({
          server: cfg.host,
          authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
          options: {
            port: cfg.port,
            database: cfg.database,
            encrypt: cfg.encrypt,
            trustServerCertificate: cfg.trustServerCertificate,
          },
        }),
    },
  });
  const db = new Kysely<TargetSchema>({ dialect });
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
  SUPPORTED_MSSQL_VERSIONS,
  MIN_SUPPORTED_MSSQL_MAJOR,
  isSupportedMssqlVersion,
  demoMssqlImage,
  type MssqlVersion,
} from './supported-versions';
