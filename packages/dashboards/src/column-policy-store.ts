import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { EXTERNAL_TABLE_COLUMNS } from '@openldr/db/schema/external';
import { HARDCODED_DENY_UNION, type ColumnPolicy } from './models/registry';

export interface ColumnPolicyStore {
  /** Build the enforcement map from the DB (table -> hidden column set). */
  load(): Promise<ColumnPolicy>;
  /** Plain per-table hidden lists for the API/CLI. */
  listHidden(): Promise<Record<string, string[]>>;
  /** Replace a single table's hidden set atomically. */
  replaceTable(table: string, hidden: string[], updatedBy?: string): Promise<void>;
}

export function createColumnPolicyStore(db: Kysely<InternalSchema>): ColumnPolicyStore {
  return {
    // A table with ANY rows is "configured": it gets a map entry (empty Set ⇒ fully exposed).
    // Only tables with NO rows are absent ⇒ hiddenFor falls back to HARDCODED_DENY_UNION.
    async load() {
      const rows = await db.selectFrom('column_exposure_policy')
        .select(['table_name', 'column_name', 'hidden']).execute();
      const map: ColumnPolicy = new Map();
      for (const r of rows) {
        let set = map.get(r.table_name);
        if (!set) { set = new Set<string>(); map.set(r.table_name, set); } // entry per configured table
        if (r.hidden) set.add(r.column_name);
      }
      return map;
    },
    async listHidden() {
      const rows = await db.selectFrom('column_exposure_policy')
        .select(['table_name', 'column_name'])
        .where('hidden', '=', true)
        .orderBy('table_name').orderBy('column_name').execute();
      const out: Record<string, string[]> = {};
      for (const r of rows) (out[r.table_name] ??= []).push(r.column_name);
      return out;
    },
    // Rewrite EVERY governed column of the table with its flag, so the table stays "configured".
    async replaceTable(table, hidden, updatedBy) {
      const cols = EXTERNAL_TABLE_COLUMNS[table as keyof typeof EXTERNAL_TABLE_COLUMNS];
      if (!cols) throw new Error(`not a governed table: ${table}`);
      const hide = new Set(hidden);
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('column_exposure_policy').where('table_name', '=', table).execute();
        await trx.insertInto('column_exposure_policy')
          .values(cols.map((column_name) => ({ table_name: table, column_name, hidden: hide.has(column_name), updated_by: updatedBy ?? null })) as never)
          .execute();
      });
    },
  };
}

// Seed a row for EVERY column of every governed table; hidden = union membership. Idempotent.
export async function seedColumnExposurePolicy(db: Kysely<InternalSchema>): Promise<void> {
  const values = Object.entries(HARDCODED_DENY_UNION).flatMap(([table_name, deny]) => {
    const cols = EXTERNAL_TABLE_COLUMNS[table_name as keyof typeof EXTERNAL_TABLE_COLUMNS] ?? [];
    const denySet = new Set(deny);
    return cols.map((column_name) => ({ table_name, column_name, hidden: denySet.has(column_name), updated_by: 'seed' }));
  });
  if (!values.length) return;
  await db.insertInto('column_exposure_policy')
    .values(values as never)
    .onConflict((oc) => oc.columns(['table_name', 'column_name']).doNothing())
    .execute();
}
