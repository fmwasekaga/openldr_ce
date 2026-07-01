import { createConnectorDb, type ConnectorDb } from './connector-db';
import { createConnectorMongo, type MongoConn } from './connector-mongo';
import { createConnectorRedis } from './connector-redis';
import { createEmailTransport } from './connector-email';
import { connectSftp } from './connector-sftp-service';
import type Redis from 'ioredis';

const SQL_TYPES = new Set(['postgres', 'microsoft-sql', 'mysql']);
const EMAIL_TYPES = new Set(['smtp', 'gmail', 'outlook']);

export interface ConnectorTestDeps {
  sqlDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  mongo?: (config: Record<string, string>) => Promise<MongoConn>;
  redis?: (config: Record<string, string>) => Redis;
  email?: (type: string, config: Record<string, string>) => { verify(): Promise<unknown>; close(): void };
  sftp?: (config: Record<string, string>) => Promise<{ list(p: string): Promise<unknown>; end(): Promise<void> }>;
  imap?: (config: Record<string, string>) => { connect(): Promise<void>; logout(): Promise<void>; getMailboxLock(f: string): Promise<{ release(): void }> };
}

/** Probe a host connector by type (SELECT 1 / mongo ping / redis PING). Throws on failure; always closes. */
export async function testConnector(type: string, config: Record<string, string>, deps: ConnectorTestDeps = {}): Promise<void> {
  if (SQL_TYPES.has(type)) {
    const conn = (deps.sqlDb ?? createConnectorDb)(type, config);
    try { await conn.query('select 1'); } finally { await conn.close(); }
    return;
  }
  if (type === 'mongodb') {
    const conn = await (deps.mongo ?? createConnectorMongo)(config);
    try { await conn.db.command({ ping: 1 }); } finally { await conn.close(); }
    return;
  }
  if (type === 'redis') {
    const client = (deps.redis ?? createConnectorRedis)(config);
    try { await client.ping(); } finally { await client.quit(); }
    return;
  }
  if (EMAIL_TYPES.has(type)) {
    const transport = (deps.email ?? ((t, c) => createEmailTransport(t, c) as unknown as { verify(): Promise<unknown>; close(): void }))(type, config);
    try { await transport.verify(); } finally { transport.close(); }
    return;
  }
  if (type === 'sftp') {
    const client = await (deps.sftp ?? (connectSftp as unknown as (c: Record<string, string>) => Promise<{ list(p: string): Promise<unknown>; end(): Promise<void> }>))(config);
    try { await client.list('.'); } finally { await client.end(); }
    return;
  }
  if (type === 'imap') {
    const { ImapFlow } = await import('imapflow');
    const client = (deps.imap ?? ((c) => new ImapFlow({ host: c.host ?? 'localhost', port: Number(c.port ?? 993), secure: c.tls !== 'false', auth: { user: c.user ?? '', pass: c.password ?? '' }, logger: false }) as unknown as { connect(): Promise<void>; logout(): Promise<void>; getMailboxLock(f: string): Promise<{ release(): void }> }))(config);
    await client.connect();
    try { const lock = await client.getMailboxLock('INBOX'); lock.release(); } finally { await client.logout(); }
    return;
  }
  throw new Error(`unsupported connector type: ${type}`);
}
