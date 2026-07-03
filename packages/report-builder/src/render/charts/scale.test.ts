import { describe, it, expect } from 'vitest';
import { linearScale, niceTicks } from './scale';

describe('linearScale', () => {
  it('maps domain endpoints to range endpoints', () => {
    const s = linearScale(0, 100, 0, 200);
    expect(s(0)).toBe(0);
    expect(s(100)).toBe(200);
    expect(s(50)).toBe(100);
  });
  it('handles a zero-width domain without NaN (maps to range start)', () => {
    const s = linearScale(5, 5, 0, 200);
    expect(Number.isNaN(s(5))).toBe(false);
  });
});

describe('niceTicks', () => {
  it('returns rounded, ascending ticks spanning the max', () => {
    const ticks = niceTicks(0, 95, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(95);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });
  it('never returns a single tick for a positive max', () => {
    expect(niceTicks(0, 10, 5).length).toBeGreaterThanOrEqual(2);
  });
});
