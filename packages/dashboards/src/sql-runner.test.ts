import { describe, it, expect } from 'vitest';
import { validateSelectSql, runSqlQuery, paginateSql } from './sql-runner';

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

describe('paginateSql', () => {
  it('wraps Postgres with LIMIT/OFFSET', () => {
    expect(paginateSql('select 1', 'postgres', { limit: 100, offset: 0 }))
      .toBe('select * from (select 1) as _q limit 100 offset 0');
  });
  it('wraps Postgres with a non-zero offset', () => {
    expect(paginateSql('select 1', 'postgres', { limit: 50, offset: 25 }))
      .toBe('select * from (select 1) as _q limit 50 offset 25');
  });
  it('wraps MSSQL with ORDER BY (SELECT NULL) OFFSET/FETCH', () => {
    expect(paginateSql('select 1', 'mssql', { limit: 100, offset: 0 }))
      .toBe('select * from (select 1) as _q order by (select null) offset 0 rows fetch next 100 rows only');
  });
  it('wraps MSSQL with a non-zero offset', () => {
    expect(paginateSql('select 1', 'mssql', { limit: 50, offset: 25 }))
      .toBe('select * from (select 1) as _q order by (select null) offset 25 rows fetch next 50 rows only');
  });
  it('defaults offset to 0 and floors non-integers', () => {
    expect(paginateSql('select 1', 'postgres', { limit: 10.9 }))
      .toBe('select * from (select 1) as _q limit 10 offset 0');
    expect(paginateSql('select 1', 'mssql', { limit: 10.9 }))
      .toBe('select * from (select 1) as _q order by (select null) offset 0 rows fetch next 10 rows only');
  });
});
