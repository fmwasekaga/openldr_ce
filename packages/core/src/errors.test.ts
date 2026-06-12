import { describe, it, expect } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('returns the message for a normal error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to the error name when message is empty', () => {
    const e = new Error('');
    e.name = 'TimeoutError';
    expect(errorMessage(e)).toBe('TimeoutError');
  });

  it('appends the cause message when present and distinct', () => {
    const e = new Error('request failed', { cause: new Error('ECONNREFUSED') });
    expect(errorMessage(e)).toBe('request failed: ECONNREFUSED');
  });

  it('stringifies non-Error throws', () => {
    expect(errorMessage('plain string')).toBe('plain string');
  });
});
