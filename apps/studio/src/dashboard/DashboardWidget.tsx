import { useEffect, useState } from 'react';
import { runWidgetQuery, type ReportResult, type WidgetConfig, type WidgetQuery } from '../api';
import { renderWidget } from './widgets';

function bindQuery(q: WidgetQuery, filterValues: Record<string, unknown>): WidgetQuery {
  if (q.mode === 'builder') {
    if (!q.variableBindings) return q;
    const filters = [...q.filters];
    for (const [varName, filterId] of Object.entries(q.variableBindings)) {
      const v = filterValues[filterId];
      if (v != null && v !== '') filters.push({ dimension: varName, op: 'eq', value: v });
    }
    return { ...q, filters };
  }
  // SQL mode: send the STORED template `sql` verbatim plus the resolved dashboard-filter values.
  // The SERVER applies the {{var}} / [[ ... ]] substitution — so the submitted `sql` stays
  // byte-identical to the persisted widget and the server can vet it against stored dashboards
  // even when filters are set (execution of vetted SQL is allowed with DASHBOARD_SQL_ENABLED off).
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
