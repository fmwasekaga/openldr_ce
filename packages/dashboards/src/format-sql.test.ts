import { describe, it, expect } from 'vitest';
import { formatSql } from './format-sql';

describe('formatSql', () => {
  it('returns the SQL unchanged when there are no parameters', () => {
    expect(formatSql('select * from t', [])).toBe('select * from t');
  });

  it('inlines $n placeholders (postgres style) in order', () => {
    const out = formatSql('select * from t where a = $1 and b = $2', ['x', 5]);
    expect(out).toBe("select * from t where a = 'x' and b = 5");
  });

  it('inlines ? placeholders (sqlite/mysql style) in order', () => {
    const out = formatSql('select * from t where a = ? and b = ?', ['x', 5]);
    expect(out).toBe("select * from t where a = 'x' and b = 5");
  });

  it('inlines @n placeholders (mssql style) in order', () => {
    const out = formatSql('select * from t where a = @1 and b = @2', ['x', 5]);
    expect(out).toBe("select * from t where a = 'x' and b = 5");
  });

  it('escapes a single quote inside a string parameter', () => {
    const out = formatSql('select * from t where a = $1', ["o'brien"]);
    expect(out).toBe("select * from t where a = 'o''brien'");
  });

  it('renders null and boolean parameters without quotes', () => {
    const out = formatSql('select * from t where a = $1 and b = $2', [null, true]);
    expect(out).toBe('select * from t where a = NULL and b = TRUE');
  });

  it('renders a Date parameter as a quoted ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    const out = formatSql('select * from t where a = $1', [d]);
    expect(out).toBe("select * from t where a = '2026-01-01T00:00:00.000Z'");
  });
});
