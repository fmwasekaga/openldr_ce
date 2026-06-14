import { errorMessage, redact } from '@openldr/core';

/**
 * Single CLI error-formatting boundary: stringify an unknown error, then redact secrets.
 * Pattern-based redaction (DSN userinfo, Authorization headers, password=/pwd=) covers
 * driver errors that echo a connection string. Use everywhere the CLI prints an error.
 */
export function redactError(err: unknown): string {
  return redact(errorMessage(err));
}
