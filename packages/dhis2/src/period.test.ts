import { describe, it, expect } from 'vitest';
import { periodRange, currentPeriod, previousPeriod, nextPeriodBoundary } from './period';

describe('periodRange', () => {
  it('quarterly', () => expect(periodRange('2026Q1')).toEqual({ from: '2026-01-01', to: '2026-03-31' }));
  it('monthly', () => expect(periodRange('202602')).toEqual({ from: '2026-02-01', to: '2026-02-28' }));
  it('yearly', () => expect(periodRange('2024')).toEqual({ from: '2024-01-01', to: '2024-12-31' }));
  it('rejects garbage', () => expect(() => periodRange('nope')).toThrow(/period/i));
});
describe('current/previous period', () => {
  const mar = new Date(Date.UTC(2026, 2, 15));
  it('current quarterly', () => expect(currentPeriod('quarterly', mar)).toBe('2026Q1'));
  it('current monthly', () => expect(currentPeriod('monthly', mar)).toBe('202603'));
  it('previous monthly across year', () => expect(previousPeriod('monthly', new Date(Date.UTC(2026, 0, 9)))).toBe('202512'));
  it('previous quarterly', () => expect(previousPeriod('quarterly', mar)).toBe('2025Q4'));
  it('previous yearly', () => expect(previousPeriod('yearly', mar)).toBe('2025'));
});
describe('nextPeriodBoundary', () => {
  it('monthly → first of next month (UTC)', () => expect(nextPeriodBoundary('monthly', new Date(Date.UTC(2026, 2, 15))).toISOString()).toBe('2026-04-01T00:00:00.000Z'));
  it('quarterly → first of next quarter', () => expect(nextPeriodBoundary('quarterly', new Date(Date.UTC(2026, 1, 1))).toISOString()).toBe('2026-04-01T00:00:00.000Z'));
});
