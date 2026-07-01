// Shared SQL-variable template logic, used by BOTH the client (widget editor preview + live
// widget) and the server (vetted stored-SQL execution), so a saved `{{var}}` / `[[ ... ]]`
// widget resolves identically everywhere. Keeping this on the server lets the query route
// receive the STORED template string (stable, vettable) plus opaque filter values, and apply
// the substitution itself — the client never bakes arbitrary SQL into the submitted string.

/** Resolve a name→value map into the flat key set the SQL template references, splitting a
 *  date-range value (`{from,to}`) into `name_from` / `name_to`. */
export function resolveValues(values: Record<string, unknown>): Record<string, string | number | null> {
  const resolved: Record<string, string | number | null> = {};
  for (const [name, val] of Object.entries(values)) {
    if (val && typeof val === 'object' && 'from' in (val as Record<string, unknown>)) {
      const r = val as { from: string; to: string };
      resolved[`${name}_from`] = r.from || null;
      resolved[`${name}_to`] = r.to || null;
    } else {
      resolved[name] = (val as string | number | null) ?? null;
    }
  }
  return resolved;
}

/** Apply `[[ ... {{var}} ... ]]` conditional clauses (kept only when every variable inside is
 *  set) then substitute `{{var}}` with a quoted literal (or `NULL`). Values become SQL literals;
 *  this path is vetted (template must match a persisted widget) or admin-gated, Postgres-only
 *  and read-only. */
export function applyTemplate(sql: string, resolved: Record<string, string | number | null>): string {
  const isSet = (v: string | number | null | undefined) => v !== null && v !== undefined && v !== '';
  const withClauses = sql.replace(/\[\[([\s\S]*?)\]\]/g, (_, clause: string) => {
    const vars = (clause.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2));
    return vars.every((v) => isSet(resolved[v])) ? clause : '';
  });
  return withClauses.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = resolved[name];
    if (!isSet(v)) return 'NULL';
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}
