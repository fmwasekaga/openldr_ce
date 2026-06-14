import { describe, it, expect } from 'vitest';
import { redactError } from './redact-error';

describe('redactError', () => {
  it('redacts a DSN password from an error message', () => {
    const err = new Error('connect ECONNREFUSED postgres://sa:S3cret@db:5432/openldr');
    expect(redactError(err)).toBe('connect ECONNREFUSED postgres://sa:***@db:5432/openldr');
  });
  it('redacts a Password= connection-string param from a driver error', () => {
    const err = new Error("Login failed (Server=db;User Id=sa;Password=S3cret!;)");
    expect(redactError(err)).not.toContain('S3cret!');
  });
  it('passes plain messages through unchanged', () => {
    expect(redactError(new Error('unknown report: x'))).toBe('unknown report: x');
  });
});
