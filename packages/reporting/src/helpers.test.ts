import { describe, it, expect } from 'vitest';
import { pivotResistance, ageBand, monthKey, hoursBetween, toCsv } from './helpers';

describe('pivotResistance', () => {
  it('sums per antibiotic and computes %R sorted desc', () => {
    const out = pivotResistance([
      { antibiotic: 'AMP', interpretation_code: 'R', n: 3 },
      { antibiotic: 'AMP', interpretation_code: 'S', n: 1 },
      { antibiotic: 'CIP', interpretation_code: 'S', n: 4 },
    ]);
    expect(out[0]).toMatchObject({ antibiotic: 'AMP', tested: 4, r: 3, s: 1, percentR: 75 });
    expect(out[1]).toMatchObject({ antibiotic: 'CIP', tested: 4, r: 0, percentR: 0 });
  });
});

describe('ageBand', () => {
  it('buckets ages and handles unknown', () => {
    expect(ageBand('1990-01-01', '2026-01-01')).toBe('25-49');
    expect(ageBand('2024-01-01', '2026-01-01')).toBe('0-4');
    expect(ageBand(null, '2026-01-01')).toBe('unknown');
    expect(ageBand('not-a-date', '2026-01-01')).toBe('unknown');
  });
});

describe('monthKey', () => {
  it('buckets by year-month', () => {
    expect(monthKey('2026-01-10T00:00:00Z')).toBe('2026-01');
    expect(monthKey(null)).toBe('unknown');
  });
});

describe('hoursBetween', () => {
  it('computes hours and rejects bad/negative', () => {
    expect(hoursBetween('2026-01-10T00:00:00Z', '2026-01-11T00:00:00Z')).toBe(24);
    expect(hoursBetween('2026-01-11T00:00:00Z', '2026-01-10T00:00:00Z')).toBeNull();
    expect(hoursBetween(null, '2026-01-11T00:00:00Z')).toBeNull();
  });
});

describe('toCsv', () => {
  it('escapes and renders', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x,y', b: 1 }]);
    expect(csv).toBe('A,B\n"x,y",1\n');
  });
});
