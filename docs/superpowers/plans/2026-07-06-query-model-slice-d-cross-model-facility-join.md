# Query-model Slice D — Cross-Model Facility Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal declared-join mechanism so `facility` (patients.managing_organization) is usable as a dimension/filter on the observations model, then seed `amr-facility-summary` and add a facility param+filter to `rt-amr-resistance`.

**Architecture:** A model declares `joins[]`; a dimension can carry a `join` alias. The compiler detects which joins a query uses, adds `LEFT JOIN` on the patients PK (no fan-out), and qualifies every column ref ONLY when a join is active (byte-identical otherwise). Portable join key via `replace()`. Two seeded/updated templates prove it.

**Tech Stack:** TypeScript, Kysely (`sql` fragments + `leftJoin`), Zod, Vitest (Sqlite compile + pg-mem acceptance).

**Build order:** registry join types → `collectUsedJoins` (pure) → compiler (add joins + qualify refs — the big task) → api mirror → seed amr-facility-summary → facility on amr-resistance → forced gate.

**Pre-existing facts (do not re-derive):**
- `ModelDimension`/`QueryModel` are plain TS interfaces in `packages/dashboards/src/models/registry.ts` (`ModelDimension` at line 4 — already has `compute?`; `QueryModel` nearby). The `observations` model is in the `MODELS` array (dims: status/code_text/interpretation_code/value_unit/effective_date_time; metrics count, avg_value). `observations.subject_ref` and `patients.id`/`patients.managing_organization` exist in `packages/db/src/schema/external.ts`.
- `compile.ts` column-ref sites (all currently unqualified): `condExpr` (`sql.ref(d.column)` at line 28), `metricExpr` (`sql.ref(m.column)` at line 59; also calls `condExpr`), `applyFilters` (`const ref = d.column as never` ~line 91), `compileRule` (`dim(model, rule.dimension).column as never` at line 114), and the dimension/breakdown selects inside `compileBuilderQuery` (`sql.ref(d.column).as('label')` / `groupBy(d.column as never)` — the `if (q.dimension)` and `if (!wide && q.breakdown)` blocks, each with an `if (d.compute)` age-band branch). `dim(model, key)` (line 10) throws on unknown. `sql`/`expressionBuilder` imported from kysely (line 1). `ConditionNode`/`ConditionRule` imported from `./types` (line 4). `ModelDimension`/`QueryModel` imported from `./models/registry` (line 3).
- Template seed pattern: `packages/report-builder/src/amr-resistance-template.ts` + `index.ts` export + `packages/bootstrap/src/seed.ts` (imports `seedSampleReportTemplate, seedAmrResistanceTemplate, seedPatientDemographicsTemplate`; seeds them; `seed.test.ts` `seedDatabase — report templates` asserts `reportTemplatesSeeded` `toBe(3)` + a sorted id array `['rt-amr-resistance','rt-patient-demographics','rt-sample-amr']`).
- `apps/studio/src/api.ts` `ModelDimension` (~line 281) already mirrors `compute?`.

---

## Task 1: Registry declared-join types + observations facility

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts`
- Test: `packages/dashboards/src/models/registry.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe('observations facility join', () => {
  it('declares a patients join and a facility dimension sourced from it', () => {
    const m = getModel('observations')!;
    const join = (m.joins ?? []).find((j) => j.alias === 'jp');
    expect(join).toMatchObject({ table: 'patients', alias: 'jp', left: 'subject_ref', leftReplace: ['Patient/', ''], right: 'id' });
    const facility = m.dimensions.find((d) => d.key === 'facility');
    expect(facility).toMatchObject({ key: 'facility', column: 'managing_organization', join: 'jp' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: FAIL — no `joins`/`facility`.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/models/registry.ts`, add the `ModelJoin` type (near `ModelDimension`), add `joins?` to `QueryModel`, add `join?` to `ModelDimension`:

```ts
export interface ModelJoin {
  table: keyof ExternalSchema;    // 'patients'
  alias: string;                  // 'jp'
  left: string;                   // base column: 'subject_ref'
  leftReplace?: [string, string]; // ['Patient/',''] → replace(base.left, 'Patient/', '')
  right: string;                  // joined column: 'id'
}
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute; join?: string }
export interface QueryModel { id: string; label: string; table: keyof ExternalSchema; dimensions: ModelDimension[]; metrics: ModelMetric[]; joins?: ModelJoin[] }
```

(`ExternalSchema` is already imported at the top of registry.ts — it's used for `table: keyof ExternalSchema`.) In the `observations` model object, add a `joins` array and the `facility` dimension:

```ts
    joins: [{ table: 'patients', alias: 'jp', left: 'subject_ref', leftReplace: ['Patient/', ''], right: 'id' }],
    dimensions: [
      // …existing status/code_text/interpretation_code/value_unit/effective_date_time…
      { key: 'facility', label: 'Facility', column: 'managing_organization', kind: 'string', join: 'jp' },
    ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts` → PASS. Then `pnpm --filter @openldr/dashboards typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git commit -m "feat(dashboards): declared joins + observations facility dimension (via patients)"
```

---

## Task 2: `collectUsedJoins` (pure)

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (add helper + import `ModelJoin`)
- Test: `packages/dashboards/src/compile.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import { collectUsedJoins } from './compile'; // add to the file's imports if it exports; else test via compiled SQL (see note)

describe('collectUsedJoins', () => {
  const model = getModel('observations')!;
  const base = { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const }, filters: [] };
  it('collects the join for a facility dimension / breakdown / filter / filterTree / metric-where', () => {
    expect(collectUsedJoins(model, { ...base, dimension: { key: 'facility' } } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, breakdown: { key: 'facility' } } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, filters: [{ dimension: 'facility', op: 'eq', value: 'x' }] } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'facility', op: 'eq', value: 'x' }] } } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, metrics: [{ key: 'r', agg: 'count', where: [{ dimension: 'facility', op: 'eq', value: 'R' }] }] } as any).map((j) => j.alias)).toEqual(['jp']);
  });
  it('collects nothing when only base dimensions are used', () => {
    expect(collectUsedJoins(model, { ...base, dimension: { key: 'code_text' } } as any)).toEqual([]);
  });
});
```

Note: export `collectUsedJoins` from `compile.ts` (add `export`) so the test can import it directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: FAIL — `collectUsedJoins` not exported.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/compile.ts`, add `ModelJoin` to the `./models/registry` import, and add the helper (above `compileBuilderQuery`):

```ts
// Distinct joins referenced by any dimension the query uses (dimension/breakdown/filters/filterTree/metric-where).
export function collectUsedJoins(model: QueryModel, q: BuilderQuery): ModelJoin[] {
  const aliases = new Set<string>();
  const add = (dimKey?: string) => { if (!dimKey) return; const d = model.dimensions.find((x) => x.key === dimKey); if (d?.join) aliases.add(d.join); };
  add(q.dimension?.key);
  add(q.breakdown?.key);
  for (const f of q.filters ?? []) add(f.dimension);
  const walk = (node?: ConditionNode) => { if (!node) return; if (node.kind === 'rule') add(node.dimension); else node.children.forEach(walk); };
  walk(q.filterTree);
  for (const m of [q.metric, ...(q.metrics ?? [])]) for (const w of m.where ?? []) add(w.dimension);
  return [...aliases].map((a) => {
    const j = (model.joins ?? []).find((x) => x.alias === a);
    if (!j) throw new Error(`unknown join alias: ${a}`);
    return j;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts` → PASS (2 new + existing green). Then `pnpm --filter @openldr/dashboards typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): collectUsedJoins — detect joins referenced by a query"
```

---

## Task 3: Compiler adds joins + qualifies column refs

**Files:**
- Modify: `packages/dashboards/src/compile.ts`
- Test: `packages/dashboards/src/compile.test.ts` (append)

This is the core task: add the `LEFT JOIN` and qualify EVERY column ref when a join is active, threading a `qualify` flag through all six ref sites. Qualification must be complete + consistent (all sites together) so shared column names (`id`, `subject_ref`) are never ambiguous.

- [ ] **Step 1: Write the failing test**

```ts
describe('compileBuilderQuery cross-model join (facility)', () => {
  const model = getModel('observations')!;
  const base = { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const } };
  it('adds a LEFT JOIN with a replace() ON + qualified group-by when grouping by a joined dimension', () => {
    const { sql } = compileBuilderQuery(db, model, { ...base, dimension: { key: 'facility' }, filters: [] } as any).compile();
    expect(sql).toMatch(/left join "patients" as "jp"/i);
    expect(sql).toMatch(/replace\("observations"\."subject_ref"/i);
    expect(sql).toMatch(/group by "jp"\."managing_organization"/i);
  });
  it('adds the join when facility is only a filter, and qualifies the base group-by', () => {
    const { sql } = compileBuilderQuery(db, model, { ...base, dimension: { key: 'code_text' }, filters: [{ dimension: 'facility', op: 'eq', value: 'Org/1' }] } as any).compile();
    expect(sql).toMatch(/left join "patients" as "jp"/i);
    expect(sql).toMatch(/group by "observations"\."code_text"/i);
  });
  it('a join-free query emits byte-identical unqualified SQL (backward-compat)', () => {
    const { sql } = compileBuilderQuery(db, model, { ...base, dimension: { key: 'code_text' }, filters: [] } as any).compile();
    expect(sql).not.toMatch(/left join/i);
    expect(sql).toMatch(/group by "code_text"/i);
    expect(sql).not.toMatch(/"observations"\."code_text"/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: FAIL — no LEFT JOIN emitted; facility dimension compiles as a bare `managing_organization` group-by (wrong column, no join).

- [ ] **Step 3: Add the ref helpers**

In `compile.ts`, above `condExpr`:

```ts
// A dimension's column ref string: joined dims → "alias"."col"; base dims → qualified only when a join is active.
function colName(model: QueryModel, dimKey: string, qualify: boolean): string {
  const d = dim(model, dimKey);
  if (d.join) return `${d.join}.${d.column}`;
  return qualify ? `${model.table}.${d.column}` : d.column;
}
// A raw base-table column (metric columns): qualified only when a join is active.
function baseCol(model: QueryModel, col: string, qualify: boolean): string {
  return qualify ? `${model.table}.${col}` : col;
}
```

- [ ] **Step 4: Thread `qualify` through the four helper functions**

Change the signatures + ref lines (each function gains a trailing `qualify: boolean` param):

`condExpr` (line 23, 28):
```ts
function condExpr(model: QueryModel, where: QueryFilter[], qualify: boolean) {
  // …
    const ref = sql.ref(colName(model, f.dimension, qualify)); // was sql.ref(d.column)
  // … (remove the now-unused `const d = dim(model, f.dimension)` line — colName does the lookup/throw)
```

`metricExpr` (line 50, 51, 59):
```ts
function metricExpr(model: QueryModel, m: Metric, qualify: boolean) {
  const cond = m.where && m.where.length ? condExpr(model, m.where, qualify) : null;
  // … column validation unchanged …
  const col = sql.ref(baseCol(model, m.column, qualify)); // was sql.ref(m.column)
```

`applyFilters` (~line 88-91): replace `const d = dim(model, f.dimension); const ref = d.column as never;` with:
```ts
    const ref = colName(model, f.dimension, qualify) as never;
```
and add `qualify: boolean` to `applyFilters`'s signature.

`compileRule` (line 113-114) + `compileNode` (line 131): thread `qualify`:
```ts
function compileRule(eb: any, model: QueryModel, rule: ConditionRule, qualify: boolean): any {
  const ref = colName(model, rule.dimension, qualify) as never; // was dim(...).column as never
  // …
}
function compileNode(eb: any, model: QueryModel, node: ConditionNode, qualify: boolean): any {
  if (node.kind === 'rule') return node.value === null ? null : compileRule(eb, model, node, qualify);
  const parts = node.children.map((c) => compileNode(eb, model, c, qualify)).filter((p: any) => p != null);
  // …
}
```

- [ ] **Step 5: Add the joins + qualify the selects in `compileBuilderQuery`**

Right after `let qb = db.selectFrom(model.table) as unknown as AnyQB;`:

```ts
  const usedJoins = collectUsedJoins(model, q);
  const qualify = usedJoins.length > 0;
  for (const j of usedJoins) {
    const left = j.leftReplace
      ? sql`replace(${sql.ref(`${model.table}.${j.left}`)}, ${j.leftReplace[0]}, ${j.leftReplace[1]})`
      : sql.ref(`${model.table}.${j.left}`);
    qb = qb.leftJoin(`${j.table} as ${j.alias}` as never, (jb: any) => jb.on(sql`${left} = ${sql.ref(`${j.alias}.${j.right}`)}` as never)) as AnyQB;
  }
```

Kysely's `JoinBuilder.on()` accepts an `Expression<SqlBool>`, so the raw `sql\`… = …\`` boolean fragment works. (If the installed Kysely rejects it, fall back to the expression-builder form `jb.on((eb: any) => eb(left, '=', sql.ref(\`${j.alias}.${j.right}\`)))`.)

Then update the metric selects and the dimension/breakdown selects to pass/use `qualify`:
- non-wide metric select: `qb.select(metricExpr(model, q.metric, qualify).as('value'))`.
- wide metric select loop: `qb.select(metricExpr(model, m, qualify).as(m.key))`.
- dimension select — the `else` (non-compute) branch:
```ts
    } else {
      const ref = colName(model, q.dimension.key, qualify);
      qb = qb.select(sql.ref(ref).as('label')).groupBy(ref as never).orderBy(ref as never);
    }
```
(Leave the `if (d.compute)` age-band branch UNCHANGED — computed dims live only on the join-free patients model, so `qualify` is always false there; its unqualified `sql.ref(d.column)` is correct.)
- breakdown select — the `else` (non-compute) branch:
```ts
    } else {
      const ref = colName(model, q.breakdown.key, qualify);
      qb = qb.select(sql.ref(ref).as('series')).groupBy(ref as never).orderBy(ref as never);
    }
```
- the filter application:
```ts
  if (q.filterTree) {
    const eb = expressionBuilder(qb as never) as never;
    const expr = compileNode(eb, model, q.filterTree, qualify);
    if (expr) qb = qb.where(expr as never) as AnyQB;
  } else {
    qb = applyFilters(qb, model, q.filters ?? [], qualify);
  }
```

- [ ] **Step 6: Run test to verify it passes + backward-compat**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts` → PASS (3 new + ALL existing green, especially the Slice-C `age_band` tests and the prior "plain-column byte-identical" tests — those use join-free models/dims so `qualify` is false and SQL is unchanged). Then `pnpm --filter @openldr/dashboards typecheck` → clean and `pnpm --filter @openldr/dashboards test` → full package green.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): compile joined dimensions (LEFT JOIN + qualified refs when a join is active)"
```

---

## Task 4: Studio `api.ts` `ModelDimension.join` mirror

**Files:**
- Modify: `apps/studio/src/api.ts` (`ModelDimension`, ~line 281)

- [ ] **Step 1: Add the field**

Add `join?: string` to the studio `ModelDimension` mirror (it already has `compute?`):

```ts
export interface ModelDimension { key: string; label: string; column: string; kind: 'string' | 'date' | 'number'; dateGrain?: string[]; compute?: { kind: 'age-band'; bands: { maxAge: number; label: string }[]; openEndedLabel: string; unknownLabel: string }; join?: string }
```

(No new UI — `facility` already appears in the dimension/filter pickers as a normal dimension; this is for type parity with the returned model data.)

- [ ] **Step 2: Verify**

Run: `pnpm --filter @openldr/studio typecheck` → clean. (No test needed — additive optional field, no behavior change.)

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "chore(studio): mirror ModelDimension.join for type parity"
```

---

## Task 5: Seed the amr-facility-summary template

**Files:**
- Create: `packages/report-builder/src/amr-facility-summary-template.ts`
- Modify: `packages/report-builder/src/index.ts` (export)
- Modify: `packages/bootstrap/src/seed.ts` (import + seed call)
- Modify: `packages/bootstrap/src/seed.test.ts` (count 3→4 + id array)
- Test: `packages/report-builder/src/amr-facility-summary-template.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildAmrFacilitySummaryTemplate, AMR_FACILITY_SUMMARY_TEMPLATE_ID } from './amr-facility-summary-template';
import { ReportTemplateSchema } from './schema';
import { lintReportTemplate } from './lint';

describe('amr-facility-summary template', () => {
  it('builds a schema-valid, published, lint-clean template grouped by facility', () => {
    const t = buildAmrFacilitySummaryTemplate();
    expect(t.id).toBe(AMR_FACILITY_SUMMARY_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    const issues = lintReportTemplate(t);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.dimension).toEqual({ key: 'facility' });
    expect(src.metrics.map((m: any) => m.key)).toEqual(['tested', 'resistant']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- amr-facility-summary-template.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the template**

Create `packages/report-builder/src/amr-facility-summary-template.ts` (mirror `amr-resistance-template.ts`):

```ts
import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const AMR_FACILITY_SUMMARY_TEMPLATE_ID = 'rt-amr-facility-summary';

const dateFilters = [
  { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
  { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
];

/**
 * The built-in amr-facility-summary code report reproduced as an editable, published template using
 * the Slice-D cross-model join: per FACILITY (patients.managing_organization, joined to observations
 * via subject_ref), tested (all AST results) + resistant (R) counts. Optional date-range param.
 * Null-facility observations surface as a null bucket (the JS report drops them). Coexists.
 */
export function buildAmrFacilitySummaryTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: AMR_FACILITY_SUMMARY_TEMPLATE_ID,
    name: 'AMR Resistance by Facility',
    description: 'Tested vs resistant AST-result counts per facility.',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'AMR Resistance by Facility', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Tested vs resistant AST-result counts per facility.', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'bar', visual: {},
        query: { mode: 'builder', model: 'observations',
          metric: { key: 'resistant', label: 'Resistant', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
          dimension: { key: 'facility' }, filters: dateFilters } } }] },
      { id: 'r4', cells: [{ colSpan: 12, block: {
        kind: 'table', columns: [],
        source: { mode: 'builder', model: 'observations',
          metric: { key: 'tested', label: 'Tested', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'in', value: ['S', 'I', 'R'] }] },
          metrics: [
            { key: 'tested', label: 'Tested', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'in', value: ['S', 'I', 'R'] }] },
            { key: 'resistant', label: 'Resistant', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
          ],
          dimension: { key: 'facility' }, filters: dateFilters } } }] },
    ],
  });
}

/** Seed the amr-facility-summary template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedAmrFacilitySummaryTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(AMR_FACILITY_SUMMARY_TEMPLATE_ID)) return 0;
  await store.create(buildAmrFacilitySummaryTemplate());
  return 1;
}
```

- [ ] **Step 4: Export + wire the seed**

In `packages/report-builder/src/index.ts`: `export * from './amr-facility-summary-template';`

In `packages/bootstrap/src/seed.ts`: extend the report-builder import with `seedAmrFacilitySummaryTemplate`, and add after the patient-demographics seed line:

```ts
    reportTemplatesSeeded += await seedAmrFacilitySummaryTemplate(app.reportTemplates);
```

In `packages/bootstrap/src/seed.test.ts` (`seedDatabase — report templates` block): change `toBe(3)` → `toBe(4)`, and add `'rt-amr-facility-summary'` to the sorted id-array assertion (the sorted array becomes `['rt-amr-facility-summary','rt-amr-resistance','rt-patient-demographics','rt-sample-amr']`).

- [ ] **Step 5: Add a pg-mem end-to-end facility acceptance test**

Mirror the amr-resistance template's pg-mem acceptance (`grep -rln "runBuilderQuery\|pg-mem\|newDb" packages/report-builder/src`). In `amr-facility-summary-template.test.ts`, add a test that: creates pg-mem with `observations` (`subject_ref`, `interpretation_code`, `effective_date_time`) + `patients` (`id`, `managing_organization`) tables; inserts observations for patients across ≥2 facilities with a mix of R/S/I interpretations (e.g. facility A: 2 R + 1 S; facility B: 1 R + 1 I) and `subject_ref` = `'Patient/<id>'`; runs the table `source` through `resolveQueryParams(src, {})` then `runBuilderQuery`; asserts per-facility rows with correct `tested`/`resistant` (A: tested 3 / resistant 2; B: tested 2 / resistant 1) — proving the LEFT JOIN + `replace()` key + conditional counts work with NO double-counting. Copy the amr test's pg-mem setup verbatim, swapping tables/columns/query.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @openldr/report-builder test -- amr-facility-summary-template.test.ts` → PASS (build/lint + pg-mem). Then `pnpm --filter @openldr/report-builder typecheck` + `pnpm --filter @openldr/bootstrap typecheck` → clean, and `pnpm --filter @openldr/bootstrap test` → the seed test (now toBe(4)) green.

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/amr-facility-summary-template.ts packages/report-builder/src/amr-facility-summary-template.test.ts packages/report-builder/src/index.ts packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(report-builder): seed amr-facility-summary as an editable template (facility join)"
```

---

## Task 6: Facility param + filter on the amr-resistance template

**Files:**
- Modify: `packages/report-builder/src/amr-resistance-template.ts`
- Test: `packages/report-builder/src/amr-resistance-template.test.ts` (update)

- [ ] **Step 1: Update the failing test**

In `packages/report-builder/src/amr-resistance-template.test.ts`, add assertions (adapt to the file's existing structure — it already builds the template and inspects it):

```ts
  it('includes a facility select param and a facility filter (Slice D)', () => {
    const t = buildAmrResistanceTemplate();
    const facilityParam = t.parameters.find((p) => p.id === 'facility');
    expect(facilityParam).toMatchObject({ id: 'facility', type: 'select' });
    expect(facilityParam?.optionsSql).toMatch(/managing_organization/i);
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.filters).toEqual(expect.arrayContaining([{ dimension: 'facility', op: 'eq', value: '{{param.facility}}' }]));
  });

  it('stays lint-clean with the facility param (bound in a filter → counted used)', () => {
    const issues = lintReportTemplate(buildAmrResistanceTemplate());
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
  });
```

(Import `lintReportTemplate` from `./lint` in the test if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- amr-resistance-template.test.ts`
Expected: FAIL — no facility param/filter.

- [ ] **Step 3: Implement**

In `packages/report-builder/src/amr-resistance-template.ts`'s `buildAmrResistanceTemplate`:
- add to `parameters` (after the existing `dateRange` param):
```ts
      { id: 'facility', label: 'Facility', type: 'select', required: false, optionsSql: "select distinct managing_organization from patients where managing_organization is not null order by 1" },
```
- add to the table source's `filters` array (after the existing interpretation/date filters):
```ts
        { dimension: 'facility', op: 'eq', value: '{{param.facility}}' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- amr-resistance-template.test.ts` → PASS (new + existing green). The existing amr pg-mem acceptance still passes: `resolveQueryParams(src, {})` blank-drops the unset `{{param.facility}}` filter, so no facility join is added and the query is unchanged when facility is unset. Then `pnpm --filter @openldr/report-builder typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/amr-resistance-template.ts packages/report-builder/src/amr-resistance-template.test.ts
git commit -m "feat(report-builder): facility param + filter on the amr-resistance template (Slice D)"
```

---

## Task 7: Forced full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: `31 successful, 31 total`. Never pipe turbo through `tail`. Fix any consumer that breaks on the widened `ModelDimension`/`QueryModel`/`ModelJoin` (server, cli, bootstrap import from dashboards).

- [ ] **Step 2: Forced tests**

Run: `pnpm turbo run test --force`
Expected: green except the known pre-existing flakes — studio `api.test.ts` (vitest-dedupe) and parallel-load timeouts (plugins/users that pass in isolation). Re-run any red package in isolation to confirm. A genuine failure in dashboards/report-builder/bootstrap touched code is a regression — fix it.

- [ ] **Step 3: Commit (only if a gate fix was needed)**

```bash
git add -A && git commit -m "fix: resolve cross-package gate breakage from declared joins"
```

---

## Post-plan: review + finish

After Task 7: final holistic review, then `finishing-a-development-branch` (merge `--no-ff` to local `main`, delete branch, update memory `query-model-expansion-workstream`). Live check (dev stack, if up): `pnpm openldr db seed`, open `/reports/builder/rt-amr-facility-summary` (per-facility rows), and set the facility param on `rt-amr-resistance` to narrow it.

---

## Self-review notes (checked against the spec)

- **Spec §Part 1 registry joins** → Task 1. **§2a collectUsedJoins** → Task 2. **§2b/2c compiler add-join + qualify** → Task 3. **§Part 4 api mirror** → Task 4. **§3a seed amr-facility-summary** → Task 5. **§3b facility on amr-resistance** → Task 6. **§gate** → Task 7.
- **Backward-compat** (spec §error-handling): Task 3 Step 6 locks byte-identical unqualified SQL for a join-free query; `join`/`joins`/`qualify` are inert when no join is used.
- **Type consistency:** `ModelJoin` (registry, Task 1) is imported by `compile.ts` (Tasks 2-3). `colName`/`baseCol`/`collectUsedJoins` names consistent (Task 2 def, Task 3 use). `qualify: boolean` threaded uniformly through `condExpr`/`metricExpr`/`applyFilters`/`compileRule`/`compileNode` (Task 3). `AMR_FACILITY_SUMMARY_TEMPLATE_ID`/`build…`/`seed…` consistent (Task 5). The age-band (`ageBandExprs`) branch is intentionally left unqualified (computed dims are join-free) — documented in Task 3 Step 5.
- **Null-facility bucket** and the JS-report-drops difference documented in the template docstring (Task 5) — matches spec §non-goals.
