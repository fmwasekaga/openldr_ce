import { describe, it, expect } from 'vitest';
import { nextCronDate } from './cron';

describe('nextCronDate', () => {
  it('computes the next run after a given instant', () => {
    const after = new Date('2026-01-01T08:00:00Z');
    const next = nextCronDate('0 9 * * *', 'UTC', after);
    expect(next.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });
  it('throws on an invalid expression', () => {
    expect(() => nextCronDate('not a cron', 'UTC', new Date())).toThrow();
  });
});
