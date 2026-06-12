import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(opts?: { level?: string; name?: string }): Logger {
  return pino({
    name: opts?.name ?? 'openldr',
    level: opts?.level ?? process.env.LOG_LEVEL ?? 'info',
  });
}
