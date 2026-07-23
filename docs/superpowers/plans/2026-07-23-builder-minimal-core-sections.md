# Widget Builder — Minimal Core + Removable Section Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the dashboard widget builder so only Source is pinned; Summarize, Filter, Group by, Breakdown, Sort, and Join column become removable, clearly-bordered add-on section cards behind one "+ Add" menu. Make `metric` optional end-to-end so Summarize is genuinely removable (no-measure widgets show an empty state).

**Architecture:** Server allows a builder query with no measure (schema `metric` optional; `runBuilderQuery` returns an empty result without executing SQL; `compileBuilderQuery` guards the scalar select). The studio measures/query helpers already yield `metric: undefined` for zero measures — types are made honest. `BuilderForm.tsx` gains a UI "shown sections" set (initialized from the query) and renders each optional clause as a `SectionCard`; every existing sub-editor (`MeasuresEditor`, `FilterTreeEditor`, Group by/Breakdown Selects, `JoinColumnPicker`) and every patch helper is reused unchanged. The existing `WidgetEditorDialog` empty-panel handles the no-measure preview; only its message is refined.

**Tech Stack:** TypeScript, Zod, Kysely (`packages/dashboards`), React + shadcn/ui + CDS tokens (`apps/studio`), Vitest + @testing-library/react.

**Spec:** [docs/superpowers/specs/2026-07-23-builder-minimal-core-sections-design.md](../specs/2026-07-23-builder-minimal-core-sections-design.md)

**Baseline:** branch `builder-minimal-core-sections` off `main` (includes `f0904c64`, which already wired ad-hoc dims into filters + grain). `ChartHint` (`packages/reporting/src/types.ts`) is `bar|line|pie|stat` — do NOT add a variant; the no-measure empty state is driven client-side by "the builder query has no measure", and the server returns a harmless empty `ReportResultData`.

---

## File Structure
- `packages/dashboards/src/types.ts` — builder `WidgetQuerySchema.metric` → optional.
- `packages/dashboards/src/compile.ts` — no-measure short-circuit in `runBuilderQuery`; guard the scalar select in `compileBuilderQuery`.
- `apps/studio/src/api.ts` — studio `WidgetQuery` builder `metric` → optional.
- `apps/studio/src/dashboard/editor/measures.model.ts` — `toBuilderMetrics` return type honest for empty list.
- `apps/studio/src/dashboard/editor/BuilderForm.tsx` — the restructure (shown-sections + `SectionCard` + Add menu + themed cards/separator).
- `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx` — refine the no-measure empty message.
- Test files alongside each.

Build order: server (Tasks 1–2) → studio helpers/types (Task 3) → builder UI (Task 4) → preview message (Task 5).

---

## Task 1: Schema — `metric` optional on the builder query

**Files:** Modify `packages/dashboards/src/types.ts`; Test `packages/dashboards/src/types.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `types.test.ts`:

```ts
describe('builder query without a measure', () => {
  it('parses a builder query that has no metric', () => {
    const parsed = WidgetQuerySchema.parse({ mode: 'builder', model: 'service_requests', filters: [] });
    expect(parsed.mode).toBe('builder');
    if (parsed.mode === 'builder') expect(parsed.metric).toBeUndefined();
  });

  it('still parses a builder query WITH a metric', () => {
    const parsed = WidgetQuerySchema.parse({ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] });
    if (parsed.mode === 'builder') expect(parsed.metric?.agg).toBe('count');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`metric` currently required, first case throws):
`pnpm --filter @openldr/dashboards test -- types.test.ts`

- [ ] **Step 3: Implement** — in `packages/dashboards/src/types.ts`, in the `mode: 'builder'` object of `WidgetQuerySchema`, change:
```ts
    metric: MetricSchema,
```
to:
```ts
    metric: MetricSchema.optional(), // absent when the widget has no Summarize measure
```

- [ ] **Step 4: Run — expect PASS**, then full package (no regression):
`pnpm --filter @openldr/dashboards test -- types.test.ts` then `pnpm --filter @openldr/dashboards test`

- [ ] **Step 5: Commit**
```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts
git commit -m "feat(dashboards): allow a builder query with no measure (metric optional)"
```

---

## Task 2: Compiler — empty result / guarded select when no measure

**Files:** Modify `packages/dashboards/src/compile.ts`; Test `packages/dashboards/src/compile.test.ts`.

Context: `runBuilderQuery` (async, executes SQL) and `compileBuilderQuery` (builds the Kysely query; also used by `compileBuilderToSql` for SQL preview). A query has **no measure** when `!q.metric && !(q.metrics && q.metrics.length)`. Reuse the existing `db`/`getModel`/`q` test helpers already in `compile.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `compile.test.ts`:

```ts
describe('builder query with no measure', () => {
  const noMeasure = { mode: 'builder' as const, model: 'service_requests', filters: [] };

  it('runBuilderQuery returns an empty result without executing SQL', async () => {
    const res = await runBuilderQuery(db, getModel('service_requests')!, noMeasure as any);
    expect(res.rows).toEqual([]);
    expect(res.columns).toEqual([]);
  });

  it('compileBuilderQuery does not throw for a no-measure query (SQL preview path)', () => {
    expect(() => compileBuilderQuery(db, getModel('service_requests')!, noMeasure as any).compile()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`metricExpr` called with undefined metric throws):
`pnpm --filter @openldr/dashboards test -- compile.test.ts`

- [ ] **Step 3: Implement** — in `packages/dashboards/src/compile.ts`:

Add a helper near the top (after the `BuilderQuery` type alias):
```ts
function hasMeasure(q: BuilderQuery): boolean {
  return !!q.metric || !!(q.metrics && q.metrics.length > 0);
}
```

In `runBuilderQuery`, right after the `model = effectiveModel(model, q);` first line, add:
```ts
  if (!hasMeasure(q)) return { columns: [], rows: [], chart: { type: 'stat', value: '', label: 'No measure' } };
```
(This short-circuits before any `compileBuilderQuery(...).execute()`. The studio drives the actual "add a measure" empty state client-side; this is the defensive server shape.)

In `compileBuilderQuery` (used by SQL preview), guard the scalar select. Find the `else` branch that does `qb = qb.select(metricExpr(model, q.metric, qualify).as('value'));` and change it to tolerate no measure:
```ts
  } else if (q.metric) {
    qb = qb.select(metricExpr(model, q.metric, qualify).as('value'));
  } else {
    qb = qb.select(sql<number>`0`.as('value')); // no measure: valid but trivial SQL for preview
  }
```
(The `wide` branch already guards on `q.metrics`. `sql` is already imported at the top of the file.)

- [ ] **Step 4: Run — expect PASS**, then full package incl. recognizer/compile (measure paths unchanged):
`pnpm --filter @openldr/dashboards test -- compile.test.ts` then `pnpm --filter @openldr/dashboards test`

- [ ] **Step 5: Commit**
```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): no-measure builder query yields empty result / trivial SQL"
```

---

## Task 3: Studio helpers/types tolerate zero measures

**Files:** Modify `apps/studio/src/dashboard/editor/measures.model.ts`, `apps/studio/src/api.ts`; Test `apps/studio/src/dashboard/editor/measures.model.test.ts`.

Note: `toBuilderMetrics([])` already returns `metric: undefined` at runtime, but its return type says `metric: Measure` (dishonest). Make the type honest so downstream (`buildSaveQuery`) type-checks with an optional metric.

- [ ] **Step 1: Write the failing test** — append to `measures.model.test.ts`:

```ts
describe('toBuilderMetrics with no measures', () => {
  it('yields undefined metric and metrics for an empty list', () => {
    const { metric, metrics } = toBuilderMetrics([]);
    expect(metric).toBeUndefined();
    expect(metrics).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @openldr/studio test -- measures.model.test.ts`. The runtime assertion likely already passes; the real change is the honest return type (verified by typecheck in Step 4). Proceed to Step 3 regardless.

- [ ] **Step 3: Implement**

In `measures.model.ts`, change the `toBuilderMetrics` return type from `{ metric: Measure; metrics?: Measure[] }` to:
```ts
export function toBuilderMetrics(list: Measure[]): { metric?: Measure; metrics?: Measure[] } {
```
(Body unchanged — it already returns `list[0]` which is `undefined` for `[]`.)

In `apps/studio/src/api.ts`, in the `mode: 'builder'` branch of `WidgetQuery`, make `metric` optional to match the server. Change the `metric: { … };` line to the same shape but optional:
```ts
      metric?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale: number; decimals: number } };
```

- [ ] **Step 4: Run** — `pnpm --filter @openldr/studio test -- measures.model.test.ts` (PASS) and `pnpm --filter @openldr/studio typecheck` (clean — this catches any consumer that assumed a non-optional `metric`; if one legitimately needs a measure, guard it with `?.`/a fallback, do not widen scope).

- [ ] **Step 5: Commit**
```bash
git add apps/studio/src/dashboard/editor/measures.model.ts apps/studio/src/api.ts apps/studio/src/dashboard/editor/measures.model.test.ts
git commit -m "feat(studio): builder query metric optional; toBuilderMetrics honest for empty list"
```

---

## Task 4: `BuilderForm` — minimal core + removable section cards

**Files:** Modify `apps/studio/src/dashboard/editor/BuilderForm.tsx`; Test `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`.

This is the core restructure. Source stays pinned; every other clause becomes a removable `SectionCard`. A `useState<Set<SectionKey>>` (initialized from the query) tracks which optional sections are shown, so an empty section can be added then filled. Reuse all existing sub-editors and patch helpers.

`SectionKey = 'summarize' | 'filter' | 'groupby' | 'breakdown' | 'sort'`. Fixed render order = that array order. Join column stays a picker launched from the Add menu; its chips render in a "Join columns" card when `adhoc.length > 0`.

- [ ] **Step 1: Write the failing tests** — append to `BuilderForm.test.tsx` (reuse existing imports/harness; the models fixture must include `optionalJoins`; a builder value with a measure so Summarize starts shown):

```tsx
const modelsFix = [{
  id: 'service_requests', label: 'Test Orders',
  dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  optionalJoins: [{ alias: 'jp', label: 'Patient', exposableColumns: ['sex'] }],
}] as never;
const withMeasure = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] } as never;

describe('BuilderForm minimal-core sections', () => {
  it('pins only Source; Group by / Breakdown are NOT shown until added', () => {
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={() => {}} />);
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.queryByLabelText('Group by')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Breakdown')).not.toBeInTheDocument();
  });

  it('summarize shows by default when the query has a measure', () => {
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={() => {}} />);
    expect(screen.getByText(/summarize/i)).toBeInTheDocument();
  });

  it('adding "Group by" from the Add menu reveals the Group by section', () => {
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add clause/i }));
    fireEvent.click(screen.getByRole('button', { name: /^group by$/i }));
    expect(screen.getByLabelText('Group by')).toBeInTheDocument();
  });

  it('removing the Summarize section clears the measure (emits metric-less query)', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove summarize/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.metric).toBeUndefined();
    expect(last.metrics).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (Group by is currently always shown, so the "not shown until added" tests fail; "remove summarize" button doesn't exist):
`pnpm --filter @openldr/studio test -- BuilderForm.test.tsx`

- [ ] **Step 3: Implement** — rewrite the render body of `BuilderForm.tsx`. Keep the existing imports, the `NONE`/`DATE_GRAINS` consts, and the `model`/`adhoc`/`dimOptions`/`dim` computations at the top. Add the shown-sections state and a local `SectionCard`, then render.

Ensure `emptyTree` is imported (used to clear the filter tree on remove) — it already is (`import { emptyTree, filtersToTree } from './conditionTree.model';`).

Add above the `return`, after the `dim`/`addOpen`/`showPicker` state:
```tsx
  type SectionKey = 'summarize' | 'filter' | 'groupby' | 'breakdown' | 'sort';
  const SECTION_ORDER: SectionKey[] = ['summarize', 'filter', 'groupby', 'breakdown', 'sort'];
  const SECTION_LABEL: Record<SectionKey, string> = { summarize: 'Summarize', filter: 'Filter', groupby: 'Group by', breakdown: 'Breakdown', sort: 'Sort' };

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
```
Note: `useState<Set<SectionKey>>(() => …)` uses a lazy initializer so it captures the query state only on mount (a section stays shown after you clear its field mid-edit, matching Metabase).

Add a local `SectionCard` at module scope, ABOVE `export function BuilderForm`:
```tsx
function SectionCard({ label, icon, onRemove, children }: {
  label: string; icon: string; onRemove: () => void; children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium"><i className={`ti ${icon}`} aria-hidden="true" />{label}</span>
        <button type="button" aria-label={`Remove ${label.toLowerCase()}`} className="text-muted-foreground hover:text-foreground" onClick={onRemove}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}
```
Add `import type { ReactNode } from 'react';`. VERIFY the icon font: grep `apps/studio/src` for existing `className="ti ` / `ti-` usage. If Tabler `ti` classes are NOT already used in studio, drop the `<i>` icons (keep the `label` text + remove button) rather than introducing a new icon dependency.

Replace the returned JSX so that:
1. **Source** stays exactly as today (the `<label>Source …</label>` block with `aria-label="Source"`), rendered as the pinned block. Optionally wrap it in `<div className="rounded-xl border border-border bg-card p-3">` to read as the root.
2. A **themed separator** below Source:
```tsx
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">optional — add only what you need</span>
        <div className="h-px flex-1 bg-border" />
      </div>
```
3. For each `k` in `SECTION_ORDER` where `shown.has(k)`, render its `SectionCard` wrapping the EXISTING editor for that clause, moved verbatim from the current file (keep every `aria-label`, the `NONE` sentinel handling, `dimOptions`, and all patch-helper calls):
   - `summarize` → `<SectionCard label="Summarize" icon="ti-sum" onRemove={() => removeSection('summarize')}>` wrapping `<MeasuresEditor value={measuresOf(value)} model={model} onChange={(list) => onChange(setMeasuresPatch(value, list))} />`
   - `filter` → `SectionCard` (icon `ti-filter`) wrapping the existing `<FilterTreeEditor value={…} dimensions={dimOptions} onChange={(tree) => onChange(setFilterTreePatch(value, tree))} />`
   - `groupby` → `SectionCard` (icon `ti-layout-rows`) wrapping the existing Group by `<Select …>` AND the existing Grain `<label>` conditional (`dim?.kind === 'date' && dim.dateGrain`) nested inside the same card
   - `breakdown` → `SectionCard` (icon `ti-chart-dots`) wrapping the existing Breakdown `<Select …>`
   - `sort` → `SectionCard` (icon `ti-arrows-sort`, label "Sort") wrapping the existing Limit `<Input …>` block; render whenever `shown.has('sort')` (REMOVE the old `value.dimension || value.breakdown` gate — Sort is now its own section)
   Use a stable render, e.g. `{SECTION_ORDER.filter((k) => shown.has(k)).map((k) => <Fragment key={k}>{renderSection(k)}</Fragment>)}` where `renderSection` switches on `k` — or inline conditional blocks in order. Keep it readable.
4. The **Join columns** chips block stays as-is, shown when `adhoc.length > 0` (keep the individual `Remove ${a.label}` chip buttons and `removeAdhocDimensionPatch`). Optionally wrap in the same card style titled "Join columns".
5. The **"+ Add"** control:
```tsx
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
            <JoinColumnPicker optionalJoins={model.optionalJoins}
              onAdd={(d) => { onChange(addAdhocDimensionPatch(value, d)); setShowPicker(false); }}
              onCancel={() => setShowPicker(false)} />
          </div>
        )}
      </div>
```

TAILWIND/TOKENS: use the app's existing token classes (`border-border`, `bg-card`, `text-muted-foreground`, `text-foreground`, `text-primary`, `rounded-xl`). GREP a sibling component (e.g. `WidgetEditorDialog.tsx`, `FilterTreeEditor.tsx`) to confirm the exact token class names the studio uses (`bg-card` vs `bg-background`, etc.); match them. Themed, clearly-bordered cards + a themed separator — no hardcoded colors.

- [ ] **Step 4: Run** — `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx` (new tests PASS). Then the whole editor folder to catch regressions: `pnpm --filter @openldr/studio test -- src/dashboard/editor`. Existing BuilderForm tests that assumed Group by/Breakdown/Filter are always present must be updated to ADD the section first (matching the new on-demand model) — update them, do NOT weaken a real assertion. Then `pnpm --filter @openldr/studio typecheck` (clean).

- [ ] **Step 5: Commit**
```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): minimal-core builder with removable section cards + Add menu"
```

---

## Task 5: Preview — "add a measure" empty state

**Files:** Modify `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx`.

Today (around line 570): `preview && preview.rows.length ? renderWidget(previewConfig, preview) : <EmptyPanel text="Run a query to see preview" />`. A no-measure builder query returns empty rows (Task 2), so `EmptyPanel` already shows — give it the right message when the cause is "no measure".

- [ ] **Step 1: Implement** — compute a no-measure flag where `builderQuery`/`measuresOf` are in scope:
```tsx
  const builderHasNoMeasure = mode === 'builder' && measuresOf(builderQuery).length === 0;
```
Change the empty-panel line to:
```tsx
  : <EmptyPanel text={builderHasNoMeasure ? 'Add a measure to see results' : 'Run a query to see preview'} />
```
Confirm `mode`, `builderQuery`, and `measuresOf` are in scope at that point (`measuresOf` is already imported; match the real variable name if `builderQuery` differs).

- [ ] **Step 2: Verify** — `pnpm --filter @openldr/studio test -- src/dashboard/editor` (green) and `pnpm --filter @openldr/studio typecheck` (clean). Manual smoke (optional): open a widget, remove Summarize → preview reads "Add a measure to see results"; add it back → preview renders.

- [ ] **Step 3: Commit**
```bash
git add apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx
git commit -m "feat(studio): builder preview shows 'add a measure' empty state when no measure"
```

---

## Final verification
- [ ] `pnpm --filter @openldr/dashboards test && pnpm --filter @openldr/dashboards typecheck`
- [ ] `pnpm --filter @openldr/studio test -- src/dashboard/editor && pnpm --filter @openldr/studio typecheck`
- [ ] Confirm the only studio suite-wide failure is the pre-existing `api.reports.test.ts` Blob flake (exists on base too), not anything in this change.

## Notes for the executor
- **Reuse, don't rewrite** the sub-editors and patch helpers — Task 4 is presentation + a shown-sections set, not query-logic changes.
- **Regression guard:** widgets that already have a measure and dimensions must render and compile byte-identically (the compiler measure paths are untouched). Existing BuilderForm tests that assumed always-present sections need to add the section first now — update them to the new model; don't delete meaningful assertions.
- **No new UI dependency** — reuse the app's existing Button/Select/Input and token classes; verify class names against a sibling component before writing.
