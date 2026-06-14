import { useEffect, useState } from 'react';
import { runWidgetQuery, type ReportResult, type WidgetConfig, type WidgetQuery } from '../api';
import { renderWidget } from './widgets';

function bindQuery(q: WidgetQuery, filterValues: Record<string, unknown>): WidgetQuery {
  if (!q.variableBindings) return q;
  if (q.mode === 'builder') {
    const filters = [...q.filters];
    for (const [varName, filterId] of Object.entries(q.variableBindings)) {
      const v = filterValues[filterId];
      if (v != null && v !== '') filters.push({ dimension: varName, op: 'eq', value: v });
    }
    return { ...q, filters };
  }
  let sqlText = q.sql;
  for (const [varName, filterId] of Object.entries(q.variableBindings)) {
    const v = filterValues[filterId];
    sqlText = sqlText.replaceAll(`{{${varName}}}`, v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  }
  return { ...q, sql: sqlText };
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
