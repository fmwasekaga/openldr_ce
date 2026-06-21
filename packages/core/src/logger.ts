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

/**
 * Redacts the value of the `access_token` query parameter from a URL string.
 * Handles it appearing as `?access_token=...` or `&access_token=...`.
 * All other query parameters are preserved unchanged.
 */
export function redactUrl(url: string): string {
  return url.replace(/(?<=[?&]access_token=)[^&]*/g, '[REDACTED]');
}

export function createLogger(opts?: { level?: string; name?: string }): Logger {
  return pino({
    name: opts?.name ?? 'openldr',
    level: opts?.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: redactPaths, censor: '[redacted]' },
    serializers: {
      // Fastify's default req serializer logs req.url verbatim, exposing any
      // `access_token` query parameter value. This override redacts it before
      // the value reaches the log stream. Fastify merges loggerInstance.serializers
      // (via pino[serializersSym]) into the child logger it creates — so this
      // serializer wins over Fastify's built-in default.
      req(req: { method?: string; url?: string; host?: string; ip?: string; socket?: { remotePort?: number }; headers?: Record<string, string> }) {
        return {
          method: req.method,
          url: req.url != null ? redactUrl(req.url) : req.url,
          version: req.headers?.['accept-version'],
          host: req.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
  });
}
