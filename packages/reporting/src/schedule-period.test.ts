import { describe, it, expect } from 'vitest';
import { nextRunAt, periodFor } from './schedule-period';

const iso = (d: Date) => d.toISOString();

describe('nextRunAt', () => {
  it('daily → next day 06:00 UTC', () => {
    expect(iso(nextRunAt('daily', null, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-03-11T06:00:00.000Z');
  });
  it('weekly → next occurrence of dayOfWeek (1=Mon) at 06:00', () => {
    expect(iso(nextRunAt('weekly', 1, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-03-16T06:00:00.000Z');
  });
  it('weekly defaults to Monday when dayOfWeek is null', () => {
    expect(iso(nextRunAt('weekly', null, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-03-16T06:00:00.000Z');
  });
  it('monthly → next month on dayOfMonth, capped at 28', () => {
    expect(iso(nextRunAt('monthly', null, 31, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-04-28T06:00:00.000Z');
  });
  it('quarterly → first day of next quarter at 06:00', () => {
    expect(iso(nextRunAt('quarterly', null, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-04-01T06:00:00.000Z');
  });
});

describe('periodFor', () => {
  it('daily → previous calendar day', () => {
    const p = periodFor('daily', new Date('2026-03-11T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-03-10T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-03-10T23:59:59.999Z');
  });
  it('weekly → the 7 days ending the day before runAt', () => {
    const p = periodFor('weekly', new Date('2026-03-16T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-03-09T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-03-15T23:59:59.999Z');
  });
  it('monthly → previous calendar month', () => {
    const p = periodFor('monthly', new Date('2026-03-05T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-02-28T23:59:59.999Z');
  });
  it('quarterly → previous calendar quarter', () => {
    const p = periodFor('quarterly', new Date('2026-04-15T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-03-31T23:59:59.999Z');
  });
});
