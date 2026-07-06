import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { listModels, type QueryModel, type WidgetQuery } from '../api';
import { BuilderForm } from '../dashboard/editor/BuilderForm';
import { FilterListEditor, type BuilderFilter } from './FilterListEditor';
import { MetricsListEditor } from './MetricsListEditor';
import { SqlQueryEditor } from './SqlQueryEditor';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
type SqlQuery = Extract<WidgetQuery, { mode: 'sql' }>;
const EMPTY: BuilderQuery = { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] };
const EMPTY_SQL: SqlQuery = { mode: 'sql', sql: 'select 1 as value', values: {} };
const CHART_TYPES: { v: 'bar' | 'line' | 'pie'; labelKey: string }[] = [{ v: 'bar', labelKey: 'reportBuilder.query.bar' }, { v: 'line', labelKey: 'reportBuilder.query.line' }, { v: 'pie', labelKey: 'reportBuilder.query.pie' }];
const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;

export function QueryEditor({ block, parameters, sqlEnabled = false, onChange }: { block: Block; parameters: ReportParam[]; sqlEnabled?: boolean; onChange: (patch: Partial<Block>) => void }): JSX.Element {
  const { t } = useTranslation();
  const [models, setModels] = useState<QueryModel[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);
  useEffect(() => { listModels().then(setModels).catch(() => setModels([])); }, []);

  const isTable = block.kind === 'table';
  // The raw stored query for this block, or null (table:'primary').
  const rawQuery: WidgetQuery | null = isTable
    ? (block.source === 'primary' ? null : (block.source as WidgetQuery))
    : ((block as { query?: WidgetQuery }).query ?? null);
  const mode: 'builder' | 'sql' = rawQuery?.mode === 'sql' ? 'sql' : 'builder';
  const builderQuery: BuilderQuery = rawQuery?.mode === 'builder' ? rawQuery : EMPTY;
  const sqlQuery: SqlQuery = rawQuery?.mode === 'sql' ? rawQuery : EMPTY_SQL;

  const setQuery = (q: WidgetQuery) => {
    if (block.kind === 'kpi' || block.kind === 'chart') onChange({ query: q } as Partial<Block>);
    else if (isTable) onChange({ source: q } as Partial<Block>);
  };

  const showBuilder = !isTable || block.source !== 'primary';
  const dimensions = models.find((m) => m.id === builderQuery.model)?.dimensions ?? [];
  // SQL authoring for a new (non-sql) block requires the flag; an existing sql block stays viewable.
  const sqlToggleDisabled = !sqlEnabled && mode !== 'sql';
  const boundParams = Object.entries(sqlQuery.values ?? {})
    .map(([v, val]) => [v, (typeof val === 'string' ? val.match(PARAM_TOKEN)?.[1] : undefined)] as const)
    .filter(([, p]) => p);

  return (
    <div className="flex flex-col gap-3">
      {isTable && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={block.source === 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: 'primary' } as Partial<Block>)}>{t('reportBuilder.query.primaryDataset')}</Button>
          <Button type="button" size="sm" variant={block.source !== 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: { ...EMPTY } } as Partial<Block>)}>{t('reportBuilder.query.ownQuery')}</Button>
        </div>
      )}

      {showBuilder && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={mode === 'builder' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => { if (mode !== 'builder') setQuery({ ...EMPTY }); }}>{t('reportBuilder.query.builder')}</Button>
          <Button type="button" size="sm" variant={mode === 'sql' ? 'default' : 'outline'} className="h-7 flex-1" disabled={sqlToggleDisabled} onClick={() => { if (mode !== 'sql') setQuery({ ...EMPTY_SQL }); }}>{t('reportBuilder.query.sql')}</Button>
        </div>
      )}

      {showBuilder && mode === 'builder' && (
        <>
          {models.length ? <BuilderForm models={models} value={builderQuery} onChange={(q) => setQuery(q)} /> : <p className="text-xs text-muted-foreground">{t('reportBuilder.query.loadingSources')}</p>}
          {block.kind === 'table' && models.length > 0 && (
            <MetricsListEditor
              metrics={builderQuery.metrics ?? []}
              dimensions={dimensions}
              onChange={(ms) => setQuery({ ...builderQuery, metrics: ms.length ? ms : undefined, metric: ms.find((m) => !m.derived) ?? builderQuery.metric })}
            />
          )}
          {models.length > 0 && (
            <FilterListEditor
              filters={(builderQuery.filters ?? []) as BuilderFilter[]}
              dimensions={dimensions}
              parameters={parameters}
              onChange={(f) => setQuery({ ...builderQuery, filters: f as BuilderQuery['filters'] })}
            />
          )}
          {block.kind === 'chart' && models.length > 0 && (
            <label className="flex flex-col gap-1 text-xs">{t('reportBuilder.query.breakdown')}
              <select
                aria-label={t('reportBuilder.query.breakdownAria')}
                className="h-7 rounded border border-border bg-background text-xs"
                value={builderQuery.breakdown?.key ?? ''}
                onChange={(e) => setQuery({ ...builderQuery, breakdown: e.target.value ? { key: e.target.value } : undefined })}
              >
                <option value="">{t('reportBuilder.query.none')}</option>
                {dimensions.filter((d) => d.key !== builderQuery.dimension?.key).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
          )}
        </>
      )}

      {showBuilder && mode === 'sql' && (
        <div className="flex flex-col gap-2">
          <pre className="max-h-24 overflow-auto rounded border border-border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{sqlQuery.sql}</pre>
          {boundParams.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {boundParams.map(([v, p]) => <div key={v}><code className="font-mono">{`{{${v}}}`}</code> → {parameters.find((pp) => pp.id === p)?.label ?? p}</div>)}
            </div>
          )}
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSqlOpen(true)}>{t('reportBuilder.query.editSql')}</Button>
          <SqlQueryEditor
            open={sqlOpen}
            sql={sqlQuery.sql}
            values={sqlQuery.values ?? {}}
            parameters={parameters}
            sqlEnabled={sqlEnabled}
            onClose={() => setSqlOpen(false)}
            onSave={(q) => setQuery(q)}
          />
        </div>
      )}

      {block.kind === 'chart' && (
        <div className="flex flex-col gap-1 text-xs">{t('reportBuilder.query.chartType')}
          <div className="flex gap-1">
            {CHART_TYPES.map((c) => (
              <Button key={c.v} type="button" size="sm" variant={block.chartType === c.v ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ chartType: c.v } as Partial<Block>)}>{t(c.labelKey)}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
