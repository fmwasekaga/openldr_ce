import { describe, it, expect } from 'vitest';
import { validateSelectSql, runSqlQuery, planPagination } from './sql-runner';

// --- Fake Kysely db/executor for driving runSqlQuery's `sql`/`sql.raw` calls through the
// transaction. Mirrors just enough of kysely's RawBuilder.execute() contract (getExecutor() →
// transformQuery() → compileQuery() → executeQuery()) to record the exact SQL text issued,
// without depending on kysely's real dialect compilers. Only RawNode + immediate ValueNode
// (what `sql` tags / `sql.lit` / `sql.raw` produce) need to be rendered.
interface FakeOpNode {
  kind: string;
  sqlFragments?: readonly string[];
  parameters?: readonly FakeOpNode[];
  value?: unknown;
}

function renderNode(node: FakeOpNode): string {
  // `sql.lit(x)` (used to inline the timeout) is itself a RawBuilder, so it arrives here as a
  // nested RawNode wrapping a ValueNode (`sql.lit`'s `toOperationNode()`), not a bare ValueNode.
  if (node.kind === 'RawNode') return compileRawNode(node);
  if (node.kind === 'ValueNode') return String(node.value);
  throw new Error(`fake compiler: unsupported node kind ${node.kind}`);
}

function compileRawNode(node: FakeOpNode): string {
  const fragments = node.sqlFragments ?? [];
  const params = node.parameters ?? [];
  let out = fragments[0] ?? '';
  for (let i = 0; i < params.length; i++) out += renderNode(params[i]) + (fragments[i + 1] ?? '');
  return out;
}

function makeFakeDb(
  rows: Record<string, unknown>[],
  version = '',
): { db: any; executed: string[] } {
  const executed: string[] = [];
  const executor = {
    transformQuery: (node: FakeOpNode) => node,
    compileQuery: (node: FakeOpNode) => ({ sql: compileRawNode(node), parameters: [], query: node }),
    executeQuery: async (compiledQuery: { sql: string }) => {
      executed.push(compiledQuery.sql);
      // Serve version() (the mysql/mariadb per-statement-timeout variant detection) from the
      // configured string; every other query returns the configured rows.
      if (/version\(\)/i.test(compiledQuery.sql)) return { rows: [{ v: version }] };
      return { rows };
    },
  };
  const trx = { getExecutor: () => executor };
  const db = { transaction: () => ({ execute: (cb: (trx: unknown) => unknown) => cb(trx) }) };
  return { db, executed };
}

describe('validateSelectSql', () => {
  it('accepts a single SELECT', () => { expect(() => validateSelectSql('SELECT 1')).not.toThrow(); });
  it('accepts a CTE (WITH)', () => { expect(() => validateSelectSql('WITH t AS (SELECT 1) SELECT * FROM t')).not.toThrow(); });
  it('rejects INSERT', () => { expect(() => validateSelectSql('INSERT INTO x VALUES (1)')).toThrow(); });
  it('rejects UPDATE/DELETE/DROP', () => {
    for (const s of ['UPDATE x SET a=1', 'DELETE FROM x', 'DROP TABLE x']) expect(() => validateSelectSql(s)).toThrow();
  });
  it('rejects multiple statements', () => { expect(() => validateSelectSql('SELECT 1; DROP TABLE x')).toThrow(); });
  it('strips a trailing comment so it does not smuggle a second statement', () => { expect(() => validateSelectSql('SELECT 1 -- ; DROP')).not.toThrow(); });
  it('rejects SELECT ... INTO (creates a table — not read-only)', () => {
    expect(() => validateSelectSql('SELECT * INTO shadow FROM t')).toThrow();
    expect(() => validateSelectSql('select id into #tmp from t')).toThrow();
  });
  it('allows "into" inside a string literal (not a false positive)', () => {
    expect(() => validateSelectSql("SELECT 'convert this into that' as note")).not.toThrow();
  });
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

describe('runSqlQuery dialect-aware session setup + capped query', () => {
  it('postgres (default engine): read-only txn + statement_timeout + LIMIT/OFFSET capped query', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 });
    expect(executed).toContain('set transaction read only');
    expect(executed).toContain('set local statement_timeout = 5000');
    expect(executed).toContain('select * from (select 1 as a) as _q limit 100 offset 0');
    expect(result.rows).toEqual([{ a: 1 }]);
    expect(result.columns).toEqual([{ key: 'a', label: 'a', kind: 'number' }]);
  });

  it('postgres (explicit engine): same shape as the default', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    await runSqlQuery(db, 'select 1 as a', { timeoutMs: 2500, rowCap: 10 }, 'postgres');
    expect(executed).toContain('set transaction read only');
    expect(executed).toContain('set local statement_timeout = 2500');
    expect(executed).toContain('select * from (select 1 as a) as _q limit 10 offset 0');
  });

  it('mssql: SET LOCK_TIMEOUT (no read-only/statement_timeout) + SET ROWCOUNT capped batch', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mssql');
    expect(executed).toContain('set lock_timeout 5000');
    expect(executed.some((s) => /read only/i.test(s))).toBe(false);
    expect(executed.some((s) => /statement_timeout/i.test(s))).toBe(false);
    expect(executed).toContain('set rowcount 100; select 1 as a; set rowcount 0');
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('mysql (MySQL 8): per-statement MAX_EXECUTION_TIME hint on the capped query — no session SET, no read-only txn', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }], '8.4.0'); // version() has no "MariaDB"
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mysql');
    // The row cap is the wrapping SELECT; the timeout rides on it as an optimizer hint (ms).
    expect(executed).toContain('select /*+ MAX_EXECUTION_TIME(5000) */ * from (select 1 as a) as _q limit 100 offset 0');
    // Nothing session-scoped and no pg/mssql pragmas — no leak onto the pooled connection.
    expect(executed.some((s) => /set session/i.test(s))).toBe(false);
    expect(executed.some((s) => /max_statement_time/i.test(s))).toBe(false); // that's MariaDB's, not MySQL's
    expect(executed.some((s) => /read only/i.test(s))).toBe(false);
    expect(executed.some((s) => /statement_timeout/i.test(s))).toBe(false);
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('mysql (MariaDB): per-statement SET STATEMENT max_statement_time wrapper (seconds) — no hint, no session SET', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }], '11.4.2-MariaDB-1:11.4.2+maria~ubu2404');
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mysql');
    expect(executed).toContain('set statement max_statement_time=5 for select * from (select 1 as a) as _q limit 100 offset 0');
    expect(executed.some((s) => /max_execution_time/i.test(s))).toBe(false); // that's MySQL's hint, not MariaDB's
    expect(executed.some((s) => /set session/i.test(s))).toBe(false);
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('mysql: a fractional-second timeout renders a decimal max_statement_time on MariaDB', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }], '11.4.2-MariaDB');
    await runSqlQuery(db, 'select 1 as a', { timeoutMs: 2500, rowCap: 10 }, 'mysql');
    expect(executed).toContain('set statement max_statement_time=2.5 for select * from (select 1 as a) as _q limit 10 offset 0');
  });
});

describe('planPagination', () => {
  it('wraps Postgres with LIMIT/OFFSET (server-side offset, no slice)', () => {
    expect(planPagination('select 1', 'postgres', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 100 offset 0', sliceOffset: 0 });
  });
  it('wraps Postgres with a non-zero offset in SQL', () => {
    expect(planPagination('select 1', 'postgres', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 50 offset 25', sliceOffset: 0 });
  });
  it('caps MSSQL with SET ROWCOUNT (works with an ORDER BY query), offset applied by slicing', () => {
    // ORDER BY in the inner query would be invalid inside a derived table on SQL Server; SET ROWCOUNT avoids that.
    expect(planPagination('select 1 order by 1', 'mssql', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'set rowcount 100; select 1 order by 1; set rowcount 0', sliceOffset: 0 });
  });
  it('MSSQL fetches offset+limit rows via SET ROWCOUNT and reports sliceOffset', () => {
    expect(planPagination('select 1', 'mssql', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'set rowcount 75; select 1; set rowcount 0', sliceOffset: 25 });
  });
  it('defaults offset to 0 and floors non-integers', () => {
    expect(planPagination('select 1', 'postgres', { limit: 10.9 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 10 offset 0', sliceOffset: 0 });
    expect(planPagination('select 1', 'mssql', { limit: 10.9 }))
      .toEqual({ sql: 'set rowcount 10; select 1; set rowcount 0', sliceOffset: 0 });
  });
  it('wraps MySQL with LIMIT/OFFSET (reuses the Postgres server-side-offset path)', () => {
    expect(planPagination('select 1', 'mysql', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 100 offset 0', sliceOffset: 0 });
    expect(planPagination('select 1', 'mysql', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 50 offset 25', sliceOffset: 0 });
  });
});
