import type { WidgetQuery } from '@openldr/dashboards';

export interface MatrixOpts { rowKey: string; colKey: string; valueKey: string }
interface PivotResult { columns: { key: string; label?: string; kind?: string }[]; rows: Record<string, unknown>[] }

function firstSeen(values: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const v of values) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}

/** Pivot opts when the query is a builder query WITH a breakdown (the long [label,series,value] shape). */
export function matrixOpts(query: WidgetQuery | undefined): MatrixOpts | null {
  if (query && query.mode === 'builder' && query.breakdown) return { rowKey: 'label', colKey: 'series', valueKey: 'value' };
  return null;
}

/** Pivot a long [rowKey,colKey,valueKey] result into a wide matrix result (dynamic columns, 0-fill). Pure. */
export function resultToMatrix(result: PivotResult, opts: MatrixOpts): PivotResult {
  const rowLabels = firstSeen(result.rows.map((r) => String(r[opts.rowKey] ?? '')));
  const colNames = firstSeen(result.rows.map((r) => String(r[opts.colKey] ?? '')));
  const cell = new Map<string, unknown>(); // `${row}\0${col}` → value
  for (const r of result.rows) cell.set(`${String(r[opts.rowKey] ?? '')}\0${String(r[opts.colKey] ?? '')}`, r[opts.valueKey] ?? 0);
  const rowCol = result.columns.find((c) => c.key === opts.rowKey);
  const columns = [
    { key: opts.rowKey, label: rowCol?.label ?? opts.rowKey, kind: 'string' },
    ...colNames.map((n) => ({ key: n, label: n, kind: 'number' })),
  ];
  const rows = rowLabels.map((label) => {
    const row: Record<string, unknown> = { [opts.rowKey]: label };
    for (const n of colNames) row[n] = cell.get(`${label}\0${n}`) ?? 0;
    return row;
  });
  return { columns, rows };
}

/** Effective table result: pivoted when `source` is a builder query with a breakdown, else the raw result. */
export function pivotTableResult(source: unknown, result: PivotResult | undefined): PivotResult | undefined {
  if (!result) return result;
  const query = source && source !== 'primary' ? (source as WidgetQuery) : undefined;
  const mo = matrixOpts(query);
  return mo ? resultToMatrix(result, mo) : result;
}
