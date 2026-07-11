import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportResultData, ReportColumn } from '@openldr/reporting';

/** Strip line (`-- ...`) and block (slash-star ... star-slash) comments before structural checks. */
function stripComments(input: string): string {
  return input.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Replace single-quoted string literals (including `''` escapes) with an empty literal so a
 *  keyword like `into` sitting inside a quoted string isn't mistaken for the SQL keyword. Only
 *  applied to the validation copy — never to the SQL that actually runs. */
function stripStringLiterals(input: string): string {
  return input.replace(/'(?:[^']|'')*'/g, "''");
}

export function validateSelectSql(rawSql: string): void {
  // Strip comments AND string literals before the structural/keyword checks so quoted text (e.g.
  // 'convert this into that') can't trigger a false positive or smuggle a banned keyword.
  const stripped = stripStringLiterals(stripComments(rawSql)).trim();
  if (!stripped) throw new Error('empty query');
  // Reject multiple statements: any semicolon that is not the final char.
  const noTrailing = stripped.replace(/;\s*$/, '');
  if (noTrailing.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(noTrailing)) throw new Error('only SELECT/WITH queries are allowed');
  // `into` is banned too: `SELECT … INTO <table>` creates a table and writes rows (a write
  // masquerading as a SELECT). On Postgres a read-only txn caught this; on MSSQL there is no
  // read-only txn, so this shared validator is the only guard for both Path A and Path B.
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|copy|into)\b/i.test(noTrailing)) {
    throw new Error('only read-only SELECT queries are allowed (INTO/DDL/DML rejected)');
  }
}

export type SqlDialect = 'postgres' | 'mssql' | 'mysql';

export interface PaginationPlan {
  /** SQL to execute (a multi-statement batch for MSSQL). */
  sql: string;
  /** Rows to drop from the front of the result set. MSSQL applies its offset here (in JS)
   *  rather than in SQL; Postgres does the offset in SQL so this is 0. */
  sliceOffset: number;
}

/** Plan a dialect-correct row-cap + offset for an ARBITRARY user SELECT (which may end in its
 *  own ORDER BY). Postgres wraps in a derived table with LIMIT/OFFSET (server-side offset).
 *  SQL Server cannot wrap an ORDER BY query in a derived table (T-SQL forbids it, and OFFSET…FETCH
 *  requires the ORDER BY at the statement's own top level), so it caps rows with SET ROWCOUNT —
 *  which works for any SELECT including one ending in ORDER BY — and applies the offset by slicing
 *  the returned rows. */
export function planPagination(inner: string, dialect: SqlDialect, opts: { limit: number; offset?: number }): PaginationPlan {
  const limit = Math.floor(opts.limit);
  const offset = Math.floor(opts.offset ?? 0);
  if (dialect === 'mssql') {
    return { sql: `set rowcount ${offset + limit}; ${inner}; set rowcount 0`, sliceOffset: offset };
  }
  // Postgres AND MySQL/MariaDB: native LIMIT/OFFSET in a derived table (server-side offset).
  return { sql: `select * from (${inner}) as _q limit ${limit} offset ${offset}`, sliceOffset: 0 };
}

export interface SqlRunOpts { timeoutMs: number; rowCap: number }

/** MariaDB's `version()` string contains "MariaDB"; MySQL's does not. The engine variant is a
 *  server property (identical across every connection in the pool), so it is detected once via a
 *  trivial `version()` query and cached per db handle. Used to pick the per-statement timeout
 *  mechanism below (MySQL optimizer hint vs MariaDB `SET STATEMENT`). */
const mariaDbByDb = new WeakMap<object, boolean>();
async function isMariaDb(db: object, trx: Kysely<ExternalSchema>): Promise<boolean> {
  const cached = mariaDbByDb.get(db);
  if (cached !== undefined) return cached;
  const r = await sql<{ v: string }>`select version() as v`.execute(trx);
  const isMaria = /mariadb/i.test(String(r.rows[0]?.v ?? ''));
  mariaDbByDb.set(db, isMaria);
  return isMaria;
}

/** Run user SQL inside a read-only transaction with a statement/lock timeout and row cap.
 *  Dialect-aware: Postgres uses `set transaction read only` + `statement_timeout`; SQL Server has
 *  no equivalent transaction-level read-only mode or per-statement timeout, so it relies on the
 *  SELECT-only validation above for read-only-ness and bounds lock waits with LOCK_TIMEOUT.
 *  MySQL/MariaDB likewise have no read-only pragma usable mid-transaction (so they too rely on
 *  SELECT-only validation), and their statement timeout is applied PER-STATEMENT — no session var
 *  is mutated, so nothing leaks onto the pooled connection: MySQL 8 uses the
 *  `MAX_EXECUTION_TIME(<ms>)` optimizer hint on the wrapping SELECT, MariaDB uses
 *  `SET STATEMENT max_statement_time=<sec> FOR <stmt>`. The two are mutually exclusive (MySQL has no
 *  `SET STATEMENT … FOR`; MariaDB ignores the hint), so the engine variant is detected once (cached)
 *  from `version()`. */
export async function runSqlQuery(
  db: Kysely<ExternalSchema>, rawSql: string, opts: SqlRunOpts, engine: SqlDialect = 'postgres',
): Promise<ReportResultData> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1) throw new Error('timeoutMs must be a finite positive number');
  if (!Number.isFinite(opts.rowCap) || opts.rowCap < 1) throw new Error('rowCap must be a finite positive number');
  validateSelectSql(rawSql);
  const inner = rawSql.replace(/;\s*$/, '');
  const cap = Math.floor(opts.rowCap);
  const ms = Math.floor(opts.timeoutMs);
  return db.transaction().execute(async (trx) => {
    const plan = planPagination(inner, engine, { limit: cap });
    let execSql = plan.sql;
    if (engine === 'mssql') {
      // SQL Server has no `set transaction read only`; SELECT-only validation enforces read-only-ness.
      // SET LOCK_TIMEOUT bounds lock waits (T-SQL has no per-statement time cap).
      await sql`set lock_timeout ${sql.lit(ms)}`.execute(trx);
    } else if (engine === 'mysql') {
      // MySQL/MariaDB reject changing txn characteristics inside an already-open txn (kysely has
      // sent BEGIN), so there is no read-only pragma here — the shared SELECT-only validation is the
      // read-only guard (same rationale as mssql). The statement timeout is applied PER-STATEMENT so
      // no session var is mutated (nothing leaks onto the pooled connection): MySQL 8 via the
      // MAX_EXECUTION_TIME(<ms>) optimizer hint on the wrapping SELECT; MariaDB via
      // `SET STATEMENT max_statement_time=<sec> FOR <stmt>` (seconds). MySQL has no
      // `SET STATEMENT … FOR` and MariaDB ignores the hint, so the variant is detected (cached) once.
      execSql = (await isMariaDb(db, trx))
        ? `set statement max_statement_time=${ms / 1000} for ${plan.sql}`
        : plan.sql.replace(/^\s*select\b/i, `select /*+ MAX_EXECUTION_TIME(${ms}) */`);
    } else {
      await sql`set transaction read only`.execute(trx);
      await sql`set local statement_timeout = ${sql.lit(ms)}`.execute(trx);
    }
    const result = await sql.raw<Record<string, unknown>>(execSql).execute(trx);
    const rows = plan.sliceOffset ? result.rows.slice(plan.sliceOffset) : result.rows;
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const columns: ReportColumn[] = keys.map((k) => ({
      key: k, label: k,
      kind: typeof rows[0]?.[k] === 'number' ? 'number' : 'string',
    }));
    return { columns, rows, chart: { type: 'bar', x: keys[0] ?? 'label', y: keys[1] ?? 'value' } };
  });
}
