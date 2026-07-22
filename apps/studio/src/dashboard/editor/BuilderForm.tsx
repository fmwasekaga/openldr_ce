import type { DashboardFilterDef, QueryModel } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FilterTreeEditor } from './FilterTreeEditor';
import { MeasuresEditor } from './MeasuresEditor';
import { emptyTree, filtersToTree } from './conditionTree.model';
import {
  setModelPatch,
  setDimensionPatch,
  setGrainPatch,
  setBreakdownPatch,
  setFilterTreePatch,
  setLimitPatch,
  measuresOf,
  setMeasuresPatch,
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

      <div className="text-sm">
        Summarize
        <div className="mt-1">
          <MeasuresEditor value={measuresOf(value)} model={model} onChange={(list) => onChange(setMeasuresPatch(value, list))} />
        </div>
      </div>

      <div className="text-sm">
        Filters
        <div className="mt-1">
          <FilterTreeEditor
            value={value.filterTree ?? (value.filters?.length ? filtersToTree(value.filters) : emptyTree())}
            dimensions={model?.dimensions ?? []}
            onChange={(tree) => onChange(setFilterTreePatch(value, tree))}
          />
        </div>
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

      {(value.dimension || value.breakdown) && (
        <label className="text-sm">
          Limit
          <Input
            type="number"
            min={1}
            aria-label="Limit"
            className="mt-1 h-8 w-full text-xs"
            placeholder="All rows"
            value={value.limit ?? ''}
            onChange={(e) => onChange(setLimitPatch(value, e.target.value === '' ? undefined : Number(e.target.value)))}
          />
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Top rows by the first measure, highest first.</span>
        </label>
      )}
    </div>
  );
}
