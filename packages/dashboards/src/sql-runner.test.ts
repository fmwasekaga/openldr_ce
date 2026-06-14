import { describe, it, expect } from 'vitest';
import { validateSelectSql, runSqlQuery } from './sql-runner';

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

describe('runSqlQuery numeric guards', () => {
  const db = { transaction: () => { throw new Error('should not reach db'); } } as any;

  it('rejects NaN timeoutMs before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: NaN, rowCap: 10 }))
      .rejects.toThrow(/finite positive/);
  });

  it('rejects Infinity rowCap before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: 5000, rowCap: Infinity }))
      .rejects.toThrow(/finite positive/);
  });

  it('rejects zero timeoutMs before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: 0, rowCap: 10 }))
      .rejects.toThrow(/finite positive/);
  });

  it('rejects negative rowCap before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: 5000, rowCap: -1 }))
      .rejects.toThrow(/finite positive/);
  });
});
