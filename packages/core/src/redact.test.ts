import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('masks credentials in connection strings', () => {
    expect(redact('postgres://user:s3cret@db:5432/x')).toBe('postgres://user:***@db:5432/x');
  });
  it('leaves plain text untouched', () => {
    expect(redact('connection refused')).toBe('connection refused');
  });
  it('masks passwords that contain a slash', () => {
    expect(redact('postgres://user:pa/ss@db/x')).toBe('postgres://user:***@db/x');
  });
  it('does not mask a bare host:port', () => {
    expect(redact('connect to localhost:5432 failed')).toBe('connect to localhost:5432 failed');
  });
});
