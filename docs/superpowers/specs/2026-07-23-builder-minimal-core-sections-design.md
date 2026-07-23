# Widget Builder — Minimal Core + Removable Section Cards

**Date:** 2026-07-23
**Status:** Approved (brainstorm) — pending implementation plan
**Related:** [dynamic-builder-adhoc-joins](2026-07-23-dynamic-builder-adhoc-joins-design.md) (shipped; this redesigns its builder layout)

## Problem

Feedback on the shipped builder (from the running UI): too much is forced on the user, and the section boundaries are invisible.

1. **Everything is "core."** Source, Summarize, Filters, Group by, and Breakdown are all pinned and always rendered, whether used or not. Only the join-column sits behind "+ Add". The user's expectation: **only Source should be core**; every other clause should be added on demand.
2. **Section boundaries are unreadable.** The one divider is a bare hairline that doesn't follow the theme — you can't tell where Source begins or ends.

This is the full fixed→removable section restructure that was explicitly deferred from the ad-hoc-joins feature. The ad-hoc/filter/grain functionality it builds on is already on `main` (`f0904c64`).

## Decisions (from brainstorm, incl. mockup review)

- **Only Source is core** (one pinned card at top). Summarize, Filter, Group by, Breakdown, Sort (row limit), and Join column are **removable add-on section cards**, each added from a single "+ Add" menu that lists only clauses not yet shown.
- **Summarize is truly removable** (full-stack, user-selected over the studio-only alternative): a query may have no measure. Pre-added by default so new widgets work; removable; when absent the preview shows an empty state.
- **Sections render in a fixed logical order** regardless of the order they were added, so the layout stays predictable: Summarize → Filter → Group by → Breakdown → Sort. Join column remains a picker launched from the Add menu; its results render as chips within a "Join columns" card.
- **Visual:** each section is a bordered card (`--surface-2` / `0.5px var(--border)` / 12px radius) with a header (icon + name + `×` remove) and its control(s) below. One themed, labeled separator ("optional — add only what you need") divides the pinned Source from the optional stack, using the same `--border`/theme tokens as the rest of the UI. Sentence case, Tabler outline icons, CDS tokens throughout.

## Architecture

### 1. Server — make `metric` optional

`packages/dashboards/src/types.ts`: in the builder branch of `WidgetQuerySchema`, change `metric: MetricSchema` → `metric: MetricSchema.optional()`. `metrics?` already optional.

`packages/dashboards/src/compile.ts`:
- A builder query has **no measure** when both `q.metric` is undefined and `q.metrics` is empty/undefined.
- `runBuilderQuery`: when no measure, short-circuit to an empty result — `{ columns: [], rows: [], chart: { type: 'empty' } }` (or the existing convention for "nothing to show"; the renderer keys off it). Do not execute SQL.
- `compileBuilderQuery`: guard the scalar path (`metricExpr(model, q.metric, …)`) so it isn't called with an undefined metric. For SQL preview (`compileBuilderToSql`) with no measure, return a friendly empty/no-op (e.g. a comment string or a `select` of no aggregates) rather than throwing — decided in the plan against the real `compileBuilderToSql` signature.
- All existing paths with a measure are unchanged.

Add a `ChartHint` variant (or reuse an existing "no data" shape) for the empty case; the plan pins the exact type against `@openldr/reporting`'s `ChartHint`.

### 2. Studio — measures/query helpers tolerate zero measures

`apps/studio/src/dashboard/editor/measures.model.ts`: `toBuilderMetrics([])` must yield `{ metric: undefined, metrics: undefined }` (today it assumes ≥1). `apps/studio/src/dashboard/editor/builderForm.model.ts`: `measuresOf` returns `[]` when the query has no metric; `setMeasuresPatch([])` clears both `metric` and `metrics`.

### 3. Studio — section-shown model in `BuilderForm.tsx`

Introduce a UI notion of **which optional sections are shown**, independent of whether their query fields are populated (so you can add an empty "Group by" card and then choose a dimension — Metabase-style):

- `type SectionKey = 'summarize' | 'filter' | 'groupby' | 'breakdown' | 'sort'`.
- `useState<Set<SectionKey>>` initialized on mount from the query: `summarize` shown if it has a measure; `filter` if `filterTree`/`filters` non-empty; `groupby` if `dimension` set; `breakdown` if `breakdown` set; `sort` if `limit` set. (New widgets default to `{summarize}` pre-added.)
- **Add** a section → add its key to the set (renders an empty card). **Remove** → delete its key and clear the underlying query fields via the existing patch helpers (`setMeasuresPatch([])`, `setFilterTreePatch(emptyTree())`, `setDimensionPatch('')`, `setBreakdownPatch('')`, `setLimitPatch(undefined)`).
- The "+ Add" menu lists section keys not in the set, plus "Join column" (shown only when `model.optionalJoins?.length`), reusing the existing `JoinColumnPicker` flow.
- Source stays pinned; Grain stays nested inside the Group by card when the chosen dimension is a date (existing behavior). Limit renders inside the Sort card.
- Reuse every existing sub-editor unchanged (`MeasuresEditor`, `FilterTreeEditor`, the Group by/Breakdown Selects, `JoinColumnPicker`) and every existing patch helper — this task restructures presentation and adds the shown-set, not the query logic. `dimOptions` (model dims + ad-hoc) and the ad-hoc chips carry over as-is.

Extract each section card into a small local presentational piece (header + `×` + body) so `BuilderForm.tsx` stays readable; if it grows large, a `SectionCard` helper component is reasonable.

### 4. Renderer — empty state when no measure

The widget preview and the dashboard widget renderer must show an "add a measure to see results" empty state when a builder widget has no measure (the compiler's empty result). Locate the widget render/preview component (studio) that consumes `ReportResultData`/`ChartHint` and add the empty-state branch. The plan identifies the exact component(s).

## Testing

- **Server:** schema accepts a builder query with no `metric`; `runBuilderQuery` returns the empty result (no SQL executed) when no measure; existing measure paths unchanged (recognizer + compile suites stay green); `compileBuilderToSql` no-measure path doesn't throw.
- **Studio helpers:** `toBuilderMetrics([])` → both undefined; `measuresOf`/`setMeasuresPatch([])` round-trip; section-shown initialization from a populated vs empty query.
- **BuilderForm:** Source is the only always-rendered section; "+ Add" lists unshown clauses; adding a section shows an empty card; removing clears its query fields and hides the card; removing Summarize yields a no-measure query; join-column flow still works.
- **Renderer:** empty-state renders for a no-measure widget; a widget with a measure renders normally.
- Existing builder/compile/recognizer tests stay green (behavior with a measure is unchanged).

## Non-goals

- No change to SQL mode, the measures/formula editor internals, the filter-tree editor, or the join-column picker (all reused as-is).
- No drag-to-reorder of sections (fixed logical order).
- No change to how ad-hoc joins compile (already shipped).

## Open questions for the plan

- Exact `ChartHint`/empty-result shape the renderer keys off (pin against `@openldr/reporting`).
- Exact widget preview/renderer component(s) to carry the empty state.
- `compileBuilderToSql` no-measure return shape.
