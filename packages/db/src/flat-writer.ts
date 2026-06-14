import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { flattenResource } from './flatten/index';

export type WriteResult = 'written' | 'skipped';

export interface FlatWriteItem { resource: unknown; provenance?: Provenance; }

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
  writeMany(items: FlatWriteItem[]): Promise<WriteResult[]>;
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

// Postgres column-param ceiling is 65535; MSSQL is ~2100 params / 1000-row insert. Chunk rows
// per table so a large batch never exceeds the driver limit. Columns/row is small (~<=20).
const PG_MAX_ROWS = 1000;
const MSSQL_MAX_ROWS = 500;

async function insertBatchPg(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += PG_MAX_ROWS) {
    const chunk = rows.slice(i, i + PG_MAX_ROWS);
    const updateCols = Object.keys(chunk[0]).filter((c) => c !== 'id' && c !== 'created_at');
    await db.insertInto(table).values(chunk).onConflict((oc: any) =>
      oc.column('id').doUpdateSet(Object.fromEntries(updateCols.map((c) => [c, (eb: any) => eb.ref(`excluded.${c}`)])))
    ).execute();
  }
}

async function mergeBatchMssql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += MSSQL_MAX_ROWS) {
    const chunk = rows.slice(i, i + MSSQL_MAX_ROWS);
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
        else await insertBatchPg(anyDb, table, rows);
      }
      return results;
    },
  };
}
