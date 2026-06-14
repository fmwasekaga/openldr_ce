import { pino, type Logger } from 'pino';

export type { Logger };

// Keys whose values may carry secrets (DSNs, passwords, tokens, S3 keys). pino redacts any
// log object property matching these paths. The plain key (e.g. `password`) catches a
// top-level property; the `*.` form (e.g. `*.password`) catches it one nesting level deep.
export const redactPaths = [
  'password', '*.password',
  'pwd', '*.pwd',
  'connectionString', '*.connectionString',
  'secretAccessKey', '*.secretAccessKey',
  'accessKeyId', '*.accessKeyId',
  'authorization', '*.authorization', 'Authorization', '*.Authorization',
];

export function createLogger(opts?: { level?: string; name?: string }): Logger {
  return pino({
    name: opts?.name ?? 'openldr',
    level: opts?.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: redactPaths, censor: '[redacted]' },
  });
}
