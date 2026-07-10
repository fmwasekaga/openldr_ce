import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportResultData, ReportColumn } from '@openldr/reporting';

/** Strip line (`-- ...`) and block (slash-star ... star-slash) comments before structural checks. */
function stripComments(input: string): string {
  return input.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export function validateSelectSql(rawSql: string): void {
  const stripped = stripComments(rawSql).trim();
  if (!stripped) throw new Error('empty query');
  // Reject multiple statements: any semicolon that is not the final char.
  const noTrailing = stripped.replace(/;\s*$/, '');
  if (noTrailing.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(noTrailing)) throw new Error('only SELECT/WITH queries are allowed');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|copy)\b/i.test(noTrailing)) {
    throw new Error('only read-only SELECT queries are allowed');
  }
}

export type SqlDialect = 'postgres' | 'mssql';

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
  return { sql: `select * from (${inner}) as _q limit ${limit} offset ${offset}`, sliceOffset: 0 };
}

export interface SqlRunOpts { timeoutMs: number; rowCap: number }

/** Run user SQL inside a read-only transaction with a statement/lock timeout and row cap.
 *  Dialect-aware: Postgres uses `set transaction read only` + `statement_timeout`; SQL Server
 *  has no equivalent transaction-level read-only mode or per-statement timeout, so it relies on
 *  the SELECT-only validation above for read-only-ness and bounds lock waits with LOCK_TIMEOUT. */
export async function runSqlQuery(
  db: Kysely<ExternalSchema>, rawSql: string, opts: SqlRunOpts, engine: SqlDialect = 'postgres',
): Promise<ReportResultData> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1) throw new Error('timeoutMs must be a finite positive number');
  if (!Number.isFinite(opts.rowCap) || opts.rowCap < 1) throw new Error('rowCap must be a finite positive number');
  validateSelectSql(rawSql);
  const inner = rawSql.replace(/;\s*$/, '');
  const cap = Math.floor(opts.rowCap);
  return db.transaction().execute(async (trx) => {
    if (engine === 'mssql') {
      // SQL Server has no `set transaction read only`; the SELECT-only validation above enforces
      // read-only-ness. SET LOCK_TIMEOUT bounds lock waits (T-SQL has no per-statement time cap).
      await sql.raw(`set lock_timeout ${Math.floor(opts.timeoutMs)}`).execute(trx);
    } else {
      await sql`set transaction read only`.execute(trx);
      await sql`set local statement_timeout = ${sql.lit(Math.floor(opts.timeoutMs))}`.execute(trx);
    }
    const plan = planPagination(inner, engine, { limit: cap });
    const result = await sql.raw<Record<string, unknown>>(plan.sql).execute(trx);
    const rows = plan.sliceOffset ? result.rows.slice(plan.sliceOffset) : result.rows;
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const columns: ReportColumn[] = keys.map((k) => ({
      key: k, label: k,
      kind: typeof rows[0]?.[k] === 'number' ? 'number' : 'string',
    }));
    return { columns, rows, chart: { type: 'bar', x: keys[0] ?? 'label', y: keys[1] ?? 'value' } };
  });
}
