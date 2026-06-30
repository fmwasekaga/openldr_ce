import Redis from 'ioredis';

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

/** Build a lazy ioredis client from connector config. Caller MUST quit(). */
export function createConnectorRedis(config: Record<string, string>): Redis {
  return new Redis({
    host: config.host || 'localhost',
    port: validatePort(config.port, 6379),
    password: config.password || undefined,
    db: config.db ? Number(config.db) : 0,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
}
