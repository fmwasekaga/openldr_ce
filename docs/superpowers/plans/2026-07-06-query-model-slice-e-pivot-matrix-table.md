# Query-model Slice E — Pivot/Matrix Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a table block whose `source` has a `breakdown` as a pivoted matrix (row dimension × column breakdown × cell metric) via a pure `resultToMatrix` helper wired into both the PDF and canvas table renderers, and seed an Analyte × Interpretation count crosstab.

**Architecture:** A new pure `matrix-data.ts` (`matrixOpts`/`resultToMatrix`/`pivotTableResult`) mirrors `chart-data.ts`. Both the PDF `drawTable` (paint.ts) and the canvas `CanvasBlock` call `pivotTableResult` so they render the identical matrix (anti-drift). The table `source` already accepts a `breakdown` (WidgetQuery schema) → NO schema change. The QueryEditor enables the breakdown dropdown for table blocks.

**Tech Stack:** TypeScript, pdfkit (table painter), React (CanvasBlock/renderWidget), Vitest (pure unit + pg-mem acceptance).

**Build order:** pure pivot helper → PDF painter → canvas render → authoring toggle → seed template → forced gate.

**Pre-existing facts (do not re-derive):**
- `packages/report-builder/src/render/chart-data.ts` — `resultToChartData(result, opts)` pivots a long breakdown result; `firstSeen` + `PivotResult` (`{ columns: {key,label?,kind?}[]; rows: Record<string,unknown>[] }`) + `chartOpts(query)` (returns `{categoryKey:'label',breakdownKey:'series',valueKeys:['value']}` for a builder query with a breakdown). Mirror this file.
- `runBuilderQuery` returns a LONG result `[{label, series, value}]` (columns `label`/`series`/`value`) for a builder query with a `breakdown` (P3b-4). The `label` column carries the row dimension's label.
- PDF `drawTable` (`packages/report-builder/src/render/paint.ts:32-55`): `const result = cell?.result; const columns = block.columns.length ? block.columns : result?.columns.map(...); const rows = result?.rows ?? []`. `drawBlock` calls `drawTable(doc, box, block, cell, bodyBottom)` for `kind:'table'`. `block.source` is `'primary' | WidgetQuery`.
- Canvas `CanvasBlock.tsx:20`: a data table renders `renderWidget(blockToWidgetConfig(block, data.result), data.result)`. `blockToWidgetConfig` (table branch) returns `{...base, type:'table', visual:{}}` — renderWidget uses the RESULT's columns/rows, so passing a pivoted result renders the pivoted columns.
- `QueryEditor.tsx:121` — the breakdown `<select>` is gated `block.kind === 'chart' && models.length > 0`; it excludes the row dimension (`dimensions.filter(d => d.key !== builderQuery.dimension?.key)`) and writes `builderQuery.breakdown`. i18n keys `reportBuilder.query.breakdown`/`breakdownAria`/`none` already exist.
- Seed pattern: `amr-facility-summary-template.ts` + `index.ts` export + `bootstrap/seed.ts` (imports/seeds the templates) + `bootstrap/seed.test.ts` (`seedDatabase — report templates`: asserts `reportTemplatesSeeded` `toBe(4)` + sorted id array `['rt-amr-facility-summary','rt-amr-resistance','rt-patient-demographics','rt-sample-amr']`). The pg-mem acceptance harness (`newDb` from pg-mem, `runBuilderQuery`/`getModel` from `@openldr/dashboards`, `resolveQueryParams` from `./render/run-template`, registers a `replace()` fn) is in `amr-facility-summary-template.test.ts`.
- `packages/report-builder/src/pure.ts` re-exports the render modules (add `matrix-data`).

---

## Task 1: `resultToMatrix` pivot helper

**Files:**
- Create: `packages/report-builder/src/render/matrix-data.ts`
- Modify: `packages/report-builder/src/pure.ts` (export)
- Test: `packages/report-builder/src/render/matrix-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/report-builder/src/render/matrix-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matrixOpts, resultToMatrix, pivotTableResult } from './matrix-data';

const breakdownQuery = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: [] };
const longResult = { columns: [{ key: 'label', label: 'Analyte', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [
  { label: 'Amp', series: 'R', value: 5 }, { label: 'Amp', series: 'S', value: 3 }, { label: 'Cip', series: 'R', value: 2 },
] };

describe('matrixOpts', () => {
  it('returns pivot opts for a builder query with a breakdown', () => {
    expect(matrixOpts(breakdownQuery as any)).toEqual({ rowKey: 'label', colKey: 'series', valueKey: 'value' });
  });
  it('returns null without a breakdown', () => {
    expect(matrixOpts({ mode: 'builder', model: 'x', metric: { key: 'count', agg: 'count' }, filters: [] } as any)).toBeNull();
    expect(matrixOpts(undefined)).toBeNull();
  });
});

describe('resultToMatrix', () => {
  it('pivots long rows into a wide matrix with 0-fill, preserving the row-dim label', () => {
    const m = resultToMatrix(longResult, matrixOpts(breakdownQuery as any)!);
    expect(m.columns.map((c) => c.key)).toEqual(['label', 'R', 'S']);
    expect(m.columns[0].label).toBe('Analyte');
    expect(m.columns[1].kind).toBe('number');
    expect(m.rows).toEqual([{ label: 'Amp', R: 5, S: 3 }, { label: 'Cip', R: 2, S: 0 }]);
  });
});

describe('pivotTableResult', () => {
  it('pivots when the source has a breakdown', () => {
    expect(pivotTableResult(breakdownQuery, longResult).columns.map((c) => c.key)).toEqual(['label', 'R', 'S']);
  });
  it('returns the raw result for a non-breakdown / primary / undefined source', () => {
    expect(pivotTableResult({ mode: 'builder', model: 'x', metric: { key: 'count', agg: 'count' }, filters: [] }, longResult)).toBe(longResult);
    expect(pivotTableResult('primary', longResult)).toBe(longResult);
    expect(pivotTableResult(breakdownQuery, undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- matrix-data.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/report-builder/src/render/matrix-data.ts`:

```ts
import type { WidgetQuery } from '@openldr/dashboards';

export interface MatrixOpts { rowKey: string; colKey: string; valueKey: string }
interface PivotResult { columns: { key: string; label?: string; kind?: string }[]; rows: Record<string, unknown>[] }

function firstSeen(values: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const v of values) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}

/** Pivot opts when the query is a builder query WITH a breakdown (the long [label,series,value] shape). */
export function matrixOpts(query: WidgetQuery | undefined): MatrixOpts | null {
  if (query && query.mode === 'builder' && query.breakdown) return { rowKey: 'label', colKey: 'series', valueKey: 'value' };
  return null;
}

/** Pivot a long [rowKey,colKey,valueKey] result into a wide matrix result (dynamic columns, 0-fill). Pure. */
export function resultToMatrix(result: PivotResult, opts: MatrixOpts): PivotResult {
  const rowLabels = firstSeen(result.rows.map((r) => String(r[opts.rowKey] ?? '')));
  const colNames = firstSeen(result.rows.map((r) => String(r[opts.colKey] ?? '')));
  const cell = new Map<string, unknown>(); // `${row}\0${col}` → value
  for (const r of result.rows) cell.set(`${String(r[opts.rowKey] ?? '')}\0${String(r[opts.colKey] ?? '')}`, r[opts.valueKey] ?? 0);
  const rowCol = result.columns.find((c) => c.key === opts.rowKey);
  const columns = [
    { key: opts.rowKey, label: rowCol?.label ?? opts.rowKey, kind: 'string' },
    ...colNames.map((n) => ({ key: n, label: n, kind: 'number' })),
  ];
  const rows = rowLabels.map((label) => {
    const row: Record<string, unknown> = { [opts.rowKey]: label };
    for (const n of colNames) row[n] = cell.get(`${label}\0${n}`) ?? 0;
    return row;
  });
  return { columns, rows };
}

/** Effective table result: pivoted when `source` is a builder query with a breakdown, else the raw result. */
export function pivotTableResult(source: unknown, result: PivotResult | undefined): PivotResult | undefined {
  if (!result) return result;
  const query = source && source !== 'primary' ? (source as WidgetQuery) : undefined;
  const mo = matrixOpts(query);
  return mo ? resultToMatrix(result, mo) : result;
}
```

In `packages/report-builder/src/pure.ts`, add: `export * from './render/matrix-data';`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- matrix-data.test.ts` → PASS (6 tests). Then `pnpm --filter @openldr/report-builder typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/matrix-data.ts packages/report-builder/src/render/matrix-data.test.ts packages/report-builder/src/pure.ts
git commit -m "feat(report-builder): resultToMatrix pivot helper for matrix tables"
```

---

## Task 2: PDF table painter pivots

**Files:**
- Modify: `packages/report-builder/src/render/paint.ts` (`drawTable`, lines 32-55)
- Test: `packages/report-builder/src/render/paint.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/report-builder/src/render/paint.test.ts` (the file renders blocks to a pdfkit doc and awaits the buffer — reuse its existing render helper + the async `'end'` collection; read the top of the file for the exact `render`/`drawBlock` harness). A robust structural check is hard on PDF bytes, so assert the pivot path is taken by extracting it into a testable seam: this task's REAL correctness is `resultToMatrix` (Task 1) + the pg-mem acceptance (Task 5). Here, assert a pivot table renders a valid, non-trivial PDF without throwing:

```ts
it('renders a matrix table (breakdown source) without throwing', async () => {
  const block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: [] } };
  const cell = { result: { columns: [{ key: 'label', label: 'Analyte', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [ { label: 'Amp', series: 'R', value: 5 }, { label: 'Amp', series: 'S', value: 3 } ] } };
  const buf = await render((doc) => drawBlock(doc, { x: 40, y: 40, w: 400, h: 200 }, block as any, cell as any, {}, 760));
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(500);
});
```

Adapt `render`/`drawBlock`/box-shape to the file's existing helpers (read `paint.test.ts` first — it already tests `drawBlock`/`drawTable` for non-pivot tables; mirror that call shape). If the file has no `render` helper, mirror the one in `charts/index.test.ts` (awaits the pdfkit `'end'` event).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- paint.test.ts`
Expected: with the un-pivoted `drawTable`, the table renders the raw long result (3 columns label/series/value) — the test's `expect %PDF-` would actually PASS even un-pivoted (it doesn't crash). So instead, make the assertion pivot-specific: assert the drawn column COUNT. Since PDF bytes are opaque, the reliable seam is a small refactor (Step 3): extract `tableColumns(block, result)` and unit-test it. Rewrite Step 1's test to import and assert that helper instead:

```ts
import { tableColumns } from './paint';
it('tableColumns pivots a breakdown table source into dynamic columns', () => {
  const block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: [] } };
  const result = { columns: [{ key: 'label', label: 'Analyte', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [ { label: 'Amp', series: 'R', value: 5 }, { label: 'Amp', series: 'S', value: 3 } ] };
  const { columns, rows } = tableColumns(block as any, result as any);
  expect(columns.map((c) => c.key)).toEqual(['label', 'R', 'S']);
  expect(rows).toEqual([{ label: 'Amp', R: 5, S: 3 }]);
});
it('tableColumns uses block.columns for a non-pivot table when set', () => {
  const block = { kind: 'table', columns: [{ key: 'a', label: 'A' }], source: { mode: 'builder', model: 'x', metric: { key: 'count', agg: 'count' }, filters: [] } };
  const result = { columns: [{ key: 'a', label: 'A', kind: 'string' }], rows: [{ a: 'x' }] };
  expect(tableColumns(block as any, result as any).columns).toEqual([{ key: 'a', label: 'A' }]);
});
```

Run → FAIL (`tableColumns` not exported).

- [ ] **Step 3: Implement**

In `packages/report-builder/src/render/paint.ts`, add the import `import { matrixOpts, resultToMatrix } from './matrix-data';` (alongside the existing `./chart-data` import), and extract an EXPORTED pure helper that both computes the effective (possibly pivoted) columns + rows:

```ts
// Effective columns + rows for a table block: pivots a breakdown source into a matrix; else uses
// block.columns (if set) or the raw result columns. Exported for unit testing.
export function tableColumns(block: Extract<Block, { kind: 'table' }>, result: { columns: { key: string; label: string; kind?: string; decimals?: number }[]; rows: Record<string, unknown>[] } | undefined):
  { columns: { key: string; label: string; kind?: string; decimals?: number }[]; rows: Record<string, unknown>[] } {
  const mo = block.source !== 'primary' ? matrixOpts(block.source) : null;
  const eff = mo && result ? resultToMatrix(result, mo) : result;
  const columns = (!mo && block.columns.length)
    ? block.columns
    : (eff?.columns.map((c) => ({ key: c.key, label: c.label ?? c.key, kind: c.kind, decimals: (c as { decimals?: number }).decimals })) ?? []);
  return { columns, rows: eff?.rows ?? [] };
}
```

Then replace the top of `drawTable` (the `columns`/`rows` derivation at lines 34-37) with:

```ts
  const { columns, rows } = tableColumns(block, cell?.result as never);
```

(Keep the rest of `drawTable` — `colW`, `header`, the row loop — unchanged; they already read `columns`/`rows`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- paint.test.ts` → PASS (2 new + existing table tests still green — a non-pivot table with `block.columns` or a plain result is unchanged). Then `pnpm --filter @openldr/report-builder typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/paint.ts packages/report-builder/src/render/paint.test.ts
git commit -m "feat(report-builder): PDF table painter pivots a breakdown source into a matrix"
```

---

## Task 3: Canvas table pivots

**Files:**
- Modify: `apps/studio/src/reports-builder/CanvasBlock.tsx`
- Test: `apps/studio/src/reports-builder/CanvasBlock.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/reports-builder/CanvasBlock.test.tsx` (reuse its render harness + recharts stubs; read the file for its render helper). Assert a table with a breakdown source renders the pivoted (dynamic) columns, not the raw long series column:

```ts
it('renders a table with a breakdown source as a pivoted matrix', () => {
  const block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: [] } };
  const data = { result: { columns: [{ key: 'label', label: 'Analyte', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [ { label: 'Amp', series: 'R', value: 5 }, { label: 'Amp', series: 'S', value: 3 } ] } };
  const { getByText, queryByText } = render(<CanvasBlock block={block as any} data={data as any} />);
  expect(getByText('R')).toBeInTheDocument();     // pivoted breakdown column header
  expect(getByText('S')).toBeInTheDocument();
  expect(queryByText('series')).not.toBeInTheDocument(); // NOT the raw long-result column
});
```

(If `renderWidget`'s table output doesn't surface headers as plain text, adapt the assertion to how the dashboards table widget renders column labels — read `../dashboard/widgets` / an existing table-widget test to see the DOM. The intent: the pivoted `R`/`S` columns appear, the raw `series` column does not.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- CanvasBlock.test.tsx`
Expected: FAIL — the raw long result renders a `series` column, not pivoted `R`/`S`.

- [ ] **Step 3: Implement**

In `apps/studio/src/reports-builder/CanvasBlock.tsx`, import `pivotTableResult` from `@openldr/report-builder/pure` (alongside `resultToChartData`), and change the data-table render (line 20) to pivot first:

```tsx
      // (inside `if (data.result)`, after the chart branch)
      const tableResult = block.kind === 'table' ? pivotTableResult(block.source, data.result) : data.result;
      return <div className="h-full w-full">{renderWidget(blockToWidgetConfig(block, tableResult), tableResult)}</div>;
```

(Only the table path changes; kpi still passes `data.result`. If TS narrows awkwardly, compute `tableResult` with a small guard as shown.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- CanvasBlock.test.tsx` → PASS (new + existing green). Then `pnpm --filter @openldr/studio typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/CanvasBlock.tsx apps/studio/src/reports-builder/CanvasBlock.test.tsx
git commit -m "feat(studio): canvas renders a breakdown table source as a pivoted matrix"
```

---

## Task 4: Enable the breakdown dropdown for table blocks

**Files:**
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx` (~line 121)
- Test: `apps/studio/src/reports-builder/QueryEditor.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/reports-builder/QueryEditor.test.tsx` (reuse the file's render harness + `../api` `listModels` mock — the mock has models with dimensions):

```ts
it('shows the breakdown dropdown for a table block (pivot/matrix)', async () => {
  const block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, filters: [] } };
  renderQueryEditor({ block, onChange: vi.fn() }); // use the file's actual render helper/signature
  expect(await screen.findByLabelText(/breakdown/i)).toBeInTheDocument();
});
```

Ensure the `../api` `listModels` mock includes an `observations` model with a `code_text` (and another) dimension so the dropdown has options. Adapt `renderQueryEditor` to the file's real helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- QueryEditor.test.tsx`
Expected: FAIL — the breakdown dropdown is chart-only.

- [ ] **Step 3: Implement**

In `apps/studio/src/reports-builder/QueryEditor.tsx:121`, change the breakdown block's guard from `block.kind === 'chart' && models.length > 0` to:

```tsx
          {(block.kind === 'chart' || block.kind === 'table') && models.length > 0 && (
```

(Leave the rest of the breakdown `<label>`/`<select>` unchanged — it already excludes the row dimension and writes `builderQuery.breakdown`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- QueryEditor.test.tsx` → PASS (new + existing green). Then `pnpm --filter @openldr/studio typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/reports-builder/QueryEditor.test.tsx
git commit -m "feat(studio): enable the breakdown dropdown for table blocks (pivot/matrix)"
```

---

## Task 5: Seed the Analyte × Interpretation crosstab template

**Files:**
- Create: `packages/report-builder/src/analyte-interpretation-template.ts`
- Modify: `packages/report-builder/src/index.ts` (export)
- Modify: `packages/bootstrap/src/seed.ts` (import + seed call)
- Modify: `packages/bootstrap/src/seed.test.ts` (count 4→5 + id array)
- Test: `packages/report-builder/src/analyte-interpretation-template.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/report-builder/src/analyte-interpretation-template.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAnalyteInterpretationTemplate, ANALYTE_INTERPRETATION_TEMPLATE_ID } from './analyte-interpretation-template';
import { ReportTemplateSchema } from './schema';
import { lintReportTemplate } from './lint';

describe('analyte-interpretation crosstab template', () => {
  it('builds a schema-valid, published, lint-clean pivot table (dimension + breakdown)', () => {
    const t = buildAnalyteInterpretationTemplate();
    expect(t.id).toBe(ANALYTE_INTERPRETATION_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    const issues = lintReportTemplate(t);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.dimension).toEqual({ key: 'code_text' });
    expect(src.breakdown).toEqual({ key: 'interpretation_code' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- analyte-interpretation-template.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the template**

Create `packages/report-builder/src/analyte-interpretation-template.ts` (mirror `amr-facility-summary-template.ts`):

```ts
import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const ANALYTE_INTERPRETATION_TEMPLATE_ID = 'rt-analyte-interpretation';

const dateFilters = [
  { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
  { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
];

/**
 * A pivot/matrix crosstab (Slice E): per analyte (code_text) row, one column per interpretation
 * (R/I/S) with the count as the cell. Renders via resultToMatrix (dimension=row, breakdown=column,
 * single metric=cell). An antibiogram-adjacent resistance profile; the FAITHFUL amr-antibiogram
 * (organism dimension + %R cell + first-isolate) is deferred. Coexists.
 */
export function buildAnalyteInterpretationTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: ANALYTE_INTERPRETATION_TEMPLATE_ID,
    name: 'Analyte × Interpretation',
    description: 'Result counts per analyte, broken down by interpretation (R/I/S).',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Analyte × Interpretation', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Result counts per analyte, broken down by interpretation (R/I/S).', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: {
        kind: 'table', columns: [],
        source: { mode: 'builder', model: 'observations',
          metric: { key: 'count', label: 'Count', agg: 'count' },
          dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: dateFilters } } }] },
    ],
  });
}

/** Seed the analyte-interpretation template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedAnalyteInterpretationTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(ANALYTE_INTERPRETATION_TEMPLATE_ID)) return 0;
  await store.create(buildAnalyteInterpretationTemplate());
  return 1;
}
```

- [ ] **Step 4: Export + wire the seed**

In `packages/report-builder/src/index.ts`: `export * from './analyte-interpretation-template';`

In `packages/bootstrap/src/seed.ts`: extend the report-builder import with `seedAnalyteInterpretationTemplate`, and add after the amr-facility-summary seed line:

```ts
    reportTemplatesSeeded += await seedAnalyteInterpretationTemplate(app.reportTemplates);
```

In `packages/bootstrap/src/seed.test.ts` (`seedDatabase — report templates` block): change `toBe(4)` → `toBe(5)`, and update the sorted id array to `['rt-amr-facility-summary','rt-amr-resistance','rt-analyte-interpretation','rt-patient-demographics','rt-sample-amr']` (`rt-analyte-interpretation` sorts after the `rt-amr-*` ids, before `rt-patient-demographics`). The reseed `toBe(0)` stays.

- [ ] **Step 5: Add a pg-mem crosstab acceptance test**

Mirror `amr-facility-summary-template.test.ts`'s pg-mem harness (`newDb`, `runBuilderQuery`/`getModel` from `@openldr/dashboards`, `resolveQueryParams` from `./render/run-template`, register a `replace` fn if the query needs it — this crosstab has NO join so no `replace` is needed). In `analyte-interpretation-template.test.ts`, add a test that: creates pg-mem with an `observations` table (`code_text`, `interpretation_code`, `effective_date_time`); inserts rows across ≥2 analytes with mixed R/I/S (e.g. Amp: 2 R + 1 S; Cip: 1 R + 1 I); runs the table `source` through `resolveQueryParams(src, {})` then `runBuilderQuery` (→ long `[label, series, value]`) then `resultToMatrix(longResult, matrixOpts(src)!)`; asserts the pivoted matrix rows have the right per-analyte R/I/S counts with 0-fill (e.g. `{ label: 'Amp', R: 2, S: 1 }` with `I: 0`, `{ label: 'Cip', R: 1, I: 1 }` with `S: 0`). Import `resultToMatrix`/`matrixOpts` from `./render/matrix-data`.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @openldr/report-builder test -- analyte-interpretation-template.test.ts` → PASS (build/lint + pg-mem crosstab). Then `pnpm --filter @openldr/report-builder typecheck` + `pnpm --filter @openldr/bootstrap typecheck` → clean, and `pnpm --filter @openldr/bootstrap test` → the seed test (now toBe(5)) green.

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/analyte-interpretation-template.ts packages/report-builder/src/analyte-interpretation-template.test.ts packages/report-builder/src/index.ts packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(report-builder): seed Analyte x Interpretation pivot crosstab template"
```

---

## Task 6: Forced full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: `31 successful, 31 total`. Never pipe turbo through `tail`.

- [ ] **Step 2: Forced tests**

Run: `pnpm turbo run test --force`
Expected: green except the known pre-existing flakes — studio `api.test.ts` (vitest-dedupe) and parallel-load timeouts (plugins/users/workflows that pass in isolation). Re-run any red package in isolation to confirm. A genuine failure in report-builder/studio/bootstrap touched code is a regression — fix it.

- [ ] **Step 3: Commit (only if a gate fix was needed)**

```bash
git add -A && git commit -m "fix: resolve cross-package gate breakage from pivot matrix table"
```

---

## Post-plan: review + finish

After Task 6: final holistic review, then `finishing-a-development-branch` (merge `--no-ff` to local `main`, delete branch, update memory `query-model-expansion-workstream`). Live check (dev stack, if up): open `/reports/builder/rt-analyte-interpretation` and confirm the matrix (analytes × R/I/S) renders on the canvas + Preview PDF.

---

## Self-review notes (checked against the spec)

- **Spec §Part 1 resultToMatrix** → Task 1. **§Part 2 renderer (PDF + canvas)** → Tasks 2 + 3. **§Part 3 authoring toggle** → Task 4. **§Part 4 seed** → Task 5. **§testing/gate** → per-task + Task 6.
- **Anti-drift**: both the PDF painter (Task 2, via `tableColumns` → `resultToMatrix`) and the canvas (Task 3, via `pivotTableResult` → `resultToMatrix`) pivot through the same `matrix-data.ts` helpers.
- **No schema change**: the table `source` already accepts `breakdown`; no task touches the schema.
- **Backward-compat**: `matrixOpts` returns null without a breakdown → `tableColumns`/`pivotTableResult` return the raw result → non-pivot tables byte-identical (Task 2 test locks the block.columns path; existing table tests stay green).
- **Type consistency**: `matrixOpts`/`resultToMatrix`/`pivotTableResult` defined in Task 1, used in Tasks 2/3/5. `tableColumns` defined + used in Task 2. `ANALYTE_INTERPRETATION_TEMPLATE_ID`/`build…`/`seed…` consistent in Task 5. Seed count 4→5 + id array consistent.
- **Deferred** (amr-antibiogram: organism + %R cell + first-isolate) noted in the template docstring (Task 5) — matches spec non-goals.
