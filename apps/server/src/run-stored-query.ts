import type { CustomQueryParam, CustomQueryStore } from '@openldr/db';
import { validateSelectSql } from '@openldr/dashboards';
import { substituteParams } from './query-sql';

const ROW_CAP = 1000;

export interface RunStoredQueryDeps {
  customQueries: Pick<CustomQueryStore, 'get'>;
  runConnectorSql(input: { connectorId: string; sql: string }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

/** Substitute {{param.*}} then enforce SELECT-only. Returns the safe inner SQL. Throws on bad param/SQL. */
export function prepareSelect(sql: string, params: CustomQueryParam[], values: Record<string, unknown>): string {
  const inner = params.length ? substituteParams(sql, params, values) : sql;
  validateSelectSql(inner);
  return inner;
}

/** Load a stored custom query by id, run it (SELECT-only, row-capped) against its connector. */
export async function runStoredQuery(
  deps: RunStoredQueryDeps, queryId: string, values: Record<string, unknown>,
): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }> {
  const rec = await deps.customQueries.get(queryId);
  if (!rec) throw new Error(`custom query not found: ${queryId}`);
  const inner = prepareSelect(rec.sql, rec.params, values).replace(/;\s*$/, '');
  const sql = `select * from (${inner}) as _q limit ${ROW_CAP}`;
  return deps.runConnectorSql({ connectorId: rec.connectorId, sql });
}
