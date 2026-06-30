import { sql, MysqlDialect, Kysely, type MysqlPool } from 'kysely';
import type { TargetSchema } from '@openldr/ports';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import { createPool } from 'mysql2';

/** A connector-backed DB connection: run one raw query, then close. */
export interface ConnectorDb {
  query(rawSql: string): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

export function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

export function buildPgUrl(config: Record<string, string>): string {
  const host = config.host ?? 'localhost';
  // hostname / IPv4, or IPv6 (raw or bracketed)
  if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) {
    throw new Error(`invalid connector host: ${host}`);
  }
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host; // bracket IPv6
  const port = validatePort(config.port, 5432);
  const user = encodeURIComponent(config.user ?? '');
  const pass = encodeURIComponent(config.password ?? '');
  const dbName = encodeURIComponent(config.database ?? '');
  const ssl = config.ssl === 'true' ? '?sslmode=require' : '';
  return `postgresql://${user}:${pass}@${hostPart}:${port}/${dbName}${ssl}`;
}

function wrap(store: { db: Kysely<TargetSchema>; close(): Promise<void> }): ConnectorDb {
  return {
    async query(rawSql) { const r = await sql.raw(rawSql).execute(store.db); return { rows: r.rows as Record<string, unknown>[] }; },
    close: () => store.close(),
  };
}

/** Build an ephemeral DB connection for a host connector by type + decrypted config.
 *  Caller MUST call close() (use try/finally). */
export function createConnectorDb(type: string, config: Record<string, string>): ConnectorDb {
  if (type === 'postgres') {
    return wrap(createDbStore({ url: buildPgUrl(config) }));
  }
  if (type === 'microsoft-sql') {
    return wrap(createMssqlStore({
      host: config.host ?? 'localhost',
      port: validatePort(config.port, 1433),
      database: config.database ?? '',
      user: config.user ?? '',
      password: config.password ?? '',
      encrypt: config.encrypt !== 'false',
      trustServerCertificate: config.trustServerCertificate === 'true',
    }));
  }
  if (type === 'mysql') {
    const port = validatePort(config.port, 3306);
    const host = config.host ?? 'localhost';
    if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) {
      throw new Error(`invalid connector host: ${host}`);
    }
    const pool = createPool({
      host, port, user: config.user ?? '', password: config.password ?? '', database: config.database ?? '',
      ...(config.ssl === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    // mysql2 callback Pool is runtime-correct for kysely (getConnection(callback)); cast bridges the structural type gap.
    const db = new Kysely<TargetSchema>({ dialect: new MysqlDialect({ pool: pool as unknown as MysqlPool }) });
    return wrap({ db, close: () => db.destroy() });
  }
  throw new Error(`unsupported connector type: ${type}`);
}
