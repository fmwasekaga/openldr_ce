import { type Kysely, sql } from 'kysely';

export type WriteResult = 'written' | 'skipped';

// Chunk rows per table so a multi-row statement never exceeds the driver's parameter ceiling.
// Each row contributes one bound parameter PER COLUMN, so the safe rows-per-statement depends on
// the column width — a fixed row cap silently blows the limit for wider tables. Size the chunk
// from the actual column count. Postgres caps at 65535 params; SQL Server at 2100 params and a
// 1000-row VALUES constructor. MySQL and MariaDB cap at 65535 placeholders per statement (like
// Postgres) and have no MSSQL-style VALUES-row ceiling, so MySQL reuses the ~60000 budget with
// margin. Budgets sit under each hard limit with margin.
const PG_PARAM_BUDGET = 60000;
const MSSQL_PARAM_BUDGET = 2000;
const MSSQL_MAX_VALUES_ROWS = 1000;
const MYSQL_PARAM_BUDGET = 60000;

const chunkSize = (budget: number, cols: number, cap = Infinity): number =>
  Math.min(cap, Math.max(1, Math.floor(budget / Math.max(1, cols))));

export async function insertBatchPg(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const step = chunkSize(PG_PARAM_BUDGET, Object.keys(rows[0]).length);
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    const updateCols = Object.keys(chunk[0]).filter((c) => c !== 'id' && c !== 'created_at');
    await db.insertInto(table).values(chunk).onConflict((oc: any) =>
      oc.column('id').doUpdateSet(Object.fromEntries(updateCols.map((c) => [c, (eb: any) => eb.ref(`excluded.${c}`)])))
    ).execute();
  }
}

export async function mergeBatchMssql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const step = chunkSize(MSSQL_PARAM_BUDGET, Object.keys(rows[0]).length, MSSQL_MAX_VALUES_ROWS);
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    const cols = Object.keys(chunk[0]);
    const sourceCols = sql.raw(cols.join(', '));
    const valuesRows = sql.join(chunk.map((r) => sql`(${sql.join(cols.map((c) => sql`${r[c]}`))})`));
    const updateCols = cols.filter((c) => c !== 'id' && c !== 'created_at');
    const set = Object.fromEntries(updateCols.map((c) => [c, sql.ref(`src.${c}`)]));
    const insertValues = Object.fromEntries(cols.map((c) => [c, sql.ref(`src.${c}`)]));
    await db
      .mergeInto(`${table} as tgt`)
      .using(sql`(values ${valuesRows})`.as(sql`src(${sourceCols})`), (j: any) => j.onRef('tgt.id', '=', 'src.id'))
      .whenMatched().thenUpdateSet(set)
      .whenNotMatched().thenInsertValues(insertValues)
      .execute();
  }
}

export async function insertBatchMysql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const step = chunkSize(MYSQL_PARAM_BUDGET, Object.keys(rows[0]).length);
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    const updateCols = Object.keys(chunk[0]).filter((c) => c !== 'id' && c !== 'created_at');
    // ON DUPLICATE KEY UPDATE col = VALUES(col): references the incoming per-row value.
    // VALUES() works on MySQL 8.4 and MariaDB 11.4 (deprecated-but-present on MySQL; canonical on MariaDB).
    const set = Object.fromEntries(updateCols.map((c) => [c, sql`values(${sql.ref(c)})`]));
    await db.insertInto(table).values(chunk).onDuplicateKeyUpdate(set).execute();
  }
}
