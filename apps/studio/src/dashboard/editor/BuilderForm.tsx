import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DashboardFilterDef, ModelDimension, QueryModel } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FilterTreeEditor } from './FilterTreeEditor';
import { MeasuresEditor } from './MeasuresEditor';
import { JoinColumnPicker } from './JoinColumnPicker';
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
  addAdhocDimensionPatch,
  removeAdhocDimensionPatch,
  type BuilderQuery,
} from './builderForm.model';

// Radix Select renders `<SelectItem value="">` as an error, so "no selection" is modeled with
// this sentinel and translated back to '' before it reaches the pure builderForm.model helpers.
const NONE = '__none__';

// Ad-hoc date columns carry no server-provided grain list (effectiveModel folds them in without
// dateGrain), so the picker offers these defaults — matching the model registry's DATE_GRAINS.
// The server buckets on q.dimension.grain regardless of the dim's dateGrain, so any of these works.
const DATE_GRAINS = ['day', 'week', 'month', 'year'];

// A removable optional-clause card: themed border + header (label + × remove) wrapping its editor.
// Studio has no Tabler/`ti` icon font, so the header is text-only (no icon dependency introduced).
function SectionCard({ label, onRemove, children }: {
  label: string; onRemove: () => void; children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

type SectionKey = 'summarize' | 'filter' | 'groupby' | 'breakdown' | 'sort';
const SECTION_ORDER: SectionKey[] = ['summarize', 'filter', 'groupby', 'breakdown', 'sort'];
const SECTION_LABEL: Record<SectionKey, string> = { summarize: 'Summarize', filter: 'Filter', groupby: 'Group by', breakdown: 'Breakdown', sort: 'Sort' };

export function BuilderForm({ models, value, dashboardFilters = [], onChange }: {
  models: QueryModel[]; value: BuilderQuery; dashboardFilters?: DashboardFilterDef[]; onChange: (q: BuilderQuery) => void;
}) {
  const model = models.find((m) => m.id === value.model) ?? models[0];

  const adhoc = value.adhocDimensions ?? [];
  // Merge ad-hoc join columns into the effective dimension list (mirrors the server's effectiveModel)
  // so they're first-class in Group by, Breakdown, and the filter tree. Date columns get default
  // grains since ad-hoc dims carry no dateGrain of their own.
  const dimOptions: ModelDimension[] = [
    ...(model?.dimensions ?? []),
    ...adhoc.map((a) => ({ key: a.key, label: a.label, column: a.column, kind: a.kind, join: a.join, ...(a.kind === 'date' ? { dateGrain: DATE_GRAINS } : {}) })),
  ];
  const dim = dimOptions.find((d) => d.key === value.dimension?.key);
  const [addOpen, setAddOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Which optional sections are shown. Lazy initializer captures the query state only on mount, so a
  // section stays shown after you clear its field mid-edit (matching Metabase's clause chips).
  const hasFilter = !!value.filterTree || !!(value.filters && value.filters.length);
  const [shown, setShown] = useState<Set<SectionKey>>(() => {
    const s = new Set<SectionKey>();
    if (measuresOf(value).length) s.add('summarize');
    if (hasFilter) s.add('filter');
    if (value.dimension) s.add('groupby');
    if (value.breakdown) s.add('breakdown');
    if (value.limit != null) s.add('sort');
    return s;
  });

  const addSection = (k: SectionKey) => { setShown((prev) => new Set(prev).add(k)); setAddOpen(false); };
  const removeSection = (k: SectionKey) => {
    setShown((prev) => { const n = new Set(prev); n.delete(k); return n; });
    if (k === 'summarize') onChange(setMeasuresPatch(value, []));
    if (k === 'filter') onChange(setFilterTreePatch(value, emptyTree()));
    if (k === 'groupby') onChange(setDimensionPatch(value, ''));
    if (k === 'breakdown') onChange(setBreakdownPatch(value, ''));
    if (k === 'sort') onChange(setLimitPatch(value, undefined));
  };
  const unshown = SECTION_ORDER.filter((k) => !shown.has(k));

  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="rounded-lg border border-border bg-card p-3">
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
      </div>

      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">optional — add only what you need</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {shown.has('summarize') && (
        <SectionCard label="Summarize" onRemove={() => removeSection('summarize')}>
          <MeasuresEditor value={measuresOf(value)} model={model} onChange={(list) => onChange(setMeasuresPatch(value, list))} />
        </SectionCard>
      )}

      {shown.has('filter') && (
        <SectionCard label="Filter" onRemove={() => removeSection('filter')}>
          <FilterTreeEditor
            value={value.filterTree ?? (value.filters?.length ? filtersToTree(value.filters) : emptyTree())}
            dimensions={dimOptions}
            onChange={(tree) => onChange(setFilterTreePatch(value, tree))}
          />
        </SectionCard>
      )}

      {shown.has('groupby') && (
        <SectionCard label="Group by" onRemove={() => removeSection('groupby')}>
          <label className="text-sm">
            Group by
            <Select value={value.dimension?.key ?? NONE} onValueChange={(key) => onChange(setDimensionPatch(value, key === NONE ? '' : key))}>
              <SelectTrigger aria-label="Group by" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>(none)</SelectItem>
                {dimOptions.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {dim?.kind === 'date' && dim.dateGrain && (
            <label className="mt-2 block text-sm">
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
        </SectionCard>
      )}

      {shown.has('breakdown') && (
        <SectionCard label="Breakdown" onRemove={() => removeSection('breakdown')}>
          <label className="text-sm">
            Breakdown
            <Select value={value.breakdown?.key ?? NONE} onValueChange={(key) => onChange(setBreakdownPatch(value, key === NONE ? '' : key))}>
              <SelectTrigger aria-label="Breakdown" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>(none)</SelectItem>
                {dimOptions.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </SectionCard>
      )}

      {shown.has('sort') && (
        <SectionCard label="Sort" onRemove={() => removeSection('sort')}>
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
        </SectionCard>
      )}

      {adhoc.length > 0 && (
        <SectionCard label="Join columns" onRemove={() => adhoc.forEach((a) => onChange(removeAdhocDimensionPatch(value, a.key)))}>
          <div className="flex flex-wrap gap-1">
            {adhoc.map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {a.label}
                <button type="button" aria-label={`Remove ${a.label}`} onClick={() => onChange(removeAdhocDimensionPatch(value, a.key))}>×</button>
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="border-t border-border pt-2">
        {!showPicker && (
          <>
            <Button size="sm" variant="outline" aria-label="Add clause" onClick={() => setAddOpen((o) => !o)}>＋ Add</Button>
            {addOpen && (
              <div className="mt-1 flex flex-col items-start gap-1">
                {unshown.map((k) => (
                  <button key={k} type="button" className="text-sm" onClick={() => addSection(k)}>{SECTION_LABEL[k]}</button>
                ))}
                {model?.optionalJoins?.length ? (
                  <button type="button" className="text-sm text-primary" onClick={() => { setShowPicker(true); setAddOpen(false); }}>Join column</button>
                ) : null}
                {!unshown.length && !model?.optionalJoins?.length && <span className="text-xs text-muted-foreground">Nothing left to add</span>}
              </div>
            )}
          </>
        )}
        {showPicker && model?.optionalJoins && (
          <div className="mt-2">
            <JoinColumnPicker
              optionalJoins={model.optionalJoins}
              onAdd={(d) => { onChange(addAdhocDimensionPatch(value, d)); setShowPicker(false); }}
              onCancel={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
