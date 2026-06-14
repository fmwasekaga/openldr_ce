import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { redactPaths } from './logger';

// Drive a pino logger with our redact paths into an in-memory stream and assert masking.
// (Return type is inferred — pino(opts, stream) yields a more specific Logger than the
// zero-arg ReturnType<typeof pino>, so an explicit annotation would mis-constrain it.)
function capture() {
  const chunks: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  const logger = pino({ redact: { paths: redactPaths, censor: '[redacted]' } }, stream);
  return { logger, lines: () => chunks.filter(Boolean).map((l) => JSON.parse(l)) };
}

describe('logger redaction', () => {
  it('redacts a password key', () => {
    const { logger, lines } = capture();
    logger.error({ config: { password: 'hunter2' } }, 'boom');
    expect(JSON.stringify(lines())).not.toContain('hunter2');
    expect(JSON.stringify(lines())).toContain('[redacted]');
  });
  it('redacts a connectionString key', () => {
    const { logger, lines } = capture();
    logger.error({ connectionString: 'postgres://u:p@h/db' }, 'boom');
    expect(JSON.stringify(lines())).not.toContain('postgres://u:p@h/db');
  });
});
