import type { WidgetQuery } from '@openldr/dashboards';

const PARAM_TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;

function subst(value: unknown, params: Record<string, string>): unknown {
  if (typeof value !== 'string') return value;
  if (!value.includes('{{')) return value;
  return value.replace(PARAM_TOKEN, (_m, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Return a deep copy of `q` with any `{{param.<id>}}` tokens in builder filter values or
 *  sql `values` replaced by the supplied param values. Pure — does not mutate `q`. */
export function resolveQueryParams(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  if (clone.mode === 'builder') {
    clone.filters = (clone.filters ?? []).map((f) => ({ ...f, value: subst(f.value, params) as never }));
  } else {
    if (clone.values) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(clone.values)) next[k] = subst(v, params);
      clone.values = next as never;
    }
  }
  return clone;
}
