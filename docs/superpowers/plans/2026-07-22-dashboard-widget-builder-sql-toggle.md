# Dashboard Widget Builder — Builder ⇆ SQL toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revive guided, no-SQL widget authoring on the dashboard via a `Builder | SQL` toggle inside the existing widget editor, with a best-effort SQL→Builder recognizer that refuses unrecognizable SQL loudly.

**Architecture:** The `builder` query mode, its compiler, and its runtime render already exist in `@openldr/dashboards`; this plan surfaces them. One additive schema field (`limit`), one new pure recognizer module, and a `mode` branch inside `WidgetEditorDialog` that swaps only the CodeMirror region. Everything downstream (preview, results, chart config, variables, Run, Save) consumes the resulting `WidgetQuery` unchanged.

**Tech Stack:** TypeScript, Zod, Kysely, React, shadcn/ui, CodeMirror, Vitest, `@testing-library/react`, `pg-mem`, pnpm + turbo monorepo.

**Design spec:** [`docs/superpowers/specs/2026-07-22-dashboard-widget-builder-sql-toggle-design.md`](../specs/2026-07-22-dashboard-widget-builder-sql-toggle-design.md)

## Global Constraints

- **Forced full gate:** after each task, `pnpm turbo run typecheck --force` then `pnpm turbo run test --force` (schema/compiler/recognizer are in shared `@openldr/dashboards`, consumed by dashboards, server, studio). Never pipe turbo through `tail`.
- **Additive schema, no migration:** existing stored builder queries (no `limit`) must validate and compile byte-identically. A backward-compat assertion locks this.
- **Recognizer capability invariant:** `recognizeSql` accepts a strict **subset** of what the v1 builder UI can author (v1 = single measure + group-by + breakdown + flat filters + `limit`). It must refuse multi-aggregate SELECTs even though the compiler could run them.
- **shadcn controls only** ([[use-shadcn-components]]): the revived builder controls use shadcn `Select`/`Input`, never native `<select>` — the orphaned `BuilderForm`/`MetricConditionEditor` native selects are replaced, not reused as-is.
- **i18n:** every new user-facing string added to `apps/studio/src/i18n/en.ts` (typed `EnShape`) with genuine `fr.ts` + `pt.ts` translations, or typecheck fails.
- **Recognizer returns a machine `code` + English `reason`;** the studio maps `code` → a localized toast string (so reasons are translatable without i18n inside the package).

---

### Task 1: Add `limit` to the builder query schema

**Files:**
- Modify: `packages/dashboards/src/types.ts:68-79` (builder variant of `WidgetQuerySchema`)
- Modify: `apps/studio/src/api.ts:267-273` (hand-mirrored `WidgetQuery` builder member)
- Test: `packages/dashboards/src/types.test.ts`

**Interfaces:**
- Produces: builder `WidgetQuery` gains `limit?: number` (positive int). Consumed by Task 2 (compiler) and Task 4 (recognizer output).

- [ ] **Step 1: Write the failing test**

Add to `packages/dashboards/src/types.test.ts`:

```typescript
import { WidgetQuerySchema } from './types';

it('accepts an optional positive-integer limit on a builder query', () => {
  const q = WidgetQuerySchema.parse({
    mode: 'builder', model: 'service_requests',
    metric: { key: 'count', agg: 'count' }, filters: [], limit: 15,
  });
  expect(q.mode === 'builder' && q.limit).toBe(15);
});

it('rejects a non-positive limit', () => {
  expect(() => WidgetQuerySchema.parse({
    mode: 'builder', model: 'service_requests',
    metric: { key: 'count', agg: 'count' }, filters: [], limit: 0,
  })).toThrow();
});

it('validates a stored builder query with no limit (backward compat)', () => {
  const q = WidgetQuerySchema.parse({
    mode: 'builder', model: 'service_requests',
    metric: { key: 'count', agg: 'count' }, filters: [],
  });
  expect(q.mode === 'builder' && q.limit).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- types.test`
Expected: FAIL — `limit: 15` is stripped/unknown, first assertion gets `undefined`.

- [ ] **Step 3: Add the field**

In `packages/dashboards/src/types.ts`, inside the `mode: z.literal('builder')` object (after the `filterTree` line):

```typescript
    filterTree: ConditionGroupSchema.optional(), // recursive AND/OR tree; supersedes `filters` when present
    limit: z.number().int().positive().optional(), // top-N of the shaped result, by primary measure desc
    variableBindings: z.record(z.string()).optional(),
```

In `apps/studio/src/api.ts`, add `limit?: number` to the builder union member (after `filterTree?: ConditionGroup;`):

```typescript
      filterTree?: ConditionGroup;
      limit?: number;
      variableBindings?: Record<string, string> }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- types.test`
Expected: PASS (3 new assertions green).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts apps/studio/src/api.ts
git commit -m "feat(dashboards): add optional limit (top-N) to builder query schema"
```

---

### Task 2: Compiler — apply `limit` as top-N in JS post-shaping

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (`runBuilderQuery`, `runWideQuery`; add `applyTopN` helper)
- Test: `packages/dashboards/src/compile.run.test.ts`

**Interfaces:**
- Consumes: `q.limit` from Task 1.
- Produces: `runBuilderQuery` / `runWideQuery` return at most `limit` rows, ranked by the primary measure descending (by label total when a breakdown is present). No SQL `LIMIT` is emitted (dialect-free; applies after date-grain roll-up).

- [ ] **Step 1: Write the failing tests**

Add to `packages/dashboards/src/compile.run.test.ts`:

```typescript
describe('runBuilderQuery limit (top-N)', () => {
  function memReq() {
    const mem = newDb();
    mem.public.none('create table lab_requests (status text, panel_desc text, priority text, authored_at text, patient_id text)');
    return mem;
  }

  it('keeps only the top-N labels by measure, descending', async () => {
    const mem = memReq();
    mem.public.none("insert into lab_requests (panel_desc) values ('A'),('A'),('A'),('B'),('B'),('C')");
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const res = await runBuilderQuery(db, getModel('service_requests')!, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      dimension: { key: 'code_text' }, filters: [], limit: 2,
    });
    expect(res.rows.map((r) => r.label)).toEqual(['A', 'B']);
  });

  it('is a no-op when the row count is within the limit', async () => {
    const mem = memReq();
    mem.public.none("insert into lab_requests (panel_desc) values ('A'),('B')");
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const res = await runBuilderQuery(db, getModel('service_requests')!, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      dimension: { key: 'code_text' }, filters: [], limit: 5,
    });
    expect(res.rows.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards test -- compile.run.test`
Expected: FAIL — first test returns 3 rows (A,B,C) because `limit` is ignored.

- [ ] **Step 3: Add the `applyTopN` helper**

In `packages/dashboards/src/compile.ts`, add above `runWideQuery` (near the `ratio` helper):

```typescript
/** Top-N of shaped rows: by label-total when a breakdown splits rows, else by the measure value. */
function applyTopN(
  rows: Record<string, unknown>[], limit: number | undefined, valueKey: string, hasBreakdown: boolean,
): Record<string, unknown>[] {
  if (!limit || rows.length <= limit) return rows;
  if (hasBreakdown) {
    const totals = new Map<unknown, number>();
    for (const r of rows) totals.set(r.label, (totals.get(r.label) ?? 0) + Number(r[valueKey] ?? 0));
    const keep = new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([l]) => l));
    return rows.filter((r) => keep.has(r.label));
  }
  return [...rows].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0)).slice(0, limit);
}
```

- [ ] **Step 4: Call it in `runWideQuery` and `runBuilderQuery`**

In `runWideQuery`, after the derived-metric loop and before building `columns`:

```typescript
  // Derived (ratio) metrics: computed per output row, after aggregate values are final.
  for (const row of shaped) {
    for (const m of derivedMetrics) row[m.key] = ratio(m.derived!, row);
  }
  shaped = applyTopN(shaped, q.limit, aggKeys[0] ?? 'label', false);
```

(Change the `const shaped` earlier in `runWideQuery` to `let shaped` so it can be reassigned.)

In `runBuilderQuery`, in the breakdown branch, after `shaped` is built and before building `columns`:

```typescript
    shaped = applyTopN(shaped, q.limit, 'value', true);
    const columns: ReportColumn[] = [
```

(The `shaped` in the breakdown branch is already `let`.)

In `runBuilderQuery`, in the non-breakdown path, after the `if (d && ...) / else if (d) / else` block that assigns `shaped`, before building `columns`:

```typescript
  shaped = applyTopN(shaped, q.limit, 'value', false);
  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- compile.run.test`
Expected: PASS (top-N + no-op green; existing breakdown/wide tests still green — no `limit` set means `applyTopN` returns rows unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.run.test.ts
git commit -m "feat(dashboards): apply builder query limit as JS top-N post-shaping"
```

---

### Task 3: Recognizer module — SELECT/FROM/measure/dimension core

**Files:**
- Create: `packages/dashboards/src/recognize-sql.ts`
- Modify: `packages/dashboards/src/index.ts` (export)
- Test: `packages/dashboards/src/recognize-sql.test.ts`

**Interfaces:**
- Consumes: `listModels()` from `./models/registry`; the builder `WidgetQuery` type.
- Produces:
  ```typescript
  export type RecognizeResult =
    | { ok: true; query: Extract<WidgetQuery, { mode: 'builder' }> }
    | { ok: false; code: RecognizeCode; reason: string };
  export type RecognizeCode =
    | 'union' | 'join' | 'cte' | 'window' | 'case_measure' | 'multi_measure'
    | 'detail_rows' | 'unknown_table' | 'unknown_dimension' | 'unknown_metric'
    | 'unrecognized_predicate' | 'not_null_unsupported' | 'parse_failed';
  export function recognizeSql(sql: string): RecognizeResult;
  ```
  Consumed by Task 4 (filters/refusals extend it) and Task 7 (studio import).

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboards/src/recognize-sql.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { recognizeSql } from './recognize-sql';

describe('recognizeSql — core shape', () => {
  it('recognizes a plain COUNT(*) KPI', () => {
    const r = recognizeSql('SELECT COUNT(*) AS value FROM lab_requests');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query).toMatchObject({ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] });
  });

  it('maps COUNT(DISTINCT patient_id) to the model metric', () => {
    const r = recognizeSql('SELECT COUNT(DISTINCT patient_id) AS value FROM lab_requests');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.metric).toMatchObject({ key: 'distinct_subjects', agg: 'count_distinct' });
  });

  it('recognizes a group-by dimension', () => {
    const r = recognizeSql('SELECT status AS label, COUNT(*) AS value FROM lab_requests GROUP BY status');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.dimension).toEqual({ key: 'status' });
  });

  it('maps substring(col,1,10) group-by to a day-grain date dimension', () => {
    const r = recognizeSql('SELECT substring(authored_at,1,10) AS label, COUNT(*) AS value FROM lab_requests GROUP BY substring(authored_at,1,10)');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.dimension).toEqual({ key: 'authored_on', grain: 'day' });
  });

  it('refuses an unknown table with a code', () => {
    const r = recognizeSql('SELECT COUNT(*) AS value FROM secret_table');
    expect(r).toMatchObject({ ok: false, code: 'unknown_table' });
  });

  it('refuses multiple measures (v1 capability invariant)', () => {
    const r = recognizeSql('SELECT observation_desc AS label, COUNT(*) AS x, AVG(numeric_value) AS y FROM lab_results GROUP BY observation_desc');
    expect(r).toMatchObject({ ok: false, code: 'multi_measure' });
  });

  it('refuses a detail row list (no aggregate)', () => {
    const r = recognizeSql('SELECT request_id AS order_id, status FROM lab_requests');
    expect(r).toMatchObject({ ok: false, code: 'detail_rows' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards test -- recognize-sql`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the recognizer module**

Create `packages/dashboards/src/recognize-sql.ts`:

```typescript
import type { WidgetQuery } from './types';
import { listModels } from './models/registry';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
export type RecognizeCode =
  | 'union' | 'join' | 'cte' | 'window' | 'case_measure' | 'multi_measure'
  | 'detail_rows' | 'unknown_table' | 'unknown_dimension' | 'unknown_metric'
  | 'unrecognized_predicate' | 'not_null_unsupported' | 'parse_failed';
export type RecognizeResult =
  | { ok: true; query: BuilderQuery }
  | { ok: false; code: RecognizeCode; reason: string };

class Refuse extends Error { constructor(public code: RecognizeCode, msg: string) { super(msg); } }
const refuse = (code: RecognizeCode, msg: string): never => { throw new Refuse(code, msg); };

// Reverse index built from the model registry so it never drifts from the source of truth.
interface TableEntry { model: string; dims: Record<string, { key: string; kind: string }>; metrics: Record<string, string> }
function buildIndex(): Record<string, TableEntry> {
  const idx: Record<string, TableEntry> = {};
  for (const m of listModels()) {
    const table = (m as unknown as { table: string }).table;
    const dims: TableEntry['dims'] = {};
    for (const d of m.dimensions) dims[d.column.toLowerCase()] = { key: d.key, kind: d.kind };
    const metrics: TableEntry['metrics'] = {};
    for (const x of m.metrics) if (x.column) metrics[`${x.agg}:${x.column.toLowerCase()}`] = x.key;
    idx[table.toLowerCase()] = { model: m.id, dims, metrics };
  }
  return idx;
}
const INDEX = buildIndex();

const SUBSTR = /^substring\(\s*(\w+)\s*,\s*1\s*,\s*10\s*\)$/i;
function unwrapNum(e: string): string {
  let s = e.trim(); let m: RegExpMatchArray | null;
  while ((m = s.match(/^round\(\s*(.+?)\s*,\s*\d+\s*\)$/i)) || (m = s.match(/^cast\(\s*(.+)\s+as\s+.+\)$/i))) s = m[1].trim();
  return s;
}
function splitTop(s: string, sep = ','): string[] {
  const out: string[] = []; let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === sep && depth === 0) { out.push(s.slice(last, i)); last = i + 1; } }
  out.push(s.slice(last)); return out.map((x) => x.trim()).filter(Boolean);
}
function splitAlias(item: string): { expr: string; alias: string | null } {
  const m = item.match(/^(.*?)\s+as\s+(\w+)$/is); return m ? { expr: m[1].trim(), alias: m[2] } : { expr: item.trim(), alias: null };
}
function classifyAgg(expr: string, reg: TableEntry): { key: string; agg: string; column?: string } | null {
  const e = unwrapNum(expr); let m: RegExpMatchArray | null;
  if (/^count\(\s*\*\s*\)$/i.test(e)) return { key: 'count', agg: 'count' };
  if ((m = e.match(/^count\(\s*distinct\s+(\w+)\s*\)$/i))) {
    const mk = reg.metrics[`count_distinct:${m[1].toLowerCase()}`];
    if (!mk) refuse('unknown_metric', `count(distinct ${m[1]}) has no model metric`);
    return { key: mk, agg: 'count_distinct', column: m[1] };
  }
  if ((m = e.match(/^(sum|avg|min|max)\(\s*(\w+)\s*\)$/i))) {
    const agg = m[1].toLowerCase(), col = m[2].toLowerCase();
    const mk = reg.metrics[`${agg}:${col}`];
    if (!mk) refuse('unknown_metric', `${agg}(${col}) has no model metric`);
    return { key: mk, agg, column: col };
  }
  if (/\bcase\b/i.test(e)) refuse('case_measure', 'CASE expression in a measure (e.g. conditional ratio)');
  return null;
}

export function recognizeSql(sql: string): RecognizeResult {
  try {
    const raw = sql.trim();
    if (/\bunion\b/i.test(raw)) refuse('union', 'UNION (combines multiple tables/queries)');
    if (/\bjoin\b/i.test(raw)) refuse('join', 'explicit JOIN');
    if (/\bwith\b\s+\w+\s+as\s*\(/i.test(raw)) refuse('cte', 'CTE (WITH ...)');
    if (/\bover\s*\(/i.test(raw)) refuse('window', 'window function (OVER)');

    const mSel = raw.match(/^select\s+(.+?)\s+from\s+(\w+)\b/is);
    if (!mSel) refuse('parse_failed', 'could not parse SELECT ... FROM');
    const reg = INDEX[mSel![2].toLowerCase()];
    if (!reg) refuse('unknown_table', `unknown table "${mSel![2]}"`);

    const measures: { key: string; agg: string; column?: string }[] = [];
    let dimItem: string | null = null;
    for (const item of splitTop(mSel![1])) {
      const { expr } = splitAlias(item);
      const agg = classifyAgg(expr, reg!);
      if (agg) { measures.push(agg); continue; }
      if (dimItem) refuse('detail_rows', 'projects multiple non-aggregated columns (detail row list, not a metric)');
      dimItem = expr;
    }
    if (measures.length === 0) refuse('detail_rows', 'no aggregate measure (detail row list, not a metric)');
    if (measures.length > 1) refuse('multi_measure', 'multiple measures — not supported in the builder yet');

    let dimension: BuilderQuery['dimension'];
    if (dimItem) {
      let col = dimItem; let grain: string | undefined; const sm = col.match(SUBSTR);
      if (sm) { col = sm[1]; grain = 'day'; }
      const d = reg!.dims[col.toLowerCase()];
      if (!d) refuse('unknown_dimension', `group-by column "${col}" is not a model dimension`);
      dimension = grain ? { key: d!.key, grain: grain as never } : { key: d!.key };
    }

    const query: BuilderQuery = { mode: 'builder', model: reg!.model, metric: measures[0] as never, filters: [] };
    if (dimension) query.dimension = dimension;
    return { ok: true, query };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, code: e.code, reason: e.message };
    throw e;
  }
}
```

- [ ] **Step 4: Export it**

In `packages/dashboards/src/index.ts`, add:

```typescript
export { recognizeSql, type RecognizeResult, type RecognizeCode } from './recognize-sql';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- recognize-sql`
Expected: PASS (7 core assertions green).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/recognize-sql.ts packages/dashboards/src/recognize-sql.test.ts packages/dashboards/src/index.ts
git commit -m "feat(dashboards): SQL->Builder recognizer core (select/from/measure/dimension)"
```

---

### Task 4: Recognizer — filters, `[[ ]]` optionals, `limit`, and the full-corpus gate

**Files:**
- Modify: `packages/dashboards/src/recognize-sql.ts` (WHERE parsing, optional clauses, limit)
- Test: `packages/dashboards/src/recognize-sql.test.ts` (add the corpus test)

**Interfaces:**
- Consumes: `recognizeSql` from Task 3; the seeded corpus `./samples/openldr-general.json`.
- Produces: filters (`eq`/`gte`/`lte`/`in`), preserved `{{var}}` tokens, and `limit` on the recognized query. Locks the measured 9/13 pass set.

- [ ] **Step 1: Write the failing corpus test**

Add to `packages/dashboards/src/recognize-sql.test.ts`:

```typescript
import board from './samples/openldr-general.json';

describe('recognizeSql — filters and corpus', () => {
  it('parses filters, an IN list, and a date range', () => {
    const r = recognizeSql(`SELECT COUNT(*) AS value FROM lab_results
      WHERE abnormal_flag IN ('H','L')
      [[AND substring(result_timestamp,1,10) >= {{period_from}}]]
      [[AND observation_desc = {{test}}]]`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.filters).toEqual([
      { dimension: 'interpretation_code', op: 'in', value: ['H', 'L'] },
      { dimension: 'effective_date_time', op: 'gte', value: '{{period_from}}' },
      { dimension: 'code_text', op: 'eq', value: '{{test}}' },
    ]);
  });

  it('captures OFFSET/FETCH as a limit', () => {
    const r = recognizeSql('SELECT panel_desc AS label, COUNT(*) AS value FROM lab_requests GROUP BY panel_desc ORDER BY value DESC OFFSET 0 ROWS FETCH NEXT 15 ROWS ONLY');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.limit).toBe(15);
  });

  it('recognizes exactly 9 of the 13 seeded widgets, with expected refusal codes', () => {
    const results = board.widgets.map((w: any) => ({ title: w.title, r: recognizeSql(w.query.sql) }));
    const passed = results.filter((x) => x.r.ok).map((x) => x.title);
    expect(passed.length).toBe(9);
    const refusals = Object.fromEntries(results.filter((x) => !x.r.ok).map((x) => [x.title, (x.r as any).code]));
    expect(refusals).toEqual({
      'Result Finalisation %': 'case_measure',
      'Order → Report Pipeline': 'union',
      'Analyte Volume vs Avg Value': 'multi_measure',
      'Recent Orders': 'detail_rows',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards test -- recognize-sql`
Expected: FAIL — WHERE/optionals/limit unimplemented; filters empty, `limit` undefined, corpus count wrong.

- [ ] **Step 3: Add limit capture, optional-clause split, and WHERE parsing**

In `packages/dashboards/src/recognize-sql.ts`, replace the body of `recognizeSql` between the up-front rejects and the `const mSel` line, and extend it. Full updated function:

```typescript
const clean = (v: string): string => v.trim().replace(/^'(.*)'$/s, '$1');
function resolveDim(rawCol: string, reg: TableEntry): { key: string } {
  let col = rawCol.trim(); const sm = col.match(SUBSTR); if (sm) col = sm[1];
  const d = reg.dims[col.toLowerCase()];
  if (!d) refuse('unknown_dimension', `filter column "${col}" is not a model dimension`);
  return { key: d!.key };
}

export function recognizeSql(sql: string): RecognizeResult {
  try {
    const raw0 = sql.trim();
    if (/\bunion\b/i.test(raw0)) refuse('union', 'UNION (combines multiple tables/queries)');
    if (/\bjoin\b/i.test(raw0)) refuse('join', 'explicit JOIN');
    if (/\bwith\b\s+\w+\s+as\s*\(/i.test(raw0)) refuse('cte', 'CTE (WITH ...)');
    if (/\bover\s*\(/i.test(raw0)) refuse('window', 'window function (OVER)');

    let limit: number | undefined;
    const raw = raw0
      .replace(/offset\s+\d+\s+rows\s+fetch\s+next\s+(\d+)\s+rows\s+only/i, (_, n) => { limit = +n; return ''; })
      .replace(/\blimit\s+(\d+)/i, (_, n) => { limit = +n; return ''; });

    const optional: string[] = [];
    const body = raw.replace(/\[\[(.*?)\]\]/gs, (_, inner) => { optional.push(inner.trim()); return ' '; });

    const mSel = body.match(/^select\s+(.+?)\s+from\s+(\w+)\b/is);
    if (!mSel) refuse('parse_failed', 'could not parse SELECT ... FROM');
    const reg = INDEX[mSel![2].toLowerCase()];
    if (!reg) refuse('unknown_table', `unknown table "${mSel![2]}"`);

    const measures: { key: string; agg: string; column?: string }[] = [];
    let dimItem: string | null = null;
    for (const item of splitTop(mSel![1])) {
      const { expr } = splitAlias(item);
      const agg = classifyAgg(expr, reg!);
      if (agg) { measures.push(agg); continue; }
      if (dimItem) refuse('detail_rows', 'projects multiple non-aggregated columns (detail row list, not a metric)');
      dimItem = expr;
    }
    if (measures.length === 0) refuse('detail_rows', 'no aggregate measure (detail row list, not a metric)');
    if (measures.length > 1) refuse('multi_measure', 'multiple measures — not supported in the builder yet');

    let dimension: BuilderQuery['dimension']; let groupCol: string | undefined;
    if (dimItem) {
      let col = dimItem; let grain: string | undefined; const sm = col.match(SUBSTR);
      if (sm) { col = sm[1]; grain = 'day'; }
      groupCol = col.toLowerCase();
      const d = reg!.dims[groupCol];
      if (!d) refuse('unknown_dimension', `group-by column "${col}" is not a model dimension`);
      dimension = grain ? { key: d!.key, grain: grain as never } : { key: d!.key };
    }

    const whereM = body.match(/\bwhere\s+(.+?)(?:\s+group\s+by|\s+order\s+by|\s*$)/is);
    const preds: string[] = [];
    if (whereM) for (const p of splitTopRe(whereM[1], /\band\b/gi)) preds.push(p.trim());
    for (const o of optional) preds.push(o.replace(/^and\s+/i, '').trim());

    const filters: NonNullable<BuilderQuery['filters']> = [];
    for (const p of preds) {
      if (/^1\s*=\s*1$/.test(p)) continue;
      let m: RegExpMatchArray | null;
      if ((m = p.match(/^(.+?)\s+is\s+not\s+null$/i))) {
        const col = m[1].trim().toLowerCase();
        if (col === groupCol || reg!.dims[col]) continue; // tolerated: builder shows nulls as (none)
        refuse('not_null_unsupported', `IS NOT NULL on "${col}"`);
      } else if ((m = p.match(/^(.+?)\s+in\s*\((.+)\)$/i))) {
        filters.push({ dimension: resolveDim(m[1], reg!).key, op: 'in', value: splitTop(m[2]).map(clean) });
      } else if ((m = p.match(/^(.+?)\s*(>=|<=|=)\s*(.+)$/))) {
        const op = m[2] === '>=' ? 'gte' : m[2] === '<=' ? 'lte' : 'eq';
        filters.push({ dimension: resolveDim(m[1], reg!).key, op, value: clean(m[3]) });
      } else refuse('unrecognized_predicate', `unrecognized predicate: "${p}"`);
    }

    const query: BuilderQuery = { mode: 'builder', model: reg!.model, metric: measures[0] as never, filters };
    if (dimension) query.dimension = dimension;
    if (limit != null) query.limit = limit;
    return { ok: true, query };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, code: e.code, reason: e.message };
    throw e;
  }
}
```

Add the regex-separator splitter helper near `splitTop`:

```typescript
function splitTopRe(s: string, sep: RegExp): string[] {
  const out: string[] = []; let last = 0; let m: RegExpExecArray | null; sep.lastIndex = 0;
  const balanced = (t: string) => (t.match(/\(/g)?.length ?? 0) === (t.match(/\)/g)?.length ?? 0);
  while ((m = sep.exec(s))) { if (balanced(s.slice(last, m.index))) { out.push(s.slice(last, m.index)); last = sep.lastIndex; } }
  out.push(s.slice(last)); return out.map((x) => x.trim()).filter(Boolean);
}
```

Delete the now-duplicated earlier `recognizeSql` definition and the earlier `clean`/`resolveDim` if you placed them; keep a single copy of each.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- recognize-sql`
Expected: PASS — filters/limit green; corpus test asserts 9 passes and the 4 refusal codes.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/recognize-sql.ts packages/dashboards/src/recognize-sql.test.ts
git commit -m "feat(dashboards): recognizer filters, optional clauses, limit; lock 9/13 corpus gate"
```

---

### Task 5: Builder pane — shadcn filter editor + revived `BuilderForm`

**Files:**
- Create: `apps/studio/src/dashboard/editor/FilterConditionEditor.tsx`
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx` (rewrite: shadcn, top-level filters, breakdown)
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

**Interfaces:**
- Consumes: `QueryModel`, builder `WidgetQuery` from `../../api`.
- Produces: `<BuilderForm models value onChange />` editing a full `BuilderQuery` (source/measure/filters/group-by/breakdown); `<FilterConditionEditor value dimensions onChange />` editing `{ dimension; op; value }[]` with shadcn controls.

- [ ] **Step 1: Write the failing test**

Replace `apps/studio/src/dashboard/editor/BuilderForm.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuilderForm } from './BuilderForm';
import type { QueryModel, WidgetQuery } from '../../api';

const models: QueryModel[] = [{
  id: 'service_requests', label: 'Test Orders',
  dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }, { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
}];
const base = { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Count', agg: 'count' }, filters: [] } as Extract<WidgetQuery, { mode: 'builder' }>;

describe('BuilderForm', () => {
  it('sets a group-by dimension', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={base} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'status' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dimension: { key: 'status' } }));
  });

  it('adds a top-level filter', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={base} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ dimension: 'status', op: 'eq', value: '' }] }));
  });
});
```

> Note: the shadcn `Select` renders a Radix combobox, not a native `<select>`; where the test drives a native control keep the corresponding field a plain accessible `<select>` **only if** the repo's shadcn `Select` isn't test-drivable in jsdom. Check `WidgetEditorDialog.test.tsx` for the established pattern and mirror it (it already tests a dialog containing shadcn `Select`s). If that suite drives shadcn via `fireEvent.click` on the trigger + option role, use the same approach here and update the two `fireEvent.change` lines accordingly before Step 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- BuilderForm`
Expected: FAIL — current `BuilderForm` has no "Group by" wired to `onChange` with a top-level filter list and no "Add filter".

- [ ] **Step 3: Create `FilterConditionEditor.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../../api';

export interface FilterCondition { dimension: string; op: string; value: unknown }
const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;
const toValue = (op: string, raw: string): unknown =>
  op === 'in' || op === 'between' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
const toLiteral = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

export function FilterConditionEditor({ value, dimensions, onChange }: {
  value: FilterCondition[]; dimensions: ModelDimension[]; onChange: (c: FilterCondition[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<FilterCondition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...value, { dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-1">
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <Select value={c.dimension} onValueChange={(v) => update(i, { dimension: v })}>
            <SelectTrigger aria-label="Filter field" className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{dimensions.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={c.op} onValueChange={(v) => update(i, { op: v, value: toValue(v, toLiteral(c.value)) })}>
            <SelectTrigger aria-label="Filter operator" className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-7 flex-1 text-xs" value={toLiteral(c.value)} onChange={(e) => update(i, { value: toValue(c.op, e.target.value) })} />
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove filter" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add filter</Button>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `BuilderForm.tsx` (shadcn, top-level filters, breakdown)**

```tsx
import type { QueryModel, WidgetQuery } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { FilterConditionEditor, type FilterCondition } from './FilterConditionEditor';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;

export function BuilderForm({ models, value, onChange }: { models: QueryModel[]; value: BuilderQuery; onChange: (q: BuilderQuery) => void }) {
  const model = models.find((m) => m.id === value.model) ?? models[0];
  const setModel = (id: string) => { const m = models.find((x) => x.id === id)!; onChange({ ...value, model: id, metric: m.metrics[0], metrics: undefined, dimension: undefined, breakdown: undefined, filters: [], filterTree: undefined }); };
  const setMetric = (key: string) => { const mm = model.metrics.find((x) => x.key === key)!; onChange({ ...value, metric: mm }); };
  const setFilters = (f: FilterCondition[]) => onChange({ ...value, filters: f as BuilderQuery['filters'] });
  const setDim = (key: string) => onChange({ ...value, dimension: key ? { key } : undefined });
  const setBreakdown = (key: string) => onChange({ ...value, breakdown: key ? { key } : undefined });
  const dim = model?.dimensions.find((d) => d.key === value.dimension?.key);

  const Sel = ({ label, val, onValue, includeNone, children }: { label: string; val: string; onValue: (v: string) => void; includeNone?: boolean; children: React.ReactNode }) => (
    <label className="text-sm">{label}
      {/* jsdom-drivable native select mirrors the shadcn control for tests; swap to shadcn Select if the repo test-pattern drives Radix */}
      <select aria-label={label} className="mt-1 w-full rounded border border-border bg-background p-2 text-sm" value={val} onChange={(e) => onValue(e.target.value)}>
        {includeNone && <option value="">(none)</option>}
        {children}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-3 p-1">
      <Sel label="Source" val={value.model} onValue={setModel}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Sel>
      <Sel label="Measure" val={value.metric.key} onValue={setMetric}>{model?.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Sel>
      <div className="text-sm">Filters
        <FilterConditionEditor value={(value.filters ?? []) as FilterCondition[]} dimensions={model?.dimensions ?? []} onChange={setFilters} />
      </div>
      <Sel label="Group by" val={value.dimension?.key ?? ''} onValue={setDim} includeNone>{model?.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Sel>
      {dim?.kind === 'date' && dim.dateGrain && (
        <Sel label="Grain" val={value.dimension?.grain ?? 'month'} onValue={(g) => onChange({ ...value, dimension: { key: dim.key, grain: g } })}>{dim.dateGrain.map((g) => <option key={g} value={g}>{g}</option>)}</Sel>
      )}
      <Sel label="Breakdown" val={value.breakdown?.key ?? ''} onValue={setBreakdown} includeNone>{model?.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Sel>
    </div>
  );
}
```

> The inline `Sel` uses a native `<select>` to stay jsdom-drivable for the Step-1 tests, which mirror the existing `BuilderForm.test.tsx` style. Per [[use-shadcn-components]], if `WidgetEditorDialog.test.tsx` demonstrates driving shadcn `Select` in jsdom, replace `Sel`'s body with the shadcn `Select` (imported above in `FilterConditionEditor`) and update the two tests to the Radix click-pattern. Delete the unused `Select` import here if you keep native. Keep `FilterConditionEditor` on shadcn regardless.

- [ ] **Step 5: Delete the now-unused `MetricConditionEditor`**

`FilterConditionEditor` replaces it. Remove the files and any imports:

```bash
git rm apps/studio/src/dashboard/editor/MetricConditionEditor.tsx apps/studio/src/dashboard/editor/MetricConditionEditor.test.tsx
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- BuilderForm FilterConditionEditor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/dashboard/editor/
git commit -m "feat(studio): revive BuilderForm with top-level filters + breakdown; shadcn FilterConditionEditor"
```

---

### Task 6: Wire the Builder ⇆ SQL toggle into `WidgetEditorDialog`

**Files:**
- Modify: `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/dashboard/editor/WidgetEditorDialog.test.tsx`

**Interfaces:**
- Consumes: `BuilderForm` (Task 5); `runWidgetQuery` (builder mode already supported server-side).
- Produces: a `mode` state; the footer toggle; builder-mode preview + save. New widgets default to Builder; existing widgets open in their saved mode.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/dashboard/editor/WidgetEditorDialog.test.tsx`:

```tsx
it('defaults a new widget to Builder mode and shows the source picker', () => {
  render(<WidgetEditorDialog open initial={undefined} onClose={() => {}} onSave={() => {}} />);
  expect(screen.getByLabelText('Source')).toBeInTheDocument();
});

it('saves a builder-mode query when authored in Builder', async () => {
  const onSave = vi.fn();
  render(<WidgetEditorDialog open initial={undefined} onClose={() => {}} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'status' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ mode: 'builder' }) }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- WidgetEditorDialog`
Expected: FAIL — no Source picker (dialog is SQL-only), `save()` always emits `mode:'sql'`.

- [ ] **Step 3: Add i18n keys**

In `apps/studio/src/i18n/en.ts`, under the widget/dashboard editor namespace (match the file's existing structure), add:

```typescript
    widgetEditor: {
      modeBuilder: 'Builder',
      modeSql: 'SQL',
      ejectBanner: 'This SQL fetches the rows; grain, ratios, and top-N are applied afterward and are not shown here.',
      cannotShowInBuilder: "Can't show this in the builder",
    },
```

Mirror in `fr.ts`:

```typescript
    widgetEditor: {
      modeBuilder: 'Générateur',
      modeSql: 'SQL',
      ejectBanner: 'Ce SQL récupère les lignes ; le regroupement temporel, les ratios et le top-N sont appliqués ensuite et ne figurent pas ici.',
      cannotShowInBuilder: 'Impossible d’afficher ceci dans le générateur',
    },
```

and `pt.ts`:

```typescript
    widgetEditor: {
      modeBuilder: 'Construtor',
      modeSql: 'SQL',
      ejectBanner: 'Este SQL busca as linhas; agrupamento temporal, rácios e top-N são aplicados depois e não aparecem aqui.',
      cannotShowInBuilder: 'Não é possível mostrar isto no construtor',
    },
```

- [ ] **Step 4: Add `mode` state, the Builder pane, the footer toggle, and builder save/run**

In `WidgetEditorDialog.tsx`:

Imports:
```tsx
import { BuilderForm } from './BuilderForm';
import { useTranslation } from '@/i18n'; // match the repo's existing i18n hook import
import { type WidgetQuery } from '../../api';
```

State (near the other `useState` calls):
```tsx
  const initialMode = initial?.query.mode ?? 'builder';
  const [mode, setMode] = useState<'builder' | 'sql'>(initialMode);
  const [builderQuery, setBuilderQuery] = useState<Extract<WidgetQuery, { mode: 'builder' }>>(
    initial?.query.mode === 'builder' ? initial.query
      : { mode: 'builder', model: models[0]?.id ?? 'service_requests', metric: models[0]?.metrics[0] ?? { key: 'count', label: 'Count', agg: 'count' }, filters: [] },
  );
```

When `models` load, seed the builder default if still empty:
```tsx
  useEffect(() => {
    listModels().then((m) => {
      setModels(m);
      setBuilderQuery((q) => (q.model ? q : { ...q, model: m[0]?.id ?? q.model, metric: m[0]?.metrics[0] ?? q.metric }));
    }).catch(() => {});
  }, []);
```
(Replace the existing `listModels().then(setModels)` effect with this.)

Builder preview — run the builder query live when in builder mode:
```tsx
  useEffect(() => {
    if (mode !== 'builder') return;
    setRunning(true);
    runWidgetQuery(builderQuery)
      .then((r) => { setPreview(r); setError(undefined); const cols = r.columns.map((c) => c.key); setVisual((v) => ({ ...v, xAxisKey: v.xAxisKey ?? cols[0], yAxisKey: v.yAxisKey ?? cols[1] ?? cols[0] })); })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setRunning(false));
  }, [mode, JSON.stringify(builderQuery)]);
```

`save()` — branch on mode:
```tsx
  const save = () => {
    const id = initial?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w-${Math.round(performance.now())}`);
    const query: WidgetQuery = mode === 'builder' ? builderQuery : { mode: 'sql', sql: sqlText, variableBindings: bindings, variables: varDefs };
    onSave({ id, type, title, query, refreshIntervalSec: initial?.refreshIntervalSec ?? 0, visual });
  };
```

Editor region — swap by mode. Replace the CodeMirror mount block (the `<div ref={onEditorMount} .../>` + sr-only textarea) with:
```tsx
              <div className="min-h-0 flex-1 overflow-auto">
                {mode === 'builder'
                  ? <BuilderForm models={models} value={builderQuery} onChange={setBuilderQuery} />
                  : (<><div ref={onEditorMount} className="h-full" /><textarea aria-label="SQL" className="sr-only" readOnly={sqlReadOnly} value={sqlText} onChange={(e) => setSqlText(e.target.value)} /></>)}
              </div>
```

Footer — add the toggle before the rows counter. Replace the footer's left content:
```tsx
              <div className="flex items-center border-t border-border px-2 py-1">
                <div className="mr-2 inline-flex overflow-hidden rounded border border-border text-[11px]">
                  <button type="button" aria-pressed={mode === 'builder'} onClick={() => setMode('builder')} className={mode === 'builder' ? 'bg-primary px-2 py-0.5 text-primary-foreground' : 'px-2 py-0.5 text-muted-foreground'}>{t('widgetEditor.modeBuilder')}</button>
                  <button type="button" aria-pressed={mode === 'sql'} onClick={() => setMode('sql')} className={mode === 'sql' ? 'bg-primary px-2 py-0.5 text-primary-foreground' : 'px-2 py-0.5 text-muted-foreground'}>{t('widgetEditor.modeSql')}</button>
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">{(preview?.rows.length ?? 0).toLocaleString()} rows</span>
                <div className="ml-auto flex items-center gap-1">
```
(Keep the existing Run + `⋯` dropdown that followed.)

Add the hook at the top of the component: `const { t } = useTranslation();`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- WidgetEditorDialog`
Expected: PASS (defaults to Builder; saves `mode:'builder'`). Existing SQL-mode dialog tests still pass because opening a saved SQL widget sets `initialMode='sql'`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx apps/studio/src/dashboard/editor/WidgetEditorDialog.test.tsx apps/studio/src/i18n/
git commit -m "feat(studio): Builder|SQL toggle in the widget editor footer; builder-mode preview + save"
```

---

### Task 7: Builder → SQL eject and SQL → Builder import

**Files:**
- Modify: `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx`
- Modify: `apps/studio/src/api.ts` (add a `compileBuilderSql` helper endpoint call OR reuse existing) — see Step 3
- Test: `apps/studio/src/dashboard/editor/WidgetEditorDialog.test.tsx`

**Interfaces:**
- Consumes: `recognizeSql` (Task 4) via `@openldr/dashboards`; the compiler for eject.
- Produces: switching to SQL fills CodeMirror from the builder query + shows a banner; switching to Builder on unrecognizable SQL toasts a reason and disables the Builder button.

- [ ] **Step 1: Write the failing tests**

Add to `WidgetEditorDialog.test.tsx`:

```tsx
it('disables the Builder toggle for unrecognizable SQL and shows a reason', () => {
  const initial = { id: 'w1', type: 'kpi', title: 't', refreshIntervalSec: 0, visual: {}, query: { mode: 'sql', sql: 'SELECT a, b FROM lab_requests UNION SELECT c, d FROM specimens' } } as const;
  render(<WidgetEditorDialog open initial={initial as any} onClose={() => {}} onSave={() => {}} />);
  const builderBtn = screen.getByRole('button', { name: 'Builder' });
  fireEvent.click(builderBtn);
  expect(screen.getByRole('button', { name: 'Builder' })).toBeDisabled();
  expect(screen.getByText(/UNION/i)).toBeInTheDocument();
});

it('imports recognizable SQL into the builder', () => {
  const initial = { id: 'w2', type: 'bar-chart', title: 't', refreshIntervalSec: 0, visual: {}, query: { mode: 'sql', sql: 'SELECT status AS label, COUNT(*) AS value FROM lab_requests GROUP BY status' } } as const;
  render(<WidgetEditorDialog open initial={initial as any} onClose={() => {}} onSave={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Builder' }));
  expect(screen.getByLabelText('Source')).toBeInTheDocument();
  expect((screen.getByLabelText('Group by') as HTMLSelectElement).value).toBe('status');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/studio test -- WidgetEditorDialog`
Expected: FAIL — toggling to Builder from SQL currently just swaps panes with no recognizer.

- [ ] **Step 3: Implement mode-switch handlers with recognizer + eject**

In `WidgetEditorDialog.tsx`, import the recognizer and a toast + compile helper:

```tsx
import { recognizeSql, type RecognizeCode } from '@openldr/dashboards';
import { toast } from 'sonner'; // match the repo's toast util
```

Add state for the disable-reason and the eject banner:
```tsx
  const [builderBlockedReason, setBuilderBlockedReason] = useState<string | undefined>();
  const codeMessage = (code: RecognizeCode, reason: string) =>
    code === 'union' ? reason : code === 'detail_rows' ? reason : reason; // codes already carry a plain English reason; localize here if desired
```

Replace the two toggle buttons' `onClick` with guarded handlers:
```tsx
  const toBuilder = () => {
    if (initial?.query.mode !== 'sql' && mode === 'sql') { /* was authored here; builderQuery is authoritative */ setMode('builder'); return; }
    const r = recognizeSql(sqlText);
    if (r.ok) { setBuilderQuery(r.query as Extract<WidgetQuery, { mode: 'builder' }>); setBuilderBlockedReason(undefined); setMode('builder'); }
    else { setBuilderBlockedReason(r.reason); toast.error(`${t('widgetEditor.cannotShowInBuilder')}: ${r.reason}`); }
  };
  const toSql = () => {
    if (mode === 'builder') {
      runWidgetQuery({ ...builderQuery }).catch(() => {}); // keep preview warm
      // eject: ask the server to compile the builder query to SQL text
      compileBuilderToSql(builderQuery).then((sql) => setSqlText(sql)).catch(() => {});
    }
    setMode('sql');
  };
```

Wire buttons: `onClick={toBuilder}` (Builder), `onClick={toSql}` (SQL). Add `disabled={!!builderBlockedReason}` and `title={builderBlockedReason}` to the Builder button. Clear `builderBlockedReason` whenever `sqlText` changes (`useEffect([sqlText], () => setBuilderBlockedReason(undefined))`).

Render the eject banner above CodeMirror when `mode==='sql'` and the widget originated in builder:
```tsx
                {mode === 'sql' && ejectedFromBuilder && (
                  <div className="border-b border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">{t('widgetEditor.ejectBanner')}</div>
                )}
```
Track `ejectedFromBuilder` = a `useState(false)` set true inside `toSql` when `mode==='builder'`.

- [ ] **Step 4: Add the compile-to-SQL helper**

In `apps/studio/src/api.ts`:

```typescript
export async function compileBuilderToSql(q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string> {
  return authFetch('/api/dashboards/compile-sql', json(q)).then((r) => okJson<{ sql: string }>(r, 'compile sql')).then((x) => x.sql);
}
```

In `apps/server/src/dashboards-routes.ts`, add a route that parses a builder query and returns `compileBuilderQuery(db, model, q).compile().sql` (inlining parameters for readability via a small `formatSql(sql, parameters)` that substitutes `$n`/`?` with quoted literals — read-only display text, never executed). Guard: only accept `mode:'builder'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- WidgetEditorDialog`
Expected: PASS (unrecognizable SQL disables Builder + shows reason; recognizable SQL imports).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx apps/studio/src/api.ts apps/server/src/dashboards-routes.ts apps/studio/src/dashboard/editor/WidgetEditorDialog.test.tsx
git commit -m "feat(studio): SQL->Builder import guard (toast+disable) and Builder->SQL eject banner"
```

---

### Task 8: Dashboard-filter binding — authoring UI + `bindQuery` date-range

**Files:**
- Modify: `apps/studio/src/dashboard/editor/FilterConditionEditor.tsx` (Value ⇆ Dashboard filter toggle)
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx` (pass dashboard filters + bindings through)
- Modify: `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx` (thread `dashboardFilters` + `variableBindings`)
- Modify: `apps/studio/src/dashboard/DashboardWidget.tsx` (`bindQuery` date-range expansion)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/dashboard/DashboardWidget.test.tsx`, `apps/studio/src/dashboard/editor/FilterConditionEditor.test.tsx`

**Interfaces:**
- Consumes: `dashboardFilters: DashboardFilterDef[]` (already a prop of `WidgetEditorDialog`); `variableBindings` on the builder query.
- Produces: a per-filter binding control writing `variableBindings[dimensionKey] = filterId`; `bindQuery` expands a date-range binding into `gte`+`lte`.

- [ ] **Step 1: Write the failing test for `bindQuery`**

Add to `apps/studio/src/dashboard/DashboardWidget.test.tsx`:

```tsx
import { bindQuery } from './DashboardWidget';

it('expands a date-range dashboard-filter binding into gte + lte', () => {
  const q = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [], variableBindings: { authored_on: 'period' } } as any;
  const out = bindQuery(q, { period: { from: '2024-01-01', to: '2024-03-31' } }) as any;
  expect(out.filters).toEqual([
    { dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
    { dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
  ]);
});

it('binds a scalar dashboard filter as an eq filter (unchanged)', () => {
  const q = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [], variableBindings: { priority: 'prio' } } as any;
  const out = bindQuery(q, { prio: 'stat' }) as any;
  expect(out.filters).toEqual([{ dimension: 'priority', op: 'eq', value: 'stat' }]);
});
```

(Export `bindQuery` from `DashboardWidget.tsx` — change `function bindQuery` to `export function bindQuery`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- DashboardWidget`
Expected: FAIL — current `bindQuery` pushes a single `eq` with the whole `{from,to}` object as value.

- [ ] **Step 3: Extend `bindQuery`**

In `DashboardWidget.tsx`, replace the builder branch of `bindQuery`:

```typescript
  if (q.mode === 'builder') {
    if (!q.variableBindings) return q;
    const filters = [...q.filters];
    for (const [dimKey, filterId] of Object.entries(q.variableBindings)) {
      const v = filterValues[filterId];
      if (v == null || v === '') continue;
      if (typeof v === 'object' && 'from' in v && 'to' in v) {
        const range = v as { from: string; to: string };
        if (range.from) filters.push({ dimension: dimKey, op: 'gte', value: range.from });
        if (range.to) filters.push({ dimension: dimKey, op: 'lte', value: range.to });
      } else {
        filters.push({ dimension: dimKey, op: 'eq', value: v as string | number });
      }
    }
    return { ...q, filters };
  }
```

- [ ] **Step 4: Add the binding control to `FilterConditionEditor`**

Extend `FilterConditionEditor` props with the dashboard filters + binding map, and render a Value/Dashboard-filter toggle per row:

```tsx
export function FilterConditionEditor({ value, dimensions, dashboardFilters = [], bindings = {}, onChange, onBindingsChange }: {
  value: FilterCondition[]; dimensions: ModelDimension[];
  dashboardFilters?: { id: string; label: string }[]; bindings?: Record<string, string>;
  onChange: (c: FilterCondition[]) => void; onBindingsChange?: (b: Record<string, string>) => void;
}): JSX.Element {
  // ... existing update/add/remove ...
  const setBound = (dimKey: string, filterId: string | null) => {
    if (!onBindingsChange) return;
    const next = { ...bindings };
    if (filterId) next[dimKey] = filterId; else delete next[dimKey];
    onBindingsChange(next);
  };
  // per row, after the operator Select, render when dashboardFilters.length > 0:
  //   a small inline segmented [Value | Dashboard filter]; when "Dashboard filter" is chosen,
  //   replace the literal <Input> with a shadcn Select of dashboardFilters writing setBound(c.dimension, id);
  //   choosing "Value" calls setBound(c.dimension, null).
  // A row is "bound" when bindings[c.dimension] is set.
}
```

Render the toggle + bound select in place of the literal `Input` when `bindings[c.dimension]` is set. (Keep the literal `Input` path for unbound rows.)

- [ ] **Step 5: Thread bindings through `BuilderForm` → dialog**

`BuilderForm` gains `dashboardFilters` + passes `value.variableBindings` to `FilterConditionEditor` and writes back via `onChange({ ...value, variableBindings })`. `WidgetEditorDialog` passes its existing `dashboardFilters` prop into `BuilderForm`.

- [ ] **Step 6: Add i18n keys**

`en.ts` (extend `widgetEditor`): `bindValue: 'Value'`, `bindDashboardFilter: 'Dashboard filter'`. `fr.ts`: `bindValue: 'Valeur'`, `bindDashboardFilter: 'Filtre du tableau de bord'`. `pt.ts`: `bindValue: 'Valor'`, `bindDashboardFilter: 'Filtro do painel'`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- DashboardWidget FilterConditionEditor`
Expected: PASS (date-range expansion + eq binding green; binding-toggle component test green).

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/dashboard/ apps/studio/src/i18n/
git commit -m "feat(studio): dashboard-filter binding UI for builder filters; bindQuery date-range expansion"
```

---

### Task 9: Full gate + visual acceptance

**Files:** none (verification checkpoint).

- [ ] **Step 1: Run the forced typecheck gate**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages green. Fix any type drift (e.g. the `api.ts` `WidgetQuery` mirror missing `limit`, or i18n `EnShape` mismatches in `fr`/`pt`).

- [ ] **Step 2: Run the forced test gate**

Run: `pnpm turbo run test --force`
Expected: green except the known pre-existing flakes (studio `api.test.ts` vitest-dedupe; parallel-load timeouts incl. plugins/users that pass in isolation). Re-run any flake in isolation to confirm it is not a regression.

- [ ] **Step 3: Visual acceptance in the running app (dark + light)**

Start the studio dev server. In a dashboard, add a widget:
- Confirm it opens in **Builder**; build source=Results, measure=Count, group by=Facility; confirm live preview + results.
- Bind a filter to a dashboard date-range filter; confirm the widget reacts to the top-bar filter.
- Flip to **SQL**; confirm the eject banner and compiled SQL appear.
- Open the seeded default dashboard's **funnel** and **Recent Orders** widgets; flip to **Builder**; confirm the Builder button is disabled with the correct reason toast (`UNION`, detail rows).
- Repeat the checks in the opposite theme.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(studio): gate green + visual acceptance for widget builder toggle"
```

---

## Self-Review

**Spec coverage:**
- Schema `limit` → Task 1. Compiler top-N → Task 2. Recognizer (core + filters/limit/refusals + capability invariant + codes) → Tasks 3–4. Builder pane (source/measure/filters/group-by/breakdown, shadcn) → Task 5. Footer toggle + swap-only-region + default-builder + builder save → Task 6. Builder→SQL eject banner + SQL→Builder import guard (toast+disable, triggered on toggle) → Task 7. Dashboard-filter binding UI + `bindQuery` date-range → Task 8. i18n en/fr/pt → Tasks 6–8. Full gate + visual → Task 9. **All spec sections mapped.**
- Deferred per spec (not in this plan, by design): AND/OR `filterTree` UI, multi-metric/derived-ratio authoring + null-check op, joins/multi-stage, faithful grain/ratio SQL eject.

**Type consistency:** `recognizeSql`/`RecognizeResult`/`RecognizeCode` defined in Task 3 and reused verbatim in Tasks 4 & 7. `FilterCondition` defined in Task 5, extended (not renamed) in Task 8. `bindQuery` exported in Task 8 matches its use. `builderQuery` state type `Extract<WidgetQuery,{mode:'builder'}>` consistent across Tasks 6–8. `applyTopN` (Task 2) is internal to `compile.ts`.

**Known risk flagged inline:** the shadcn-`Select`-in-jsdom testability question (Task 5 Step 1 note) — resolve by mirroring `WidgetEditorDialog.test.tsx`'s established pattern before writing new tests.
