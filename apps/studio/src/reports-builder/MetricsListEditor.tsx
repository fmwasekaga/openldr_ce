import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelDimension } from '../api';
import { MetricConditionEditor, type MetricCondition } from '../dashboard/editor/MetricConditionEditor';

export interface ListMetric { key: string; label?: string; agg: string; column?: string; where?: MetricCondition[] }

const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

export function MetricsListEditor({ metrics, dimensions, onChange }: {
  metrics: ListMetric[]; dimensions: ModelDimension[]; onChange: (m: ListMetric[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<ListMetric>) =>
    onChange(metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = () => {
    const nums = metrics
      .map((m) => /^m(\d+)$/.exec(m.key)?.[1])
      .filter((n): n is string => n != null)
      .map(Number);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    onChange([...metrics, { key: `m${next}`, agg: 'count' }]);
  };
  const remove = (i: number) => onChange(metrics.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">{t('reportBuilder.metrics.heading')}</div>
      {metrics.map((m, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
          <div className="flex items-center gap-1">
            <Input aria-label={t('reportBuilder.metrics.label')} className="h-7 flex-1 text-xs" placeholder={t('reportBuilder.metrics.labelPlaceholder')}
              value={m.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
            <select aria-label={t('reportBuilder.metrics.aggregate')} className="h-7 rounded border border-border bg-background text-xs"
              value={m.agg} onChange={(e) => update(i, { agg: e.target.value })}>
              {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t('reportBuilder.metrics.remove')} onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {m.agg !== 'count' && (
            <select aria-label={t('reportBuilder.metrics.column')} className="h-7 rounded border border-border bg-background text-xs"
              value={m.column ?? ''} onChange={(e) => update(i, { column: e.target.value || undefined })}>
              <option value="">{t('reportBuilder.metrics.columnPlaceholder')}</option>
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
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>{t('reportBuilder.metrics.add')}</Button>
    </div>
  );
}
