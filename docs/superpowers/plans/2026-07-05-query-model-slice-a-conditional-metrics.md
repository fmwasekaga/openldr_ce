# Query-Model Slice A — Conditional/Filtered Metrics + Multi-Metric Tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conditional aggregate metrics (`count where <dimension> = <value>`) and multi-metric table queries to the shared `@openldr/dashboards` builder query model, so the `amr-resistance` R/I/S/tested table becomes expressible (%R arrives in Slice B).

**Architecture:** Three additive layers — (1) zod schema gains an optional `where` on a metric and an optional `metrics[]` on the builder query; (2) the compiler emits portable `CASE`-based conditional aggregates and a wide-table branch; (3) two UIs (Report Builder `QueryEditor` multi-metric list, dashboards `BuilderForm` conditional predicate) share one literal-condition editor. Every change is backward-compatible: `metric` stays required, `metrics`/`where` are optional, so all stored dashboards and templates keep validating.

**Tech Stack:** TypeScript, zod, Kysely (`sql` template tag), vitest, pg-mem (in-memory Postgres for run tests), React + Testing Library.

**Design spec:** `docs/superpowers/specs/2026-07-05-query-model-slice-a-conditional-metrics-design.md`

**Conventions (from repo memory):**
- Never pipe turbo through `tail` (masks exit code).
- Schema lives in the SHARED dashboards package → the final gate is the forced full-workspace typecheck (`--force`, turbo cache hides cross-package breakage).
- Run one package's tests from repo root, e.g. `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`.
- Commit after every green step.

---

## File Structure

**Modify:**
- `packages/dashboards/src/types.ts` — reorder `QueryFilterSchema` above `MetricSchema`; add `where` to `MetricSchema`; add `metrics` to the builder branch.
- `apps/studio/src/api.ts` — the studio hand-maintained `WidgetQuery` type mirror (it is NOT re-exported from `@openldr/dashboards`) gains `where?` on the metric shape and a `metrics?` array on the builder branch. Its `op`/`value` are already loose (`string`/`unknown`), so the UI condition types line up without casts.
- `packages/dashboards/src/compile.ts` — `likePattern` helper (factored escaping), `condExpr`, conditional `metricExpr`, wide-mode branch in `compileBuilderQuery`, `runWideQuery` branch in `runBuilderQuery`.
- `apps/studio/src/dashboard/editor/BuilderForm.tsx` — conditional predicate editor on the single metric.
- `apps/studio/src/reports-builder/QueryEditor.tsx` — multi-metric list for table blocks.

**Create:**
- `apps/studio/src/dashboard/editor/MetricConditionEditor.tsx` — shared literal-condition-row editor (consumed by both UIs).
- `apps/studio/src/reports-builder/MetricsListEditor.tsx` — the multi-metric column list for table blocks.
- Tests alongside each (see tasks).

**Test files touched:** `packages/dashboards/src/types.test.ts`, `packages/dashboards/src/compile.test.ts`, `packages/dashboards/src/compile.run.test.ts`, `apps/studio/src/dashboard/editor/MetricConditionEditor.test.tsx`, `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`, `apps/studio/src/reports-builder/MetricsListEditor.test.tsx`, `apps/studio/src/reports-builder/QueryEditor.test.tsx`.

---

## Task 1: Type contract — `where` on metrics, `metrics[]` on the builder query (dashboards schema + studio api mirror)

**Files:**
- Modify: `packages/dashboards/src/types.ts`
- Modify: `apps/studio/src/api.ts`
- Test: `packages/dashboards/src/types.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/types.test.ts`:

```ts
import { MetricSchema, WidgetQuerySchema } from './types';

describe('conditional & multi-metric schema (Slice A)', () => {
  it('accepts a metric with a conditional where predicate', () => {
    const m = MetricSchema.parse({
      key: 'r', label: 'R', agg: 'count',
      where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }],
    });
    expect(m.where?.[0]).toEqual({ dimension: 'interpretation_code', op: 'eq', value: 'R' });
  });

  it('accepts a builder query carrying multiple metrics', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      dimension: { key: 'code_text' }, filters: [],
    });
    if (q.mode !== 'builder') throw new Error('expected builder');
    expect(q.metrics?.map((m) => m.key)).toEqual(['tested', 'r']);
  });

  it('still accepts a legacy single-metric builder query with no metrics field', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
    });
    if (q.mode !== 'builder') throw new Error('expected builder');
    expect(q.metrics).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/types.test.ts`
Expected: FAIL — the `where`/`metrics` keys are stripped or the assertions fail (schema doesn't define them yet).

- [ ] **Step 3: Reorder `QueryFilterSchema` above `MetricSchema` and add the fields**

In `packages/dashboards/src/types.ts`, **delete** the current `QueryFilterSchema` block (lines ~27-31):

```ts
export const QueryFilterSchema = z.object({
  dimension: z.string(), op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).nullable(),
});
export type QueryFilter = z.infer<typeof QueryFilterSchema>;
```

Then **replace** the current `MetricSchema` block:

```ts
export const MetricSchema = z.object({
  key: z.string(), label: z.string().optional(),
  agg: z.enum(AGGS), column: z.string().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;
```

with the reordered pair (`QueryFilterSchema` first so `MetricSchema.where` can reference it):

```ts
export const QueryFilterSchema = z.object({
  dimension: z.string(), op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).nullable(),
});
export type QueryFilter = z.infer<typeof QueryFilterSchema>;

export const MetricSchema = z.object({
  key: z.string(), label: z.string().optional(),
  agg: z.enum(AGGS), column: z.string().optional(),
  where: z.array(QueryFilterSchema).optional(), // Slice A: conditional predicate (ANDed)
});
export type Metric = z.infer<typeof MetricSchema>;
```

- [ ] **Step 4: Add `metrics` to the builder branch of `WidgetQuerySchema`**

In the `mode: z.literal('builder')` object (the first member of the `discriminatedUnion`), add `metrics` right after `metric`:

```ts
    metric: MetricSchema,
    metrics: z.array(MetricSchema).optional(), // Slice A: multi-column table mode
    dimension: DimensionRefSchema.optional(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/types.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Mirror the fields in the studio `api.ts` `WidgetQuery` type**

`apps/studio/src/api.ts` hand-maintains `WidgetQuery` (it does not re-export the dashboards zod type), so the UI won't see `where`/`metrics` until this mirror is updated. Replace the `builder` member of the `WidgetQuery` union (lines ~260-262):

```ts
  | { mode: 'builder'; model: string; metric: { key: string; label?: string; agg: string; column?: string };
      dimension?: { key: string; grain?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
      variableBindings?: Record<string, string> }
```

with (adds `where?` to the metric shape and a `metrics?` array of the same metric shape):

```ts
  | { mode: 'builder'; model: string;
      metric: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[] };
      metrics?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[] }[];
      dimension?: { key: string; grain?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
      variableBindings?: Record<string, string> }
```

- [ ] **Step 7: Typecheck the studio type mirror**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: PASS (the change is additive/optional; no existing consumer breaks).

- [ ] **Step 8: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts apps/studio/src/api.ts
git commit -m "feat(dashboards): schema — conditional metric where + multi-metric metrics[] (+ studio api mirror)"
```

---

## Task 2: Conditional aggregate compilation (`condExpr` + `CASE` in `metricExpr`)

**Files:**
- Modify: `packages/dashboards/src/compile.ts`
- Test: `packages/dashboards/src/compile.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/dashboards/src/compile.test.ts` (inside the existing `describe('compileBuilderQuery', …)` or a new describe — the file already imports `compileBuilderQuery`, `getModel`, and constructs `db`):

```ts
describe('conditional metrics (Slice A)', () => {
  it('compiles a conditional count to a portable sum(case when …)', () => {
    const model = getModel('observations')!;
    const { sql, parameters } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      dimension: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('sum(case when');
    expect(sql).toContain('then 1 else 0 end)');
    expect(parameters).toContain('R'); // predicate value is bound, not inlined
  });

  it('wraps sum/avg/count_distinct conditionally', () => {
    const model = getModel('observations')!;
    const mk = (agg: string) => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'x', agg: agg as any, column: 'value_quantity', where: [{ dimension: 'status', op: 'eq', value: 'final' }] },
      filters: [],
    }).compile().sql;
    expect(mk('sum')).toContain('sum(case when');
    expect(mk('sum')).toContain('else 0 end)');
    expect(mk('avg')).toContain('avg(case when');
    expect(mk('count_distinct')).toContain('count(distinct case when');
  });

  it('leaves a plain count unchanged (no where)', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
    }).compile();
    expect(sql).toContain('count(*)');
    expect(sql).not.toContain('case when');
  });

  it('rejects a conditional predicate on an unknown dimension', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'r', agg: 'count', where: [{ dimension: 'evil', op: 'eq', value: 'R' }] },
      filters: [],
    })).toThrow(/unknown dimension/i);
  });

  it('supports in / gte / between predicate operators', () => {
    const model = getModel('observations')!;
    const s = (where: any) => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'x', agg: 'count', where }, filters: [],
    }).compile().sql;
    expect(s([{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I'] }])).toContain('in (');
    expect(s([{ dimension: 'effective_date_time', op: 'gte', value: '2024-01-01' }])).toContain('>=');
    expect(s([{ dimension: 'effective_date_time', op: 'between', value: ['2024-01-01', '2024-12-31'] }])).toContain('>=');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: FAIL — `metricExpr` ignores `where`, so no `case when` is emitted.

- [ ] **Step 3: Add the `likePattern` helper and `condExpr`**

In `packages/dashboards/src/compile.ts`, add near the top (after the imports / `dim` helper). First factor the `contains` escaping so `applyFilters` and `condExpr` share it:

```ts
/** LIKE pattern for a `contains` match, escaping % _ \ so they're literal. */
function likePattern(value: unknown): string {
  return `%${String(value).replace(/[%_\\]/g, '\\$&')}%`;
}

/** A portable boolean SQL fragment for a metric's conditional predicate (ANDed). */
function condExpr(model: QueryModel, where: QueryFilter[]) {
  const frags = [];
  for (const f of where) {
    if (f.value === null) continue;
    const d = dim(model, f.dimension); // throws on unknown dimension
    const ref = sql.ref(d.column);
    switch (f.op) {
      case 'eq': frags.push(sql`${ref} = ${f.value}`); break;
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        frags.push(sql`${ref} in (${sql.join(arr)})`);
        break;
      }
      case 'contains': frags.push(sql`${ref} like ${likePattern(f.value)}`); break;
      case 'gte': frags.push(sql`${ref} >= ${f.value}`); break;
      case 'lte': frags.push(sql`${ref} <= ${f.value}`); break;
      case 'between':
        if (Array.isArray(f.value) && f.value.length === 2) {
          frags.push(sql`(${ref} >= ${f.value[0]} and ${ref} <= ${f.value[1]})`);
        }
        break;
    }
  }
  if (frags.length === 0) return sql<boolean>`1=1`;
  return sql<boolean>`(${sql.join(frags, sql` and `)})`;
}
```

Update `applyFilters`' `contains` case to use the shared helper (replace the inline `escaped`/`` `%${escaped}%` `` lines):

```ts
      case 'contains': {
        q = q.where(ref, 'like', likePattern(f.value) as never);
        break;
      }
```

- [ ] **Step 4: Make `metricExpr` conditional**

Replace the whole `metricExpr` function body with:

```ts
function metricExpr(model: QueryModel, m: Metric) {
  const cond = m.where && m.where.length ? condExpr(model, m.where) : null;
  if (m.agg === 'count') {
    return cond ? sql<number>`sum(case when ${cond} then 1 else 0 end)` : sql<number>`count(*)`;
  }
  if (!m.column) throw new Error(`metric ${m.agg} requires a column`);
  const knownAsDimension = model.dimensions.some((d) => d.column === m.column);
  const knownAsMetric = model.metrics.some((x) => x.column === m.column);
  if (!knownAsDimension && !knownAsMetric) throw new Error(`unknown metric column: ${m.column}`);
  const col = sql.ref(m.column);
  switch (m.agg) {
    case 'count_distinct': return cond ? sql<number>`count(distinct case when ${cond} then ${col} else null end)` : sql<number>`count(distinct ${col})`;
    case 'sum': return cond ? sql<number>`sum(case when ${cond} then ${col} else 0 end)` : sql<number>`sum(${col})`;
    case 'avg': return cond ? sql<number>`avg(case when ${cond} then ${col} else null end)` : sql<number>`avg(${col})`;
    case 'min': return cond ? sql<number>`min(case when ${cond} then ${col} else null end)` : sql<number>`min(${col})`;
    case 'max': return cond ? sql<number>`max(case when ${cond} then ${col} else null end)` : sql<number>`max(${col})`;
    default: throw new Error(`unsupported agg: ${m.agg}`);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: PASS (new conditional-metric cases + the pre-existing tests stay green — the plain-count and filter tests are unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): portable CASE conditional aggregates in metricExpr"
```

---

## Task 3: Wide-mode compile branch (multiple metrics → columns)

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (`compileBuilderQuery`)
- Test: `packages/dashboards/src/compile.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/dashboards/src/compile.test.ts`:

```ts
describe('wide-mode compile (Slice A)', () => {
  it('selects one aliased column per metric, grouped by the dimension', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      dimension: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('as "tested"');
    expect(sql).toContain('as "r"');
    expect(sql).toContain('group by');
  });

  it('rejects wide mode combined with a breakdown', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      metrics: [{ key: 'a', agg: 'count' }],
      dimension: { key: 'code_text' }, breakdown: { key: 'status' }, filters: [],
    })).toThrow(/breakdown/i);
  });

  it('rejects duplicate metric keys', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'a', agg: 'count' },
      metrics: [{ key: 'a', agg: 'count' }, { key: 'a', agg: 'count' }],
      filters: [],
    })).toThrow(/duplicate metric key/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: FAIL — `metrics` is ignored; only the single `metric` `value` column is selected and no dup/breakdown guard exists.

- [ ] **Step 3: Add the wide-mode branch to `compileBuilderQuery`**

Replace the body of `compileBuilderQuery` with:

```ts
export function compileBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery): AnyQB {
  const wide = !!(q.metrics && q.metrics.length > 0);
  let qb = db.selectFrom(model.table) as unknown as AnyQB;
  if (wide) {
    if (q.breakdown) throw new Error('multi-metric (wide) queries cannot use a breakdown');
    const seen = new Set<string>();
    for (const m of q.metrics!) {
      if (seen.has(m.key)) throw new Error(`duplicate metric key: ${m.key}`);
      seen.add(m.key);
      qb = qb.select(metricExpr(model, m).as(m.key));
    }
  } else {
    qb = qb.select(metricExpr(model, q.metric).as('value'));
  }
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    qb = qb.select(sql.ref(d.column).as('label')).groupBy(d.column as never).orderBy(d.column as never);
  }
  if (!wide && q.breakdown) {
    const b = dim(model, q.breakdown.key);
    qb = qb.select(sql.ref(b.column).as('series')).groupBy(b.column as never).orderBy(b.column as never);
  }
  qb = applyFilters(qb, model, q.filters ?? []);
  return qb;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: PASS (wide-mode cases + all earlier compile tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): wide-mode compile branch for multi-metric table queries"
```

---

## Task 4: Wide-mode run shaping + amr-resistance acceptance

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (`runBuilderQuery` + new `runWideQuery`)
- Test: `packages/dashboards/src/compile.run.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/dashboards/src/compile.run.test.ts` (the file already imports `runBuilderQuery`, `getModel`, and `newDb` from pg-mem):

```ts
describe('runBuilderQuery wide mode (Slice A)', () => {
  function memObs() {
    const mem = newDb();
    mem.public.none('create table observations (status text, code_text text, interpretation_code text, value_unit text, value_quantity float, effective_date_time text, subject_ref text)');
    return mem;
  }

  it('reproduces the amr-resistance R/I/S/tested pivot as columns', async () => {
    const mem = memObs();
    // Cipro: 2R 1I 1S ; Genta: 1R 0I 2S
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
        { key: 'i', label: 'I', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] },
        { key: 's', label: 'S', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'S' }] },
      ],
      dimension: { key: 'code_text' },
      filters: [{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }],
    });
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'tested', 'r', 'i', 's']);
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Ciprofloxacin', tested: 4, r: 2, i: 1, s: 1 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Gentamicin', tested: 3, r: 1, i: 0, s: 2 }));
  });

  it('returns a single summary row with each metric when there is no dimension', async () => {
    const mem = memObs();
    mem.public.none(`insert into observations (interpretation_code) values ('R'),('R'),('S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      filters: [],
    });
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]).toEqual(expect.objectContaining({ tested: 3, r: 2 }));
  });

  it('sums each metric column per grain bucket for a date dimension', async () => {
    const mem = memObs();
    mem.public.none(`insert into observations (effective_date_time, interpretation_code) values
      ('2024-01-05','R'),('2024-01-20','S'),('2024-02-03','R')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'total', agg: 'count' },
      metrics: [
        { key: 'total', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      dimension: { key: 'effective_date_time', grain: 'month' }, filters: [],
    });
    expect(res.rows.map((r) => r.label).sort()).toEqual(['2024-01', '2024-02']);
    expect(res.rows).toContainEqual(expect.objectContaining({ label: '2024-01', total: 2, r: 1 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: '2024-02', total: 1, r: 1 }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.run.test.ts`
Expected: FAIL — `runBuilderQuery` has no wide branch; it shapes the single `value` column and ignores `metrics`.

- [ ] **Step 3: Add `runWideQuery` and branch `runBuilderQuery`**

In `packages/dashboards/src/compile.ts`, add this function above `runBuilderQuery`:

```ts
/** Shape a multi-metric (wide) query into a table: label + one numeric column per metric. */
async function runWideQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  const metrics = q.metrics!;
  const keys = metrics.map((m) => m.key);
  const rows = (await compileBuilderQuery(db, model, q).execute()) as Record<string, unknown>[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bk = grainKey(r.label, q.dimension.grain);
      const acc = buckets.get(bk) ?? Object.fromEntries(keys.map((k) => [k, 0]));
      for (const k of keys) acc[k] += Number(r[k] ?? 0);
      buckets.set(bk, acc);
    }
    shaped = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, acc]) => ({ label, ...acc }));
  } else if (d) {
    shaped = rows.map((r) => {
      const out: Record<string, unknown> = { label: r.label ?? '(none)' };
      for (const k of keys) out[k] = Number(r[k] ?? 0);
      return out;
    });
  } else {
    const out: Record<string, unknown> = { label: model.label };
    for (const k of keys) out[k] = Number(rows[0]?.[k] ?? 0);
    shaped = [out];
  }

  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    ...metrics.map((m) => ({ key: m.key, label: m.label ?? m.key, kind: 'number' as const })),
  ];
  const chart: ChartHint = { type: 'bar', x: 'label', y: keys[0] ?? 'label' };
  return { columns, rows: shaped, chart };
}
```

Then add the branch as the first line of `runBuilderQuery`'s body (immediately after the function signature `{`):

```ts
  if (q.metrics && q.metrics.length > 0) return runWideQuery(db, model, q);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.run.test.ts`
Expected: PASS (amr pivot, no-dimension summary, and grain-bucket cases).

- [ ] **Step 5: Run the whole dashboards package to confirm no regressions**

Run: `pnpm --filter @openldr/dashboards test`
Expected: PASS — every existing suite (breakdown shaping, seed, store, sql-runner, registry, types) stays green.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.run.test.ts
git commit -m "feat(dashboards): wide-mode run shaping + amr-resistance pivot acceptance"
```

---

## Task 5: Shared `MetricConditionEditor` (literal condition rows)

**Files:**
- Create: `apps/studio/src/dashboard/editor/MetricConditionEditor.tsx`
- Test: `apps/studio/src/dashboard/editor/MetricConditionEditor.test.tsx`

Note: this component uses plain English strings to match the sibling `BuilderForm.tsx` (the dashboards editor is not wired to `react-i18next`; only the reports-builder was localized). Keeping it English-literal avoids adding `reportBuilder.*` keys across en/fr/pt in this slice.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/dashboard/editor/MetricConditionEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MetricConditionEditor } from './MetricConditionEditor';

const dims = [
  { key: 'interpretation_code', label: 'Interpretation', column: 'interpretation_code', kind: 'string' as const },
  { key: 'status', label: 'Status', column: 'status', kind: 'string' as const },
];

describe('MetricConditionEditor', () => {
  it('adds a condition defaulting to the first dimension', () => {
    const onChange = vi.fn();
    render(<MetricConditionEditor conditions={[]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith([{ dimension: 'interpretation_code', op: 'eq', value: '' }]);
  });

  it('edits a condition value', () => {
    const onChange = vi.fn();
    render(<MetricConditionEditor conditions={[{ dimension: 'interpretation_code', op: 'eq', value: '' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'R' } });
    expect(onChange).toHaveBeenCalledWith([{ dimension: 'interpretation_code', op: 'eq', value: 'R' }]);
  });

  it('removes a condition', () => {
    const onChange = vi.fn();
    render(<MetricConditionEditor conditions={[{ dimension: 'status', op: 'eq', value: 'final' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove condition/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/dashboard/editor/MetricConditionEditor.test.tsx`
Expected: FAIL — module `./MetricConditionEditor` does not exist.

- [ ] **Step 3: Create the component**

Create `apps/studio/src/dashboard/editor/MetricConditionEditor.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../../api';

export interface MetricCondition { dimension: string; op: string; value: unknown }

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;

function toValue(op: string, raw: string): unknown {
  if (op === 'in' || op === 'between') return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return raw;
}
function toLiteral(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
}

export function MetricConditionEditor({ conditions, dimensions, onChange }: {
  conditions: MetricCondition[]; dimensions: ModelDimension[]; onChange: (c: MetricCondition[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<MetricCondition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...conditions, { dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(conditions.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-1">
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <select aria-label="Condition field" className="h-7 rounded border border-border bg-background text-xs"
            value={c.dimension} onChange={(e) => update(i, { dimension: e.target.value })}>
            {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select aria-label="Condition operator" className="h-7 rounded border border-border bg-background text-xs"
            value={c.op} onChange={(e) => update(i, { op: e.target.value, value: toValue(e.target.value, toLiteral(c.value)) })}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Input className="h-7 flex-1 text-xs" value={toLiteral(c.value)}
            onChange={(e) => update(i, { value: toValue(c.op, e.target.value) })} />
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove condition" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add condition</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/dashboard/editor/MetricConditionEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/MetricConditionEditor.tsx apps/studio/src/dashboard/editor/MetricConditionEditor.test.tsx
git commit -m "feat(studio): shared MetricConditionEditor for literal metric predicates"
```

---

## Task 6: Dashboards `BuilderForm` — conditional predicate on the single metric

**Files:**
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`:

```tsx
import { screen } from '@testing-library/react';

describe('BuilderForm conditional metric (Slice A)', () => {
  it('sets metric.where when a condition is added', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={{ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      metric: expect.objectContaining({ where: [{ dimension: 'status', op: 'eq', value: '' }] }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/dashboard/editor/BuilderForm.test.tsx`
Expected: FAIL — no "Add condition" button exists yet.

- [ ] **Step 3: Wire the condition editor into `BuilderForm`**

In `apps/studio/src/dashboard/editor/BuilderForm.tsx`, add the import at the top:

```tsx
import { MetricConditionEditor, type MetricCondition } from './MetricConditionEditor';
```

Add a setter next to the existing `setMetric`/`setDim` handlers:

```tsx
  const setWhere = (w: MetricCondition[]) => onChange({ ...value, metric: { ...value.metric, where: w.length ? w : undefined } });
```

Add the editor block immediately after the "Metric" `<label>` (before the "Group by" label):

```tsx
      <div className="text-sm">Only where
        <MetricConditionEditor
          conditions={(value.metric.where ?? []) as MetricCondition[]}
          dimensions={model?.dimensions ?? []}
          onChange={setWhere}
        />
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/dashboard/editor/BuilderForm.test.tsx`
Expected: PASS (new case + the existing "emits a builder query when a dimension is chosen" case).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): dashboards BuilderForm conditional metric predicate"
```

---

## Task 7: Reports `QueryEditor` — multi-metric list for table blocks

**Files:**
- Create: `apps/studio/src/reports-builder/MetricsListEditor.tsx`
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx`
- Test: `apps/studio/src/reports-builder/MetricsListEditor.test.tsx`, `apps/studio/src/reports-builder/QueryEditor.test.tsx`

- [ ] **Step 1: Write the failing test for `MetricsListEditor`**

Create `apps/studio/src/reports-builder/MetricsListEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MetricsListEditor } from './MetricsListEditor';

const dims = [
  { key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' as const },
  { key: 'interpretation_code', label: 'Interpretation', column: 'interpretation_code', kind: 'string' as const },
];

describe('MetricsListEditor', () => {
  it('adds a count metric with a generated key', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add metric/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ key: 'm1', agg: 'count' })]);
  });

  it('removes a metric', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'r', label: 'R', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove metric/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('edits a metric label', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'm1', label: '', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Metric label'), { target: { value: 'Tested' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ key: 'm1', label: 'Tested' })]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/MetricsListEditor.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `MetricsListEditor`**

Create `apps/studio/src/reports-builder/MetricsListEditor.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import { MetricConditionEditor, type MetricCondition } from '../dashboard/editor/MetricConditionEditor';

export interface ListMetric { key: string; label?: string; agg: string; column?: string; where?: MetricCondition[] }

const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

export function MetricsListEditor({ metrics, dimensions, onChange }: {
  metrics: ListMetric[]; dimensions: ModelDimension[]; onChange: (m: ListMetric[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<ListMetric>) =>
    onChange(metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = () => onChange([...metrics, { key: `m${metrics.length + 1}`, agg: 'count' }]);
  const remove = (i: number) => onChange(metrics.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">Metrics (table columns)</div>
      {metrics.map((m, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
          <div className="flex items-center gap-1">
            <Input aria-label="Metric label" className="h-7 flex-1 text-xs" placeholder="Column label"
              value={m.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
            <select aria-label="Metric aggregate" className="h-7 rounded border border-border bg-background text-xs"
              value={m.agg} onChange={(e) => update(i, { agg: e.target.value })}>
              {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove metric" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {m.agg !== 'count' && (
            <select aria-label="Metric column" className="h-7 rounded border border-border bg-background text-xs"
              value={m.column ?? ''} onChange={(e) => update(i, { column: e.target.value || undefined })}>
              <option value="">(column…)</option>
              {dimensions.map((d) => <option key={d.key} value={d.column}>{d.label}</option>)}
            </select>
          )}
          <MetricConditionEditor
            conditions={m.where ?? []}
            dimensions={dimensions}
            onChange={(w) => update(i, { where: w.length ? w : undefined })}
          />
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add metric</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the `MetricsListEditor` test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/MetricsListEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing wiring test in `QueryEditor.test.tsx`**

Append to `apps/studio/src/reports-builder/QueryEditor.test.tsx`:

```tsx
describe('QueryEditor multi-metric (Slice A)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a metric to a table own-query and writes source.metrics', async () => {
    const block: Block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] } } as any;
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={[]} onChange={onChange} />);
    await waitFor(() => screen.getByRole('button', { name: /add metric/i }));
    fireEvent.click(screen.getByRole('button', { name: /add metric/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ metrics: [expect.objectContaining({ key: 'm1', agg: 'count' })] }),
    }));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/QueryEditor.test.tsx`
Expected: FAIL — no "Add metric" button (the metrics list isn't wired in).

- [ ] **Step 7: Wire `MetricsListEditor` into `QueryEditor`**

In `apps/studio/src/reports-builder/QueryEditor.tsx`, add the import:

```tsx
import { MetricsListEditor, type ListMetric } from './MetricsListEditor';
```

Inside the `showBuilder && mode === 'builder'` fragment, add the metrics list for table blocks — place it right after the `<BuilderForm … />` line (before the `FilterListEditor` block):

```tsx
          {block.kind === 'table' && models.length > 0 && (
            <MetricsListEditor
              metrics={builderQuery.metrics ?? []}
              dimensions={dimensions}
              onChange={(ms) => setQuery({ ...builderQuery, metrics: ms.length ? ms : undefined, metric: ms[0] ?? builderQuery.metric })}
            />
          )}
```

(`builderQuery.metrics` and `ListMetric` share the same loose `op: string` / `value: unknown` shape from the api mirror, so no casts are needed. `ListMetric` is imported only for the `MetricsListEditor` prop type in its own file.)

- [ ] **Step 8: Run the `QueryEditor` tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/QueryEditor.test.tsx`
Expected: PASS (new multi-metric case + all pre-existing QueryEditor cases stay green).

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/reports-builder/MetricsListEditor.tsx apps/studio/src/reports-builder/MetricsListEditor.test.tsx apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/reports-builder/QueryEditor.test.tsx
git commit -m "feat(studio): reports QueryEditor multi-metric list for table blocks"
```

---

## Task 8: Full-workspace gate + final verification

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck across all packages**

Run: `pnpm turbo run typecheck --force`
Expected: PASS for every package (the shared schema change compiles in server, bootstrap, reporting, report-builder, studio, dashboards, etc.). Do NOT pipe through `tail`. If any package fails to typecheck, fix it before proceeding — the additive fields should not break consumers, but a consumer that destructures `Metric` exhaustively may need a tweak.

- [ ] **Step 2: Forced full test run**

Run: `pnpm turbo run test --force`
Expected: PASS across the workspace, including the new dashboards and studio suites.

- [ ] **Step 3: Manual canvas smoke (deferred-acceptable, note in report)**

Per the workstream convention, live browser verification of the Report Builder canvas rendering a wide-mode table is deferred to Slice G (which seeds the actual `amr-resistance` template). The engine + authoring are proven by the automated acceptance test in Task 4. Record in the completion notes that the PDF/canvas end-to-end render of a multi-metric table is verified in Slice G.

- [ ] **Step 4: Final commit (if any gate fixups were needed)**

```bash
git add -A
git commit -m "chore(query-model): Slice A gate — forced typecheck + full test run green"
```

If Steps 1–2 required no fixups, skip this commit.

---

## Done criteria

- A metric can carry a conditional `where` predicate, compiled to portable `CASE` aggregates (PG + MSSQL).
- A builder query can carry `metrics[]`; a table block renders one column per metric grouped by a dimension.
- The `amr-resistance` R/I/S/tested pivot is reproduced by the query model (proven by the Task 4 acceptance test); `%R` remains for Slice B.
- Both authoring UIs land: dashboards conditional KPIs (`BuilderForm`) and reports multi-metric tables (`QueryEditor`).
- Backward-compatible: all existing single-metric queries compile and shape identically; forced full-workspace typecheck + test are green.

## Follow-ups (not this slice)

- **Slice B** — derived/ratio metrics (`%R = r / tested`); completes `amr-resistance`.
- **Slice G** — seed the converted `amr-resistance` builder template + verify PDF/canvas render end-to-end.
- Param-binding on metric predicates (literals only here); dashboards multi-metric (KPIs stay single-value here).
