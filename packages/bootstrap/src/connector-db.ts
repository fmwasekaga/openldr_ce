import { sql } from 'kysely';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';

/** A connector-backed DB connection: run one raw query, then close. */
export interface ConnectorDb {
  query(rawSql: string): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

/** Build an ephemeral DB connection for a host connector by type + decrypted config.
 *  Caller MUST call close() (use try/finally). */
export function createConnectorDb(type: string, config: Record<string, string>): ConnectorDb {
  if (type === 'postgres') {
    const ssl = config.ssl === 'true';
    const url = `postgresql://${encodeURIComponent(config.user ?? '')}:${encodeURIComponent(config.password ?? '')}@${config.host ?? 'localhost'}:${config.port ?? '5432'}/${encodeURIComponent(config.database ?? '')}${ssl ? '?sslmode=require' : ''}`;
    const store = createDbStore({ url });
    return {
      async query(rawSql) { const r = await sql.raw(rawSql).execute(store.db); return { rows: r.rows as Record<string, unknown>[] }; },
      close: () => store.close(),
    };
  }
  if (type === 'microsoft-sql') {
    const store = createMssqlStore({
      host: config.host ?? 'localhost',
      port: Number(config.port ?? 1433),
      database: config.database ?? '',
      user: config.user ?? '',
      password: config.password ?? '',
      encrypt: config.encrypt !== 'false',
      trustServerCertificate: config.trustServerCertificate === 'true',
    });
    return {
      async query(rawSql) { const r = await sql.raw(rawSql).execute(store.db); return { rows: r.rows as Record<string, unknown>[] }; },
      close: () => store.close(),
    };
  }
  throw new Error(`unsupported connector type: ${type}`);
}
