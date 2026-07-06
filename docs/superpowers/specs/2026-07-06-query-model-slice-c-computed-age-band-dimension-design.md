# Query-model Slice C — Computed Age-Band Dimension

**Date:** 2026-07-06
**Origin:** Query-model-expansion workstream (see memory `query-model-expansion-workstream`). Slices A (conditional metrics) + B (derived ratios) + G(amr-resistance) are done — amr-resistance is an editable template. Slice C adds the one missing capability to make **`patient-demographics` the second built-in report to become an editable Report Builder template**: bucketing patients into **age bands** computed from `birth_date`.
**Status:** Design approved — ready for implementation plan.

## Goal

`packages/reporting/src/reports/patient-demographics.ts` bins patients into age bands
(`0-4 / 5-14 / 15-24 / 25-49 / 50+ / unknown`) computed in JS from `birth_date` vs a
reference date (`asOf` param), then splits each band by gender. The gender split is
already expressible via Slice A conditional metrics; the query model cannot yet
express the **age-band dimension** (it only groups by plain columns / date grains).
Slice C adds a computed `age_band` dimension and seeds the report as a template.

## Decisions locked in brainstorming

- **Age-band-specific** computed dimension (not a general bucketing primitive) — YAGNI,
  mirrors Slice B's ratio-only choice.
- **Registry-declared** `age_band` dimension on the `patients` model, fixed standard bands
  — no bands-editing UI.
- **Reference date binds to an optional param** (`asOf`), falling back to current date.
- **Defer the "Other/unknown" gender column** (it needs a `notIn`/`neq` op — a separate
  cross-cutting change). The template ships **Total / Male / Female** (Total counts everyone).
- **Portability:** no dialect-specific age function. The compiler pre-computes each band's
  birth-date threshold **in JS** from the reference date and emits a portable `CASE` over
  `birth_date` (ISO text) vs those literals.

## Architecture / boundaries

- **Registry + compiler** (`@openldr/dashboards`) — the capability: an `age_band` computed
  dimension + a portable `CASE` bucket in the compiler.
- **Reference-date plumbing** (`@openldr/report-builder` + `@openldr/dashboards` schema) — an
  optional `reference` on the query `DimensionRef`, substituted by `resolveQueryParams`, and
  counted-used by `lintReportTemplate`.
- **UI** (`apps/studio`) — `age_band` shows in the dimension dropdown automatically; a minimal
  "Reference date" input appears only for computed dimensions.
- **Seed** (`@openldr/report-builder` + `@openldr/bootstrap`) — a published
  `patient-demographics` template.

## Part 1 — Registry computed dimension (`packages/dashboards/src/models/registry.ts`)

`ModelDimension` is a plain TS interface (the `MODELS` array is not Zod-parsed), so this is a
type-only addition:

```ts
export interface AgeBandCompute {
  kind: 'age-band';
  bands: { maxAge: number; label: string }[]; // closed upper bounds, e.g. {maxAge:4,label:'0-4'}
  openEndedLabel: string;                      // e.g. '50+' (older than the last band)
  unknownLabel: string;                        // e.g. 'unknown' (null / future birth_date)
}
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute }
```

The `patients` model gains one dimension (reusing `column: 'birth_date'`):

```ts
{ key: 'age_band', label: 'Age band', column: 'birth_date', kind: 'string',
  compute: { kind: 'age-band',
    bands: [{ maxAge: 4, label: '0-4' }, { maxAge: 14, label: '5-14' }, { maxAge: 24, label: '15-24' }, { maxAge: 49, label: '25-49' }],
    openEndedLabel: '50+', unknownLabel: 'unknown' } }
```

Existing dimensions (no `compute`) are unchanged.

## Part 2 — Pure threshold helper (`packages/dashboards/src/age-band.ts`, new)

Pure and unit-testable (no Kysely). Given a reference `Date` and the bands, produce the ordered
CASE arms with birth-date thresholds and integer ranks:

```ts
// 'YYYY-MM-DD' for `ref` minus `years`.
export function minusYears(ref: Date, years: number): string;

export interface AgeBandArms {
  refYMD: string;                                             // ref as 'YYYY-MM-DD'
  arms: { thresholdYMD: string; label: string; rank: number }[]; // youngest→oldest; birth_date > thresholdYMD ⇒ this band
  openEndedLabel: string; openEndedRank: number;              // rank = bands.length
  unknownLabel: string; unknownRank: number;                  // rank = bands.length + 1 (sorts last)
}
export function ageBandArms(c: AgeBandCompute, ref: Date): AgeBandArms;
```

`ageBandArms` sorts bands by `maxAge` ascending; each arm's `thresholdYMD = minusYears(ref, maxAge + 1)`
(so `birth_date > threshold ⇔ age ≤ maxAge`, matching the `ageBand` helper's boundaries — e.g. ref
2026-01-01, band 0-4 → threshold 2021-01-01; someone born exactly 2021-01-01 is age 5 → next band).
Ranks: youngest arm 0 … open-ended `bands.length`, unknown `bands.length + 1` — reproducing the
report's `['0-4','5-14','15-24','25-49','50+','unknown']` order.

## Part 3 — Compiler (`packages/dashboards/src/compile.ts`)

`DimensionRefSchema` (`types.ts`) gains an optional reference:

```ts
export const DimensionRefSchema = z.object({ key: z.string(), grain: z.enum(['day','week','month','year']).optional(), reference: z.string().optional() });
```

A helper builds the label + rank `CASE` from `ageBandArms`, using **bound params** (not inlined),
over the dimension's column (`birth_date` text):

```
label CASE: WHEN col IS NULL THEN unknownLabel
            WHEN col > refYMD THEN unknownLabel           -- future/negative age
            WHEN col > arm[0].thresholdYMD THEN arm[0].label   -- youngest first
            … ELSE openEndedLabel END
rank  CASE: same WHEN structure returning the integer ranks
```

The dimension select in `compileBuilderQuery` (currently `if (q.dimension) { qb = qb.select(sql.ref(d.column).as('label')).groupBy(d.column).orderBy(d.column) }`, shared by long + wide mode) branches:
- `d.compute` present → resolve the reference date (`ref = q.dimension.reference ? new Date(reference) : new Date()`; invalid → `new Date()`), build `{ label, rank }`, then
  `qb.select(label.as('label')).groupBy(label).orderBy(rank)`.
- else → the existing plain-column path, **byte-identical**.

Portable: `CASE` + text `>` comparisons + integer ranks — no pg/mssql date functions. `GROUP BY`
the same `label` expression (both dialects allow group-by-expression; the identical `sql` fragment
satisfies mssql's match rule). Assumes ISO `birth_date` text (real FHIR `birthDate` is `YYYY-MM-DD`);
invalid-text rows aren't specially handled in SQL (minor fidelity gap vs the JS helper — noted).

`breakdown` + `age_band` is allowed (a computed dimension is still one group-by column); wide + any
dimension already works (Slice A). The wide/long guards are unchanged.

## Part 4 — Reference substitution + lint (`@openldr/report-builder`)

- `resolveQueryParams` (`render/run-template.ts`): in the builder branch, after the existing
  `filters`/`filterTree` handling, substitute `{{param.*}}` in `dimension.reference` when present
  (reusing `subst`). A blank result is left as-is (compiler falls back to current date).
- `lintReportTemplate` (`lint.ts`): `paramRefs` also scans `dimension.reference` for `{{param.<id>}}`,
  so a param bound **only** in the dimension reference (like `asOf`) counts as used — no false
  `unused-parameter` warning, and an orphaned ref is still caught.

## Part 5 — UI (`apps/studio`)

- `api.ts` mirrors (structural, additive): `ModelDimension` gains `compute?` (mirror of `AgeBandCompute`);
  the builder `WidgetQuery`'s `dimension` gains `reference?: string`.
- `QueryEditor.tsx`: after the breakdown dropdown, a **"Reference date"** text input renders **only when
  the selected dimension has `compute`** (`dimensions.find(d => d.key === builderQuery.dimension?.key)?.compute`).
  It reads/writes `builderQuery.dimension.reference` — a plain date string or a `{{param.x}}` token
  (free text; a full literal/param toggle is out of scope). `BuilderForm` (shared with dashboards) is
  **untouched** — `age_band` appears in its dimension `<select>` automatically as "Age band".
- i18n `reportBuilder.query.referenceDate` (+ helper/aria) en/fr/pt (fr/pt typed `EnShape`).

## Part 6 — Seed template (`packages/report-builder/src/patient-demographics-template.ts`, new)

Mirrors `amr-resistance-template.ts`: `buildPatientDemographicsTemplate` /
`seedPatientDemographicsTemplate` / `PATIENT_DEMOGRAPHICS_TEMPLATE_ID = 'rt-patient-demographics'`.
A published "Patient Demographics" template:
- an `asOf` text param (`required: false`);
- a title + intro text;
- a **wide table** block: `source` = `{ mode:'builder', model:'patients',
  metric:{key:'total',label:'Total',agg:'count'},
  metrics:[ {key:'total',label:'Total',agg:'count'},
            {key:'male',label:'Male',agg:'count',where:[{dimension:'gender',op:'eq',value:'male'}]},
            {key:'female',label:'Female',agg:'count',where:[{dimension:'gender',op:'eq',value:'female'}]} ],
  dimension:{ key:'age_band', reference:'{{param.asOf}}' }, filters:[] }`;
- a **pie chart** block: total count by `age_band` (`chartType:'pie'`, same dimension+reference).

Wired into `packages/bootstrap/src/seed.ts` idempotently (alongside `rt-sample-amr` and
`rt-amr-resistance`; fresh install seeds it, reseed = 0). Coexists with the code report (not retired).
This is the **second** built-in report to become an editable template.

## Data flow

Builder/preview: author picks "Age band" (+ optional reference / `asOf` binding) → stored on the
block's `WidgetQuery.dimension` → `resolveQueryParams` substitutes the reference → `compileBuilderQuery`
resolves the date, precomputes thresholds (JS), emits the `CASE` bucket → grouped counts per band ×
the conditional gender metrics → table/pie render. Lint counts `asOf` used via the reference scan.

## Error handling / edge cases

- **Unset reference / `asOf`**: compiler uses current date (server `new Date()`); a demographics
  "current age" snapshot. Deterministic in tests (they pass an explicit reference).
- **Invalid reference string**: `new Date(reference)` NaN → fall back to current date.
- **Null `birth_date`**: first CASE arm → `unknown`. **Future `birth_date`** (negative age): second
  arm → `unknown`.
- **Band ordering**: the rank CASE orders bands youngest→oldest→unknown regardless of alphabetical
  label order.
- **Backward-compat**: `compute` / `reference` are optional; every existing dimension compiles to
  byte-identical SQL. Dashboards (no param layer) use `age_band` with current-date reference.

## Testing

- **dashboards**: `age-band.test.ts` — `minusYears` + `ageBandArms` boundary cases (exact-birthday,
  null-free, rank order, threshold dates for a fixed ref). `compile.test.ts` — `age_band` emits a
  `CASE` (SQL contains the band labels + `group by` + `order by`) and honors an explicit `reference`;
  **a plain-column dimension emits byte-identical SQL** (compute absent). A fixture/pg-mem run buckets
  known birth dates into the right bands.
- **report-builder**: `resolveQueryParams` substitutes `dimension.reference`; `lint` counts a
  reference-bound param used (no `unused-parameter`) and flags an orphaned reference ref; the seeded
  template's own query reproduces patient-demographics band×gender counts (pg-mem acceptance, mirroring
  amr's G-instance test).
- **studio**: the reference input renders only for a computed dimension and writes
  `dimension.reference`; `age_band` appears selectable.
- **Visual check**: open `rt-patient-demographics` in the running builder (dev stack) — confirm the
  age-band table + pie render with seeded patients, and the `asOf` param changes the bands.

## Gate

- Forced 31-package typecheck + test (`pnpm turbo run typecheck --force` then `test --force`) — the
  schema/registry/compiler changes are in shared `@openldr/dashboards`, consumed by dashboards,
  report-builder, server, studio. Never pipe turbo through `tail`.
- Pre-existing unrelated flakes (studio `api.test.ts` vitest-dedupe; plugins/users parallel-load
  timeouts that pass in isolation) are not regressions.

## Scope / non-goals

- No general numeric/date bucketing primitive (age-band only).
- No "Other/unknown" gender column (needs a `notIn`/`neq` op — its own micro-slice).
- No author-editable bands UI (bands fixed in the registry).
- No cross-model facility join (that is Slice D); the template omits the facility filter.
- No retiring of the `patient-demographics` code report (coexists).

## Follow-ups (later)

- `notIn`/`neq` op → the "Other/unknown" gender column (completes the report's gender split).
- General bucketed dimension (numeric ranges) if a second report needs it.
- Facility filter on the template once Slice D lands.
