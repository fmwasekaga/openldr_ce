import type { DashboardFilterDef, QueryModel } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { FilterConditionEditor, type FilterCondition } from './FilterConditionEditor';
import {
  setModelPatch,
  setMetricPatch,
  setDimensionPatch,
  setGrainPatch,
  setBreakdownPatch,
  setFiltersPatch,
  type BuilderQuery,
} from './builderForm.model';

// Radix Select renders `<SelectItem value="">` as an error, so "no selection" is modeled with
// this sentinel and translated back to '' before it reaches the pure builderForm.model helpers.
const NONE = '__none__';

export function BuilderForm({ models, value, dashboardFilters = [], onChange }: {
  models: QueryModel[]; value: BuilderQuery; dashboardFilters?: DashboardFilterDef[]; onChange: (q: BuilderQuery) => void;
}) {
  const model = models.find((m) => m.id === value.model) ?? models[0];
  const dim = model?.dimensions.find((d) => d.key === value.dimension?.key);

  return (
    <div className="flex flex-col gap-3 p-1">
      <label className="text-sm">
        Source
        <Select value={value.model} onValueChange={(id) => onChange(setModelPatch(models, value, id))}>
          <SelectTrigger aria-label="Source" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="text-sm">
        Measure
        <Select value={value.metric.key} onValueChange={(key) => onChange(setMetricPatch(model, value, key))}>
          <SelectTrigger aria-label="Measure" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {model?.metrics.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="text-sm">
        Filters
        <FilterConditionEditor
          value={(value.filters ?? []) as FilterCondition[]}
          dimensions={model?.dimensions ?? []}
          dashboardFilters={dashboardFilters.map((f) => ({ id: f.id, label: f.label }))}
          bindings={value.variableBindings ?? {}}
          onChange={(f) => onChange(setFiltersPatch(value, f as BuilderQuery['filters']))}
          onBindingsChange={(b) => onChange({ ...value, variableBindings: b })}
        />
      </div>

      <label className="text-sm">
        Group by
        <Select value={value.dimension?.key ?? NONE} onValueChange={(key) => onChange(setDimensionPatch(value, key === NONE ? '' : key))}>
          <SelectTrigger aria-label="Group by" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>(none)</SelectItem>
            {model?.dimensions.map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {dim?.kind === 'date' && dim.dateGrain && (
        <label className="text-sm">
          Grain
          <Select value={value.dimension?.grain ?? 'month'} onValueChange={(g) => onChange(setGrainPatch(value, g))}>
            <SelectTrigger aria-label="Grain" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dim.dateGrain.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      <label className="text-sm">
        Breakdown
        <Select value={value.breakdown?.key ?? NONE} onValueChange={(key) => onChange(setBreakdownPatch(value, key === NONE ? '' : key))}>
          <SelectTrigger aria-label="Breakdown" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>(none)</SelectItem>
            {model?.dimensions.map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
