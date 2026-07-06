import type { WidgetQuery } from '@openldr/dashboards';
import type { ReportResult } from '@openldr/reporting';
import type { Block, ReportTemplate } from '../schema';
import type { CellData, ResolvedTemplate } from './layout';

const PARAM_TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;

function subst(value: unknown, params: Record<string, string>): unknown {
  if (typeof value !== 'string') return value;
  if (!value.includes('{{')) return value;
  return value.replace(PARAM_TOKEN, (_m, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function isBlankValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0 || v.every((x) => x === null || x === undefined || x === '');
  return false;
}

/** Return a deep copy of `q` with any `{{param.<id>}}` tokens in builder filter values or
 *  sql `values` replaced by the supplied param values. Pure — does not mutate `q`. */
export function resolveQueryParams(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  if (clone.mode === 'builder') {
    clone.filters = (clone.filters ?? [])
      .map((f) => ({ ...f, value: subst(f.value, params) as never }))
      .filter((f) => !isBlankValue(f.value));
  } else {
    if (clone.values) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(clone.values)) next[k] = subst(v, params);
      clone.values = next as never;
    }
  }
  return clone;
}

export type QueryFn = (q: WidgetQuery) => Promise<ReportResult>;

// A data-bearing block carries its own WidgetQuery, EXCEPT a table with source:'primary'
// (which binds to the template dataset). Returns the query to run, or null if none.
function blockQuery(block: Block): WidgetQuery | null {
  if (block.kind === 'kpi' || block.kind === 'chart') return block.query;
  if (block.kind === 'table') return block.source === 'primary' ? null : block.source;
  return null;
}

export async function runTemplate(
  template: ReportTemplate,
  params: Record<string, string>,
  queryFn: QueryFn,
): Promise<ResolvedTemplate> {
  // Dedup cache keyed by the resolved-query JSON. A miss runs queryFn; a thrown query is
  // cached as an error so repeats don't re-run and one bad block can't fail the whole render.
  const cache = new Map<string, CellData>();
  const run = async (q: WidgetQuery): Promise<CellData> => {
    const resolved = resolveQueryParams(q, params);
    const key = JSON.stringify(resolved);
    const hit = cache.get(key);
    if (hit) return hit;
    let cell: CellData;
    try { cell = { result: await queryFn(resolved) }; }
    catch (e) { cell = { error: e instanceof Error ? e.message : String(e) }; }
    cache.set(key, cell);
    return cell;
  };

  const primary = template.dataset ? await run(template.dataset) : undefined;

  const cells: Record<string, CellData> = {};
  for (let r = 0; r < template.rows.length; r++) {
    const row = template.rows[r];
    for (let c = 0; c < row.cells.length; c++) {
      const q = blockQuery(row.cells[c].block);
      if (q) cells[`${r}:${c}`] = await run(q);
    }
  }
  return { template, params, primary, cells };
}
