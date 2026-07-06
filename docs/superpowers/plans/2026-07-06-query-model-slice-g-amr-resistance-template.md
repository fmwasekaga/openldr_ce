# Query-Model Slice G — Seed amr-resistance as an Editable Template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the built-in `amr-resistance` code report as a published, editable Report Builder template (antibiotic × `tested`/`r`/`i`/`s`/`%R`) using the Slice A+B query model, with two supporting render-path fixes so it renders faithfully.

**Architecture:** Three additive parts + an end-to-end acceptance. (1) `resolveQueryParams` drops filters whose resolved value is blank, so an unset date-range param means "all dates" instead of `<= ''`. (2) The table painter formats `kind:'percent'` columns as `"50.0%"`. (3) A new `amr-resistance-template.ts` module (mirroring `sample.ts`) builds + seeds the template; bootstrap wires the seed. The seeded template's table `source` is a wide query with conditional metrics (A) + a derived `%R` ratio (B); report-builder's schema uses the shared `WidgetQuerySchema`, so `metrics`/`derived` are preserved.

**Tech Stack:** TypeScript, zod, Kysely, vitest, pg-mem, pdfkit.

**Design spec:** `docs/superpowers/specs/2026-07-06-query-model-slice-g-amr-resistance-template-design.md`

**Conventions (repo memory):**
- Slices A+B merged on `main` (`c53efa9c`). Work Slice G on a fresh branch `slice-g-amr-resistance-template` off `main`.
- Never pipe turbo through `tail`. Run one package's tests from repo root, e.g. `pnpm --filter @openldr/report-builder exec vitest run src/render/run-template.test.ts`.
- Commit after every green step; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Key facts verified:**
- A `daterange` param writes to fixed `from`/`to` value keys (`ParamValuesBar`), so the seed's date filters bind to `{{param.from}}`/`{{param.to}}`.
- `subst` in `run-template.ts` only substitutes string values (arrays pass through unchanged) — the seed uses string-valued `gte`/`lte` filters, so substitution applies.
- `report-builder/src/schema.ts:39` types a table `source` as `z.union([z.literal('primary'), WidgetQuerySchema])` using the SHARED dashboards schema → `metrics`/`derived` are accepted, not stripped.
- `packages/report-builder` already depends on `@openldr/dashboards` (value) and has `pg-mem` (devDep) → the end-to-end acceptance test lives there with no new deps.

---

## File Structure

**Modify:**
- `packages/report-builder/src/render/run-template.ts` — `resolveQueryParams` drops blank filters (+ `isBlankValue` helper).
- `packages/report-builder/src/render/paint.ts` — `formatCell` helper + `drawTable` carries/uses column `kind`.
- `packages/report-builder/src/index.ts` — export the new template module.
- `packages/bootstrap/src/seed.ts` — call `seedAmrResistanceTemplate`.

**Create:**
- `packages/report-builder/src/amr-resistance-template.ts` — `buildAmrResistanceTemplate` + `seedAmrResistanceTemplate` + `AMR_RESISTANCE_TEMPLATE_ID`.
- `packages/report-builder/src/amr-resistance-template.test.ts` — schema/idempotency + end-to-end acceptance.

**Test files touched:** `packages/report-builder/src/render/run-template.test.ts`, `packages/report-builder/src/render/paint.test.ts`, `packages/report-builder/src/amr-resistance-template.test.ts`, `packages/bootstrap/src/seed.test.ts`.

---

## Task 1: Drop blank param-filters in `resolveQueryParams`

**Files:**
- Modify: `packages/report-builder/src/render/run-template.ts`
- Test: `packages/report-builder/src/render/run-template.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/report-builder/src/render/run-template.test.ts` (add `resolveQueryParams` to the existing `./run-template` import if not already imported):

```ts
describe('resolveQueryParams blank-filter drop (Slice G)', () => {
  const base = {
    mode: 'builder' as const, model: 'observations',
    metric: { key: 'tested', agg: 'count' as const },
    filters: [
      { dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] },
      { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
      { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
    ],
  };

  it('drops date filters when the range is unset (keeps the literal filter)', () => {
    const out = resolveQueryParams(base as never, {});
    if (out.mode !== 'builder') throw new Error('expected builder');
    expect(out.filters).toEqual([{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }]);
  });

  it('keeps date filters with substituted values when the range is set', () => {
    const out = resolveQueryParams(base as never, { from: '2024-01-01', to: '2024-12-31' });
    if (out.mode !== 'builder') throw new Error('expected builder');
    expect(out.filters).toContainEqual({ dimension: 'effective_date_time', op: 'gte', value: '2024-01-01' });
    expect(out.filters).toContainEqual({ dimension: 'effective_date_time', op: 'lte', value: '2024-12-31' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/render/run-template.test.ts`
Expected: FAIL — the unset-range case keeps `effective_date_time >= ''` / `<= ''` filters (value substituted to `''` but not dropped).

- [ ] **Step 3: Add `isBlankValue` and drop blank filters**

In `packages/report-builder/src/render/run-template.ts`, add the helper near the top (after `subst`):

```ts
function isBlankValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0 || v.every((x) => x === null || x === undefined || x === '');
  return false;
}
```

In `resolveQueryParams`, change the builder branch's filter mapping to also drop blanks:

```ts
  if (clone.mode === 'builder') {
    clone.filters = (clone.filters ?? [])
      .map((f) => ({ ...f, value: subst(f.value, params) as never }))
      .filter((f) => !isBlankValue(f.value));
  } else {
```

(The `else` / sql branch is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/render/run-template.test.ts`
Expected: PASS (both new cases + the pre-existing run-template tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/run-template.ts packages/report-builder/src/render/run-template.test.ts
git commit -m "feat(report-builder): drop blank param-filters in resolveQueryParams"
```

---

## Task 2: Percent-column formatting in the table painter

**Files:**
- Modify: `packages/report-builder/src/render/paint.ts`
- Test: `packages/report-builder/src/render/paint.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/report-builder/src/render/paint.test.ts` (add `formatCell` to the existing `./paint` import, or add an import line):

```ts
import { formatCell } from './paint';

describe('formatCell (Slice G)', () => {
  it('formats a percent column value as N.N%', () => {
    expect(formatCell(50, 'percent')).toBe('50.0%');
    expect(formatCell(33.3, 'percent')).toBe('33.3%');
  });
  it('renders a blank/non-numeric percent as empty', () => {
    expect(formatCell(null, 'percent')).toBe('');
    expect(formatCell(undefined, 'percent')).toBe('');
    expect(formatCell('x', 'percent')).toBe('');
  });
  it('renders non-percent columns as string (unchanged)', () => {
    expect(formatCell('Ciprofloxacin')).toBe('Ciprofloxacin');
    expect(formatCell(4, 'number')).toBe('4');
    expect(formatCell(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/render/paint.test.ts`
Expected: FAIL — `formatCell` is not exported.

- [ ] **Step 3: Add `formatCell` and use it + the column `kind` in `drawTable`**

In `packages/report-builder/src/render/paint.ts`, add the exported helper above `drawTable`:

```ts
export function formatCell(value: unknown, kind?: string): string {
  if (kind === 'percent') {
    const n = Number(value);
    return Number.isFinite(n) && value !== '' && value !== null && value !== undefined ? `${n.toFixed(1)}%` : '';
  }
  return String(value ?? '');
}
```

In `drawTable`, change the `columns` projection (currently `result?.columns.map((c) => ({ key: c.key, label: c.label }))`) to carry `kind`, and the row cell render to use `formatCell`. Replace the two lines:

```ts
  const columns = block.columns.length ? block.columns : (result?.columns.map((c) => ({ key: c.key, label: c.label })) ?? []);
```
with
```ts
  const columns: { key: string; label: string; kind?: string }[] = block.columns.length
    ? block.columns
    : (result?.columns.map((c) => ({ key: c.key, label: c.label, kind: c.kind })) ?? []);
```

and
```ts
    columns.forEach((c, i) => doc.text(String(row[c.key] ?? ''), box.x + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
```
with
```ts
    columns.forEach((c, i) => doc.text(formatCell(row[c.key], c.kind), box.x + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
```

(`block.columns` elements are `{ key, label }` — assigning them to the `{ key; label; kind? }[]` type leaves `kind` undefined, so block-defined columns render as plain text, unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/render/paint.test.ts`
Expected: PASS (formatCell cases + pre-existing paint tests stay green — non-percent cells render identically).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/paint.ts packages/report-builder/src/render/paint.test.ts
git commit -m "feat(report-builder): format percent-kind table columns as N.N%"
```

---

## Task 3: The amr-resistance template module (+ end-to-end acceptance)

**Files:**
- Create: `packages/report-builder/src/amr-resistance-template.ts`
- Modify: `packages/report-builder/src/index.ts`
- Test: `packages/report-builder/src/amr-resistance-template.test.ts`

- [ ] **Step 1: Write the failing tests** — create `packages/report-builder/src/amr-resistance-template.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { runBuilderQuery, getModel } from '@openldr/dashboards';
import { ReportTemplateSchema } from './schema';
import type { ReportTemplateStore } from './store';
import { buildAmrResistanceTemplate, seedAmrResistanceTemplate, AMR_RESISTANCE_TEMPLATE_ID } from './amr-resistance-template';
import { resolveQueryParams } from './render/run-template';

function tableSource() {
  const t = buildAmrResistanceTemplate();
  const block = t.rows.flatMap((r) => r.cells.map((c) => c.block)).find((b) => b.kind === 'table')!;
  return (block as { source: unknown }).source;
}

describe('buildAmrResistanceTemplate', () => {
  it('produces a schema-valid published AMR template', () => {
    const t = buildAmrResistanceTemplate();
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    expect(t.id).toBe(AMR_RESISTANCE_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(t.category).toBe('amr');
  });

  it('has a table source with tested/r/i/s conditional counts + a derived %R', () => {
    const src = tableSource() as { metrics: { key: string; derived?: unknown }[] };
    expect(src.metrics.map((m) => m.key)).toEqual(['tested', 'r', 'i', 's', 'percentR']);
    expect(src.metrics.find((m) => m.key === 'percentR')?.derived).toEqual({ numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 });
  });
});

describe('seedAmrResistanceTemplate', () => {
  function fakeStore(existing: unknown = undefined): ReportTemplateStore {
    return {
      list: vi.fn(), get: vi.fn(async () => existing as never),
      create: vi.fn(async (t) => t), update: vi.fn(), remove: vi.fn(),
    } as unknown as ReportTemplateStore;
  }
  it('creates the template when absent (returns 1)', async () => {
    const store = fakeStore(undefined);
    expect(await seedAmrResistanceTemplate(store)).toBe(1);
    expect(store.create).toHaveBeenCalledOnce();
  });
  it('is idempotent when it already exists (returns 0, no create)', async () => {
    const store = fakeStore({ id: AMR_RESISTANCE_TEMPLATE_ID });
    expect(await seedAmrResistanceTemplate(store)).toBe(0);
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe('amr-resistance template end-to-end (Slice G acceptance)', () => {
  it('reproduces amr-resistance numbers incl %R when the query runs', async () => {
    const resolved = resolveQueryParams(tableSource() as never, {}); // unset range → date filters dropped
    const mem = newDb();
    mem.public.none('create table observations (status text, code_text text, interpretation_code text, value_unit text, value_quantity float, effective_date_time text, subject_ref text)');
    mem.public.none(`insert into observations (code_text, interpretation_code) values
      ('Ciprofloxacin','R'),('Ciprofloxacin','R'),('Ciprofloxacin','I'),('Ciprofloxacin','S'),
      ('Gentamicin','R'),('Gentamicin','S'),('Gentamicin','S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<never>;
    const res = await runBuilderQuery(db, getModel('observations')!, resolved as never);
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'tested', 'r', 'i', 's', 'percentR']);
    expect(res.columns.find((c) => c.key === 'percentR')?.kind).toBe('percent');
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Ciprofloxacin', tested: 4, r: 2, i: 1, s: 1, percentR: 50 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Gentamicin', tested: 3, r: 1, i: 0, s: 2, percentR: 33.3 }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/amr-resistance-template.test.ts`
Expected: FAIL — module `./amr-resistance-template` does not exist.

- [ ] **Step 3: Create the template module**

Create `packages/report-builder/src/amr-resistance-template.ts`:

```ts
import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const AMR_RESISTANCE_TEMPLATE_ID = 'rt-amr-resistance';

/**
 * The built-in amr-resistance code report reproduced as an editable, published Report Builder
 * template using the conditional (Slice A) + derived-ratio (Slice B) query model: per antibiotic,
 * R/I/S/tested counts + %R over the `observations` model. An optional date-range parameter binds to
 * the effective-date filters (dropped when unset). Facility filter deferred to the cross-model-join
 * slice. Coexists with the code report.
 */
export function buildAmrResistanceTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: AMR_RESISTANCE_TEMPLATE_ID,
    name: 'AMR Resistance Rate',
    description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'AMR Resistance Rate', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.', style: { italic: true } } }] },
      {
        id: 'r3',
        cells: [{
          colSpan: 12,
          block: {
            kind: 'table',
            columns: [],
            source: {
              mode: 'builder',
              model: 'observations',
              metric: { key: 'tested', label: 'Tested', agg: 'count' },
              metrics: [
                { key: 'tested', label: 'Tested', agg: 'count' },
                { key: 'r', label: 'R', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
                { key: 'i', label: 'I', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] },
                { key: 's', label: 'S', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'S' }] },
                { key: 'percentR', label: '%R', agg: 'count', derived: { numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 } },
              ],
              dimension: { key: 'code_text' },
              filters: [
                { dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] },
                { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
                { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
              ],
            },
          },
        }],
      },
    ],
  });
}

/** Seed the amr-resistance template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedAmrResistanceTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(AMR_RESISTANCE_TEMPLATE_ID)) return 0;
  await store.create(buildAmrResistanceTemplate());
  return 1;
}
```

- [ ] **Step 4: Export the module from the package barrel**

In `packages/report-builder/src/index.ts`, add after the `export * from './sample';` line:

```ts
export * from './amr-resistance-template';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/amr-resistance-template.test.ts`
Expected: PASS — schema-valid, metrics shape, idempotency, AND the end-to-end acceptance (Cipro `%R 50`, Genta `33.3`, `percentR` column kind `percent`). This proves the *seeded template's own query* (run through `resolveQueryParams` + `runBuilderQuery`) reproduces amr-resistance.

- [ ] **Step 6: Typecheck + whole package**

Run: `pnpm --filter @openldr/report-builder exec tsc --noEmit` then `pnpm --filter @openldr/report-builder exec vitest run`
Expected: tsc clean; all report-builder suites green.

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/amr-resistance-template.ts packages/report-builder/src/amr-resistance-template.test.ts packages/report-builder/src/index.ts
git commit -m "feat(report-builder): amr-resistance editable template (%R via derived ratio) + e2e acceptance"
```

---

## Task 4: Wire the seed into bootstrap

**Files:**
- Modify: `packages/bootstrap/src/seed.ts`
- Test: `packages/bootstrap/src/seed.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/bootstrap/src/seed.test.ts` (it already imports `seedDatabase`, `fakeApp`, `fakeDb`, vitest, and `fakeApp()` returns `{ app, reportTemplates, ... }`):

```ts
describe('seedDatabase — report templates', () => {
  it('seeds both report templates on a fresh install, idempotent on reseed', async () => {
    const { app, reportTemplates } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    expect(first.reportTemplatesSeeded).toBe(2);
    expect(reportTemplates.map((r) => r.id).sort()).toEqual(['rt-amr-resistance', 'rt-sample-amr']);
    const second = await seedDatabase(fakeDb, app);
    expect(second.reportTemplatesSeeded).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/seed.test.ts`
Expected: FAIL — only `rt-sample-amr` is seeded, so `reportTemplatesSeeded` is `1` (not `2`) and the id list lacks `rt-amr-resistance`.

- [ ] **Step 3: Wire the second seed call**

In `packages/bootstrap/src/seed.ts`, update the import (line ~5) to add `seedAmrResistanceTemplate`:

```ts
import { seedSampleReportTemplate, seedAmrResistanceTemplate, type ReportTemplateStore } from '@openldr/report-builder';
```

Then in the `try` block that seeds report templates (currently `reportTemplatesSeeded = await seedSampleReportTemplate(app.reportTemplates);`), sum both:

```ts
  let reportTemplatesSeeded = 0;
  try {
    reportTemplatesSeeded = await seedSampleReportTemplate(app.reportTemplates);
    reportTemplatesSeeded += await seedAmrResistanceTemplate(app.reportTemplates);
  } catch (e) {
    console.warn('[seed] report template seed skipped:', e instanceof Error ? e.message : String(e));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/seed.test.ts`
Expected: PASS (new case + all pre-existing seed tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(bootstrap): seed the amr-resistance editable template on fresh install"
```

---

## Task 5: Full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck across all packages**

Run: `pnpm turbo run typecheck --force`
Expected: 31/31 packages PASS. Do NOT pipe through `tail`. (The new export + bootstrap wiring cross package boundaries.)

- [ ] **Step 2: Forced full test run**

Run: `pnpm turbo run test --force`
Expected: PASS across the workspace. Two pre-existing flakes are NOT Slice G regressions and are acceptable: `apps/studio/src/api.test.ts > "includes server error messages…"` (the vitest-dedupe flake, red on `main` identically) and various packages timing out under the 30-package parallel run (they pass in isolation — re-run any failing file with `pnpm --filter <pkg> exec vitest run <file>` to confirm). Any OTHER failure must be fixed.

- [ ] **Step 3: Confirm the Slice G packages are clean**

Run: `pnpm --filter @openldr/report-builder test` and `pnpm --filter @openldr/bootstrap exec vitest run src/seed.test.ts`
Expected: all green (report-builder render + template + acceptance suites; bootstrap seed).

- [ ] **Step 4: Final commit (only if a gate fixup was needed)**

```bash
git add -A
git commit -m "chore(query-model): Slice G gate — forced typecheck + full test green"
```

If Steps 1–3 required no fixups, skip this commit.

---

## Done criteria

- `resolveQueryParams` drops blank-valued filters, so an unset date-range param means "all dates".
- The table painter formats `percent`-kind columns as `"N.N%"`.
- A published `rt-amr-resistance` "AMR Resistance Rate" template is built + seeded on fresh install (idempotent), coexisting with the code report.
- **End-to-end proof:** the seeded template's own table `source`, run through `resolveQueryParams` + `runBuilderQuery`, reproduces amr-resistance numbers including `%R` (Cipro 50.0, Genta 33.3).
- Forced 31-package typecheck + full test green (modulo the two documented pre-existing flakes).

## Follow-ups (not this slice)

- **Slice D** — cross-model joins → add the facility parameter to this template.
- **Slice C** — computed/bucketed dimensions (age-band) → `patient-demographics`.
- Retiring the `amr-resistance` code report once fidelity (incl. facility) is complete.
- A lint rule for dangling derived-metric refs (noted follow-up from Slice B).
