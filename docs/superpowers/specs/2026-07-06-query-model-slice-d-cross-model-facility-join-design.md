# Query-model Slice D — Cross-Model Joins (Facility)

**Date:** 2026-07-06
**Origin:** Query-model-expansion workstream (memory `query-model-expansion-workstream`). Slices A/B/C done → two code reports (amr-resistance, patient-demographics) are editable templates. Slice D adds cross-model joins so **facility** (a `patients` attribute) becomes available on the **observations** model — completing amr-resistance's deferred facility param and making `amr-facility-summary` a template.
**Status:** Design approved — ready for implementation plan.

## Goal

The AMR reports query `observations`, but "facility" lives on `patients`
(`managing_organization`), reached via `observations.subject_ref` (`'Patient/123'`)
→ strip `Patient/` → `patients.id`. Today every facility-using report does this join
**in JS** (`amr-facility-summary.ts`: fetch observations, extract patient ids, fetch
patients, Map, aggregate). The query model can only query one table, so `facility`
isn't a dimension or filter. Slice D adds a **minimal declared-join mechanism** and a
`facility` dimension on `observations`.

## Decisions locked in brainstorming

- **Minimal declared joins**: a model declares `joins[]`; a dimension can source from a
  joined table. The join machinery is the capability; facility is the first rider.
- **Deliverables**: seed `amr-facility-summary` (facility × tested/resistant) as the 3rd
  editable template AND add a facility filter + param to the existing `rt-amr-resistance`.
- **Portable join key**: `replace(observations.subject_ref, 'Patient/', '') = patients.id`
  — `replace()` has the same signature on pg + mssql (no `||`/`+` concat split).
- **LEFT JOIN on the patients PK** → at most one match per observation → no row fan-out.
- **Null facility surfaces as a bucket** (honest; the JS report drops it — noted difference).
- **Backward-compat**: column refs are qualified ONLY when a join is active; a join-free
  query compiles byte-identical to today.

## Architecture / boundaries

- **Registry + compiler** (`@openldr/dashboards`) — the capability.
- **Templates** (`@openldr/report-builder` + `bootstrap/seed.ts`) — the two deliverables.
- **UI** (`apps/studio`) — `facility` auto-appears in dimension/filter pickers; the only
  studio change is a one-field `api.ts` `ModelDimension` mirror.

## Part 1 — Registry declared joins (`packages/dashboards/src/models/registry.ts`)

Type-only additions (the `MODELS` array is plain data, not Zod-parsed):

```ts
export interface ModelJoin {
  table: keyof ExternalSchema;   // 'patients'
  alias: string;                 // 'jp' (unique per model)
  left: string;                  // base-table column: 'subject_ref'
  leftReplace?: [string, string];// optional: ['Patient/',''] → replace(base.left, 'Patient/', '')
  right: string;                 // joined-table column: 'id'
}
export interface QueryModel { id: string; label: string; table: keyof ExternalSchema; dimensions: ModelDimension[]; metrics: ModelMetric[]; joins?: ModelJoin[] }
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute; join?: string }
```

The `observations` model gains:

```ts
    joins: [{ table: 'patients', alias: 'jp', left: 'subject_ref', leftReplace: ['Patient/', ''], right: 'id' }],
    dimensions: [ …existing…, { key: 'facility', label: 'Facility', column: 'managing_organization', kind: 'string', join: 'jp' } ],
```

A `join`-less dimension (every existing one) is unchanged; a `joins`-less model is unchanged.

## Part 2 — Compiler (`packages/dashboards/src/compile.ts`)

### 2a. Detect used joins
A pure `collectUsedJoins(model, q): ModelJoin[]` scans every dimension reference in the
query — `dimension`, `breakdown`, flat `filters`, `filterTree` rules, and each metric's
`where` (Slice A) — resolves each to its `ModelDimension`, and collects the distinct
`join` aliases, mapping them to the model's `ModelJoin` entries. (A referenced join alias
with no matching `ModelJoin` throws, like `dim()` does for unknown dimensions.)

### 2b. Add the joins + qualify refs
In `compileBuilderQuery`: compute `usedJoins = collectUsedJoins(model, q)` and
`qualify = usedJoins.length > 0`. For each join, add
`qb = qb.leftJoin('<table> as <alias>', jb => jb.on(<onExpr>))` where
`onExpr = sql\`replace(<base.left>, <from>, <to>) = <alias.right>\`` (or without `replace`
when `leftReplace` is absent). `<base.left>` / `<alias.right>` are qualified refs.

Introduce ref helpers and thread `qualify` through every column-ref site:
- `dimColRef(model, dimKey, qualify)` → for a **dimension key**: if its `ModelDimension`
  has `join`, `sql.ref('<join>.<column>')`; else `qualify ? sql.ref('<table>.<column>') : sql.ref('<column>')`.
- `baseColRef(model, col, qualify)` → for a **base-table column** (metric columns):
  `qualify ? sql.ref('<table>.<col>') : sql.ref('<col>')`.

Wire them into the six ref sites (all currently `sql.ref(...)` / `d.column as never`):
the dimension select, the breakdown select, `applyFilters` (`compile.ts:91`), `condExpr`
(`:27`, metric `where`), `compileRule` (filterTree rules), and `metricExpr` (`:59`, via
`baseColRef`). Each gains a `qualify` parameter (threaded from `compileBuilderQuery`).

**Why qualify-when-joined:** once `patients` is joined, an unqualified `id`/`subject_ref`
is ambiguous (both tables have them). So when any join is active, base columns qualify
with `<model.table>` and joined columns with their alias. When no join is used,
everything stays **unqualified — byte-identical to today** (a `compile.test` locks this).

### 2c. Cardinality / null
`LEFT JOIN` on `patients.id` (the PK) → ≤1 match per observation → counts unaffected (no
fan-out). An observation whose patient is missing or has `managing_organization = null`
yields a **null facility** — a null-labeled bucket when grouping (the JS
`amr-facility-summary` drops these; documented difference). Interacts cleanly with the
age-band CASE (Slice C) and conditional metrics (Slice A) — those already build on the
same ref sites, now qualified.

## Part 3 — Deliverables (`@openldr/report-builder` + seed)

### 3a. Seed `amr-facility-summary` (new template)
`packages/report-builder/src/amr-facility-summary-template.ts` (mirrors
`amr-resistance-template.ts`): `AMR_FACILITY_SUMMARY_TEMPLATE_ID = 'rt-amr-facility-summary'`,
`buildAmrFacilitySummaryTemplate` / `seedAmrFacilitySummaryTemplate`. Published "AMR
Resistance by Facility": a wide TABLE over `observations`, dimension `facility`, metrics
`tested` (count where `interpretation_code in [S,I,R]`) + `resistant` (count where
`interpretation_code = R`), a `daterange` param → `effective_date_time` `gte/lte`
`{{param.from/to}}` filters, and a bar chart of `resistant` by `facility`. Exported from
`index.ts`; wired idempotently into `bootstrap/seed.ts` (fresh install seeds it).

### 3b. Facility filter/param on `rt-amr-resistance`
Modify `buildAmrResistanceTemplate`: add a `facility` **select** param
(`optionsSql: "select distinct managing_organization from patients where managing_organization is not null order by 1"`)
and a filter `{ dimension: 'facility', op: 'eq', value: '{{param.facility}}' }` on the
table source. Unset facility → blank-dropped by `resolveQueryParams` (all facilities),
completing Slice G's deferred param. Update the amr-resistance template test to expect the
new param + filter.

## Part 4 — UI (`apps/studio`)

No new UI. `facility` is a normal `ModelDimension` → it appears in the dimension/breakdown
dropdowns and the filter/metric-condition pickers automatically. The facility **param** is
a `select` with `optionsSql`, which `ParametersEditor` + `ParamValuesBar` already support.
The only change: add `join?: string` to the `api.ts` `ModelDimension` mirror for type parity.

## Data flow

Author (or the seeded template) uses `facility` as a dimension or filter on `observations`
→ `compileBuilderQuery` detects the `jp` join is used → adds `LEFT JOIN patients as jp ON
replace(observations.subject_ref,'Patient/','') = jp.id`, qualifies all refs → groups/filters
by `jp.managing_organization` → per-facility counts. `resolveQueryParams` substitutes the
facility/date params; lint counts them used (facility bound in a filter value; already covered).

## Error handling / edge cases

- **Unknown join alias** on a dimension → throws (like unknown dimension).
- **Null / missing facility** → null bucket (grouping) or excluded (a `facility = X` filter).
- **No join used** → no `LEFT JOIN`, unqualified refs, byte-identical SQL (locked by test).
- **Fan-out**: none — PK join is 1:1. A `compile.test` + pg-mem acceptance confirm counts.
- **Multiple joined dims** in one query → each distinct alias joined once (dedup by alias).

## Testing

- **dashboards**: `collectUsedJoins` unit test (dimension/breakdown/filter/filterTree/metric-where
  all trigger the join; unrelated dims don't). `compile.test`: a facility dimension emits
  `left join "patients" as "jp"` with the `replace(...)` ON + qualified `jp.managing_organization`
  group-by; a facility filter adds the join; **a join-free query emits byte-identical
  unqualified SQL** (backward-compat). A **pg-mem acceptance** inserts observations + patients,
  groups by facility, and asserts correct per-facility counts with **no double-counting**.
- **report-builder**: both templates lint-clean; a pg-mem acceptance reproduces
  amr-facility-summary's tested/resistant per facility; the amr-resistance template test covers
  the added facility param + filter (blank-drop when unset).
- **bootstrap**: seed test count `3`→`4` + the sorted id array updated.
- **Visual check** (dev stack): open `rt-amr-facility-summary`; confirm per-facility rows; set
  the facility param on `rt-amr-resistance` and see it narrow.

## Gate

- Forced 31-package typecheck + test — the registry/compiler changes are in shared
  `@openldr/dashboards`, consumed by dashboards, report-builder, server, studio. Never pipe
  turbo through `tail`.
- Pre-existing unrelated flakes (studio `api.test.ts` vitest-dedupe; plugins/users parallel-load
  timeouts that pass in isolation) are not regressions.

## Scope / non-goals

- Only ONE declared join shipped (observations→patients / facility). The mechanism is reusable
  but no other join is added.
- No general multi-hop / N-level join engine; a dimension sources from ONE directly-joined table.
- No `notNull` op to hide the null-facility bucket (same family as the deferred "other" gender).
- No aggregate-across-join beyond count/conditional-count (the existing metrics suffice for
  tested/resistant; summing a joined-table numeric column is not needed and out of scope).
- No retiring of the `amr-facility-summary` code report (coexists).

## Follow-ups (later)

- Additional joins as reports need them (e.g. specimen/test attributes).
- A `notNull`/`neq` op (also unlocks the deferred "other" gender) to hide null-facility rows.
- Slice E (antibiogram pivot/matrix), Slice F (first-isolate dedup).
