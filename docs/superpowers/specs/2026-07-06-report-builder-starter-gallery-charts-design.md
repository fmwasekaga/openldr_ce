# Report Builder — Starter-Template Gallery + Wider Chart Types

**Date:** 2026-07-06
**Origin:** Second of the three-part Report Builder improvement sequence (after
`2026-07-06-report-builder-layout-space`). Motivated by the builder being too
AMR-focused (every path starts blank or from a lone AMR sample) and the chart
palette being limited to bar/line/pie. Reference projects reviewed earlier
(inerttila/Report-Builder, react-awesome-query-builder) — this slice takes the
"pick a starter, then edit" pattern.
**Status:** Design approved — ready for implementation plan.

## Goal

Make the Report Builder useful beyond AMR out of the box, in two ways:

1. **Starter-template gallery** — "New report" opens a gallery of ready-to-edit
   starters across lab-report categories (not just AMR); picking one preloads the
   builder with live-data-bound blocks.
2. **Wider chart types** — extend the report chart palette from bar/line/pie to
   also include area, donut, horizontal bar (row), and scatter, on both the PDF
   and the live canvas render paths.

Both lean on existing patterns; no DB migration.

## Architecture / boundaries

- **Starters** are pure builder functions in `@openldr/report-builder` (mirroring
  the existing `buildSampleReportTemplate` in `src/sample.ts`), collected in a
  registry and exported from the browser-safe `./pure` barrel. No DB, no
  migration, fully unit-testable.
- **Chart types** extend the shared `chartType` enum in `src/schema.ts` and gain a
  drawer on **both** render paths — the PDF drawer (`src/render/charts/index.ts`)
  and the recharts canvas (`apps/studio/src/reports-builder/ReportChart.tsx`).
  The anti-drift invariant established in P3b-4 holds: both paths consume the same
  pure `chart-data.ts` output (`{ categories, series[] }`); no new query shape is
  introduced.

The two pieces are independent at the code level (a chart type works without the
gallery and vice versa) but ship together for a cohesive "start from a good
template that shows off richer charts" experience.

## Part A — Starter-template gallery

### A1. Registry (`packages/report-builder/src/starters/`)

A new module `src/starters/index.ts` exporting:

- `interface StarterMeta { id: string; name: string; description: string; category: string }`
- `listStarters(): StarterMeta[]` — the gallery's data source (metadata only).
- `getStarterTemplate(id: string): ReportTemplate` — builds a fresh, schema-valid
  `ReportTemplate` for the given starter id. Throws if `id` is unknown.

Both are re-exported from `packages/report-builder/src/pure.ts` so the studio app
imports them from `@openldr/report-builder/pure` (never the server barrel).

Each starter is a small pure builder function (one per file or grouped in
`src/starters/builders.ts`, implementer's discretion within the module) returning
`ReportTemplateSchema.parse({...})`. All starters:

- set `status: 'draft'` (the gallery creates an unsaved draft; see A3);
- carry a stable `id` **inside the registry** used only as the starter key, NOT as
  the persisted template id (A3 assigns a fresh id at preload time);
- bind block queries to real seeded models (see A2) so the canvas shows live data
  immediately on open;
- produce **lint-clean** templates (`lintReportTemplate` returns no errors and no
  warnings) — no parameters unless a filter binds them, no empty queries, non-empty
  name.

The `amr-resistance` starter **reuses** the existing sample content rather than
duplicating it: factor the block-building body of `buildSampleReportTemplate`
(`src/sample.ts`) into a shared builder the registry calls, or have the registry's
amr starter call a shared helper. Seeding behavior (`seedSampleReportTemplate`,
`SAMPLE_REPORT_ID = 'rt-sample-amr'`) is **unchanged** in this slice — the registry
is additive; the seed still creates its one published sample.

### A2. The starter set

Bound to models in `packages/dashboards/src/models/registry.ts` (verified
available dimensions/metrics in parentheses):

- **`blank`** — "Blank report". Empty template (delegates to
  `createEmptyTemplate`). Category `general`. Always first.
- **`amr-resistance`** — "AMR Resistance". Category `amr`. `observations` broken
  down by `interpretation_code` (R/I/S) over `code_text` (analyte), reusing the
  existing sample's resistance content. Title + intro text + a breakdown chart +
  an analyte table.
- **`test-volume`** — "Test Volume". Category `operational`. `service_requests`:
  two KPIs (`count` "Total test orders", `distinct_subjects` "Distinct patients"),
  a monthly volume chart (`authored_on` grain `month`, breakdown `status`) as an
  **area** chart, and an orders-by-`code_text` table.
- **`patient-demographics`** — "Patient Demographics". Category `quality`.
  `patients`: a total-patients KPI (`count`) and a **donut** of `count` by
  `gender`. (Age-bands deferred to query-model Slice C.)
- **`specimen-results`** — "Specimen & Results". Category `operational`.
  `specimens` by `type_text` (a **row**/horizontal-bar chart of `count` by type)
  plus a status-over-`received_time` line, and an `observations` table by
  `code_text` (analyte) with `avg_value`.

The category strings are display metadata surfaced as a badge in the gallery; they
are stored in the template's existing free-string `category` field. No category
enum is introduced.

### A3. Gallery UI + preload (`apps/studio`)

- **Entry point.** `NewReportButton` (in `apps/studio/src/pages/Reports.tsx`)
  currently navigates straight to `/reports/builder/new`. Change it to open a new
  **`StarterGalleryDialog`** (shadcn `Dialog`) instead.
- **`StarterGalleryDialog.tsx`** — a grid of cards, one per `listStarters()` entry.
  Each card shows: the starter `name`, a category **badge**, the one-line
  `description`, and a lucide icon chosen per category (lightweight — **no**
  live-render thumbnails). Clicking a card closes the dialog and navigates to
  `/reports/builder/new?starter=<id>` (Blank → `?starter=blank`, or plain
  `/reports/builder/new` — both resolve to a blank draft). Uses shadcn primitives
  (`Dialog`, `Badge`, `Button`) per the repo's shadcn convention.
- **Preload.** `ReportBuilderPage.tsx` initializes its template state. Today:
  `useState(() => createEmptyTemplate(\`rt-${Date.now()}\`, ''))`. Change: read the
  `starter` search param (`useSearchParams`); when present and there is no `:id`
  route param, initialize from `getStarterTemplate(starter)` but **override the id
  and keep it an unsaved draft**: spread the built template with a fresh
  `id: \`rt-${Date.now()}\`` and `status: 'draft'`. Unknown/absent starter →
  `createEmptyTemplate` (current behavior). The draft is unsaved until the user
  clicks Save — identical to the existing `/new` flow.
- i18n: gallery strings (dialog title, "Blank report", per-starter names +
  descriptions, category badge labels) go in the `reportBuilder.*` en/fr/pt
  namespace (fr/pt typed `EnShape`, so keys must exist in all three).

## Part B — Wider chart types

### B1. Schema (`packages/report-builder/src/schema.ts`)

Extend the chart block's `chartType` enum:

```
chartType: z.enum(['bar', 'line', 'pie', 'area', 'donut', 'row', 'scatter'])
```

(`kpi` remains its own block kind, unchanged.) This is additive; existing
templates with `bar`/`line`/`pie` keep validating.

### B2. PDF drawers (`packages/report-builder/src/render/charts/index.ts`)

Widen `ChartKind` to include the four new kinds and add drawers, reusing existing
machinery:

- **`area`** — draw the line (reuse `drawLine`'s path building) then close the path
  down to the axis and fill with a translucent series color; redraw the line on
  top. Multi-series each get their own filled area.
- **`donut`** — the existing `drawPie` with an inner radius: after filling each
  slice, punch a center circle in the page background color (or draw slices as an
  annulus). Legend identical to pie.
- **`row`** — horizontal bars: categories laid out down the Y axis, value along X.
  Transpose the `drawBar` logic (swap x/y roles); reuse `linearScale`/`niceTicks`
  for the value axis and category labels down the left.
- **`scatter`** — a categorical dot-plot: for each series, plot a point at
  `x = category index`, `y = value`, reusing `drawAxes` for the value axis and the
  category labels along X (like `drawLine` without the connecting stroke).

`drawChart`'s dispatch switch routes the new kinds; the default stays `bar`.

**Scatter interpretation (decision):** scatter is a categorical dot-plot over the
existing `{ categories, series[] }` shape — NOT a two-numeric-metric X/Y
correlation plot. A true X/Y scatter would require a different query shape
(two aggregate metrics as axes) and is explicitly out of scope for this slice
(future extension).

### B3. Canvas (`apps/studio/src/reports-builder/ReportChart.tsx`)

Widen the `chartType` prop type and add recharts renderers:

- **`area`** — `AreaChart` + one `<Area>` per series (fill = series color).
- **`donut`** — the existing `<Pie>` with `innerRadius` set.
- **`row`** — `BarChart layout="vertical"` with `XAxis type="number"` +
  `YAxis type="category" dataKey="category"`.
- **`scatter`** — `ScatterChart` with each series as a `<Scatter>` of
  `{ x: categoryIndex, y: value }` points (or category on a category X axis).

Colors continue to come from the shared `COLORS` palette; the `No data` and
multi-series legend behavior is preserved.

### B4. Authoring (`QueryEditor` chart-type toggle)

The chart-type selector in `apps/studio/src/reports-builder/QueryEditor.tsx` gains
the four new options with i18n labels (`reportBuilder.*` en/fr/pt). Selecting a
type writes `block.chartType`; the canvas and PDF both honor it via the shared
value.

## Data flow

New report: `NewReportButton` → `StarterGalleryDialog` (reads `listStarters()`) →
navigate `/reports/builder/new?starter=<id>` → `ReportBuilderPage` reads the param
→ `getStarterTemplate(id)` (fresh id, draft) → in-memory template → existing
`useBlockData` runs each block's live query → canvas renders (including new chart
types via `ReportChart`) → Save persists (existing route/store) → Preview/Publish
render the same via `renderReportTemplatePdf` (new PDF drawers).

Chart type: author picks a type in `QueryEditor` → `block.chartType` → both
`ReportChart` (canvas) and `drawChart` (PDF) dispatch on it, consuming the same
`resultToChartData` output.

## Error handling / edge cases

- `getStarterTemplate` with an unknown id throws in the package; `ReportBuilderPage`
  treats an unknown/absent `?starter=` as Blank (defensive — no crash on a stale
  or hand-typed URL).
- Starters must be lint-clean; a starter that references an unavailable
  dimension/metric would surface as an empty/erroring block — the unit tests
  (build + lint each starter, and a smoke check that block queries reference real
  model dimensions where practical) guard against this.
- New chart kinds with zero categories render the existing `No data` state
  (canvas) / empty plot (PDF) — same as current charts.
- Donut center punch must use the report page background (white — the report is a
  light-theme surface per the prior slice), not the app theme color.

## Testing

Package (`packages/report-builder`):
- `starters/index.test.ts` — `listStarters()` returns the expected set; every
  `getStarterTemplate(id)` builds a schema-valid template AND
  `lintReportTemplate(t)` returns zero errors and zero warnings; `blank` is empty;
  an unknown id throws.
- `render/charts/index.test.ts` (extend) — `drawChart` handles `area`/`donut`/
  `row`/`scatter` without throwing and emits the expected pdfkit ops (mirroring the
  existing bar/line/pie assertions).
- The `chart-data` agreement test (P3b-4) needs no change (data shape unchanged),
  but add a note/assertion that the new kinds consume the same `ChartData`.

Studio (`apps/studio`):
- `StarterGalleryDialog.test.tsx` — renders a card per starter (incl. Blank);
  clicking a card navigates to `/reports/builder/new?starter=<id>`.
- `ReportBuilderPage` test — with `?starter=test-volume`, the initial template is
  the starter's content with a fresh id and `status: 'draft'`; with no param, Blank.
- `ReportChart.test.tsx` (or existing) — renders each new chart type under the
  jsdom recharts stubs already used (getBoundingClientRect + synchronous
  ResizeObserver).
- i18n `parity.test.ts` continues to guard fr/pt completeness for the new keys.

Visual check (dark + light) in the running builder after the gate: open the gallery,
pick each starter, confirm live data + each new chart type renders on the canvas and
in Preview PDF.

## Gate

- Forced 31-package typecheck + test (`pnpm turbo run typecheck --force` then
  `test --force`) — the schema + chart-data + starters changes live in the shared
  `@openldr/report-builder` package and are consumed by studio; never pipe turbo
  through `tail`.
- Pre-existing unrelated flakes are not regressions: studio `api.test.ts`
  vitest-dedupe flake, and parallel-load timeouts (users/audit/etc.) that pass in
  isolation.

## Scope / non-goals

- No DB migration, no new API route, no change to seeding (`rt-sample-amr` stays).
- No live-render thumbnails in the gallery (icon + text cards only).
- No true X/Y two-metric scatter (categorical dot-plot only).
- No new query-model capability (age-bands, cross-model joins) — those are the
  separate query-model slices C/D/E/F.
- Category is display metadata (a badge), not a new enum or a Reports-library
  filter.

## Follow-ups (later, per the agreed sequence)

- (3) Visual/nested query builder for non-scripters (adopt
  react-awesome-query-builder; query-model flat-filters → condition-tree) — its own
  capability slice.
- Optionally: surface `category` as a filter/section in the Reports library; a
  true X/Y scatter once multi-metric x/y queries exist.
