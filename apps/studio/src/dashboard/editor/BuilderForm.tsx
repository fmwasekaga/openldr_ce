import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { Sigma, Filter, Rows3, Columns3, ArrowUpDown, Blend, Grid2x2Plus, type LucideIcon } from 'lucide-react';
import type { DashboardFilterDef, ModelDimension, QueryModel } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FilterTreeEditor } from './FilterTreeEditor';
import { MeasuresEditor } from './MeasuresEditor';
import { JoinDataPicker } from './JoinDataPicker';
import { CustomColumnEditor } from './CustomColumnEditor';
import { addCustomColumn, removeCustomColumn, customColumnKind } from './customColumns.model';
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
  removeAdhocDimensionPatch,
  removeRelationshipPatch,
  setRelationshipColumnsPatch,
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
    <div className="mx-1 rounded-md border border-border bg-card p-3">
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
const SECTION_ICON: Record<SectionKey, LucideIcon> = { summarize: Sigma, filter: Filter, groupby: Rows3, breakdown: Columns3, sort: ArrowUpDown };

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
  const customColumns = value.customColumns ?? [];
  // Custom columns are first-class group-by/breakdown dimensions (kind derived from their expr).
  dimOptions.push(...customColumns.map((c) => ({ key: c.key, label: c.label, column: '', kind: customColumnKind(c.expr) })));
  // Filters can't reference a computed expression in v1 → exclude custom columns from the filter list.
  const filterDimOptions = dimOptions.filter((d) => !customColumns.some((c) => c.key === d.key));
  // Operands may reference only plain (non-computed) dimensions: model dims (minus age-band) + ad-hoc.
  const operandDims = [
    ...(model?.dimensions ?? []).filter((d) => !d.compute).map((d) => ({ key: d.key, label: d.label, kind: d.kind })),
    ...adhoc.map((a) => ({ key: a.key, label: a.label, kind: a.kind })),
  ];
  const dim = dimOptions.find((d) => d.key === value.dimension?.key);
  const [showPicker, setShowPicker] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

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

  const addSection = (k: SectionKey) => { setShown((prev) => new Set(prev).add(k)); };
  const removeSection = (k: SectionKey) => {
    setShown((prev) => { const n = new Set(prev); n.delete(k); return n; });
    if (k === 'summarize') onChange(setMeasuresPatch(value, []));
    if (k === 'filter') onChange(setFilterTreePatch(value, emptyTree()));
    if (k === 'groupby') onChange(setDimensionPatch(value, ''));
    if (k === 'breakdown') onChange(setBreakdownPatch(value, ''));
    if (k === 'sort') onChange(setLimitPatch(value, undefined));
  };
  const unshown = SECTION_ORDER.filter((k) => !shown.has(k));

  // The optional-section cards, keyed by section, rendered only when shown.
  const sectionNodes: Record<SectionKey, ReactNode> = {
    summarize: (
      <SectionCard label="Summarize" onRemove={() => removeSection('summarize')}>
        <MeasuresEditor value={measuresOf(value)} model={model} onChange={(list) => onChange(setMeasuresPatch(value, list))} />
      </SectionCard>
    ),
    filter: (
      <SectionCard label="Filter" onRemove={() => removeSection('filter')}>
        <FilterTreeEditor
          value={value.filterTree ?? (value.filters?.length ? filtersToTree(value.filters) : emptyTree())}
          dimensions={filterDimOptions}
          onChange={(tree) => onChange(setFilterTreePatch(value, tree))}
        />
      </SectionCard>
    ),
    groupby: (
      <SectionCard label="Group by" onRemove={() => removeSection('groupby')}>
        <label className="text-sm">
          <Select value={value.dimension?.key ?? NONE} onValueChange={(key) => onChange(setDimensionPatch(value, key === NONE ? '' : key))}>
            <SelectTrigger aria-label="Group by" className="w-full">
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
    ),
    breakdown: (
      <SectionCard label="Breakdown" onRemove={() => removeSection('breakdown')}>
        <label className="text-sm">
          <Select value={value.breakdown?.key ?? NONE} onValueChange={(key) => onChange(setBreakdownPatch(value, key === NONE ? '' : key))}>
            <SelectTrigger aria-label="Breakdown" className="w-full">
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
    ),
    sort: (
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
    ),
  };

  // Ordered list of every visible optional block: one relationship card per active join alias
  // (grouped from the ad-hoc dimensions), then the custom-columns card, then the shown section
  // cards (in SECTION_ORDER) — Metabase-style, join/custom-column blocks sit right under Data,
  // ahead of the clause sections. A subtle hairline is rendered before each block (and before the
  // Add tiles) so every section is visually separated, no label.
  const visibleBlocks: ReactNode[] = [
    ...[...new Set(adhoc.map((a) => a.join))].map((alias) => {
      const meta = model?.optionalJoins?.find((j) => j.alias === alias);
      const cols = adhoc.filter((a) => a.join === alias);
      const label = meta?.label ?? alias;
      return (
        <SectionCard key={`__join_${alias}__`} label={`Join: ${label}`} onRemove={() => onChange(removeRelationshipPatch(value, alias))}>
          {meta && <p className="mb-2 text-xs text-muted-foreground">on {meta.left} = {meta.right}</p>}
          <div className="flex flex-wrap gap-1">
            {cols.map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {a.label}
                <button type="button" aria-label={`Remove ${a.label}`} onClick={() => onChange(removeAdhocDimensionPatch(value, a.key))}>×</button>
              </span>
            ))}
          </div>
        </SectionCard>
      );
    }),
    ...(customColumns.length > 0
      ? [
          <SectionCard key="__customcols__" label="Custom columns" onRemove={() => onChange(customColumns.reduce((q, c) => removeCustomColumn(q, c.key), value))}>
            <div className="flex flex-wrap gap-1">
              {customColumns.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                  {c.label}
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={() => onChange(removeCustomColumn(value, c.key))}>×</button>
                </span>
              ))}
            </div>
          </SectionCard>,
        ]
      : []),
    ...SECTION_ORDER.filter((k) => shown.has(k)).map((k) => sectionNodes[k]),
  ];

  // Icon-only actions directly under Data (Metabase-style): Join (when joinable) + Custom column.
  const dataActions: ReactNode = (
    <div className="flex gap-1.5 px-1">
      {model?.optionalJoins?.length ? (
        <button
          type="button"
          aria-label="Join data"
          title="Join data"
          onClick={() => { setShowCustom(false); setShowPicker(true); }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card hover:bg-muted"
        >
          <Blend size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Custom column"
        title="Custom column"
        onClick={() => { setShowPicker(false); setShowCustom(true); }}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card hover:bg-muted"
      >
        <Grid2x2Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );

  // The inline JoinDataPicker / CustomColumnEditor, rendered right under the action buttons.
  const inlineEditor: ReactNode =
    showPicker && model?.optionalJoins ? (
      <div className="px-1">
        <JoinDataPicker
          optionalJoins={model.optionalJoins}
          adhoc={adhoc}
          onApply={(alias, joinLabel, columns) => { onChange(setRelationshipColumnsPatch(value, alias, joinLabel, columns)); setShowPicker(false); }}
          onCancel={() => setShowPicker(false)}
        />
      </div>
    ) : showCustom ? (
      <div className="px-1">
        <CustomColumnEditor
          dims={operandDims}
          existing={customColumns}
          onAdd={(col) => { onChange(addCustomColumn(value, col)); setShowCustom(false); }}
          onCancel={() => setShowCustom(false)}
        />
      </div>
    ) : null;

  // The bottom Add tiles row holds the unshown clause sections plus Join data and Custom column —
  // Metabase shows both of those in the icon row under Data AND again here as labeled tiles.
  // Custom column is always available, so this row always renders (unlike the clause tiles, which
  // disappear once every section is shown).
  const showAddTiles = true;
  const addTilesRow: ReactNode = (
    <div className="flex flex-wrap gap-2 px-1">
      {unshown.map((k) => {
        const Icon = SECTION_ICON[k];
        return (
          <button
            key={k}
            type="button"
            onClick={() => addSection(k)}
            className="flex min-w-[76px] flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
          >
            <Icon size={16} aria-hidden="true" />
            {SECTION_LABEL[k]}
          </button>
        );
      })}
      {model?.optionalJoins?.length ? (
        <button
          type="button"
          onClick={() => { setShowCustom(false); setShowPicker(true); }}
          className="flex min-w-[76px] flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
        >
          <Blend size={16} aria-hidden="true" />
          Join data
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => { setShowPicker(false); setShowCustom(true); }}
        className="flex min-w-[76px] flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
      >
        <Grid2x2Plus size={16} aria-hidden="true" />
        Custom column
      </button>
    </div>
  );

  // Every block below Data, each preceded by a hairline divider (which also serves as the
  // divider under Data's action row). One leading divider per block — no doubled or trailing hairlines.
  const blocks: ReactNode[] = [...visibleBlocks];
  if (showAddTiles) blocks.push(addTilesRow);

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="mx-1 rounded-md border border-border bg-card p-3">
        <label className="text-sm">
          Data
          <Select value={value.model} onValueChange={(id) => onChange(setModelPatch(models, value, id))}>
            <SelectTrigger aria-label="Data" className="mt-1 w-full">
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

      {dataActions}
      {inlineEditor}

      {blocks.map((b, i) => (
        <Fragment key={i}>
          <div className="h-px bg-border" />
          {b}
        </Fragment>
      ))}
    </div>
  );
}
