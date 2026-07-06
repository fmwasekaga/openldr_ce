import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';
import { RuleValueEditor } from './RuleValueEditor';

// Studio builder-filter shape (loose, mirrors api.ts WidgetQuery filters).
export interface BuilderFilter { dimension: string; op: string; value: unknown }

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;

export function FilterListEditor({ filters, dimensions, parameters, onChange }: {
  filters: BuilderFilter[];
  dimensions: ModelDimension[];
  parameters: ReportParam[];
  onChange: (f: BuilderFilter[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<BuilderFilter>) =>
    onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () =>
    onChange([...filters, { dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportBuilder.filters.heading')}</div>
      {filters.map((f, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
          <div className="flex gap-1">
            <select
              aria-label={`filter-${i}-dimension`}
              className="h-7 flex-1 rounded border border-border bg-background text-xs"
              value={f.dimension}
              onChange={(e) => update(i, { dimension: e.target.value })}
            >
              {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select
              aria-label={`filter-${i}-op`}
              className="h-7 w-20 rounded border border-border bg-background text-xs"
              value={f.op}
              onChange={(e) => update(i, { op: e.target.value })}
            >
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <RuleValueEditor
              op={f.op}
              value={f.value}
              parameters={parameters}
              onChange={(v) => update(i, { value: v })}
              idPrefix={`filter-${i}`}
            />
            <Button
              type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive"
              aria-label={`filter-${i}-remove`} onClick={() => remove(i)}
            ><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>{t('reportBuilder.filters.addFilter')}</Button>
    </div>
  );
}
