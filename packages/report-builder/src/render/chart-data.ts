import type { WidgetQuery } from '@openldr/dashboards';

export interface ChartSeries { name: string; values: number[] }
export interface ChartData { title: string; categories: string[]; series: ChartSeries[] }
export interface ChartOpts { title?: string; categoryKey?: string; breakdownKey?: string; valueKeys?: string[] }

// Structural shape of a query result (avoids importing server-only types).
interface PivotResult { columns: { key: string; label?: string; kind?: string }[]; rows: Record<string, unknown>[] }

function firstSeen(values: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const v of values) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}

/** Pivot a result into ChartData. With `breakdownKey`, long rows pivot wide (0-fill); otherwise
 *  each numeric column (or `valueKeys`) becomes a series. Pure; deterministic first-seen order. */
export function resultToChartData(result: PivotResult | undefined, opts: ChartOpts): ChartData {
  const title = opts.title ?? '';
  if (!result || result.rows.length === 0) return { title, categories: [], series: [] };
  const cols = result.columns;
  const categoryKey = opts.categoryKey ?? cols.find((c) => c.kind !== 'number')?.key ?? cols[0]?.key ?? 'label';

  if (opts.breakdownKey) {
    const valueKey = opts.valueKeys?.[0] ?? cols.find((c) => c.kind === 'number')?.key ?? 'value';
    const categories = firstSeen(result.rows.map((r) => String(r[categoryKey] ?? '')));
    const names = firstSeen(result.rows.map((r) => String(r[opts.breakdownKey!] ?? '')));
    const cell = new Map<string, number>(); // `${cat}\0${name}` → value
    for (const r of result.rows) cell.set(`${String(r[categoryKey] ?? '')}\0${String(r[opts.breakdownKey!] ?? '')}`, Number(r[valueKey] ?? 0));
    const series = names.map((name) => ({ name, values: categories.map((c) => cell.get(`${c}\0${name}`) ?? 0) }));
    return { title, categories, series };
  }

  const numericKeys = opts.valueKeys ?? cols.filter((c) => c.kind === 'number').map((c) => c.key);
  const valueKeys = numericKeys.length ? numericKeys : [cols[1]?.key ?? 'value'];
  const categories = result.rows.map((r) => String(r[categoryKey] ?? ''));
  const series = valueKeys.map((k) => ({ name: cols.find((c) => c.key === k)?.label ?? k, values: result.rows.map((r) => Number(r[k] ?? 0)) }));
  return { title, categories, series };
}

/** Derive pivot opts from a block's query. Only a builder query WITH a breakdown needs explicit
 *  long-pivot keys; everything else (SQL/wide, or builder single-dimension) uses defaults. */
export function chartOpts(query: WidgetQuery | undefined): ChartOpts {
  if (query && query.mode === 'builder' && query.breakdown) {
    return { categoryKey: 'label', breakdownKey: 'series', valueKeys: ['value'] };
  }
  return {};
}
