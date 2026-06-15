import { describe, it, expect } from 'vitest';
import { resolveValues, applyTemplate } from './template';

describe('resolveValues', () => {
  it('splits a date-range into _from/_to and keeps scalars', () => {
    expect(resolveValues({ period: { from: '2024-01-01', to: '2024-02-01' }, ward: 'ICU', n: 5 })).toEqual({
      period_from: '2024-01-01',
      period_to: '2024-02-01',
      ward: 'ICU',
      n: 5,
    });
  });
  it('maps null/undefined to null', () => {
    expect(resolveValues({ a: null, b: undefined })).toEqual({ a: null, b: null });
  });
});

describe('applyTemplate', () => {
  it('quotes + escapes string values', () => {
    expect(applyTemplate('WHERE ward = {{ward}}', { ward: "O'Hara" })).toBe("WHERE ward = 'O''Hara'");
  });
  it('leaves numbers unquoted', () => {
    expect(applyTemplate('LIMIT {{n}}', { n: 5 })).toBe('LIMIT 5');
  });
  it('substitutes NULL for an unset var', () => {
    expect(applyTemplate('x = {{ward}}', { ward: null })).toBe('x = NULL');
  });
  it('keeps a [[ ]] clause when its vars are set', () => {
    expect(applyTemplate('1=1 [[AND ward = {{ward}}]]', { ward: 'ICU' })).toBe("1=1 AND ward = 'ICU'");
  });
  it('drops a [[ ]] clause when a var is unset', () => {
    expect(applyTemplate('1=1 [[AND ward = {{ward}}]]', { ward: null })).toBe('1=1 ');
  });
  it('resolves a date-range clause via _from/_to', () => {
    const resolved = resolveValues({ period: { from: '2024-01-01', to: '2024-02-01' } });
    expect(applyTemplate('[[AND d >= {{period_from}} AND d <= {{period_to}}]]', resolved)).toBe("AND d >= '2024-01-01' AND d <= '2024-02-01'");
  });
});
