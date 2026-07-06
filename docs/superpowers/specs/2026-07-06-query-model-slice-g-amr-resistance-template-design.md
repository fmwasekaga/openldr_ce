# Query-Model Expansion — Slice G: Seed amr-resistance as an Editable Template

**Date:** 2026-07-06
**Workstream:** query-model-expansion (see memory `query-model-expansion-workstream`)
**Depends on:** Slice A (conditional/multi-metric, `a7f60304`) + Slice B (derived ratio metrics, `c53efa9c`) — both merged local `main`.
**Status:** Design approved — ready for implementation plan.

## Goal

Turn the built-in `amr-resistance` **code** report into a **published, editable
Report Builder template**, seeded on fresh install, that reproduces its core
analytics (antibiotic × `tested`/`r`/`i`/`s`/`%R`) using the A+B query model. This
is the visible payoff of Slices A+B — a built-in report becomes editable in the
builder and appears in the P4 coexistence library. To render it faithfully, two
small supporting fixes land: dropping blank param-filters on the render path, and
percent-column formatting in the table painter.

## Scope decisions (locked)

- **Core table + a `daterange` parameter now; facility parameter deferred to
  Slice D.** The facility filter needs a `subject_ref → patients.managing_organization`
  cross-model join (Slice D). The `avg %R` summary KPI is omitted (an aggregate
  over a per-row derived value — not expressible).
- **Percent formatting added to the table painter** so `%R` renders as `"50.0%"`,
  matching the code report.
- **Blank param-filters are dropped in `resolveQueryParams`** (the report-builder
  render path), NOT in the dashboards compile layer — localized to templated
  reports, zero risk to dashboards compile semantics.
- **The template coexists with the `amr-resistance` code report.** The code report
  is NOT retired in this slice (retirement is a later call once fidelity —
  including facility — is complete).

## Background: why the three parts

The table render path already works for a multi-metric wide result: in
`drawTable` (`packages/report-builder/src/render/paint.ts`), an empty
`block.columns` falls back to `result.columns` and paints every column. So the
data side (from Slice B's `runWideQuery`) flows through unchanged. Two gaps remain
for a faithful, usable seed:

1. **Unset date range breaks the query.** A `daterange` param writes to fixed
   `from`/`to` value keys (`ParamValuesBar`), so the table's date filters bind to
   `{{param.from}}`/`{{param.to}}`. `resolveQueryParams` substitutes a missing
   param with `''`, and `applyFilters` only skips `value === null` — so an unset
   range yields `effective_date_time <= ''`, excluding every row. The default
   no-param PDF render would be empty. → **Part 1.**
2. **`%R` renders as a bare number.** `drawTable` prints `String(row[c.key])`,
   ignoring `ReportColumn.kind`, so `%R` shows `50` not `50.0%`. → **Part 2.**

## Architecture

Three independently-testable parts + an acceptance test.

### Part 1: Drop blank param-filters (`packages/report-builder/src/render/run-template.ts`)

In `resolveQueryParams`, after the existing `{{param.*}}` substitution over a
builder query's `filters`, drop any filter whose resolved `value` is **blank**:
`null`, `''`, or an array that is empty or all-blank. Pure; still returns a deep
copy. A literal filter such as `interpretation_code in ['R','I','S']` (non-blank)
is kept; date filters bound to an unset range are dropped, meaning "all dates".

Tests: unset range params → only the literal `interp in [...]` filter survives;
set range params → the `gte`/`lte` date filters survive with substituted values.

### Part 2: Percent-column formatting in the table painter (`packages/report-builder/src/render/paint.ts`)

Today `drawTable` maps result columns to `{ key, label }` and prints
`String(row[c.key] ?? '')`. Extend the column projection to carry `kind`
(`{ key, label, kind }` from `result.columns`; block-defined `columns` default to
`kind: undefined` → plain text) and format each cell by kind:

- `kind === 'percent'`: render a finite numeric value as `` `${value.toFixed(1)}%` `` (e.g. `50` → `"50.0%"`, `33.3` → `"33.3%"`); non-numeric/blank → `''`.
- otherwise: `String(row[c.key] ?? '')` (unchanged).

A small pure `formatCell(value, kind)` helper keeps this testable. Tests: percent
column formats `50` → `"50.0%"`; a string/number column is unchanged.

### Part 3: Seed the amr-resistance template

New module `packages/report-builder/src/amr-resistance-template.ts`, mirroring
`sample.ts`:

```
AMR_RESISTANCE_TEMPLATE_ID = 'rt-amr-resistance'
buildAmrResistanceTemplate(): ReportTemplate   // ReportTemplateSchema.parse(...)
seedAmrResistanceTemplate(store): Promise<number>  // create-if-absent, returns 1|0
```

Template shape:
- `id: 'rt-amr-resistance'`, `name: 'AMR Resistance Rate'`,
  `description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.'`,
  `category: 'amr'`, `status: 'published'`, default A4 page.
- `parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }]`.
- Rows:
  - title block `'AMR Resistance Rate'`;
  - a short text block;
  - a **table** block, `columns: []`, `source` = builder wide query over
    `observations`:
    - `metric: { key: 'tested', label: 'Tested', agg: 'count' }` (required single
      metric — an aggregate, per Slice B's `QueryEditor` rule),
    - `metrics: [`
      - `{ key: 'tested', label: 'Tested', agg: 'count' }`,
      - `{ key: 'r', label: 'R', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] }`,
      - `{ key: 'i', label: 'I', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] }`,
      - `{ key: 's', label: 'S', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'S' }] }`,
      - `{ key: 'percentR', label: '%R', agg: 'count', derived: { numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 } }`
    - `] `,
    - `dimension: { key: 'code_text' }`,
    - `filters: [`
      - `{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }`,
      - `{ dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' }`,
      - `{ dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' }`
    - `]`
- Wire `seedAmrResistanceTemplate` into `packages/bootstrap/src/seed.ts` beside the
  existing `seedSampleReportTemplate` call.

Note on the date filters: they bind to `{{param.from}}`/`{{param.to}}` (the fixed
keys a `daterange` param populates), and Part 1 drops them when the range is unset.

Tests: `buildAmrResistanceTemplate()` passes `ReportTemplateSchema.parse`;
`seedAmrResistanceTemplate` is idempotent (returns 1 then 0); `seed.ts` calls it.

### Part 4: End-to-end acceptance

An integration test that runs the seeded template's table `source` through
`runBuilderQuery` (`@openldr/dashboards`) against a pg-mem `observations` fixture
(the Slice-B Cipro/Genta data), asserting the result columns are
`[label, tested, r, i, s, percentR]` and rows Cipro `{tested:4,r:2,i:1,s:1,percentR:50}` /
Gentamicin `{tested:3,r:1,i:0,s:2,percentR:33.3}` — proving the *seeded template*
(not just a hand-written query) reproduces amr-resistance. Placed where both
`@openldr/report-builder` (for `buildAmrResistanceTemplate`) and
`@openldr/dashboards` + `pg-mem` are available (e.g. `packages/bootstrap`, which
already depends on both and owns the seed wiring).

Live browser canvas/PDF spot-check is deferred (workstream convention).

## Testing (TDD) — summary

- report-builder: `resolveQueryParams` blank-filter drop; `formatCell`/`drawTable`
  percent formatting; `buildAmrResistanceTemplate` schema-valid;
  `seedAmrResistanceTemplate` idempotent.
- bootstrap: `seed.ts` seeds the amr template; **end-to-end acceptance** (template
  source → `runBuilderQuery` → amr numbers incl. `%R`).

## Gate

- Forced 31-package typecheck (`pnpm turbo run typecheck --force`) — the seed +
  bootstrap wiring cross package boundaries. Never pipe turbo through `tail`.
- Pre-existing unrelated flakes (`api.test.ts` vitest-dedupe; parallel-load
  timeouts that pass in isolation) are not Slice G regressions.

## Out of scope (YAGNI / later)

- Facility parameter (→ **Slice D**, cross-model join).
- Retiring the `amr-resistance` code report (later, once fidelity is complete).
- `avg %R` summary KPI (aggregate over a derived value — not expressible).
- Converting the other AMR/demographics reports (later slices).
- A lint rule for dangling derived-metric refs (noted follow-up from Slice B).

## Follow-ups

- **Slice D** — cross-model joins → add the facility parameter to this template.
- **Slice C** — computed/bucketed dimensions (age-band) → `patient-demographics`.
