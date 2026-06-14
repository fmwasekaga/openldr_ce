import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { flattenResource } from './flatten/index';

export type WriteResult = 'written' | 'skipped';

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
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
  };
}
