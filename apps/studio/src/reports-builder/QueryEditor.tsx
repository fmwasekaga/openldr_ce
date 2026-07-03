import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listModels, type QueryModel, type WidgetQuery } from '../api';
import { BuilderForm } from '../dashboard/editor/BuilderForm';
import { FilterListEditor, type BuilderFilter } from './FilterListEditor';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
const EMPTY: BuilderQuery = { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] };
const CHART_TYPES: { v: 'bar' | 'line' | 'pie'; label: string }[] = [{ v: 'bar', label: 'Bar' }, { v: 'line', label: 'Line' }, { v: 'pie', label: 'Pie' }];

export function QueryEditor({ block, parameters, onChange }: { block: Block; parameters: ReportParam[]; onChange: (patch: Partial<Block>) => void }): JSX.Element {
  const [models, setModels] = useState<QueryModel[]>([]);
  useEffect(() => { listModels().then(setModels).catch(() => setModels([])); }, []);

  const isTable = block.kind === 'table';
  const query: BuilderQuery = isTable
    ? (block.source === 'primary' ? EMPTY : (block.source as BuilderQuery))
    : ((block as { query?: WidgetQuery }).query?.mode === 'builder' ? (block as { query: BuilderQuery }).query : EMPTY);

  const setQuery = (q: BuilderQuery) => {
    if (block.kind === 'kpi' || block.kind === 'chart') onChange({ query: q } as Partial<Block>);
    else if (isTable) onChange({ source: q } as Partial<Block>);
  };

  const showBuilder = !isTable || block.source !== 'primary';
  const dimensions = models.find((m) => m.id === query.model)?.dimensions ?? [];

  return (
    <div className="flex flex-col gap-3">
      {isTable && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={block.source === 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: 'primary' } as Partial<Block>)}>Primary dataset</Button>
          <Button type="button" size="sm" variant={block.source !== 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: { ...EMPTY } } as Partial<Block>)}>Own query</Button>
        </div>
      )}

      {showBuilder && (
        models.length ? <BuilderForm models={models} value={query} onChange={setQuery} /> : <p className="text-xs text-muted-foreground">Loading data sources…</p>
      )}

      {showBuilder && models.length > 0 && (
        <FilterListEditor
          filters={(query.filters ?? []) as BuilderFilter[]}
          dimensions={dimensions}
          parameters={parameters}
          onChange={(f) => setQuery({ ...query, filters: f as BuilderQuery['filters'] })}
        />
      )}

      {block.kind === 'chart' && (
        <div className="flex flex-col gap-1 text-xs">Chart type
          <div className="flex gap-1">
            {CHART_TYPES.map((c) => (
              <Button key={c.v} type="button" size="sm" variant={block.chartType === c.v ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ chartType: c.v } as Partial<Block>)}>{c.label}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
