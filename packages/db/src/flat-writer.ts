import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { flattenResource, tableForResourceType } from './flatten/index';

export type WriteResult = 'written' | 'skipped';

export interface FlatWriteItem { resource: unknown; provenance?: Provenance; }

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
  writeMany(items: FlatWriteItem[]): Promise<WriteResult[]>;
  deleteById(resourceType: string, id: string): Promise<void>;
}

// MSSQL has no ON CONFLICT; use MERGE keyed on id. Behaviour-equivalent to the PG upsert:
// insert-or-update exactly one flat row, idempotent on id.
async function upsertMssql(
  db: Kysely<any>,
  table: string,
  row: Record<string, unknown>,
  updateRow: Record<string, unknown>,
): Promise<void> {
  // `table` and `cols` are trusted internal identifiers from flattenResource()'s closed schema
  // (never user input), so sql.raw on the column list is injection-safe; values are parameterized.
  const cols = Object.keys(row);
  const valuesTuple = sql.join(cols.map((c) => sql`${row[c]}`));
  const sourceCols = sql.raw(cols.join(', '));
  const set = Object.fromEntries(Object.keys(updateRow).map((c) => [c, sql.ref(`src.${c}`)]));
  const insertValues = Object.fromEntries(cols.map((c) => [c, sql.ref(`src.${c}`)]));
  await db
    .mergeInto(`${table} as tgt`)
    .using(sql`(values (${valuesTuple}))`.as(sql`src(${sourceCols})`), (j: any) => j.onRef('tgt.id', '=', 'src.id'))
    .whenMatched()
    .thenUpdateSet(set)
    .whenNotMatched()
    .thenInsertValues(insertValues)
    .execute();
}

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

async function insertBatchPg(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
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

async function mergeBatchMssql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
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

async function insertBatchMysql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
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

export function createFlatWriter(db: Kysely<ExternalSchema>, engine: TargetEngine = 'postgres'): FlatWriter {
  const anyDb = db as unknown as Kysely<any>;
  return {
    async write(resource, provenance = {}) {
      const flat = flattenResource(resource, provenance);
      if (!flat) return 'skipped';
      const { table, row } = flat;
      const updateRow = { ...row };
      delete (updateRow as Record<string, unknown>).id;
      delete (updateRow as Record<string, unknown>).created_at;

      if (engine === 'mssql') {
        await upsertMssql(anyDb, table, row, updateRow);
      } else if (engine === 'mysql') {
        // Single row: update to literal `updateRow` values (like the pg single-row path). The batch
        // helper instead uses VALUES(col) to reference each incoming row — that asymmetry is intentional.
        await anyDb.insertInto(table).values(row).onDuplicateKeyUpdate(updateRow).execute();
      } else {
        await anyDb.insertInto(table).values(row).onConflict((oc: any) => oc.column('id').doUpdateSet(updateRow)).execute();
      }
      return 'written';
    },
    async writeMany(items) {
      const results: WriteResult[] = new Array(items.length).fill('skipped');
      // Group flattened rows by target table, remembering each item's original index for the result order.
      const byTable = new Map<string, Record<string, unknown>[]>();
      items.forEach((it, idx) => {
        const flat = flattenResource(it.resource, it.provenance ?? {});
        if (!flat) return; // stays 'skipped'
        results[idx] = 'written';
        const list = byTable.get(flat.table) ?? [];
        list.push(flat.row);
        byTable.set(flat.table, list);
      });
      for (const [table, rows] of byTable) {
        if (engine === 'mssql') await mergeBatchMssql(anyDb, table, rows);
        else if (engine === 'mysql') await insertBatchMysql(anyDb, table, rows);
        else await insertBatchPg(anyDb, table, rows);
      }
      return results;
    },
    async deleteById(resourceType, id) {
      const table = tableForResourceType(resourceType);
      if (!table) return; // non-projected type — nothing to delete
      await anyDb.deleteFrom(table).where('id', '=', id).execute();
    },
  };
}
