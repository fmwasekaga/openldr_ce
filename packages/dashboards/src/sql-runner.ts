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

/** Run user SQL inside a READ ONLY transaction with a statement timeout and row cap. Postgres only. */
export async function runSqlQuery(
  db: Kysely<ExternalSchema>, rawSql: string, opts: SqlRunOpts,
): Promise<ReportResultData> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1) throw new Error('timeoutMs must be a finite positive number');
  if (!Number.isFinite(opts.rowCap) || opts.rowCap < 1) throw new Error('rowCap must be a finite positive number');
  validateSelectSql(rawSql);
  const inner = rawSql.replace(/;\s*$/, '');
  const cap = Math.floor(opts.rowCap);
  const capped = `select * from (${inner}) as _q limit ${cap}`;
  return db.transaction().execute(async (trx) => {
    await sql`set transaction read only`.execute(trx);
    await sql`set local statement_timeout = ${sql.lit(Math.floor(opts.timeoutMs))}`.execute(trx);
    const result = await sql.raw<Record<string, unknown>>(capped).execute(trx);
    const rows = result.rows;
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const columns: ReportColumn[] = keys.map((k) => ({
      key: k, label: k,
      kind: typeof rows[0]?.[k] === 'number' ? 'number' : 'string',
    }));
    return { columns, rows, chart: { type: 'bar', x: keys[0] ?? 'label', y: keys[1] ?? 'value' } };
  });
}
