import type Redis from 'ioredis';
import { createConnectorRedis } from './connector-redis';

export interface ConnectorRedisDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  make?: (config: Record<string, string>) => Redis;
}

export function createConnectorRedisRunner(deps: ConnectorRedisDeps) {
  const make = deps.make ?? createConnectorRedis;
  return async ({ connectorId, operation, key, value, ttlSeconds }: { connectorId: string; operation: string; key: string; value?: string; ttlSeconds?: number }): Promise<{ result: unknown }> => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (c.type !== 'redis') throw new Error(`connector ${connectorId} is not a redis connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const client = make(config);
    try {
      if (operation === 'set') {
        const result = ttlSeconds ? await client.set(key, value ?? '', 'EX', ttlSeconds) : await client.set(key, value ?? '');
        return { result };
      }
      if (operation === 'del') return { result: await client.del(key) };
      return { result: await client.get(key) };
    } finally {
      await client.quit();
    }
  };
}
