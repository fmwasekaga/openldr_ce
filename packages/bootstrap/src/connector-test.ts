import { createConnectorDb, type ConnectorDb } from './connector-db';
import { createConnectorMongo, type MongoConn } from './connector-mongo';
import { createConnectorRedis } from './connector-redis';
import type Redis from 'ioredis';

const SQL_TYPES = new Set(['postgres', 'microsoft-sql', 'mysql']);

export interface ConnectorTestDeps {
  sqlDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  mongo?: (config: Record<string, string>) => Promise<MongoConn>;
  redis?: (config: Record<string, string>) => Redis;
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
  throw new Error(`unsupported connector type: ${type}`);
}
