import { describe, it, expect } from 'vitest';
import { validateSelectSql } from './sql-runner';

describe('validateSelectSql', () => {
  it('accepts a single SELECT', () => { expect(() => validateSelectSql('SELECT 1')).not.toThrow(); });
  it('accepts a CTE (WITH)', () => { expect(() => validateSelectSql('WITH t AS (SELECT 1) SELECT * FROM t')).not.toThrow(); });
  it('rejects INSERT', () => { expect(() => validateSelectSql('INSERT INTO x VALUES (1)')).toThrow(); });
  it('rejects UPDATE/DELETE/DROP', () => {
    for (const s of ['UPDATE x SET a=1', 'DELETE FROM x', 'DROP TABLE x']) expect(() => validateSelectSql(s)).toThrow();
  });
  it('rejects multiple statements', () => { expect(() => validateSelectSql('SELECT 1; DROP TABLE x')).toThrow(); });
  it('strips a trailing comment so it does not smuggle a second statement', () => { expect(() => validateSelectSql('SELECT 1 -- ; DROP')).not.toThrow(); });
});
