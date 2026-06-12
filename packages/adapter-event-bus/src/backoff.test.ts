import { describe, it, expect } from 'vitest';
import { backoff } from './backoff';

describe('backoff', () => {
  it('grows exponentially and caps', () => {
    expect(backoff(1)).toBe(2000);
    expect(backoff(2)).toBe(4000);
    expect(backoff(3)).toBe(8000);
    expect(backoff(100)).toBe(300_000);
  });
});
