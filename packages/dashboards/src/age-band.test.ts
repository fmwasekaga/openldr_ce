import { describe, it, expect } from 'vitest';
import { minusYears, ageBandArms } from './age-band';
import type { AgeBandCompute } from './models/registry';

const compute: AgeBandCompute = {
  kind: 'age-band',
  bands: [{ maxAge: 4, label: '0-4' }, { maxAge: 14, label: '5-14' }, { maxAge: 24, label: '15-24' }, { maxAge: 49, label: '25-49' }],
  openEndedLabel: '50+', unknownLabel: 'unknown',
};

describe('minusYears', () => {
  it('subtracts whole years and returns YYYY-MM-DD', () => {
    expect(minusYears(new Date('2026-01-01T00:00:00Z'), 5)).toBe('2021-01-01');
    expect(minusYears(new Date('2026-03-15T00:00:00Z'), 50)).toBe('1976-03-15');
  });
});

describe('ageBandArms', () => {
  it('builds youngest→oldest arms with thresholds ref-(maxAge+1)y and ordered ranks', () => {
    const a = ageBandArms(compute, new Date('2026-01-01T00:00:00Z'));
    expect(a.refYMD).toBe('2026-01-01');
    expect(a.arms).toEqual([
      { thresholdYMD: '2021-01-01', label: '0-4', rank: 0 },
      { thresholdYMD: '2011-01-01', label: '5-14', rank: 1 },
      { thresholdYMD: '2001-01-01', label: '15-24', rank: 2 },
      { thresholdYMD: '1976-01-01', label: '25-49', rank: 3 },
    ]);
    expect(a.openEndedLabel).toBe('50+');
    expect(a.openEndedRank).toBe(4);
    expect(a.unknownLabel).toBe('unknown');
    expect(a.unknownRank).toBe(5);
  });
});
