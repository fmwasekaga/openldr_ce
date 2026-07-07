import type { CustomQueryParam } from '@openldr/dashboards';

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
  sql: string, params: CustomQueryParam[], values: Record<string, unknown>,
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
