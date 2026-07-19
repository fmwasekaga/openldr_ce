import { describe, expect, it } from 'vitest';
import { sanitizeSyncError } from './activity';

describe('sanitizeSyncError', () => {
  it('redacts bearer tokens', () => {
    const out = sanitizeSyncError(new Error('POST failed with Authorization: Bearer abc123.def-456_GHI'));
    expect(out).not.toContain('abc123');
    expect(out).toContain('Bearer [redacted]');
  });

  it('redacts JWT-looking substrings', () => {
    const out = sanitizeSyncError(new Error('token eyJhbGciOiJIUzI1NiIsong.payloadpart.sigsig rejected'));
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiI');
    expect(out).toContain('[redacted-jwt]');
  });

  it('accepts non-Error values and caps length', () => {
    expect(sanitizeSyncError('plain string')).toBe('plain string');
    const long = 'x'.repeat(1000);
    expect(sanitizeSyncError(new Error(long)).length).toBeLessThanOrEqual(501);
  });
});
