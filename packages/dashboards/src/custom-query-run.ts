import type { CustomQueryParam, CustomQueryStore } from '@openldr/db';
import type { CustomQueryParam as DashboardCustomQueryParam } from './custom-query';
import { validateSelectSql } from './sql-runner';

// Shape check for injection-safety only (YYYY-MM-DD); the DB enforces calendar validity.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
// Shape check for injection-safety only; the DB enforces calendar validity.
function assertDate(v: unknown): string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) throw new Error(`invalid date: ${String(v)}`);
  return v;
}

/** Replace {{param.x}} tokens in `sql` using declared params + supplied values.
 *  - daterange param `p` provides {{param.from}} and {{param.to}} (value: { from, to }).
 *  - text/select provide {{param.<id>}} as a quoted string literal.
 *  Read-only substitution only; caller has already run validateSelectSql. */
export function substituteParams(
  sql: string, params: DashboardCustomQueryParam[], values: Record<string, unknown>,
): string {
  const replacements = new Map<string, string>();
  for (const p of params) {
    const v = values[p.id];
    if (p.type === 'daterange') {
      const dr = (v ?? {}) as { from?: unknown; to?: unknown };
      if (p.required && (dr.from == null || dr.to == null)) throw new Error(`required parameter: ${p.id}`);
      if (dr.from != null) replacements.set('from', sqlString(assertDate(dr.from)));
      if (dr.to != null) replacements.set('to', sqlString(assertDate(dr.to)));
    } else {
      if (p.required && (v == null || v === '')) throw new Error(`required parameter: ${p.id}`);
      if (v != null) replacements.set(p.id, sqlString(String(v)));
    }
  }
  return sql.replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const r = replacements.get(key);
    if (r === undefined) throw new Error(`unbound parameter: ${key}`);
    return r;
  });
}

const ROW_CAP = 1000;

export interface RunStoredQueryDeps {
  customQueries: Pick<CustomQueryStore, 'get'>;
  runConnectorSql(input: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
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
  return deps.runConnectorSql({ connectorId: rec.connectorId, sql: inner, rowCap: ROW_CAP });
}
