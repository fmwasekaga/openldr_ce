import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import { MetricConditionEditor, type MetricCondition } from '../dashboard/editor/MetricConditionEditor';

export interface ListMetric { key: string; label?: string; agg: string; column?: string; where?: MetricCondition[] }

const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

export function MetricsListEditor({ metrics, dimensions, onChange }: {
  metrics: ListMetric[]; dimensions: ModelDimension[]; onChange: (m: ListMetric[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<ListMetric>) =>
    onChange(metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = () => onChange([...metrics, { key: `m${metrics.length + 1}`, agg: 'count' }]);
  const remove = (i: number) => onChange(metrics.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">Metrics (table columns)</div>
      {metrics.map((m, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
          <div className="flex items-center gap-1">
            <Input aria-label="Metric label" className="h-7 flex-1 text-xs" placeholder="Column label"
              value={m.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
            <select aria-label="Metric aggregate" className="h-7 rounded border border-border bg-background text-xs"
              value={m.agg} onChange={(e) => update(i, { agg: e.target.value })}>
              {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove metric" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {m.agg !== 'count' && (
            <select aria-label="Metric column" className="h-7 rounded border border-border bg-background text-xs"
              value={m.column ?? ''} onChange={(e) => update(i, { column: e.target.value || undefined })}>
              <option value="">(column…)</option>
              {dimensions.map((d) => <option key={d.key} value={d.column}>{d.label}</option>)}
            </select>
          )}
          <MetricConditionEditor
            conditions={m.where ?? []}
            dimensions={dimensions}
            onChange={(w) => update(i, { where: w.length ? w : undefined })}
          />
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add metric</Button>
    </div>
  );
}
