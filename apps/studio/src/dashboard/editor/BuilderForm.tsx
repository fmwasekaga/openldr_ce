import type { QueryModel, WidgetQuery } from '../../api';
import { MetricConditionEditor, type MetricCondition } from './MetricConditionEditor';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;

export function BuilderForm({ models, value, onChange }: { models: QueryModel[]; value: BuilderQuery; onChange: (q: BuilderQuery) => void }) {
  const model = models.find((m) => m.id === value.model) ?? models[0];
  const setModel = (id: string) => { const m = models.find((x) => x.id === id)!; onChange({ ...value, model: id, metric: m.metrics[0], metrics: undefined, dimension: undefined, filters: [], filterTree: undefined }); };
  const setMetric = (key: string) => { const mm = model.metrics.find((x) => x.key === key)!; onChange({ ...value, metric: mm }); };
  const setWhere = (w: MetricCondition[]) => onChange({ ...value, metric: { ...value.metric, where: w.length ? w : undefined } });
  const setDim = (key: string) => onChange({ ...value, dimension: key ? { key } : undefined });
  const dim = model?.dimensions.find((d) => d.key === value.dimension?.key);
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">Source
        <select aria-label="Source" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className="text-sm">Metric
        <select aria-label="Metric" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.metric.key} onChange={(e) => setMetric(e.target.value)}>
          {model?.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      <div className="text-sm">Only where
        <MetricConditionEditor
          conditions={(value.metric.where ?? []) as MetricCondition[]}
          dimensions={model?.dimensions ?? []}
          onChange={setWhere}
        />
      </div>
      <label className="text-sm">Group by
        <select aria-label="Group by" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.dimension?.key ?? ''} onChange={(e) => setDim(e.target.value)}>
          <option value="">(none)</option>
          {model?.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </label>
      {dim?.kind === 'date' && dim.dateGrain && (
        <label className="text-sm">Grain
          <select aria-label="Grain" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.dimension?.grain ?? 'month'} onChange={(e) => onChange({ ...value, dimension: { key: dim.key, grain: e.target.value } })}>
            {dim.dateGrain.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
