# Query-Model Expansion — Slice B: Derived (Ratio) Metrics

**Date:** 2026-07-05
**Workstream:** query-model-expansion (see memory `query-model-expansion-workstream`)
**Depends on:** Slice A (conditional/filtered metrics + multi-metric tables) — merged local `main` `a7f60304`.
**Status:** Design approved — ready for implementation plan.

## Goal

Add **derived ratio metrics** to the shared `@openldr/dashboards` builder query
model: a metric whose value is `numerator / denominator × scale`, rounded to N
decimals, computed **per output row from other metrics' aggregate values**
(post-aggregation, in JS). This completes `amr-resistance`: its `%R` column
(`round(r / tested × 100, 1)`) becomes expressible on top of the Slice A `r` /
`tested` conditional-count columns. After this slice, `amr-resistance` is fully
reproducible by the query model — only the Slice G template seed remains.

The change is in the **shared** dashboards package, so it must be
**backward-compatible and additive**, and pass the forced 31-package typecheck.

## Scope decisions (locked)

- **Ratio only.** A derived metric is exactly `numerator / denominator × scale`,
  rounded to `decimals`, with division-by-zero → `0` (matching
  `pivotResistance`'s `percentR`). No general arithmetic expression engine — no
  in-scope report needs it, and it would drag in a parser/evaluator + its own
  validation surface. A general form can be added additively later if a report
  demands it.
- **Post-aggregation in JS.** Derived metrics are computed in `runWideQuery`
  after the aggregate columns are fully shaped (including grain-bucket summing),
  as the last step. They are **not** selected in SQL.
- **Reports UI only.** The derived-metric authoring UI is added to the reports
  `MetricsListEditor`. Dashboards `BuilderForm` is untouched — a ratio needs two
  aggregate metrics, which the single-metric dashboards form cannot express.

## Out of scope (YAGNI — explicit)

- General arithmetic expressions; derived-of-derived chaining; sum/difference
  derived ops.
- Ratio KPIs on dashboards (would require multi-metric on dashboards).
- Seeding the `amr-resistance` template + verifying its PDF/canvas render → **Slice G**.

## Architecture

Three layers, each independently testable:

1. **Schema** (`packages/dashboards/src/types.ts`) — additive `derived` field.
2. **Compile/run** (`packages/dashboards/src/compile.ts`) — skip derived in SQL
   select; compute derived post-aggregation in `runWideQuery`; validate refs.
3. **UI** (`apps/studio/src/reports-builder/MetricsListEditor.tsx`) — a
   `Column`/`Ratio` type toggle with numerator/denominator/decimals controls.

### 1. Schema (`packages/dashboards/src/types.ts`)

```ts
export const DerivedRatioSchema = z.object({
  numerator: z.string(),            // key of another (aggregate) metric in the same query
  denominator: z.string(),          // key of another (aggregate) metric
  scale: z.number().default(100),   // ×100 → percent
  decimals: z.number().default(1),  // round to N decimals
});
export type DerivedRatio = z.infer<typeof DerivedRatioSchema>;

export const MetricSchema = z.object({
  key: z.string(), label: z.string().optional(),
  agg: z.enum(AGGS), column: z.string().optional(),
  where: z.array(QueryFilterSchema).optional(),
  derived: DerivedRatioSchema.optional(),  // Slice B: when set, computed post-aggregation, not selected in SQL
});
```

- `agg` stays required (keeps the type simple); for a derived metric it is
  ignored — the presence of `derived` is the discriminator. The UI defaults it to
  `count`.
- Mirror `derived?` into the hand-maintained `apps/studio/src/api.ts`
  `WidgetQuery` builder metric shape (both the single `metric` and the `metrics[]`
  element), matching its loose style:
  `derived?: { numerator: string; denominator: string; scale?: number; decimals?: number }`
  (`scale`/`decimals` optional on the client type — the UI sets them explicitly and
  the server's zod parse applies defaults).
- Backward-compatible: `derived` is optional; every Slice A / legacy query is
  unaffected.

### 2. Compile + run (`packages/dashboards/src/compile.ts`)

**`compileBuilderQuery` (wide branch):** skip derived metrics when emitting SQL
columns — `if (m.derived) continue;` before the per-metric `.select(...)`. Derived
metrics produce **no** SQL column. The duplicate-key check still spans **all**
metric keys (derived output columns must be uniquely named too). Validation of
derived references happens here (fail-fast, before execution) — see §3.

**`runWideQuery`:** compute derived metrics **after** the aggregate columns are
fully shaped for each output row (i.e. after grain-bucket summing — ratios cannot
be summed across buckets), as the final step:

```ts
function ratio(d: DerivedRatio, row: Record<string, unknown>): number {
  const den = Number(row[d.denominator] ?? 0);
  if (!den) return 0;                                   // div-by-zero → 0
  const v = (Number(row[d.numerator] ?? 0) / den) * d.scale;
  const f = 10 ** d.decimals;
  return Math.round(v * f) / f;
}
```

For each shaped row and each derived metric (in `metrics[]` order):
`row[m.key] = ratio(m.derived, row)`. This reproduces `pivotResistance`'s
`percentR` (`round(r / tested * 100 * 10) / 10`).

**Columns:** built in `metrics[]` order so `tested, r, i, s, %R` interleave
naturally. A derived metric's column `kind` is `'percent'` when `scale === 100`,
else `'number'`.

### 3. Validation (in compile, fail-fast with clear errors)

- Each `derived.numerator` / `derived.denominator` must reference an existing
  **non-derived** metric key in the same query → else throw
  `` `derived metric ${m.key} references unknown metric: ${ref}` ``. (A derived
  metric may not reference another derived metric — this keeps evaluation a single
  pass and avoids ordering/cycle concerns.)
- Derived keys participate in the existing duplicate-metric-key check.

### 4. UI (`apps/studio/src/reports-builder/MetricsListEditor.tsx`) — reports only

- Per metric row: a **type toggle `Column` (aggregate) ▸ `Ratio` (derived)**.
- **Aggregate** row: unchanged (label / agg / optional column / condition editor).
- **Ratio** row: hide agg/column/condition; show a **numerator** `<select>` and a
  **denominator** `<select>`, each populated from the **other non-derived**
  metrics in the list (by label, value = key), plus a **decimals** number input.
  `scale` is fixed at `100` in the UI (rendered/hinted as `%`); it stays in the
  schema so a non-percent ratio is possible later without a migration. Writing a
  ratio sets `metric.derived = { numerator, denominator, scale: 100, decimals }`
  and leaves `agg: 'count'` as the ignored default.
- Localized: extend the `reportBuilder.metrics.*` bundle (en/fr/pt) with the new
  strings (type toggle labels, numerator, denominator, decimals, ratio).
- **Dashboards `BuilderForm` is untouched.**

### 5. Testing (TDD)

Engine (`packages/dashboards`):
- Schema: `MetricSchema` accepts a `derived` ratio (defaults applied for
  `scale`/`decimals`); legacy metrics still parse.
- `compileBuilderQuery`: a derived metric emits **no** SQL column (its key does
  not appear as a `select … as`); a dangling `numerator`/`denominator` reference
  throws `references unknown metric`; duplicate derived key throws.
- `runWideQuery` (pg-mem): **the completion proof** — the Slice A amr-resistance
  query plus a `percentR` derived metric reproduces `pivotResistance` **including
  %R** (Cipro `r=2,tested=4 → 50.0`; Genta `r=1,tested=3 → 33.3`); a div-by-zero
  row (`tested=0 → 0`).
- Backward-compat: aggregate-only wide queries and single-metric queries produce
  identical SQL/shape to before.

UI (`apps/studio`):
- `MetricsListEditor`: toggling a metric to `Ratio` writes `derived`; the
  numerator/denominator selects list the other metrics; editing decimals updates
  `derived.decimals`; existing aggregate/add/remove behavior unchanged.

### 6. Gate

- Forced 31-package typecheck (`pnpm turbo run typecheck --force`) — shared schema
  change. Never pipe turbo through `tail`.
- The pre-existing unrelated flakes (`audit#test` parallel-load timeout;
  `studio/api.test.ts` vitest-dedupe, red on `main`) are not Slice B regressions.

## Follow-ups (later slices)

- **Slice G** — seed the converted `amr-resistance` builder template and verify
  its PDF/canvas render of the multi-metric + %R table end-to-end.
- **Slice C** — computed/bucketed dimensions (age-band) for `patient-demographics`.
- General derived ops / dashboard ratio KPIs, if a later report needs them.
