# Query-model Slice C — Computed Age-Band Dimension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a computed `age_band` dimension to the query model (portable JS-precomputed birth-date-threshold CASE) with a param-bindable reference date, and seed `patient-demographics` as the second editable Report Builder template.

**Architecture:** A registry-declared `age_band` computed dimension on the `patients` model; the compiler emits a portable `CASE` label + rank over `birth_date` (ISO text) vs thresholds precomputed in JS from a reference date. The reference binds to an optional `asOf` param via `DimensionRef.reference`, substituted by `resolveQueryParams` and counted-used by lint. A minimal reference input in the report `QueryEditor`; a seeded published template.

**Tech Stack:** TypeScript, Zod, Kysely `sql` bound-param fragments, React + shadcn, react-i18next (en/fr/pt typed `EnShape`), Vitest (Sqlite compile + pg-mem acceptance).

**Build order:** registry type → pure threshold helper → schema `reference` → compiler → resolveQueryParams → lint → studio UI → seed template → forced gate. The capability (1–6) lands before the UI (7) and the end-to-end seed (8) that proves real bucketing.

**Pre-existing facts (do not re-derive):**
- `ModelDimension` is a plain TS interface (`packages/dashboards/src/models/registry.ts:4`); the `MODELS` array is NOT Zod-parsed, so `compute?` is a type-only addition. `patients` model at `registry.ts:54`.
- `DimensionRefSchema` at `packages/dashboards/src/types.ts:55`; `DimensionKind`/`DateGrain` at `types.ts:15-16`; the builder query uses `dimension: DimensionRefSchema.optional()` at `types.ts:74`.
- `compileBuilderQuery`'s dimension select is at `packages/dashboards/src/compile.ts:159-162` (shared by long + wide mode), using `dim(model, key)` (`compile.ts:10`), `sql` and `sql.ref` (imported `compile.ts:1`).
- `resolveQueryParams` (`packages/report-builder/src/render/run-template.ts:25`) uses `subst`; `lintReportTemplate`'s `paramRefs` (`packages/report-builder/src/lint.ts:26-38`) uses an inner `scan`.
- Template seed pattern: `packages/report-builder/src/amr-resistance-template.ts` (`AMR_RESISTANCE_TEMPLATE_ID` / `buildAmrResistanceTemplate` / `seedAmrResistanceTemplate`), exported via `packages/report-builder/src/index.ts:4`, wired in `packages/bootstrap/src/seed.ts:5,162-165`.
- `apps/studio/src/api.ts`: `ModelDimension` at line 281, the builder `WidgetQuery.dimension` at line 266.
- The `patients` table has `birth_date` (ISO `YYYY-MM-DD` text). The gender split uses Slice A conditional metrics (`metric.where`), already available.

---

## Task 1: `age_band` computed dimension in the registry

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts` (add `AgeBandCompute` + `compute?` on `ModelDimension`; add `age_band` to the `patients` model)
- Test: `packages/dashboards/src/models/registry.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/models/registry.test.ts`:

```ts
describe('patients age_band computed dimension', () => {
  it('exposes an age_band dimension with an age-band compute config', () => {
    const m = getModel('patients')!;
    const d = m.dimensions.find((x) => x.key === 'age_band');
    expect(d).toBeDefined();
    expect(d!.column).toBe('birth_date');
    expect(d!.compute).toMatchObject({ kind: 'age-band', openEndedLabel: '50+', unknownLabel: 'unknown' });
    expect(d!.compute!.bands.map((b) => b.label)).toEqual(['0-4', '5-14', '15-24', '25-49']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: FAIL — no `age_band` dimension.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/models/registry.ts`, add the type above `ModelDimension` (line 4) and widen the interface:

```ts
export interface AgeBandCompute {
  kind: 'age-band';
  bands: { maxAge: number; label: string }[]; // closed upper bounds, e.g. { maxAge: 4, label: '0-4' }
  openEndedLabel: string;                      // older than the last band, e.g. '50+'
  unknownLabel: string;                        // null / future birth_date, e.g. 'unknown'
}
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute }
```

In the `patients` model (`id: 'patients'`, ~line 54), add `age_band` to its `dimensions` array (keep `gender`/`managing_organization`):

```ts
      { key: 'age_band', label: 'Age band', column: 'birth_date', kind: 'string',
        compute: { kind: 'age-band',
          bands: [{ maxAge: 4, label: '0-4' }, { maxAge: 14, label: '5-14' }, { maxAge: 24, label: '15-24' }, { maxAge: 49, label: '25-49' }],
          openEndedLabel: '50+', unknownLabel: 'unknown' } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts` → PASS. Then `pnpm --filter @openldr/dashboards typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git commit -m "feat(dashboards): age_band computed dimension on the patients model"
```

---

## Task 2: Pure age-band threshold helper

**Files:**
- Create: `packages/dashboards/src/age-band.ts`
- Test: `packages/dashboards/src/age-band.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboards/src/age-band.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { minusYears, ageBandArms } from './age-band';
import type { AgeBandCompute } from './models/registry';

const compute: AgeBandCompute = {
  kind: 'age-band',
  bands: [{ maxAge: 4, label: '0-4' }, { maxAge: 14, label: '5-14' }, { maxAge: 24, label: '15-24' }, { maxAge: 49, label: '25-49' }],
  openEndedLabel: '50+', unknownLabel: 'unknown',
};

describe('minusYears', () => {
  it('subtracts whole years and returns YYYY-MM-DD', () => {
    expect(minusYears(new Date('2026-01-01T00:00:00Z'), 5)).toBe('2021-01-01');
    expect(minusYears(new Date('2026-03-15T00:00:00Z'), 50)).toBe('1976-03-15');
  });
});

describe('ageBandArms', () => {
  it('builds youngest→oldest arms with thresholds ref-(maxAge+1)y and ordered ranks', () => {
    const a = ageBandArms(compute, new Date('2026-01-01T00:00:00Z'));
    expect(a.refYMD).toBe('2026-01-01');
    expect(a.arms).toEqual([
      { thresholdYMD: '2021-01-01', label: '0-4', rank: 0 },
      { thresholdYMD: '2011-01-01', label: '5-14', rank: 1 },
      { thresholdYMD: '2001-01-01', label: '15-24', rank: 2 },
      { thresholdYMD: '1976-01-01', label: '25-49', rank: 3 },
    ]);
    expect(a.openEndedLabel).toBe('50+');
    expect(a.openEndedRank).toBe(4);
    expect(a.unknownLabel).toBe('unknown');
    expect(a.unknownRank).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- age-band.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboards/src/age-band.ts`:

```ts
import type { AgeBandCompute } from './models/registry';

// 'YYYY-MM-DD' for `ref` minus `years`, computed in UTC. (Feb 29 rolls to Mar 1 — fine for age bands.)
export function minusYears(ref: Date, years: number): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear() - years, ref.getUTCMonth(), ref.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export interface AgeBandArms {
  refYMD: string;
  arms: { thresholdYMD: string; label: string; rank: number }[]; // youngest→oldest; birth_date > thresholdYMD ⇒ this band
  openEndedLabel: string; openEndedRank: number;
  unknownLabel: string; unknownRank: number;
}

// birth_date > ref-(maxAge+1)y  ⇔  age ≤ maxAge (matches the reporting `ageBand` helper's boundaries).
export function ageBandArms(c: AgeBandCompute, ref: Date): AgeBandArms {
  const sorted = [...c.bands].sort((a, b) => a.maxAge - b.maxAge);
  return {
    refYMD: ref.toISOString().slice(0, 10),
    arms: sorted.map((b, i) => ({ thresholdYMD: minusYears(ref, b.maxAge + 1), label: b.label, rank: i })),
    openEndedLabel: c.openEndedLabel, openEndedRank: sorted.length,
    unknownLabel: c.unknownLabel, unknownRank: sorted.length + 1,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- age-band.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/age-band.ts packages/dashboards/src/age-band.test.ts
git commit -m "feat(dashboards): pure age-band threshold/rank helper"
```

---

## Task 3: `DimensionRef.reference` schema field

**Files:**
- Modify: `packages/dashboards/src/types.ts:55`
- Test: `packages/dashboards/src/types.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/types.test.ts`:

```ts
import { WidgetQuerySchema } from './types';

describe('DimensionRef.reference', () => {
  it('accepts an optional reference on the query dimension', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [], dimension: { key: 'age_band', reference: '{{param.asOf}}' } });
    expect(q).toMatchObject({ mode: 'builder', dimension: { key: 'age_band', reference: '{{param.asOf}}' } });
  });
  it('a dimension without reference still parses', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [], dimension: { key: 'gender' } });
    expect((q as { dimension?: { reference?: string } }).dimension).not.toHaveProperty('reference');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts`
Expected: FAIL — `reference` stripped/rejected.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/types.ts:55`, add `reference` to `DimensionRefSchema`:

```ts
export const DimensionRefSchema = z.object({ key: z.string(), grain: z.enum(['day', 'week', 'month', 'year']).optional(), reference: z.string().optional() });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts` → PASS. Then `pnpm --filter @openldr/dashboards typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts
git commit -m "feat(dashboards): optional reference date on the query DimensionRef"
```

---

## Task 4: Compiler emits the age-band CASE + rank

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (import `ageBandArms`; add `ageBandExprs`; branch the dimension select at lines 159-162)
- Test: `packages/dashboards/src/compile.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/compile.test.ts` (the file already builds `const db = new Kysely<any>({ dialect: new SqliteDialect(...) })` and asserts on `compileBuilderQuery(db, getModel(...)!, q).compile().sql` — reuse that):

```ts
describe('compileBuilderQuery age_band computed dimension', () => {
  const model = getModel('patients')!;
  it('emits a CASE bucket with group by + order by for age_band', () => {
    const { sql } = compileBuilderQuery(db, model, { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, dimension: { key: 'age_band', reference: '2026-01-01' }, filters: [] } as any).compile();
    expect(sql).toMatch(/case when/i);
    expect(sql).toMatch(/group by/i);
    expect(sql).toMatch(/order by/i);
  });
  it('a plain-column dimension emits byte-identical SQL (compute absent)', () => {
    const { sql } = compileBuilderQuery(db, model, { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, dimension: { key: 'gender' }, filters: [] } as any).compile();
    expect(sql).not.toMatch(/case when/i);
    expect(sql).toMatch(/group by "gender"/i);
    expect(sql).toMatch(/order by "gender"/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: FAIL — `age_band` currently compiles as a plain column (`group by "birth_date"`, no CASE).

- [ ] **Step 3: Implement**

In `packages/dashboards/src/compile.ts`, add the import at the top (alongside the existing `./age-band` sibling — add a new import line):

```ts
import { ageBandArms } from './age-band';
```

Add the helper above `compileBuilderQuery` (after `applyFilters`):

```ts
// Build label + rank CASE expressions for a computed age-band dimension, thresholds bound (not inlined).
function ageBandExprs(d: ModelDimension, reference?: string) {
  const parsed = reference ? new Date(reference) : new Date();
  const ref = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const a = ageBandArms(d.compute!, ref);
  const col = sql.ref(d.column);
  let label = sql`case when ${col} is null then ${a.unknownLabel} when ${col} > ${a.refYMD} then ${a.unknownLabel}`;
  let rank = sql`case when ${col} is null then ${a.unknownRank} when ${col} > ${a.refYMD} then ${a.unknownRank}`;
  for (const arm of a.arms) {
    label = sql`${label} when ${col} > ${arm.thresholdYMD} then ${arm.label}`;
    rank = sql`${rank} when ${col} > ${arm.thresholdYMD} then ${arm.rank}`;
  }
  label = sql`${label} else ${a.openEndedLabel} end`;
  rank = sql`${rank} else ${a.openEndedRank} end`;
  return { label, rank };
}
```

Replace the dimension select at lines 159-162:

```ts
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    if (d.compute) {
      const { label, rank } = ageBandExprs(d, q.dimension.reference);
      qb = qb.select(label.as('label') as never).groupBy(label as never).orderBy(rank as never);
    } else {
      qb = qb.select(sql.ref(d.column).as('label')).groupBy(d.column as never).orderBy(d.column as never);
    }
  }
```

Note: the arms are youngest→oldest, so the CASE checks the latest threshold (youngest band) first — first match wins, matching the `ageBand` helper. Thresholds/labels/ranks are all bound `sql` params. `GROUP BY` uses the same `label` fragment (portable; mssql's group-by-must-match-select rule is satisfied by the identical fragment).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts` → PASS (2 new + existing green — the plain-column path is unchanged). Then `pnpm --filter @openldr/dashboards typecheck` → clean and `pnpm --filter @openldr/dashboards test` → all green.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): compile age_band to a portable CASE bucket + rank order"
```

---

## Task 5: `resolveQueryParams` substitutes `dimension.reference`

**Files:**
- Modify: `packages/report-builder/src/render/run-template.ts` (`resolveQueryParams`, ~line 27)
- Test: `packages/report-builder/src/render/run-template.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/report-builder/src/render/run-template.test.ts`:

```ts
describe('resolveQueryParams dimension.reference', () => {
  it('substitutes a param token in the dimension reference', () => {
    const q = { mode: 'builder' as const, model: 'patients', metric: { key: 'count', agg: 'count' as const }, filters: [], dimension: { key: 'age_band', reference: '{{param.asOf}}' } };
    const r = resolveQueryParams(q as any, { asOf: '2026-01-01' }) as any;
    expect(r.dimension.reference).toBe('2026-01-01');
  });
  it('leaves a plain dimension untouched', () => {
    const q = { mode: 'builder' as const, model: 'patients', metric: { key: 'count', agg: 'count' as const }, filters: [], dimension: { key: 'gender' } };
    const r = resolveQueryParams(q as any, {}) as any;
    expect(r.dimension).toEqual({ key: 'gender' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- run-template.test.ts`
Expected: FAIL — the reference isn't substituted.

- [ ] **Step 3: Implement**

In `packages/report-builder/src/render/run-template.ts`, inside `resolveQueryParams`'s `if (clone.mode === 'builder') { ... }` block, after the existing `filters`/`filterTree` handling, add:

```ts
    if (clone.dimension?.reference) {
      clone.dimension = { ...clone.dimension, reference: subst(clone.dimension.reference, params) as string };
    }
```

(`WidgetQuery` from `@openldr/dashboards` now includes `dimension.reference` via Task 3, so this is typed; use `as any` on the clone access if the local narrowing needs it, matching the file's style.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- run-template.test.ts` → PASS (2 new + existing green).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/run-template.ts packages/report-builder/src/render/run-template.test.ts
git commit -m "feat(report-builder): resolveQueryParams substitutes dimension.reference"
```

---

## Task 6: `lintReportTemplate` counts a reference-bound param

**Files:**
- Modify: `packages/report-builder/src/lint.ts` (`paramRefs`, ~line 26-38)
- Test: `packages/report-builder/src/lint.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/report-builder/src/lint.test.ts` (reuse the file's minimal-template helper style):

```ts
describe('lint dimension.reference param refs', () => {
  function tpl(reference: string, params: { id: string; label: string; type: 'text' }[] = []) {
    return {
      id: 't', name: 'T', description: '', category: 'quality' as const, status: 'draft' as const,
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: params,
      rows: [{ id: 'r1', cells: [{ colSpan: 12, block: { kind: 'chart' as const, chartType: 'pie' as const, visual: {},
        query: { mode: 'builder' as const, model: 'patients', metric: { key: 'count', agg: 'count' as const }, filters: [], dimension: { key: 'age_band', reference } } } }] }],
    };
  }
  it('counts a param used when bound only in dimension.reference (no unused warning)', () => {
    const issues = lintReportTemplate(tpl('{{param.asOf}}', [{ id: 'asOf', label: 'As of', type: 'text' }]));
    expect(issues.some((i) => i.code === 'unused-parameter' && i.paramId === 'asOf')).toBe(false);
    expect(issues.some((i) => i.code === 'orphaned-param-ref')).toBe(false);
  });
  it('flags an orphaned reference-bound param', () => {
    const issues = lintReportTemplate(tpl('{{param.ghost}}'));
    expect(issues.some((i) => i.code === 'orphaned-param-ref')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- lint.test.ts`
Expected: FAIL — `paramRefs` ignores `dimension.reference`, so `asOf` reads as unused and `ghost` isn't flagged.

- [ ] **Step 3: Implement**

In `packages/report-builder/src/lint.ts`, inside `paramRefs`, after the existing builder `filters`/`filterTree` scans and before `return ids;`, add:

```ts
  if (q.mode === 'builder' && q.dimension?.reference) scan(q.dimension.reference);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- lint.test.ts` → PASS (2 new + existing green).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/lint.ts packages/report-builder/src/lint.test.ts
git commit -m "feat(report-builder): lint counts params bound in dimension.reference"
```

---

## Task 7: Studio mirrors + reference input + i18n

**Files:**
- Modify: `apps/studio/src/api.ts` (`ModelDimension` line 281; builder `WidgetQuery.dimension` line 266)
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/reports-builder/QueryEditor.test.tsx` (append)

- [ ] **Step 1: Mirror the schema in `api.ts`**

In `apps/studio/src/api.ts`, extend `ModelDimension` (line 281) with an optional `compute`:

```ts
export interface ModelDimension { key: string; label: string; column: string; kind: 'string' | 'date' | 'number'; dateGrain?: string[]; compute?: { kind: 'age-band'; bands: { maxAge: number; label: string }[]; openEndedLabel: string; unknownLabel: string } }
```

and add `reference?: string` to the builder `WidgetQuery`'s `dimension` (line 266):

```ts
      dimension?: { key: string; grain?: string; reference?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
```

- [ ] **Step 2: Add i18n keys (en/fr/pt)**

`apps/studio/src/i18n/en.ts` — under `reportBuilder.query` (siblings of `breakdown`):

```ts
      referenceDate: 'Reference date',
      referenceDateAria: 'Reference date',
      referenceDatePlaceholder: 'YYYY-MM-DD or {{param.x}}',
```

`fr.ts`:

```ts
      referenceDate: 'Date de référence',
      referenceDateAria: 'Date de référence',
      referenceDatePlaceholder: 'AAAA-MM-JJ ou {{param.x}}',
```

`pt.ts`:

```ts
      referenceDate: 'Data de referência',
      referenceDateAria: 'Data de referência',
      referenceDatePlaceholder: 'AAAA-MM-DD ou {{param.x}}',
```

- [ ] **Step 3: Write the failing test**

Append to `apps/studio/src/reports-builder/QueryEditor.test.tsx` (reuse the file's render harness + `../api` `listModels` mock; the mock must return a model whose dimension has `compute` — extend the existing mock or provide a local one for this test):

```ts
it('shows a Reference date input only when the selected dimension is computed', async () => {
  // listModels mock returns a patients model with an age_band compute dimension
  const block = { kind: 'chart', chartType: 'pie', visual: {}, query: { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [], dimension: { key: 'age_band' } } };
  renderQueryEditor({ block, onChange: vi.fn() }); // use the file's existing render helper/signature
  expect(await screen.findByLabelText('Reference date')).toBeInTheDocument();
});

it('hides the Reference date input for a plain dimension', async () => {
  const block = { kind: 'chart', chartType: 'pie', visual: {}, query: { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [], dimension: { key: 'gender' } } };
  renderQueryEditor({ block, onChange: vi.fn() });
  await screen.findByText(/chart type/i); // wait for render
  expect(screen.queryByLabelText('Reference date')).not.toBeInTheDocument();
});
```

The file mocks `../api` at module level (`vi.mock('../api', () => ({ listModels: vi.fn().mockResolvedValue([ ...models ]) }))`). Read that mock and ADD a `patients` model to its models array (additive — existing tests use other models): `{ id: 'patients', label: 'Patients', dimensions: [{ key: 'gender', label: 'Gender', column: 'gender', kind: 'string' }, { key: 'age_band', label: 'Age band', column: 'birth_date', kind: 'string', compute: { kind: 'age-band', bands: [{ maxAge: 4, label: '0-4' }], openEndedLabel: '50+', unknownLabel: 'unknown' } }], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] }`. Use whatever render helper the existing tests use (the file may render `<QueryEditor .../>` directly with props rather than a named `renderQueryEditor` — match it).

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- QueryEditor.test.tsx`
Expected: FAIL — no reference input.

- [ ] **Step 5: Implement the reference input**

In `apps/studio/src/reports-builder/QueryEditor.tsx`, ensure `Input` is imported (`import { Input } from '@/components/ui/input';` — add if missing). In the builder-mode block, after the breakdown `<label>` (the `block.kind === 'chart'` breakdown dropdown), add a reference input gated on the selected dimension being computed (works for chart AND table blocks):

```tsx
          {(() => {
            const selDim = dimensions.find((d) => d.key === builderQuery.dimension?.key);
            if (!selDim?.compute) return null;
            return (
              <label className="flex flex-col gap-1 text-xs">{t('reportBuilder.query.referenceDate')}
                <Input aria-label={t('reportBuilder.query.referenceDateAria')} className="h-7 text-xs"
                  value={builderQuery.dimension?.reference ?? ''}
                  placeholder={t('reportBuilder.query.referenceDatePlaceholder')}
                  onChange={(e) => setQuery({ ...builderQuery, dimension: { ...(builderQuery.dimension ?? { key: selDim.key }), reference: e.target.value || undefined } })} />
              </label>
            );
          })()}
```

Place it inside the `showBuilder && mode === 'builder'` fragment, after the breakdown block. `dimensions` is already computed at `QueryEditor.tsx:49`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- QueryEditor.test.tsx i18n` → PASS (2 new + existing green + parity). Then `pnpm --filter @openldr/studio typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/reports-builder/QueryEditor.test.tsx
git commit -m "feat(studio): reference-date input for computed dimensions (en/fr/pt) + api mirror"
```

---

## Task 8: Seed the patient-demographics template

**Files:**
- Create: `packages/report-builder/src/patient-demographics-template.ts`
- Modify: `packages/report-builder/src/index.ts` (export)
- Modify: `packages/bootstrap/src/seed.ts` (import + seed call)
- Test: `packages/report-builder/src/patient-demographics-template.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/report-builder/src/patient-demographics-template.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPatientDemographicsTemplate, PATIENT_DEMOGRAPHICS_TEMPLATE_ID } from './patient-demographics-template';
import { ReportTemplateSchema } from './schema';
import { lintReportTemplate } from './lint';

describe('patient-demographics template', () => {
  it('builds a schema-valid, published, lint-clean template', () => {
    const t = buildPatientDemographicsTemplate();
    expect(t.id).toBe(PATIENT_DEMOGRAPHICS_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    const issues = lintReportTemplate(t);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0); // asOf counted used via dimension.reference (Task 6)
  });

  it('groups by age_band with total/male/female conditional metrics + an asOf-bound reference', () => {
    const t = buildPatientDemographicsTemplate();
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.dimension).toEqual({ key: 'age_band', reference: '{{param.asOf}}' });
    expect(src.metrics.map((m: any) => m.key)).toEqual(['total', 'male', 'female']);
    expect(src.metrics.find((m: any) => m.key === 'male').where).toEqual([{ dimension: 'gender', op: 'eq', value: 'male' }]);
  });
});
```

Note the lint assertion mirrors the starter-registry pattern: `ReportLintIssue.severity` is `'error' | 'warning'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- patient-demographics-template.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the template (mirror `amr-resistance-template.ts`)**

Create `packages/report-builder/src/patient-demographics-template.ts`:

```ts
import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const PATIENT_DEMOGRAPHICS_TEMPLATE_ID = 'rt-patient-demographics';

const ageBandDim = { key: 'age_band', reference: '{{param.asOf}}' };

/**
 * The built-in patient-demographics code report reproduced as an editable, published Report Builder
 * template: patient counts by the Slice-C computed `age_band` dimension × gender (total/male/female
 * via Slice-A conditional metrics). An optional `asOf` param binds the age-band reference date.
 * "Other/unknown" gender and the facility filter are deferred (need a notIn op / Slice D join).
 */
export function buildPatientDemographicsTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: PATIENT_DEMOGRAPHICS_TEMPLATE_ID,
    name: 'Patient Demographics',
    description: 'Patient counts by age band and gender.',
    category: 'quality',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'asOf', label: 'As of (YYYY-MM-DD)', type: 'text', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Patient Demographics', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Patient counts by age band and gender.', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'pie', visual: {},
        query: { mode: 'builder', model: 'patients', metric: { key: 'count', label: 'Patients', agg: 'count' }, dimension: ageBandDim, filters: [] } } }] },
      { id: 'r4', cells: [{ colSpan: 12, block: {
        kind: 'table', columns: [],
        source: { mode: 'builder', model: 'patients',
          metric: { key: 'total', label: 'Total', agg: 'count' },
          metrics: [
            { key: 'total', label: 'Total', agg: 'count' },
            { key: 'male', label: 'Male', agg: 'count', where: [{ dimension: 'gender', op: 'eq', value: 'male' }] },
            { key: 'female', label: 'Female', agg: 'count', where: [{ dimension: 'gender', op: 'eq', value: 'female' }] },
          ],
          dimension: ageBandDim, filters: [] } } }] },
    ],
  });
}

/** Seed the patient-demographics template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedPatientDemographicsTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(PATIENT_DEMOGRAPHICS_TEMPLATE_ID)) return 0;
  await store.create(buildPatientDemographicsTemplate());
  return 1;
}
```

- [ ] **Step 4: Export + wire the seed**

In `packages/report-builder/src/index.ts`, add after the amr-resistance export:

```ts
export * from './patient-demographics-template';
```

In `packages/bootstrap/src/seed.ts`, extend the import at line 5:

```ts
import { seedSampleReportTemplate, seedAmrResistanceTemplate, seedPatientDemographicsTemplate, type ReportTemplateStore } from '@openldr/report-builder';
```

and add a seed call after the amr line (~166):

```ts
    reportTemplatesSeeded += await seedPatientDemographicsTemplate(app.reportTemplates);
```

- [ ] **Step 5: Add a pg-mem end-to-end bucketing acceptance test**

Mirror the amr-resistance template's pg-mem acceptance test (find it: `grep -rln "runBuilderQuery\|pg-mem\|newDb" packages/report-builder/src`). In `patient-demographics-template.test.ts`, add a test that: spins up pg-mem with a `patients` table, inserts patients with known `birth_date`/`gender`, runs the template's table `source` through `resolveQueryParams(src, { asOf: '2026-01-01' })` then `runBuilderQuery` (the same harness the amr test uses), and asserts the age-band rows carry the expected total/male/female counts in band order. Use birth dates that land in distinct bands (e.g. `2023-01-01` → 0-4, `2015-01-01` → 5-14, `1990-01-01` → 25-49, `1970-01-01` → 50+) and mixed genders. Copy the amr test's pg-mem setup verbatim, swapping the table/columns/query.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @openldr/report-builder test -- patient-demographics-template.test.ts` → PASS (build/lint + schema + pg-mem bucketing). Then `pnpm --filter @openldr/report-builder typecheck` and `pnpm --filter @openldr/bootstrap typecheck` → clean.

**Required test update:** `packages/bootstrap/src/seed.test.ts:252` asserts `expect(first.reportTemplatesSeeded).toBe(2)` (the `seedDatabase — report templates` block, ~line 248-255) — adding a third template makes it **3**. Change that one assertion `toBe(2)` → `toBe(3)` (the reseed `toBe(0)` at line 255 stays). Then `pnpm --filter @openldr/bootstrap test` → green. Include `packages/bootstrap/src/seed.test.ts` in this task's commit.

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/patient-demographics-template.ts packages/report-builder/src/patient-demographics-template.test.ts packages/report-builder/src/index.ts packages/bootstrap/src/seed.ts
git commit -m "feat(report-builder): seed patient-demographics as an editable template (age_band × gender)"
```

---

## Task 9: Forced full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: `31 successful, 31 total`. Never pipe turbo through `tail`. Fix any consumer that breaks on the widened `ModelDimension`/`DimensionRef` (server, cli, bootstrap import from dashboards/report-builder).

- [ ] **Step 2: Forced tests**

Run: `pnpm turbo run test --force`
Expected: green except the known pre-existing flakes — studio `api.test.ts` (vitest-dedupe) and parallel-load timeouts (plugins/users/etc. that pass in isolation). Re-run any red package in isolation to confirm it's a flake. A genuine failure in dashboards/report-builder/studio touched code is a regression — fix it.

- [ ] **Step 3: Commit (only if a gate fix was needed)**

```bash
git add -A && git commit -m "fix: resolve cross-package gate breakage from age-band dimension"
```

---

## Post-plan: review + finish

After Task 9: final holistic review, then `finishing-a-development-branch` (merge `--no-ff` to local `main`, delete branch, update memory `query-model-expansion-workstream`). Live check (dev stack): `pnpm openldr db seed` to seed the new template, open `/reports/builder/rt-patient-demographics`, confirm the age-band table + pie render with seeded patients and the `asOf` param shifts the bands.

---

## Self-review notes (checked against the spec)

- **Spec §1 registry dimension** → Task 1. **§2 threshold helper** → Task 2. **§3 compiler CASE+rank / DimensionRef.reference** → Tasks 3 (schema) + 4 (compiler). **§4 resolve + lint** → Tasks 5 + 6. **§5 UI mirrors + reference input + i18n** → Task 7. **§6 seed template** → Task 8. **§testing/gate** → per-task tests + Task 9.
- **Backward-compat** (spec §error-handling): Task 4 locks byte-identical SQL for a plain-column dimension; `compute`/`reference` optional throughout.
- **Type consistency:** `AgeBandCompute` (registry.ts, Task 1) is imported by `age-band.ts` (Task 2) and `compile.ts` (Task 4), and mirrored structurally in `api.ts` (Task 7). `DimensionRef.reference` (Task 3) is read by the compiler (Task 4), substituted by resolve (Task 5), scanned by lint (Task 6), written by the UI (Task 7), and set in the seed (Task 8). `ageBandArms`/`minusYears` names consistent between Task 2 (def) and Task 4 (use). `PATIENT_DEMOGRAPHICS_TEMPLATE_ID`/`buildPatientDemographicsTemplate`/`seedPatientDemographicsTemplate` consistent across Task 8.
- **The "other" gender column and facility filter are intentionally absent** from the seed template (spec non-goals), noted in the template docstring.
