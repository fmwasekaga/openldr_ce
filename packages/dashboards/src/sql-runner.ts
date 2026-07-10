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

/** Wrap an inner SELECT with a dialect-correct row-cap + offset. Postgres uses LIMIT/OFFSET;
 *  SQL Server uses OFFSET…FETCH, which requires an ORDER BY - `(SELECT NULL)` is a stable no-op
 *  order for an arbitrary wrapped subquery. */
export function paginateSql(inner: string, dialect: SqlDialect, opts: { limit: number; offset?: number }): string {
  const limit = Math.floor(opts.limit);
  const offset = Math.floor(opts.offset ?? 0);
  if (dialect === 'mssql') {
    return `select * from (${inner}) as _q order by (select null) offset ${offset} rows fetch next ${limit} rows only`;
  }
  return `select * from (${inner}) as _q limit ${limit} offset ${offset}`;
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
