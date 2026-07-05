# Query-Model Slice B — Derived (Ratio) Metrics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add derived ratio metrics (`numerator / denominator × scale`, rounded, div-by-zero → 0) to the shared `@openldr/dashboards` builder query model, computed post-aggregation, so `amr-resistance`'s `%R` column becomes expressible on top of Slice A's `r`/`tested` conditional counts — completing amr-resistance in the query model.

**Architecture:** Additive to Slice A. Schema gains an optional `derived` ratio spec on a metric. In compile, derived metrics are validated (their `numerator`/`denominator` must reference existing non-derived metric keys) and **skipped** in the SQL select. In `runWideQuery`, derived metrics are computed per output row as the last step (after grain-bucket summing — you can't sum ratios). UI adds a Column/Ratio toggle to the reports `MetricsListEditor`. Backward-compatible: `derived` is optional; every Slice A / legacy query is unchanged.

**Tech Stack:** TypeScript, zod, Kysely, vitest, pg-mem, React + Testing Library, react-i18next.

**Design spec:** `docs/superpowers/specs/2026-07-05-query-model-slice-b-derived-ratio-metrics-design.md`

**Conventions (repo memory):**
- Slice A is merged on `main` (`a7f60304`). Work Slice B on a fresh branch `slice-b-derived-ratio-metrics` off `main`.
- Never pipe turbo through `tail`. Run one package's tests from repo root: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`.
- `apps/studio/src/api.ts` HAND-MAINTAINS its `WidgetQuery` type (not re-exported from dashboards) — mirror schema changes there.
- `fr.ts`/`pt.ts` are typed `: EnShape` — new locale keys must be added to all three or tsc fails.
- Studio test i18n resolves `t()` to English, so English-valued keys keep assertions passing.
- Commit after every green step; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Modify:**
- `packages/dashboards/src/types.ts` — `DerivedRatioSchema` + optional `derived` on `MetricSchema`.
- `apps/studio/src/api.ts` — mirror `derived?` on the builder metric shape (single `metric` + `metrics[]` element).
- `packages/dashboards/src/compile.ts` — skip derived in the wide SQL select + validate derived refs (`compileBuilderQuery`); compute derived post-aggregation + column `kind` (`runWideQuery`, new `ratio` helper).
- `apps/studio/src/reports-builder/MetricsListEditor.tsx` — Column/Ratio type toggle + numerator/denominator/decimals controls; `ListMetric.derived`.
- `apps/studio/src/i18n/{en,fr,pt}.ts` — new `reportBuilder.metrics.*` keys.

**Test files:** `packages/dashboards/src/types.test.ts`, `packages/dashboards/src/compile.test.ts`, `packages/dashboards/src/compile.run.test.ts`, `apps/studio/src/reports-builder/MetricsListEditor.test.tsx`.

---

## Task 1: Schema — `derived` ratio on a metric (+ studio api mirror)

**Files:**
- Modify: `packages/dashboards/src/types.ts`
- Modify: `apps/studio/src/api.ts`
- Test: `packages/dashboards/src/types.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/dashboards/src/types.test.ts`:

```ts
import { DerivedRatioSchema } from './types';

describe('derived ratio metric schema (Slice B)', () => {
  it('accepts a metric carrying a derived ratio and applies scale/decimals defaults', () => {
    const m = MetricSchema.parse({
      key: 'percentR', agg: 'count',
      derived: { numerator: 'r', denominator: 'tested' },
    });
    expect(m.derived).toEqual({ numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 });
  });

  it('parses an explicit scale/decimals', () => {
    const d = DerivedRatioSchema.parse({ numerator: 'a', denominator: 'b', scale: 1, decimals: 2 });
    expect(d).toEqual({ numerator: 'a', denominator: 'b', scale: 1, decimals: 2 });
  });

  it('still accepts a plain aggregate metric with no derived field', () => {
    const m = MetricSchema.parse({ key: 'tested', agg: 'count' });
    expect(m.derived).toBeUndefined();
  });
});
```

Note: `MetricSchema` is already imported at the top of `types.test.ts` (from Slice A). Add only `DerivedRatioSchema` to that import or a new import line — don't duplicate the `MetricSchema` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/types.test.ts`
Expected: FAIL — `DerivedRatioSchema` is not exported; `derived` is stripped.

- [ ] **Step 3: Add `DerivedRatioSchema` and the `derived` field**

In `packages/dashboards/src/types.ts`, replace the current `MetricSchema` block (it currently ends at `export type Metric = z.infer<typeof MetricSchema>;`):

```ts
export const MetricSchema = z.object({
  key: z.string(), label: z.string().optional(),
  agg: z.enum(AGGS), column: z.string().optional(),
  where: z.array(QueryFilterSchema).optional(), // Slice A: conditional predicate (ANDed)
});
export type Metric = z.infer<typeof MetricSchema>;
```

with (add `DerivedRatioSchema` above `MetricSchema`, then the `derived` field):

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
  where: z.array(QueryFilterSchema).optional(), // Slice A: conditional predicate (ANDed)
  derived: DerivedRatioSchema.optional(),       // Slice B: computed post-aggregation, not selected in SQL
});
export type Metric = z.infer<typeof MetricSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/types.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Mirror `derived?` in the studio `api.ts` `WidgetQuery` type**

In `apps/studio/src/api.ts`, the `builder` member of the `WidgetQuery` union currently reads (from Slice A):

```ts
  | { mode: 'builder'; model: string;
      metric: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[] };
      metrics?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[] }[];
      dimension?: { key: string; grain?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
      variableBindings?: Record<string, string> }
```

Replace it with (adds `derived?` to BOTH the single `metric` and the `metrics[]` element):

```ts
  | { mode: 'builder'; model: string;
      metric: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale?: number; decimals?: number } };
      metrics?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale?: number; decimals?: number } }[];
      dimension?: { key: string; grain?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
      variableBindings?: Record<string, string> }
```

- [ ] **Step 6: Typecheck the studio mirror**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: PASS (additive/optional).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts apps/studio/src/api.ts
git commit -m "feat(dashboards): schema — derived ratio metric (+ studio api mirror)"
```

---

## Task 2: Compile — skip derived in SQL + validate references

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (`compileBuilderQuery` wide branch)
- Test: `packages/dashboards/src/compile.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/dashboards/src/compile.test.ts` (reuse the existing `db`, `getModel`, `compileBuilderQuery`, vitest imports):

```ts
describe('derived metrics compile (Slice B)', () => {
  it('does not emit a SQL column for a derived metric', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'pct', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      dimension: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('as "tested"');
    expect(sql).not.toContain('as "pct"');
  });

  it('throws when a derived metric references an unknown metric', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'pct', agg: 'count', derived: { numerator: 'nope', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      filters: [],
    })).toThrow(/references unknown metric/i);
  });

  it('throws when a derived metric references another derived metric', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'a', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
        { key: 'b', agg: 'count', derived: { numerator: 'a', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      filters: [],
    })).toThrow(/references unknown metric/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: FAIL — derived metrics are currently selected as SQL columns (`as "pct"` present) and no reference validation exists.

- [ ] **Step 3: Update the wide branch of `compileBuilderQuery`**

In `packages/dashboards/src/compile.ts`, replace the `if (wide) { … }` block (the whole block, ending just before `} else {`):

```ts
  if (wide) {
    if (q.breakdown) throw new Error('multi-metric (wide) queries cannot use a breakdown');
    const seen = new Set<string>();
    for (const m of q.metrics!) {
      if (seen.has(m.key)) throw new Error(`duplicate metric key: ${m.key}`);
      seen.add(m.key);
      qb = qb.select(metricExpr(model, m).as(m.key));
    }
  } else {
```

with:

```ts
  if (wide) {
    if (q.breakdown) throw new Error('multi-metric (wide) queries cannot use a breakdown');
    const aggKeys = new Set(q.metrics!.filter((m) => !m.derived).map((m) => m.key));
    const seen = new Set<string>();
    for (const m of q.metrics!) {
      if (seen.has(m.key)) throw new Error(`duplicate metric key: ${m.key}`);
      seen.add(m.key);
      if (m.derived) {
        for (const ref of [m.derived.numerator, m.derived.denominator]) {
          if (!aggKeys.has(ref)) throw new Error(`derived metric ${m.key} references unknown metric: ${ref}`);
        }
        continue; // derived metrics are computed post-aggregation, not selected in SQL
      }
      qb = qb.select(metricExpr(model, m).as(m.key));
    }
  } else {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: PASS (derived cases + all earlier compile tests — including the Slice A dup-key and wide-mode select tests — stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): skip + validate derived metrics in wide-mode compile"
```

---

## Task 3: Run — compute derived ratios post-aggregation + column kind

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (`runWideQuery` + new `ratio` helper)
- Test: `packages/dashboards/src/compile.run.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/dashboards/src/compile.run.test.ts` (reuse `newDb`, `runBuilderQuery`, `getModel`, vitest imports):

```ts
describe('runBuilderQuery derived ratio (Slice B)', () => {
  function memObs() {
    const mem = newDb();
    mem.public.none('create table observations (status text, code_text text, interpretation_code text, value_unit text, value_quantity float, effective_date_time text, subject_ref text)');
    return mem;
  }

  it('computes %R as a derived ratio metric (completes amr-resistance)', async () => {
    const mem = memObs();
    mem.public.none(`insert into observations (code_text, interpretation_code) values
      ('Ciprofloxacin','R'),('Ciprofloxacin','R'),('Ciprofloxacin','I'),('Ciprofloxacin','S'),
      ('Gentamicin','R'),('Gentamicin','S'),('Gentamicin','S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', label: 'Tested', agg: 'count' },
        { key: 'r', label: 'R', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
        { key: 'percentR', label: '%R', agg: 'count', derived: { numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      dimension: { key: 'code_text' },
      filters: [{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }],
    });
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'tested', 'r', 'percentR']);
    expect(res.columns.find((c) => c.key === 'percentR')?.kind).toBe('percent');
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Ciprofloxacin', tested: 4, r: 2, percentR: 50 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Gentamicin', tested: 3, r: 1, percentR: 33.3 }));
  });

  it('returns 0 for a derived ratio when the denominator is 0', async () => {
    const mem = memObs();
    mem.public.none(`insert into observations (interpretation_code) values ('S'),('S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'r', agg: 'count' },
      metrics: [
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
        { key: 'i', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] },
        { key: 'ratio', agg: 'count', derived: { numerator: 'r', denominator: 'i', scale: 100, decimals: 1 } },
      ],
      filters: [],
    });
    expect(res.rows[0]).toEqual(expect.objectContaining({ r: 0, i: 0, ratio: 0 }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.run.test.ts`
Expected: FAIL — `runWideQuery` doesn't compute derived metrics; `percentR`/`ratio` come out `0`/absent and the column kind isn't `percent`.

- [ ] **Step 3: Add the `ratio` helper and rewrite `runWideQuery`**

In `packages/dashboards/src/compile.ts`, add the helper immediately above `runWideQuery`:

```ts
/** Derived ratio: numerator/denominator × scale, rounded to `decimals`; div-by-zero → 0. */
function ratio(d: NonNullable<Metric['derived']>, row: Record<string, unknown>): number {
  const den = Number(row[d.denominator] ?? 0);
  if (!den) return 0;
  const v = (Number(row[d.numerator] ?? 0) / den) * d.scale;
  const f = 10 ** d.decimals;
  return Math.round(v * f) / f;
}
```

Then replace the entire `runWideQuery` function with:

```ts
/** Shape a multi-metric (wide) query into a table: label + one column per metric (aggregate or derived). */
async function runWideQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  const metrics = q.metrics!;
  const aggKeys = metrics.filter((m) => !m.derived).map((m) => m.key);
  const derivedMetrics = metrics.filter((m) => m.derived);
  const rows = (await compileBuilderQuery(db, model, q).execute()) as Record<string, unknown>[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bk = grainKey(r.label, q.dimension.grain);
      const acc = buckets.get(bk) ?? Object.fromEntries(aggKeys.map((k) => [k, 0]));
      for (const k of aggKeys) acc[k] += Number(r[k] ?? 0);
      buckets.set(bk, acc);
    }
    shaped = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, acc]) => ({ label, ...acc }));
  } else if (d) {
    shaped = rows.map((r) => {
      const out: Record<string, unknown> = { label: r.label ?? '(none)' };
      for (const k of aggKeys) out[k] = Number(r[k] ?? 0);
      return out;
    });
  } else {
    const out: Record<string, unknown> = { label: model.label };
    for (const k of aggKeys) out[k] = Number(rows[0]?.[k] ?? 0);
    shaped = [out];
  }

  // Derived (ratio) metrics: computed per output row, after aggregate values are final.
  for (const row of shaped) {
    for (const m of derivedMetrics) row[m.key] = ratio(m.derived!, row);
  }

  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    ...metrics.map((m) => ({
      key: m.key, label: m.label ?? m.key,
      kind: (m.derived && m.derived.scale === 100 ? 'percent' : 'number') as 'percent' | 'number',
    })),
  ];
  const chart: ChartHint = { type: 'bar', x: 'label', y: aggKeys[0] ?? 'label' };
  return { columns, rows: shaped, chart };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.run.test.ts`
Expected: PASS — %R = 50 / 33.3, kind `percent`, div-by-zero → 0. The Slice A wide-mode run tests (aggregate-only) stay green (aggregate-only queries have no `derivedMetrics`, so behavior is identical).

- [ ] **Step 5: Run the whole package + typecheck**

Run: `pnpm --filter @openldr/dashboards exec vitest run` then `pnpm --filter @openldr/dashboards exec tsc --noEmit`
Expected: all suites green; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.run.test.ts
git commit -m "feat(dashboards): compute derived ratio metrics in runWideQuery (%R completes amr-resistance)"
```

---

## Task 4: UI — Column/Ratio toggle in MetricsListEditor (+ i18n)

**Files:**
- Modify: `apps/studio/src/reports-builder/MetricsListEditor.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `apps/studio/src/i18n/fr.ts`, `apps/studio/src/i18n/pt.ts`
- Test: `apps/studio/src/reports-builder/MetricsListEditor.test.tsx`

- [ ] **Step 1: Add locale keys to all three bundles**

In each of `en.ts`, `fr.ts`, `pt.ts`, the `reportBuilder.metrics` object currently ends with an `add:` key. Add these five keys inside that same `metrics` object (before its closing `},`). They must be added to ALL THREE files (fr/pt are typed `: EnShape`).

en.ts:
```ts
      typeColumn: 'Column',
      typeRatio: 'Ratio',
      numerator: 'Numerator',
      denominator: 'Denominator',
      decimals: 'Decimals',
```
fr.ts:
```ts
      typeColumn: 'Colonne',
      typeRatio: 'Ratio',
      numerator: 'Numérateur',
      denominator: 'Dénominateur',
      decimals: 'Décimales',
```
pt.ts:
```ts
      typeColumn: 'Coluna',
      typeRatio: 'Rácio',
      numerator: 'Numerador',
      denominator: 'Denominador',
      decimals: 'Casas decimais',
```

- [ ] **Step 2: Write the failing tests** — append to `apps/studio/src/reports-builder/MetricsListEditor.test.tsx` (the file already imports `describe, it, expect, vi` and `render, fireEvent, screen`, and defines `dims`):

```tsx
describe('MetricsListEditor ratio metrics (Slice B)', () => {
  it('toggles a metric to a ratio with default numerator/denominator/decimals', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'tested', label: 'Tested', agg: 'count' }, { key: 'r', label: 'R', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    const ratioButtons = screen.getAllByRole('button', { name: /^ratio$/i });
    fireEvent.click(ratioButtons[1]);
    expect(onChange).toHaveBeenCalledWith([
      { key: 'tested', label: 'Tested', agg: 'count' },
      expect.objectContaining({ key: 'r', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } }),
    ]);
  });

  it('edits the ratio numerator from the other aggregate metrics', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[
      { key: 'tested', label: 'Tested', agg: 'count' },
      { key: 'r', label: 'R', agg: 'count' },
      { key: 'pct', label: '%R', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
    ]} dimensions={dims} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/numerator/i), { target: { value: 'r' } });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'pct', derived: expect.objectContaining({ numerator: 'r' }) }),
    ]));
  });

  it('toggling back to Column clears derived', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[
      { key: 'tested', agg: 'count' },
      { key: 'pct', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
    ]} dimensions={dims} onChange={onChange} />);
    const colButtons = screen.getAllByRole('button', { name: /^column$/i });
    fireEvent.click(colButtons[1]);
    expect(onChange).toHaveBeenCalledWith([
      { key: 'tested', agg: 'count' },
      expect.objectContaining({ key: 'pct', derived: undefined }),
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/MetricsListEditor.test.tsx`
Expected: FAIL — no Column/Ratio buttons, no numerator control.

- [ ] **Step 4: Rewrite `MetricsListEditor.tsx`**

Replace the entire file `apps/studio/src/reports-builder/MetricsListEditor.tsx` with:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelDimension } from '../api';
import { MetricConditionEditor, type MetricCondition } from '../dashboard/editor/MetricConditionEditor';

export interface DerivedRatio { numerator: string; denominator: string; scale?: number; decimals?: number }
export interface ListMetric { key: string; label?: string; agg: string; column?: string; where?: MetricCondition[]; derived?: DerivedRatio }

const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

export function MetricsListEditor({ metrics, dimensions, onChange }: {
  metrics: ListMetric[]; dimensions: ModelDimension[]; onChange: (m: ListMetric[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<ListMetric>) =>
    onChange(metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = () => {
    const nums = metrics
      .map((m) => /^m(\d+)$/.exec(m.key)?.[1])
      .filter((n): n is string => n != null)
      .map(Number);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    onChange([...metrics, { key: `m${next}`, agg: 'count' }]);
  };
  const remove = (i: number) => onChange(metrics.filter((_, j) => j !== i));

  // Aggregate metrics are the sources a ratio can reference (exclude all derived metrics).
  const aggOptions = metrics.filter((m) => !m.derived);
  const setRatio = (i: number, on: boolean) => {
    if (!on) return update(i, { derived: undefined });
    const first = aggOptions[0]?.key ?? '';
    update(i, { derived: { numerator: first, denominator: first, scale: 100, decimals: 1 } });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">{t('reportBuilder.metrics.heading')}</div>
      {metrics.map((m, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
          <div className="flex items-center gap-1">
            <Input aria-label={t('reportBuilder.metrics.label')} className="h-7 flex-1 text-xs" placeholder={t('reportBuilder.metrics.labelPlaceholder')}
              value={m.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
            <Button type="button" size="sm" variant={!m.derived ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => setRatio(i, false)}>{t('reportBuilder.metrics.typeColumn')}</Button>
            <Button type="button" size="sm" variant={m.derived ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => setRatio(i, true)}>{t('reportBuilder.metrics.typeRatio')}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t('reportBuilder.metrics.remove')} onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          {!m.derived && (
            <>
              <div className="flex items-center gap-1">
                <select aria-label={t('reportBuilder.metrics.aggregate')} className="h-7 rounded border border-border bg-background text-xs"
                  value={m.agg} onChange={(e) => update(i, { agg: e.target.value })}>
                  {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {m.agg !== 'count' && (
                  <select aria-label={t('reportBuilder.metrics.column')} className="h-7 flex-1 rounded border border-border bg-background text-xs"
                    value={m.column ?? ''} onChange={(e) => update(i, { column: e.target.value || undefined })}>
                    <option value="">{t('reportBuilder.metrics.columnPlaceholder')}</option>
                    {dimensions.map((d) => <option key={d.key} value={d.column}>{d.label}</option>)}
                  </select>
                )}
              </div>
              <MetricConditionEditor
                conditions={m.where ?? []}
                dimensions={dimensions}
                onChange={(w) => update(i, { where: w.length ? w : undefined })}
              />
            </>
          )}

          {m.derived && (
            <div className="flex items-center gap-1">
              <select aria-label={t('reportBuilder.metrics.numerator')} className="h-7 flex-1 rounded border border-border bg-background text-xs"
                value={m.derived.numerator} onChange={(e) => update(i, { derived: { ...m.derived!, numerator: e.target.value } })}>
                {aggOptions.map((o) => <option key={o.key} value={o.key}>{o.label || o.key}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">/</span>
              <select aria-label={t('reportBuilder.metrics.denominator')} className="h-7 flex-1 rounded border border-border bg-background text-xs"
                value={m.derived.denominator} onChange={(e) => update(i, { derived: { ...m.derived!, denominator: e.target.value } })}>
                {aggOptions.map((o) => <option key={o.key} value={o.key}>{o.label || o.key}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">×100%</span>
              <Input aria-label={t('reportBuilder.metrics.decimals')} type="number" className="h-7 w-14 text-xs"
                value={m.derived.decimals ?? 1} onChange={(e) => update(i, { derived: { ...m.derived!, decimals: Number(e.target.value) } })} />
            </div>
          )}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>{t('reportBuilder.metrics.add')}</Button>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/MetricsListEditor.test.tsx`
Expected: PASS — the 3 new ratio cases AND the pre-existing 4 cases (add/remove/edit-label/collision) stay green (label Input, "Remove metric", "Add metric" all unchanged).

- [ ] **Step 6: Typecheck + reports-builder suite (QueryEditor still wires cleanly)**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit` then `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ src/i18n/`
Expected: tsc clean (i18n `EnShape` parity holds); reports-builder + i18n suites green (`QueryEditor` passes `builderQuery.metrics` — now possibly carrying `derived` — through `ListMetric[]` unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/reports-builder/MetricsListEditor.tsx apps/studio/src/reports-builder/MetricsListEditor.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Column/Ratio metric toggle in MetricsListEditor (+ i18n)"
```

---

## Task 5: Full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck across all packages**

Run: `pnpm turbo run typecheck --force`
Expected: 31/31 packages PASS. Do NOT pipe through `tail`. The shared schema change must compile in server, bootstrap, reporting, report-builder, studio, dashboards.

- [ ] **Step 2: Forced full test run**

Run: `pnpm turbo run test --force`
Expected: PASS across the workspace. Two pre-existing flakes are NOT Slice B regressions and are acceptable: `@openldr/audit#test` (a parallel-load 5s timeout — re-run `pnpm --filter @openldr/audit test` in isolation to confirm it passes ~1s) and `apps/studio/src/api.test.ts > "includes server error messages…"` (the vitest-dedupe flake, red on `main` identically — confirm by checking out `main` and running that one file if in doubt). Any OTHER failure must be fixed.

- [ ] **Step 3: Confirm the Slice B packages are clean**

Run: `pnpm --filter @openldr/dashboards test` and `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ src/i18n/ src/dashboard/editor/`
Expected: all green (dashboards derived-ratio suites; studio reports-builder + i18n + dashboard-editor suites).

- [ ] **Step 4: Final commit (only if a gate fixup was needed)**

```bash
git add -A
git commit -m "chore(query-model): Slice B gate — forced typecheck + full test green"
```

If Steps 1–3 required no fixups, skip this commit.

---

## Done criteria

- A metric can carry a `derived` ratio (`numerator/denominator × scale`, rounded, div-by-zero → 0), computed post-aggregation in `runWideQuery`, not selected in SQL.
- Derived references are validated (must point at a non-derived metric key in the same query); dangling refs throw a clear error.
- **amr-resistance is fully reproducible**: the wide query with `tested`, `r`, `i`, `s` conditional counts + a `percentR` derived ratio yields the exact `pivotResistance` rows including `%R` (proven by the Task 3 acceptance test).
- Reports UI authors ratios via a Column/Ratio toggle (i18n en/fr/pt).
- Backward-compatible: aggregate-only wide queries and single-metric queries are byte-identical; forced 31-package typecheck + full test green (modulo the two documented pre-existing flakes).

## Follow-ups (not this slice)

- **Slice G** — seed the converted `amr-resistance` builder template + verify the multi-metric + %R table renders end-to-end in PDF/canvas.
- **Slice C** — computed/bucketed dimensions (age-band) for `patient-demographics`.
- General derived ops / dashboard ratio KPIs, if a later report needs them.
