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

  it('surfaces the first non-empty inner error of an AggregateError', () => {
    const e = new AggregateError(
      [new Error('ECONNREFUSED 127.0.0.1:9000'), new Error('ETIMEDOUT')],
      '',
    );
    expect(errorMessage(e)).toBe('AggregateError: ECONNREFUSED 127.0.0.1:9000');
  });

  it('skips empty inner messages and surfaces the first with content', () => {
    const e = new AggregateError([new Error(''), new Error('ECONNREFUSED')], '');
    expect(errorMessage(e)).toBe('AggregateError: ECONNREFUSED');
  });

  it('falls back to the name when all inner messages are empty', () => {
    const e = new AggregateError([new Error(''), new Error('')], '');
    expect(errorMessage(e)).toBe('AggregateError');
  });

  it('stringifies non-Error throws', () => {
    expect(errorMessage('plain string')).toBe('plain string');
  });
});
