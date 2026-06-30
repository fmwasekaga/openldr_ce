import { MongoClient, type Db } from 'mongodb';

export interface MongoConn { db: Db; close(): Promise<void> }

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

/** Build a mongodb:// URI from discrete config (encoded creds, IPv6 brackets, optional authSource). */
export function buildMongoUri(config: Record<string, string>): string {
  const host = config.host ?? 'localhost';
  if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) throw new Error(`invalid connector host: ${host}`);
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const port = validatePort(config.port, 27017);
  const db = encodeURIComponent(config.database ?? '');
  const auth = config.user ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? '')}@` : '';
  const qs = config.authSource ? `?authSource=${encodeURIComponent(config.authSource)}` : '';
  return `mongodb://${auth}${hostPart}:${port}/${db}${qs}`;
}

/** Connect to a mongo connector; caller MUST close(). */
export async function createConnectorMongo(config: Record<string, string>): Promise<MongoConn> {
  const client = new MongoClient(buildMongoUri(config));
  await client.connect();
  return { db: client.db(config.database || undefined), close: () => client.close() };
}
