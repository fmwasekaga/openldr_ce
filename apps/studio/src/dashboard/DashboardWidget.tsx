import { useEffect, useState } from 'react';
import { runWidgetQuery, type ReportResult, type WidgetConfig, type WidgetQuery } from '../api';
import { renderWidget } from './widgets';

export function bindQuery(q: WidgetQuery, filterValues: Record<string, unknown>): WidgetQuery {
  if (q.mode === 'builder') {
    if (!q.variableBindings) return q;
    const filters = [...q.filters];
    for (const [dimKey, filterId] of Object.entries(q.variableBindings)) {
      const v = filterValues[filterId];
      if (v == null || v === '') continue;
      if (typeof v === 'object' && 'from' in v && 'to' in v) {
        const range = v as { from: string; to: string };
        if (range.from) filters.push({ dimension: dimKey, op: 'gte', value: range.from });
        if (range.to) filters.push({ dimension: dimKey, op: 'lte', value: range.to });
      } else {
        filters.push({ dimension: dimKey, op: 'eq', value: v as string | number });
      }
    }
    return { ...q, filters };
  }
  // SQL mode: send the STORED template `sql` verbatim plus the resolved dashboard-filter values.
  // The SERVER applies the {{var}} / [[ ... ]] substitution — so the submitted `sql` stays
  // byte-identical to the persisted widget and the server can vet it against stored dashboards
  // even when filters are set (execution of vetted SQL is allowed with the `dashboard.raw_sql` flag off).
  const values: Record<string, string | number | null | { from: string; to: string }> = {};
  for (const [varName, filterId] of Object.entries(q.variableBindings ?? {})) {
    const v = filterValues[filterId];
    values[varName] = (v ?? null) as string | number | null | { from: string; to: string };
  }
  return { ...q, values };
}

export function DashboardWidget({ config, filterValues }: { config: WidgetConfig; filterValues: Record<string, unknown> }) {
  const [result, setResult] = useState<ReportResult>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    const run = () => runWidgetQuery(bindQuery(config.query, filterValues)).then((r) => alive && setResult(r)).catch((e) => alive && setError(String(e.message ?? e)));
    run();
    const ms = config.refreshIntervalSec * 1000;
    const t = ms > 0 ? setInterval(run, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.query), JSON.stringify(filterValues), config.refreshIntervalSec]);
  if (error) return <div className="p-3 text-sm text-destructive">{error}</div>;
  if (!result || !result.rows) return <div className="p-3 text-sm text-muted-foreground">Loading…</div>;
  return <div className="h-full w-full">{renderWidget(config, result)}</div>;
}
