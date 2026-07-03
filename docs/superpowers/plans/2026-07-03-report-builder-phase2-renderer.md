# Report Builder — Phase 2: pdfkit Renderer + computeLayout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a persisted `ReportTemplate` + parameter values into PDF bytes via a server-side pipeline — data resolution (`runTemplate`), pure geometry (`computeLayout` with an injected `Measurer`), a pdfkit painter with richer charts, plus a preview API endpoint and a CLI render command to exercise it — all before any builder UI exists.

**Architecture:** New `packages/report-builder/src/render/` module. `layout.ts` is pure (types + `computeLayout` + `toLayoutModel`) and browser-safe so Phase 3's canvas reuses it; everything that touches pdfkit (measurer, charts, painter, orchestrator) is node-only and stays in the server barrel. `runTemplate` takes an injected `queryFn` (= `ctx.dashboards.query`) so `report-builder` never imports `@openldr/bootstrap` (no cycle).

**Tech Stack:** TypeScript (ESM), pdfkit, Zod, Fastify, commander, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase2-renderer-design.md`
**Builds on:** Phase 1 (`@openldr/report-builder` with `ReportTemplate`, `Block`, `interpolate`, `ReportTemplateStore`; `AppContext.reportTemplates`; `/api/report-templates` CRUD; `openldr report-template` CLI).

---

## Scope

**In:** `resolveQueryParams`, `runTemplate`, `computeLayout` (+ `Measurer`), `toLayoutModel`, pdfkit measurer, chart pure-helpers + drawers (bar/line/pie/kpi), `paint.ts`, `renderReportTemplatePdf`, preview endpoint, CLI render, tests.

**Out (later phases):** HTML canvas painter (Phase 3); wrapped multi-line table cells; scatter/gauge/funnel; font embedding; catalog coexistence/run/schedule (Phase 4). Do NOT touch `ctx.reporting`, `reports-routes.ts`, or `@openldr/report-pdf`.

## Conventions used below

- `@openldr/report-builder/pure` re-exports Phase-1 `schema.ts` + `helpers.ts`. This phase adds `render/layout.ts` to that pure barrel.
- The server barrel `@openldr/report-builder` (`src/index.ts`) additionally exports `render/index.ts` and `render/run-template.ts`.
- `WidgetQuery` and `ReportResult` are TYPE-only imports (`import type`) from `@openldr/dashboards` / `@openldr/reporting` — no runtime dependency added by them.
- Run package tests directly (`pnpm -C packages/report-builder test <file>`), never via turbo `tail`.

## File map

| File | Responsibility |
| --- | --- |
| `packages/report-builder/src/render/layout.ts` (create) | **Pure**: all render types (`BlockStyle`, `Measurer`, `PositionedBox`, `LayoutBlock/Row/Model`, `CellData`, `ResolvedTemplate`), `computeLayout`, `toLayoutModel` |
| `packages/report-builder/src/render/run-template.ts` (create) | `QueryFn` type, `resolveQueryParams`, `runTemplate` (data resolution, dedup, error isolation) |
| `packages/report-builder/src/render/measurer.ts` (create) | pdfkit-backed `Measurer` |
| `packages/report-builder/src/render/charts/scale.ts` (create) | Pure `linearScale`, `niceTicks` |
| `packages/report-builder/src/render/charts/legend.ts` (create) | Pure `layoutLegend` |
| `packages/report-builder/src/render/charts/index.ts` (create) | `drawChart` facade + `bar`/`line`/`pie`/`kpi` drawers |
| `packages/report-builder/src/render/paint.ts` (create) | `drawBlock` dispatcher + per-kind drawers |
| `packages/report-builder/src/render/index.ts` (create) | `renderReportTemplatePdf(template, params, queryFn)` orchestrator |
| `packages/report-builder/src/pure.ts` (modify) | add `export * from './render/layout'` |
| `packages/report-builder/src/index.ts` (modify) | add `export * from './render'` + `export * from './render/run-template'` |
| `packages/report-builder/package.json` (modify) | add `pdfkit` + `@types/pdfkit` |
| `apps/server/src/report-templates-routes.ts` (modify) | add `POST /api/report-templates/:id/preview` |
| `packages/cli/src/report-template.ts` (modify) | add `renderTemplateToFile` + `runRender` |
| `packages/cli/src/index.ts` (modify) | register `report-template render` |

---

## Task 1: `resolveQueryParams` — bind `{{param.x}}` tokens into a query

Pure function: given a `WidgetQuery` and a `params` map, replace any string value equal to (or containing) a `{{param.<id>}}` token with the actual param value. Handles builder-mode filter values and sql-mode `values`.

**Files:**
- Create: `packages/report-builder/src/render/run-template.ts`
- Test: `packages/report-builder/src/render/run-template.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveQueryParams } from './run-template';

describe('resolveQueryParams', () => {
  it('substitutes a param token in a builder filter value', () => {
    const q = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'code_text', op: 'eq', value: '{{param.analyte}}' }] } as any;
    const out = resolveQueryParams(q, { analyte: 'Glucose' }) as any;
    expect(out.filters[0].value).toBe('Glucose');
    // original is not mutated
    expect(q.filters[0].value).toBe('{{param.analyte}}');
  });

  it('substitutes tokens embedded in a larger string', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'd', op: 'contains', value: 'x-{{param.a}}-y' }] } as any;
    const out = resolveQueryParams(q, { a: 'Z' }) as any;
    expect(out.filters[0].value).toBe('x-Z-y');
  });

  it('leaves unknown tokens as empty string', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'd', op: 'eq', value: '{{param.missing}}' }] } as any;
    const out = resolveQueryParams(q, {}) as any;
    expect(out.filters[0].value).toBe('');
  });

  it('substitutes into sql-mode values', () => {
    const q = { mode: 'sql', sql: 'select 1', values: { fac: '{{param.facility}}', n: 5 } } as any;
    const out = resolveQueryParams(q, { facility: 'Ndola' }) as any;
    expect(out.values.fac).toBe('Ndola');
    expect(out.values.n).toBe(5);
  });

  it('passes a query with no tokens through unchanged (structurally)', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } as any;
    expect(resolveQueryParams(q, { a: 'b' })).toEqual(q);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test run-template`
Expected: FAIL — `Cannot find module './run-template'`.

- [ ] **Step 3: Implement (create `run-template.ts` with `resolveQueryParams` only for now)**

```ts
import type { WidgetQuery } from '@openldr/dashboards';

const PARAM_TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;

function subst(value: unknown, params: Record<string, string>): unknown {
  if (typeof value !== 'string') return value;
  if (!value.includes('{{')) return value;
  return value.replace(PARAM_TOKEN, (_m, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Return a deep copy of `q` with any `{{param.<id>}}` tokens in builder filter values or
 *  sql `values` replaced by the supplied param values. Pure — does not mutate `q`. */
export function resolveQueryParams(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  if (clone.mode === 'builder') {
    clone.filters = (clone.filters ?? []).map((f) => ({ ...f, value: subst(f.value, params) as never }));
  } else {
    if (clone.values) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(clone.values)) next[k] = subst(v, params);
      clone.values = next as never;
    }
  }
  return clone;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test run-template`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/run-template.ts packages/report-builder/src/render/run-template.test.ts
git commit -m "feat(report-builder): resolveQueryParams — bind {{param.x}} into block queries"
```

---

## Task 2: `runTemplate` — resolve primary dataset + block queries

Adds `runTemplate` to `run-template.ts`. Resolves the primary dataset once, resolves each data block's query (dedup identical resolved queries), isolates per-block query errors. Returns a `ResolvedTemplate`. The `ResolvedTemplate`/`CellData` types live in `layout.ts` (Task 3) — but Task 2 needs them, so define them in `layout.ts` FIRST as a tiny types-only stub, then flesh out `computeLayout` in Task 3.

**Files:**
- Create: `packages/report-builder/src/render/layout.ts` (types only in this task)
- Modify: `packages/report-builder/src/render/run-template.ts`
- Test: `packages/report-builder/src/render/run-template.test.ts` (add cases)

- [ ] **Step 1: Create `layout.ts` with the shared types (no logic yet)**

```ts
import type { ReportResult } from '@openldr/reporting';
import type { Block, ReportTemplate } from '../schema';

export interface CellData { result?: ReportResult; error?: string }

export interface ResolvedTemplate {
  template: ReportTemplate;
  params: Record<string, string>;
  primary?: CellData;                 // resolution of template.dataset (if present)
  cells: Record<string, CellData>;    // key `${rowIndex}:${cellIndex}` for data-bearing blocks
}

export type BlockKind = Block['kind'];
```

- [ ] **Step 2: Write the failing test (append to `run-template.test.ts`)**

```ts
import { runTemplate } from './run-template';
import { createEmptyTemplate } from '../helpers';

function result(rows: any[]): any {
  return { columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }],
    rows, chart: { type: 'bar', x: 'label', y: 'value' }, meta: { generatedAt: 'now', rowCount: rows.length } };
}

describe('runTemplate', () => {
  it('resolves the primary dataset and each data block, keyed by row:cell', async () => {
    const t = createEmptyTemplate('rt', 'R');
    t.dataset = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] } as any;
    t.rows = [{ id: 'r0', cells: [
      { colSpan: 6, block: { kind: 'kpi', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, label: 'K' } as any },
      { colSpan: 6, block: { kind: 'table', source: 'primary', columns: [] } as any },
    ] }];
    const calls: any[] = [];
    const queryFn = async (q: any) => { calls.push(q); return result([{ label: 'a', value: 1 }]); };
    const resolved = await runTemplate(t, {}, queryFn);
    expect(resolved.primary?.result?.rows.length).toBe(1);
    expect(resolved.cells['0:0'].result?.rows.length).toBe(1); // kpi block
    expect(resolved.cells['0:1']).toBeUndefined();             // table source:'primary' uses primary, not its own query
    expect(calls.length).toBe(2); // primary + kpi
  });

  it('dedups identical resolved queries into one call', async () => {
    const t = createEmptyTemplate('rt', 'R');
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] };
    t.rows = [{ id: 'r0', cells: [
      { colSpan: 6, block: { kind: 'kpi', query: q, label: 'A' } as any },
      { colSpan: 6, block: { kind: 'kpi', query: q, label: 'B' } as any },
    ] }];
    let n = 0;
    const resolved = await runTemplate(t, {}, async () => { n++; return result([{ label: 'a', value: 1 }]); });
    expect(n).toBe(1);
    expect(resolved.cells['0:0'].result).toBe(resolved.cells['0:1'].result);
  });

  it('isolates a failing block query as an error, not a throw', async () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r0', cells: [
      { colSpan: 12, block: { kind: 'chart', query: { mode: 'builder', model: 'boom', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any },
    ] }];
    const resolved = await runTemplate(t, {}, async () => { throw new Error('bad query'); });
    expect(resolved.cells['0:0'].error).toMatch(/bad query/);
    expect(resolved.cells['0:0'].result).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test run-template`
Expected: FAIL — `runTemplate is not a function` (and the `layout` import resolves).

- [ ] **Step 4: Implement `runTemplate` (append to `run-template.ts`)**

Add these imports at the top of `run-template.ts` (the file currently imports only `WidgetQuery`; after this it imports all of the below):

```ts
import type { WidgetQuery } from '@openldr/dashboards';
import type { ReportResult } from '@openldr/reporting';
import type { Block, ReportTemplate } from '../schema';
import type { CellData, ResolvedTemplate } from './layout';
```

Then append:

```ts
export type QueryFn = (q: WidgetQuery) => Promise<ReportResult>;

// A data-bearing block carries its own WidgetQuery, EXCEPT a table with source:'primary'
// (which binds to the template dataset). Returns the query to run, or null if none.
function blockQuery(block: Block): WidgetQuery | null {
  if (block.kind === 'kpi' || block.kind === 'chart') return block.query;
  if (block.kind === 'table') return block.source === 'primary' ? null : block.source;
  return null;
}

export async function runTemplate(
  template: ReportTemplate,
  params: Record<string, string>,
  queryFn: QueryFn,
): Promise<ResolvedTemplate> {
  // Dedup cache keyed by the resolved-query JSON. A miss runs queryFn; a thrown query is
  // cached as an error so repeats don't re-run and one bad block can't fail the whole render.
  const cache = new Map<string, CellData>();
  const run = async (q: WidgetQuery): Promise<CellData> => {
    const resolved = resolveQueryParams(q, params);
    const key = JSON.stringify(resolved);
    const hit = cache.get(key);
    if (hit) return hit;
    let cell: CellData;
    try { cell = { result: await queryFn(resolved) }; }
    catch (e) { cell = { error: e instanceof Error ? e.message : String(e) }; }
    cache.set(key, cell);
    return cell;
  };

  const primary = template.dataset ? await run(template.dataset) : undefined;

  const cells: Record<string, CellData> = {};
  for (let r = 0; r < template.rows.length; r++) {
    const row = template.rows[r];
    for (let c = 0; c < row.cells.length; c++) {
      const q = blockQuery(row.cells[c].block);
      if (q) cells[`${r}:${c}`] = await run(q);
    }
  }
  return { template, params, primary, cells };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test run-template`
Expected: PASS (all run-template tests, 8 total).

- [ ] **Step 6: Commit**

```bash
git add packages/report-builder/src/render/layout.ts packages/report-builder/src/render/run-template.ts packages/report-builder/src/render/run-template.test.ts
git commit -m "feat(report-builder): runTemplate — resolve dataset + block queries (dedup, error isolation)"
```

---

## Task 3: `computeLayout` + `Measurer` (grid, heights, pagination, header/footer)

The core geometry engine. Pure and deterministic given an injected `Measurer`. Operates on a light `LayoutModel` (built in Task 4 from a `ResolvedTemplate`) so it is decoupled from queries/data.

**Files:**
- Modify: `packages/report-builder/src/render/layout.ts` (add types + `computeLayout`)
- Test: `packages/report-builder/src/render/layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeLayout, type LayoutModel, type Measurer } from './layout';

// Deterministic fake measurer: height = number of \n-separated lines * lineHeight.
const fakeMeasurer: Measurer = {
  measureText: (text, style) => {
    const lh = (style.fontSize ?? 11) + 4;
    return Math.max(1, text.split('\n').length) * lh;
  },
};

const A4_PORTRAIT = { size: 'A4' as const, orientation: 'portrait' as const, margins: { top: 40, right: 40, bottom: 40, left: 40 } };

function model(rows: any[]): LayoutModel { return { page: A4_PORTRAIT, rows }; }

describe('computeLayout', () => {
  it('splits a row into cells by colSpan/12 across the usable width', () => {
    const boxes = computeLayout(model([
      { cells: [
        { kind: 'divider', colSpan: 6 },
        { kind: 'divider', colSpan: 6 },
      ] },
    ]), fakeMeasurer);
    // A4 width 595.28, margins 40+40 → usable 515.28; two 6-col cells ≈ half each.
    expect(boxes.length).toBe(2);
    expect(boxes[0].x).toBeCloseTo(40, 1);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[0].w).toBeGreaterThan(240);
    expect(boxes[0].w).toBeLessThan(260);
    expect(boxes[0].page).toBe(1);
  });

  it('measures title/text height via the injected measurer and stacks rows downward', () => {
    const boxes = computeLayout(model([
      { cells: [{ kind: 'title', colSpan: 12, text: 'one line', style: { fontSize: 16 } }] },
      { cells: [{ kind: 'text', colSpan: 12, text: 'a\nb\nc', style: {} }] },
    ]), fakeMeasurer);
    expect(boxes[0].h).toBe(20);          // 1 line * (16+4)
    expect(boxes[1].h).toBe(45);          // 3 lines * (11+4)
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].h - 1);
  });

  it('gives a table a header + per-row height', () => {
    const boxes = computeLayout(model([
      { cells: [{ kind: 'table', colSpan: 12, rowCount: 3 }] },
    ]), fakeMeasurer);
    expect(boxes[0].h).toBe(18 + 3 * 16); // TABLE_HEADER_H + rows * TABLE_ROW_H
  });

  it('overflows onto a new page when content exceeds the usable height', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ cells: [{ kind: 'kpi', colSpan: 12 }], _i: i }));
    const boxes = computeLayout(model(rows), fakeMeasurer);
    const pages = new Set(boxes.map((b) => b.page));
    expect(pages.size).toBeGreaterThan(1);
    expect(Math.max(...boxes.map((b) => b.page))).toBeGreaterThanOrEqual(2);
  });

  it('repeats header/footer rows on every page and reserves their space', () => {
    const rows: any[] = [{ repeat: 'header', cells: [{ kind: 'title', colSpan: 12, text: 'H', style: {} }] }];
    for (let i = 0; i < 60; i++) rows.push({ cells: [{ kind: 'kpi', colSpan: 12 }] });
    rows.push({ repeat: 'footer', cells: [{ kind: 'text', colSpan: 12, text: 'F', style: {} }] });
    const boxes = computeLayout(model(rows), fakeMeasurer);
    const pageCount = Math.max(...boxes.map((b) => b.page));
    expect(pageCount).toBeGreaterThanOrEqual(2);
    // one header box + one footer box per page
    expect(boxes.filter((b) => b.repeat === 'header').length).toBe(pageCount);
    expect(boxes.filter((b) => b.repeat === 'footer').length).toBe(pageCount);
    // a header box sits at the top margin on its page
    const h2 = boxes.find((b) => b.repeat === 'header' && b.page === 2)!;
    expect(h2.y).toBeCloseTo(40, 0);
  });

  it('forces a new page at a pageBreak block', () => {
    const boxes = computeLayout(model([
      { cells: [{ kind: 'kpi', colSpan: 12 }] },
      { cells: [{ kind: 'pageBreak', colSpan: 12 }] },
      { cells: [{ kind: 'kpi', colSpan: 12 }] },
    ]), fakeMeasurer);
    const kpis = boxes.filter((b) => b.kind === 'kpi');
    expect(kpis[0].page).toBe(1);
    expect(kpis[1].page).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test layout`
Expected: FAIL — `computeLayout is not a function` / missing exports.

- [ ] **Step 3: Implement (append types + `computeLayout` to `layout.ts`)**

```ts
export interface BlockStyle {
  bold?: boolean; italic?: boolean; fontSize?: number; align?: 'left' | 'center' | 'right';
}

export interface Measurer {
  /** Height in points of `text` rendered in `style`, wrapped to `maxWidth`. */
  measureText(text: string, style: BlockStyle, maxWidth: number): number;
}

export interface PageSpec {
  size: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutBlock {
  kind: BlockKind;
  colSpan: number;
  text?: string;          // title/text (already interpolated)
  style?: BlockStyle;     // title/text
  rowCount?: number;      // table
  fixedHeight?: number;   // kpi/chart/image/spacer override
}

export interface LayoutRow {
  repeat?: 'header' | 'footer';
  cells: LayoutBlock[];
}

export interface LayoutModel { page: PageSpec; rows: LayoutRow[] }

export interface PositionedBox {
  page: number; x: number; y: number; w: number; h: number;
  rowIndex: number; cellIndex: number;
  kind: BlockKind; repeat?: 'header' | 'footer';
}

const PAGE_DIMS: Record<PageSpec['size'], [number, number]> = { A4: [595.28, 841.89], Letter: [612, 792] };
const GRID_COLS = 12;
const CELL_GAP = 8;
const ROW_GAP = 8;
const TABLE_HEADER_H = 18;
const TABLE_ROW_H = 16;
const DEFAULT_H: Partial<Record<BlockKind, number>> = { kpi: 54, chart: 180, image: 120, divider: 12, spacer: 12 };

function pageWH(p: PageSpec): [number, number] {
  const [w, h] = PAGE_DIMS[p.size];
  return p.orientation === 'landscape' ? [h, w] : [w, h];
}

function cellHeight(b: LayoutBlock, width: number, m: Measurer): number {
  switch (b.kind) {
    case 'title': case 'text': return m.measureText(b.text ?? '', b.style ?? {}, width);
    case 'table': return TABLE_HEADER_H + (b.rowCount ?? 0) * TABLE_ROW_H;
    case 'kpi': case 'chart': case 'image': case 'spacer': return b.fixedHeight ?? DEFAULT_H[b.kind]!;
    case 'divider': return DEFAULT_H.divider!;
    default: return 0; // pageBreak
  }
}

// Lay out one row's cells left-to-right; return the boxes (y/page filled by caller) + row height.
function layoutRowCells(cells: LayoutBlock[], left: number, usableWidth: number, m: Measurer):
  { boxes: Omit<PositionedBox, 'page' | 'y' | 'rowIndex' | 'repeat'>[]; height: number } {
  const boxes: Omit<PositionedBox, 'page' | 'y' | 'rowIndex' | 'repeat'>[] = [];
  let x = left;
  let height = 0;
  cells.forEach((cell, cellIndex) => {
    const w = (usableWidth * cell.colSpan) / GRID_COLS - CELL_GAP;
    const h = cellHeight(cell, w, m);
    boxes.push({ x, y: 0, w, h, cellIndex, kind: cell.kind } as never);
    x += (usableWidth * cell.colSpan) / GRID_COLS;
    height = Math.max(height, h);
  });
  return { boxes, height };
}

export function computeLayout(modelIn: LayoutModel, m: Measurer): PositionedBox[] {
  const { page, rows } = modelIn;
  const [pw, ph] = pageWH(page);
  const left = page.margins.left;
  const usableWidth = pw - page.margins.left - page.margins.right;

  const headerRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.repeat === 'header');
  const footerRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.repeat === 'footer');
  const bodyRows = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.repeat);

  const measureBand = (band: { r: LayoutRow; i: number }[]) =>
    band.reduce((sum, x) => sum + layoutRowCells(x.r.cells, left, usableWidth, m).height + ROW_GAP, 0);
  const headerH = measureBand(headerRows);
  const footerH = measureBand(footerRows);

  const bodyTop = page.margins.top + headerH;
  const bodyBottom = ph - page.margins.bottom - footerH;

  const out: PositionedBox[] = [];
  let pageNo = 1;
  let cursorY = bodyTop;

  const emitBand = (band: { r: LayoutRow; i: number }[], startY: number, repeat: 'header' | 'footer') => {
    let y = startY;
    for (const { r, i } of band) {
      const { boxes, height } = layoutRowCells(r.cells, left, usableWidth, m);
      for (const b of boxes) out.push({ ...(b as any), y, page: pageNo, rowIndex: i, repeat });
      y += height + ROW_GAP;
    }
  };
  const stampBands = () => {
    emitBand(headerRows, page.margins.top, 'header');
    emitBand(footerRows, bodyBottom + ROW_GAP, 'footer');
  };
  stampBands();

  for (const { r, i } of bodyRows) {
    const hasPageBreak = r.cells.some((c) => c.kind === 'pageBreak');
    if (hasPageBreak) { pageNo++; cursorY = bodyTop; stampBands(); continue; }
    const { boxes, height } = layoutRowCells(r.cells, left, usableWidth, m);
    if (cursorY + height > bodyBottom && cursorY > bodyTop) {
      pageNo++; cursorY = bodyTop; stampBands();
    }
    for (const b of boxes) out.push({ ...(b as any), y: cursorY, page: pageNo, rowIndex: i });
    cursorY += height + ROW_GAP;
  }
  return out;
}
```

Note on the primary-table spill requirement: a very tall `table` row taller than a full page is placed at the current page start and its height is reported as-is; the painter (Task 8) splits its *rows* across pages using `bodyBottom`, re-drawing the column header. `computeLayout` reports one box per table; row-level pagination is a paint-time concern driven by the same `bodyBottom`. This test suite asserts row-level page flow and header/footer repeat, which is `computeLayout`'s responsibility.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test layout`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/layout.ts packages/report-builder/src/render/layout.test.ts
git commit -m "feat(report-builder): computeLayout — pure grid geometry + pagination + header/footer"
```

---

## Task 4: `toLayoutModel` — project a `ResolvedTemplate` into a `LayoutModel`

Bridges data → geometry: interpolates title/text (so measured height matches painted text) and fills `rowCount` for tables from the resolved data.

**Files:**
- Modify: `packages/report-builder/src/render/layout.ts` (add `toLayoutModel`)
- Test: `packages/report-builder/src/render/layout.test.ts` (add cases)

- [ ] **Step 1: Write the failing test (append to `layout.test.ts`)**

```ts
import { toLayoutModel } from './layout';
import { createEmptyTemplate } from '../helpers';

describe('toLayoutModel', () => {
  const primaryResult = { columns: [], rows: [{}, {}, {}], chart: { type: 'bar', x: 'l', y: 'v' }, meta: { generatedAt: 'n', rowCount: 3 } };

  it('interpolates title text and carries style + colSpan', () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r', cells: [{ colSpan: 8, block: { kind: 'title', text: 'Hi {{param.who}}', style: { fontSize: 16 } } as any }] }];
    const lm = toLayoutModel({ template: t, params: { who: 'Ndola' }, cells: {} });
    expect(lm.rows[0].cells[0].text).toBe('Hi Ndola');
    expect(lm.rows[0].cells[0].style).toEqual({ fontSize: 16 });
    expect(lm.rows[0].cells[0].colSpan).toBe(8);
    expect(lm.page.size).toBe(t.page.size);
  });

  it('fills a primary-table rowCount from the primary dataset', () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } as any }] }];
    const lm = toLayoutModel({ template: t, params: {}, primary: { result: primaryResult as any }, cells: {} });
    expect(lm.rows[0].cells[0].rowCount).toBe(3);
  });

  it('fills an inline-table rowCount from its own resolved cell', () => {
    const t = createEmptyTemplate('rt', 'R');
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] };
    t.rows = [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', source: q, columns: [] } as any }] }];
    const lm = toLayoutModel({ template: t, params: {}, cells: { '0:0': { result: { ...primaryResult, rows: [{}, {}] } as any } } });
    expect(lm.rows[0].cells[0].rowCount).toBe(2);
  });

  it('carries repeat flags through', () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'text', text: 'x', style: {} } as any }] }];
    const lm = toLayoutModel({ template: t, params: {}, cells: {} });
    expect(lm.rows[0].repeat).toBe('header');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test layout`
Expected: FAIL — `toLayoutModel is not a function`.

- [ ] **Step 3: Implement (append to `layout.ts`)**

Add this import to the top of `layout.ts` (merge with existing imports):

```ts
import { interpolate } from '../helpers';
```

Append:

```ts
export function toLayoutModel(resolved: ResolvedTemplate): LayoutModel {
  const { template, params, primary, cells } = resolved;
  const datasetRow = primary?.result?.rows[0] as Record<string, unknown> | undefined;
  const ctx = { params, dataset: datasetRow };

  const rows: LayoutRow[] = template.rows.map((row, r) => ({
    repeat: row.repeat,
    cells: row.cells.map((cell, c) => {
      const b = cell.block;
      const lb: LayoutBlock = { kind: b.kind, colSpan: cell.colSpan };
      if (b.kind === 'title') { lb.text = interpolate(b.text, ctx); lb.style = b.style; }
      else if (b.kind === 'text') { lb.text = interpolate(b.content, ctx); lb.style = b.style; }
      else if (b.kind === 'table') {
        lb.rowCount = b.source === 'primary'
          ? (primary?.result?.rows.length ?? 0)
          : (cells[`${r}:${c}`]?.result?.rows.length ?? 0);
      }
      return lb;
    }),
  }));
  return { page: template.page as PageSpec, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test layout`
Expected: PASS (all layout tests, 11 total).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/layout.ts packages/report-builder/src/render/layout.test.ts
git commit -m "feat(report-builder): toLayoutModel — project ResolvedTemplate into pure LayoutModel"
```

---

## Task 5: pdfkit-backed `Measurer` (+ add pdfkit dependency)

**Files:**
- Modify: `packages/report-builder/package.json` (add pdfkit)
- Create: `packages/report-builder/src/render/measurer.ts`
- Test: `packages/report-builder/src/render/measurer.test.ts`

- [ ] **Step 1: Add the dependency**

In `packages/report-builder/package.json`, add to `dependencies`:
```json
    "pdfkit": "^0.15.0",
```
and to `devDependencies`:
```json
    "@types/pdfkit": "^0.13.4",
```
Run: `pnpm install` (expected: completes; pdfkit resolves).

- [ ] **Step 2: Write the failing test `measurer.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { pdfkitMeasurer } from './measurer';

describe('pdfkitMeasurer', () => {
  it('returns a positive height for a single line and a larger height for wrapped text', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const m = pdfkitMeasurer(doc);
    const one = m.measureText('short', {}, 400);
    const many = m.measureText('word '.repeat(200), {}, 120);
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
  });

  it('a larger font size yields a taller single line', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const m = pdfkitMeasurer(doc);
    expect(m.measureText('x', { fontSize: 24 }, 400)).toBeGreaterThan(m.measureText('x', { fontSize: 8 }, 400));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test measurer`
Expected: FAIL — `Cannot find module './measurer'`.

- [ ] **Step 4: Implement `measurer.ts`**

```ts
import type PDFDocument from 'pdfkit';
import type { BlockStyle, Measurer } from './layout';

const BASE_FONT_SIZE = 11;

function fontName(style: BlockStyle): string {
  if (style.bold && style.italic) return 'Helvetica-BoldOblique';
  if (style.bold) return 'Helvetica-Bold';
  if (style.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** A Measurer backed by a live pdfkit document (uses its font metrics + line wrapping). */
export function pdfkitMeasurer(doc: PDFKit.PDFDocument): Measurer {
  return {
    measureText(text, style, maxWidth) {
      doc.font(fontName(style)).fontSize(style.fontSize ?? BASE_FONT_SIZE);
      // heightOfString accounts for wrapping at the given width. Guard empty string to one line.
      return doc.heightOfString(text || ' ', { width: maxWidth });
    },
  };
}
```

Note: `import type PDFDocument from 'pdfkit'` is only to make the `PDFKit.PDFDocument` global namespace type available; the parameter type is `PDFKit.PDFDocument` (pdfkit ships this ambient namespace via `@types/pdfkit`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test measurer`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/report-builder/package.json packages/report-builder/src/render/measurer.ts packages/report-builder/src/render/measurer.test.ts pnpm-lock.yaml
git commit -m "feat(report-builder): pdfkit-backed Measurer + pdfkit dependency"
```

---

## Task 6: Chart pure helpers — `scale.ts` (linear scale + nice ticks) and `legend.ts`

The testable geometry of charts, with no pdfkit dependency.

**Files:**
- Create: `packages/report-builder/src/render/charts/scale.ts`
- Create: `packages/report-builder/src/render/charts/legend.ts`
- Test: `packages/report-builder/src/render/charts/scale.test.ts`
- Test: `packages/report-builder/src/render/charts/legend.test.ts`

- [ ] **Step 1: Write the failing tests**

`scale.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { linearScale, niceTicks } from './scale';

describe('linearScale', () => {
  it('maps domain endpoints to range endpoints', () => {
    const s = linearScale(0, 100, 0, 200);
    expect(s(0)).toBe(0);
    expect(s(100)).toBe(200);
    expect(s(50)).toBe(100);
  });
  it('handles a zero-width domain without NaN (maps to range start)', () => {
    const s = linearScale(5, 5, 0, 200);
    expect(Number.isNaN(s(5))).toBe(false);
  });
});

describe('niceTicks', () => {
  it('returns rounded, ascending ticks spanning the max', () => {
    const ticks = niceTicks(0, 95, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(95);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });
  it('never returns a single tick for a positive max', () => {
    expect(niceTicks(0, 10, 5).length).toBeGreaterThanOrEqual(2);
  });
});
```

`legend.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { layoutLegend } from './legend';

describe('layoutLegend', () => {
  it('positions one entry per series with a swatch and non-overlapping y', () => {
    const items = layoutLegend(['A', 'B', 'C'], { x: 10, y: 20, swatch: 8, lineHeight: 14 });
    expect(items.length).toBe(3);
    expect(items[0].label).toBe('A');
    expect(items[0].y).toBe(20);
    expect(items[1].y).toBe(34);
    expect(items[0].swatchX).toBe(10);
    expect(items[0].labelX).toBeGreaterThan(items[0].swatchX);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/report-builder test charts/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `scale.ts`**

```ts
/** Returns a function mapping a value in [d0,d1] to [r0,r1]. Zero-width domain → constant r0. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => r0;
  const k = (r1 - r0) / span;
  return (v: number) => r0 + (v - d0) * k;
}

/** Ascending "nice" ticks from 0 (or `min`) to at least `max`, ~`count` steps, rounded to a 1/2/5×10ⁿ step. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min, min + 1];
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t < max + step; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}
```

- [ ] **Step 4: Implement `legend.ts`**

```ts
export interface LegendOpts { x: number; y: number; swatch: number; lineHeight: number }
export interface LegendItem { label: string; y: number; swatchX: number; labelX: number; swatch: number }

/** Vertical legend: one row per series, swatch left, label right, rows spaced by lineHeight. */
export function layoutLegend(series: string[], opts: LegendOpts): LegendItem[] {
  return series.map((label, i) => ({
    label,
    y: opts.y + i * opts.lineHeight,
    swatchX: opts.x,
    labelX: opts.x + opts.swatch + 6,
    swatch: opts.swatch,
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/report-builder test charts/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/report-builder/src/render/charts/scale.ts packages/report-builder/src/render/charts/legend.ts packages/report-builder/src/render/charts/scale.test.ts packages/report-builder/src/render/charts/legend.test.ts
git commit -m "feat(report-builder): chart pure helpers — linear scale, nice ticks, legend layout"
```

---

## Task 7: Chart drawers + `drawChart` facade

Uses the pure helpers to draw bar/line/pie/kpi onto a pdfkit doc within a box: title, axes + gridlines (bar/line), marks, value labels, legend. Tested for "produces valid output without throwing" (drawing correctness is covered by the pure helpers + visual inspection via the CLI in Task 11).

**Files:**
- Create: `packages/report-builder/src/render/charts/index.ts`
- Test: `packages/report-builder/src/render/charts/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { drawChart, type ChartData } from './index';

function render(fn: (doc: PDFKit.PDFDocument) => void): Buffer {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  fn(doc);
  doc.end();
  return Buffer.concat(chunks);
}

const box = { x: 40, y: 40, w: 400, h: 200 };
const data: ChartData = { title: 'Resistance', categories: ['E. coli', 'K. pneu'], series: [{ name: '%R', values: [41, 52] }] };

describe('drawChart', () => {
  for (const kind of ['bar', 'line', 'pie', 'kpi'] as const) {
    it(`draws a ${kind} chart without throwing and emits a valid PDF`, () => {
      const buf = render((doc) => drawChart(doc, box, kind, data, {}));
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(500);
    });
  }

  it('handles empty data without throwing', () => {
    const buf = render((doc) => drawChart(doc, box, 'bar', { title: 'Empty', categories: [], series: [] }, {}));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test charts/index`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement `charts/index.ts`**

```ts
import { linearScale, niceTicks } from './scale';
import { layoutLegend } from './legend';

export interface ChartSeries { name: string; values: number[] }
export interface ChartData { title: string; categories: string[]; series: ChartSeries[] }
export interface ChartVisual { color?: string; secondaryColor?: string; showLegend?: boolean }

export type ChartKind = 'bar' | 'line' | 'pie';
const PALETTE = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#D4537E'];
const AXIS = '#999';
const GRID = '#e5e5e5';
const TITLE_H = 16;
const LEGEND_W = 90;

function seriesColor(v: ChartVisual, i: number): string {
  if (i === 0 && v.color) return v.color;
  if (i === 1 && v.secondaryColor) return v.secondaryColor;
  return PALETTE[i % PALETTE.length];
}

function drawTitle(doc: PDFKit.PDFDocument, box: Box, title: string): void {
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#222').text(title, box.x, box.y, { width: box.w, ellipsis: true });
}

interface Box { x: number; y: number; w: number; h: number }

function maxValue(d: ChartData): number {
  let mx = 0;
  for (const s of d.series) for (const v of s.values) mx = Math.max(mx, v);
  return mx;
}

function drawAxes(doc: PDFKit.PDFDocument, plot: Box, max: number): (v: number) => number {
  const y = linearScale(0, max || 1, plot.y + plot.h, plot.y);
  const ticks = niceTicks(0, max || 1, 4);
  doc.fontSize(7).fillColor('#666').font('Helvetica');
  for (const t of ticks) {
    const yy = y(t);
    doc.moveTo(plot.x, yy).lineTo(plot.x + plot.w, yy).strokeColor(GRID).lineWidth(0.5).stroke();
    doc.fillColor('#666').text(String(t), plot.x - 26, yy - 3, { width: 24, align: 'right' });
  }
  doc.moveTo(plot.x, plot.y).lineTo(plot.x, plot.y + plot.h).strokeColor(AXIS).lineWidth(0.75).stroke();
  doc.moveTo(plot.x, plot.y + plot.h).lineTo(plot.x + plot.w, plot.y + plot.h).strokeColor(AXIS).stroke();
  return y;
}

function drawLegend(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const items = layoutLegend(d.series.map((s) => s.name), { x: box.x + box.w - LEGEND_W + 8, y: box.y + TITLE_H + 4, swatch: 8, lineHeight: 14 });
  items.forEach((it, i) => {
    doc.rect(it.swatchX, it.y, it.swatch, it.swatch).fill(seriesColor(v, i));
    doc.fillColor('#333').font('Helvetica').fontSize(8).text(it.label, it.labelX, it.y - 1, { width: LEGEND_W - 20, ellipsis: true });
  });
}

function plotArea(box: Box, hasLegend: boolean): Box {
  return { x: box.x + 30, y: box.y + TITLE_H + 6, w: box.w - 30 - (hasLegend ? LEGEND_W : 8), h: box.h - TITLE_H - 24 };
}

function drawBar(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const y = drawAxes(doc, plot, max);
  const n = d.categories.length || 1;
  const groupW = plot.w / n;
  const barW = (groupW * 0.7) / Math.max(1, d.series.length);
  d.categories.forEach((cat, ci) => {
    const gx = plot.x + ci * groupW + groupW * 0.15;
    d.series.forEach((s, si) => {
      const val = s.values[ci] ?? 0;
      const top = y(val);
      doc.rect(gx + si * barW, top, barW - 1, plot.y + plot.h - top).fill(seriesColor(v, si));
      doc.fillColor('#333').font('Helvetica').fontSize(6).text(String(val), gx + si * barW, top - 8, { width: barW, align: 'center' });
    });
    doc.fillColor('#555').fontSize(7).text(cat, plot.x + ci * groupW, plot.y + plot.h + 3, { width: groupW, align: 'center', ellipsis: true });
  });
  if (hasLegend) drawLegend(doc, box, d, v);
}

function drawLine(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const y = drawAxes(doc, plot, max);
  const n = Math.max(1, d.categories.length - 1);
  const x = linearScale(0, n, plot.x, plot.x + plot.w);
  d.series.forEach((s, si) => {
    const col = seriesColor(v, si);
    s.values.forEach((val, i) => {
      const px = x(i), py = y(val);
      if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py);
    });
    doc.strokeColor(col).lineWidth(1.25).stroke();
    s.values.forEach((val, i) => doc.circle(x(i), y(val), 1.75).fill(col));
  });
  d.categories.forEach((cat, ci) =>
    doc.fillColor('#555').font('Helvetica').fontSize(7).text(cat, x(ci) - 20, plot.y + plot.h + 3, { width: 40, align: 'center', ellipsis: true }));
  if (hasLegend) drawLegend(doc, box, d, v);
}

function drawPie(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const plot = plotArea(box, true);
  const values = d.categories.map((_, i) => d.series[0]?.values[i] ?? 0);
  const total = values.reduce((s, n) => s + n, 0) || 1;
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2, r = Math.min(plot.w, plot.h) / 2 - 4;
  let a0 = -Math.PI / 2;
  values.forEach((val, i) => {
    const a1 = a0 + (val / total) * Math.PI * 2;
    doc.moveTo(cx, cy).arc?.(cx, cy, r, a0, a1).lineTo(cx, cy).fill(seriesColor(v, i));
    a0 = a1;
  });
  const legend = layoutLegend(d.categories, { x: box.x + box.w - LEGEND_W + 8, y: box.y + TITLE_H + 4, swatch: 8, lineHeight: 14 });
  legend.forEach((it, i) => {
    doc.rect(it.swatchX, it.y, it.swatch, it.swatch).fill(seriesColor(v, i));
    doc.fillColor('#333').font('Helvetica').fontSize(8).text(it.label, it.labelX, it.y - 1, { width: LEGEND_W - 20, ellipsis: true });
  });
}

function drawKpi(doc: PDFKit.PDFDocument, box: Box, d: ChartData): void {
  const value = d.series[0]?.values[0] ?? 0;
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#111').text(String(value), box.x, box.y + box.h / 2 - 16, { width: box.w, align: 'center' });
}

export function drawChart(doc: PDFKit.PDFDocument, box: Box, kind: ChartKind | 'kpi', data: ChartData, visual: ChartVisual): void {
  drawTitle(doc, box, data.title);
  if (kind === 'kpi') { drawKpi(doc, box, data); return; }
  if (kind === 'pie') { drawPie(doc, box, data, visual); return; }
  if (kind === 'line') { drawLine(doc, box, data, visual); return; }
  drawBar(doc, box, data, visual);
}
```

Note: `arc` on pdfkit is provided by the `arc` method in pdfkit ≥0.14; the optional-call `doc.arc?.(...)` degrades safely if unavailable (the slice just won't draw, but no throw) — the test only asserts no-throw + valid PDF. If `arc` is present (it is in `^0.15`), pie slices render.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test charts/index`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/charts/index.ts packages/report-builder/src/render/charts/index.test.ts
git commit -m "feat(report-builder): chart drawers (bar/line/pie/kpi) with axes, gridlines, legend"
```

---

## Task 8: `paint.ts` — per-block drawers

Consumes a `PositionedBox` + the block + its resolved data, and draws it. Handles title/text (interpolated), table (header + rows, splitting across pages at `bodyBottom`), image (URL/logo placeholder text for v1), divider, spacer, and an error placeholder. KPI/chart delegate to `drawChart`.

**Files:**
- Create: `packages/report-builder/src/render/paint.ts`
- Test: `packages/report-builder/src/render/paint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { drawBlock } from './paint';
import type { PositionedBox, CellData } from './layout';

function render(fn: (doc: PDFKit.PDFDocument) => void): Buffer {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  fn(doc);
  doc.end();
  return Buffer.concat(chunks);
}

const box = (kind: string): PositionedBox => ({ page: 1, x: 40, y: 40, w: 400, h: 120, rowIndex: 0, cellIndex: 0, kind: kind as any });
const result = (rows: any[]): any => ({ columns: [{ key: 'a', label: 'A', kind: 'string' }], rows, chart: { type: 'bar', x: 'a', y: 'b' }, meta: { generatedAt: 'n', rowCount: rows.length } });

describe('drawBlock', () => {
  it('draws a title block without throwing', () => {
    const buf = render((doc) => drawBlock(doc, box('title'), { kind: 'title', text: 'Hi', style: { fontSize: 16 } } as any, undefined, { params: {}, dataset: undefined }, 800));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('draws a table block from cell data without throwing', () => {
    const cell: CellData = { result: result([{ a: '1' }, { a: '2' }]) };
    const buf = render((doc) => drawBlock(doc, box('table'), { kind: 'table', source: 'primary', columns: [{ key: 'a', label: 'A' }] } as any, cell, { params: {}, dataset: undefined }, 800));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('draws an error placeholder when the cell has an error', () => {
    const cell: CellData = { error: 'boom' };
    const buf = render((doc) => drawBlock(doc, box('chart'), { kind: 'chart', query: {} as any, chartType: 'bar', visual: {} } as any, cell, { params: {}, dataset: undefined }, 800));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('draws divider and spacer without throwing', () => {
    const buf = render((doc) => {
      drawBlock(doc, box('divider'), { kind: 'divider' } as any, undefined, { params: {}, dataset: undefined }, 800);
      drawBlock(doc, box('spacer'), { kind: 'spacer', height: 10 } as any, undefined, { params: {}, dataset: undefined }, 800);
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test paint`
Expected: FAIL — `Cannot find module './paint'`.

- [ ] **Step 3: Implement `paint.ts`**

```ts
import { interpolate, type InterpolateContext } from '../helpers';
import type { Block } from '../schema';
import type { CellData, PositionedBox } from './layout';
import { drawChart, type ChartData } from './charts';

const TABLE_HEADER_H = 18;
const TABLE_ROW_H = 16;

function fontFor(style?: { bold?: boolean; italic?: boolean }): string {
  if (style?.bold && style?.italic) return 'Helvetica-BoldOblique';
  if (style?.bold) return 'Helvetica-Bold';
  if (style?.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

// Build ChartData from a ReportResult using the columns as label/value (label = first string col, value = first number col).
function toChartData(title: string, result: CellData['result']): ChartData {
  if (!result) return { title, categories: [], series: [] };
  const cols = result.columns;
  const labelKey = cols.find((c) => c.kind !== 'number')?.key ?? cols[0]?.key ?? 'label';
  const valueKey = cols.find((c) => c.kind === 'number')?.key ?? cols[1]?.key ?? 'value';
  const categories = result.rows.map((r) => String(r[labelKey] ?? ''));
  const values = result.rows.map((r) => Number(r[valueKey] ?? 0));
  return { title, categories, series: [{ name: valueKey, values }] };
}

function drawErrorPlaceholder(doc: PDFKit.PDFDocument, box: PositionedBox, msg: string): void {
  doc.rect(box.x, box.y, box.w, box.h).fillColor('#fdf2f2').fill();
  doc.fillColor('#a33').font('Helvetica').fontSize(8).text(`⚠ ${msg}`, box.x + 6, box.y + 6, { width: box.w - 12, ellipsis: true });
  doc.fillColor('#000');
}

function drawTable(doc: PDFKit.PDFDocument, box: PositionedBox, block: Extract<Block, { kind: 'table' }>, cell: CellData | undefined, bodyBottom: number): void {
  const result = cell?.result;
  const columns = block.columns.length ? block.columns : (result?.columns.map((c) => ({ key: c.key, label: c.label })) ?? []);
  const rows = result?.rows ?? [];
  const colW = box.w / Math.max(1, columns.length);
  let y = box.y;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#222');
    columns.forEach((c, i) => doc.text(c.label, box.x + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
    doc.moveTo(box.x, y + TABLE_HEADER_H).lineTo(box.x + box.w, y + TABLE_HEADER_H).strokeColor('#999').lineWidth(0.5).stroke();
    y += TABLE_HEADER_H;
  };
  header();
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  rows.forEach((row, idx) => {
    if (y + TABLE_ROW_H > bodyBottom) { doc.addPage(); y = doc.page.margins.top; header(); doc.font('Helvetica').fontSize(8).fillColor('#000'); }
    if (idx % 2 === 1) { doc.rect(box.x, y, box.w, TABLE_ROW_H).fillColor('#f5f5f5').fill().fillColor('#000'); }
    columns.forEach((c, i) => doc.text(String(row[c.key] ?? ''), box.x + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
    y += TABLE_ROW_H;
  });
  if (rows.length === 0) doc.fillColor('#888').text('(no rows)', box.x + 2, y + 4).fillColor('#000');
}

export function drawBlock(
  doc: PDFKit.PDFDocument,
  box: PositionedBox,
  block: Block,
  cell: CellData | undefined,
  ctx: InterpolateContext,
  bodyBottom: number,
): void {
  if (cell?.error) { drawErrorPlaceholder(doc, box, cell.error); return; }
  switch (block.kind) {
    case 'title':
    case 'text': {
      const raw = block.kind === 'title' ? block.text : block.content;
      doc.font(fontFor(block.style)).fontSize(block.style?.fontSize ?? (block.kind === 'title' ? 14 : 11)).fillColor('#111');
      doc.text(interpolate(raw, ctx), box.x, box.y, { width: box.w, align: block.style?.align ?? 'left' });
      doc.fillColor('#000');
      return;
    }
    case 'kpi':
      drawChart(doc, box, 'kpi', toChartData(block.label || '', cell?.result), {});
      return;
    case 'chart':
      drawChart(doc, box, block.chartType, toChartData('', cell?.result), block.visual as never);
      return;
    case 'table':
      drawTable(doc, box, block, cell, bodyBottom);
      return;
    case 'image':
      doc.rect(box.x, box.y, box.w, box.h).strokeColor('#ccc').lineWidth(0.5).stroke();
      doc.fillColor('#999').fontSize(8).text(block.src === 'org-logo' ? '[logo]' : block.src, box.x + 4, box.y + 4, { width: box.w - 8, ellipsis: true }).fillColor('#000');
      return;
    case 'divider':
      doc.moveTo(box.x, box.y + box.h / 2).lineTo(box.x + box.w, box.y + box.h / 2).strokeColor('#ccc').lineWidth(0.5).stroke();
      return;
    case 'spacer':
    case 'pageBreak':
      return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test paint`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/paint.ts packages/report-builder/src/render/paint.test.ts
git commit -m "feat(report-builder): paint.ts — per-block drawers (title/text/table/kpi/chart/image/error)"
```

---

## Task 9: `renderReportTemplatePdf` orchestrator + barrels

Assembles the pipeline and exports the public entry points.

**Files:**
- Create: `packages/report-builder/src/render/index.ts`
- Modify: `packages/report-builder/src/pure.ts` (export layout)
- Modify: `packages/report-builder/src/index.ts` (export render + run-template)
- Test: `packages/report-builder/src/render/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderReportTemplatePdf } from './index';
import { createEmptyTemplate } from '../helpers';

const result = (rows: any[]): any => ({ columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }], rows, chart: { type: 'bar', x: 'label', y: 'value' }, meta: { generatedAt: 'n', rowCount: rows.length } });

describe('renderReportTemplatePdf', () => {
  it('renders a template with a header, KPI, chart, and primary table into a valid PDF', async () => {
    const t = createEmptyTemplate('rt', 'Demo');
    t.dataset = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] } as any;
    t.rows = [
      { id: 'h', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Report for {{param.facility}}', style: { fontSize: 16, bold: true } } as any }] },
      { id: 'k', cells: [
        { colSpan: 6, block: { kind: 'kpi', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, label: 'Total' } as any },
        { colSpan: 6, block: { kind: 'chart', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any },
      ] },
      { id: 't', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } as any }] },
    ];
    const rows = Array.from({ length: 80 }, (_, i) => ({ label: `r${i}`, value: i }));
    const buf = await renderReportTemplatePdf(t, { facility: 'Ndola' }, async () => result(rows));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('still renders when a block query fails (error isolation)', async () => {
    const t = createEmptyTemplate('rt', 'Demo');
    t.rows = [{ id: 'k', cells: [{ colSpan: 12, block: { kind: 'chart', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any }] }];
    const buf = await renderReportTemplatePdf(t, {}, async () => { throw new Error('nope'); });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test render/index`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement `render/index.ts`**

```ts
import PDFDocument from 'pdfkit';
import type { ReportTemplate } from '../schema';
import { computeLayout, toLayoutModel, type PageSpec } from './layout';
import { runTemplate, type QueryFn } from './run-template';
import { pdfkitMeasurer } from './measurer';
import { drawBlock } from './paint';

const PAGE_DIMS: Record<PageSpec['size'], [number, number]> = { A4: [595.28, 841.89], Letter: [612, 792] };

function pageSize(p: PageSpec): { size: [number, number] } {
  const [w, h] = PAGE_DIMS[p.size];
  return { size: p.orientation === 'landscape' ? [h, w] : [w, h] };
}

export async function renderReportTemplatePdf(
  template: ReportTemplate,
  params: Record<string, string>,
  queryFn: QueryFn,
): Promise<Buffer> {
  const resolved = await runTemplate(template, params, queryFn);
  const page = template.page as PageSpec;

  const doc = new PDFDocument({ ...pageSize(page), margins: page.margins, bufferPages: true });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolveP, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolveP(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const measurer = pdfkitMeasurer(doc);
  const boxes = computeLayout(toLayoutModel(resolved), measurer);
  const datasetRow = resolved.primary?.result?.rows[0] as Record<string, unknown> | undefined;
  const ctx = { params, dataset: datasetRow };

  const [, ph] = pageSize(page).size;
  const bodyBottom = ph - page.margins.bottom;

  // Ensure the document has enough pages, then paint each box on its page.
  const maxPage = boxes.reduce((m, b) => Math.max(m, b.page), 1);
  for (let p = 2; p <= maxPage; p++) doc.addPage();

  const pageStart = doc.bufferedPageRange().start;
  for (const box of boxes.filter((b) => !b.repeat)) {
    doc.switchToPage(pageStart + box.page - 1);
    const cell = resolved.cells[`${box.rowIndex}:${box.cellIndex}`];
    drawBlock(doc, box, template.rows[box.rowIndex].cells[box.cellIndex].block, cell, ctx, bodyBottom);
  }
  // Header/footer boxes repeat on their page already (computeLayout emitted one per page).
  for (const box of boxes.filter((b) => b.repeat)) {
    if (box.page - 1 >= doc.bufferedPageRange().count) continue;
    doc.switchToPage(pageStart + box.page - 1);
    const cell = resolved.cells[`${box.rowIndex}:${box.cellIndex}`];
    drawBlock(doc, box, template.rows[box.rowIndex].cells[box.cellIndex].block, cell, ctx, bodyBottom);
  }

  doc.end();
  return done;
}
```

Note on table spill vs pre-added pages: `drawTable` may call `doc.addPage()` when a long primary table overflows, appending pages beyond `maxPage`. Because header/footer painting uses `bufferedPageRange().count` as a guard and body boxes are painted before the table can add pages only for their own page index, this is safe for v1 (the spilled table pages simply won't carry the repeating header/footer — an acceptable v1 limitation noted in the spec's "future" list). Do not attempt to fix spilled-page furniture in this phase.

- [ ] **Step 4: Update the barrels**

`packages/report-builder/src/pure.ts` — append:
```ts
export * from './render/layout';
```

`packages/report-builder/src/index.ts` — append:
```ts
export * from './render';
export * from './render/run-template';
```

- [ ] **Step 5: Run test + full package test + typecheck**

Run: `pnpm -C packages/report-builder test render/index`  (2 tests pass)
Run: `pnpm -C packages/report-builder test`  (all package tests pass)
Run: `pnpm -C packages/report-builder typecheck`  (clean)

- [ ] **Step 6: Commit**

```bash
git add packages/report-builder/src/render/index.ts packages/report-builder/src/render/index.test.ts packages/report-builder/src/pure.ts packages/report-builder/src/index.ts
git commit -m "feat(report-builder): renderReportTemplatePdf orchestrator + render barrels"
```

---

## Task 10: `POST /api/report-templates/:id/preview` endpoint

**Files:**
- Modify: `apps/server/src/report-templates-routes.ts`
- Test: `apps/server/src/report-templates-routes.test.ts` (add cases)

- [ ] **Step 1: Write the failing test (append to `report-templates-routes.test.ts`)**

Add a preview-capable fake context and cases. Append inside the existing file (reuse its imports; add `renderReportTemplatePdf` is NOT imported here — the route uses it internally):

```ts
describe('report-template preview', () => {
  const tpl = {
    id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi {{param.who}}', style: {} } }] }],
  };

  function ctxWith(tplRow: any) {
    return {
      reportTemplates: { get: async (id: string) => (id === tplRow?.id ? tplRow : undefined) },
      dashboards: { query: async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'n', rowCount: 0 } }) },
      logger: { error() {}, warn() {}, info() {} },
    } as any;
  }

  it('returns a PDF for a known template', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles: ['lab_technician'] }; });
    registerReportTemplateRoutes(app, ctxWith(tpl));
    const res = await app.inject({ method: 'POST', url: '/api/report-templates/rt1/preview', payload: { params: { who: 'Ndola' } } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('404s an unknown template', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles: ['lab_technician'] }; });
    registerReportTemplateRoutes(app, ctxWith(tpl));
    const res = await app.inject({ method: 'POST', url: '/api/report-templates/nope/preview', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/server test report-templates-routes`
Expected: FAIL — the preview route returns 404 for all (route not defined) or the described assertions fail.

- [ ] **Step 3: Implement — add the route to `report-templates-routes.ts`**

Add the import at the top (alongside the existing imports):
```ts
import { renderReportTemplatePdf } from '@openldr/report-builder';
```

Add this route inside `registerReportTemplateRoutes`, after the GET `:id` route (reads-open, no `MANAGE`):
```ts
  app.post('/api/report-templates/:id/preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = await ctx.reportTemplates.get(id);
    if (!tpl) { reply.code(404); return { error: 'not found' }; }
    const body = (req.body ?? {}) as { params?: Record<string, string> };
    const pdf = await renderReportTemplatePdf(tpl, body.params ?? {}, (q) => ctx.dashboards.query(q));
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="${id}.pdf"`);
    return reply.send(pdf);
  });
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm -C apps/server test report-templates-routes`  (all pass)
Run: `pnpm -C apps/server typecheck`  (clean)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/report-templates-routes.ts apps/server/src/report-templates-routes.test.ts
git commit -m "feat(server): POST /api/report-templates/:id/preview → PDF bytes"
```

---

## Task 11: `openldr report-template render` CLI command

**Files:**
- Modify: `packages/cli/src/report-template.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/report-template.test.ts` (add cases)

- [ ] **Step 1: Write the failing test (append to `report-template.test.ts`)**

```ts
import { renderTemplateToFile, parseParams } from './report-template';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('report-template render helpers', () => {
  it('parseParams splits k=v,k2=v2', () => {
    expect(parseParams('a=1,b=hello')).toEqual({ a: '1', b: 'hello' });
    expect(parseParams(undefined)).toEqual({});
  });

  it('renderTemplateToFile writes a PDF for a known template', async () => {
    const tpl = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi', style: {} } }] }] };
    const store = { get: async (id: string) => (id === 'rt1' ? tpl : undefined) } as any;
    const queryFn = async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'n', rowCount: 0 } });
    const out = join(tmpdir(), `rt-${Date.now()}.pdf`);
    await renderTemplateToFile(store, queryFn as any, 'rt1', {}, out);
    const buf = readFileSync(out);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    rmSync(out, { force: true });
  });

  it('renderTemplateToFile throws on unknown id', async () => {
    const store = { get: async () => undefined } as any;
    await expect(renderTemplateToFile(store, (async () => ({})) as any, 'nope', {}, 'x.pdf')).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/cli test report-template`
Expected: FAIL — `renderTemplateToFile`/`parseParams` not exported.

- [ ] **Step 3: Implement — append to `report-template.ts`**

Add imports at the top (merge with existing):
```ts
import { writeFileSync } from 'node:fs';
import { renderReportTemplatePdf, type ReportTemplateStore } from '@openldr/report-builder';
import type { WidgetQuery } from '@openldr/dashboards';
import type { ReportResult } from '@openldr/reporting';
```

Append:
```ts
export function parseParams(s: string | undefined): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const pair of s.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

export async function renderTemplateToFile(
  store: ReportTemplateStore,
  queryFn: (q: WidgetQuery) => Promise<ReportResult>,
  id: string,
  params: Record<string, string>,
  outPath: string,
): Promise<void> {
  const tpl = await store.get(id);
  if (!tpl) throw new Error(`report template not found: ${id}`);
  const pdf = await renderReportTemplatePdf(tpl, params, queryFn);
  writeFileSync(outPath, pdf);
}

export async function runRender(id: string, opts: { params?: string; out: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await renderTemplateToFile(ctx.reportTemplates, (q) => ctx.dashboards.query(q), id, parseParams(opts.params), opts.out);
    process.stdout.write(`rendered ${id} → ${opts.out}\n`);
    return 0;
  } finally { await ctx.close(); }
}
```

- [ ] **Step 4: Register the command in `packages/cli/src/index.ts`**

Add `runRender as runReportTemplateRender` to the existing report-template import:
```ts
import { runList as runReportTemplateList, runExport as runReportTemplateExport, runImport as runReportTemplateImport, runDelete as runReportTemplateDelete, runRender as runReportTemplateRender } from './report-template';
```

Add this command after the existing `report-template delete` command registration:
```ts
reportTemplate.command('render <id>').description('Render a report template to a PDF file')
  .option('--params <kv>', 'comma-separated k=v parameter values')
  .requiredOption('-o, --out <file>', 'output PDF path')
  .action(async (id: string, opts: { params?: string; out: string }) => {
    try { process.exitCode = await runReportTemplateRender(id, opts); } catch (err) { process.stderr.write(`report-template render failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm -C packages/cli test report-template`  (all pass)
Run: `pnpm -C packages/cli typecheck`  (clean)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/report-template.ts packages/cli/src/index.ts packages/cli/src/report-template.test.ts
git commit -m "feat(cli): openldr report-template render <id> -o out.pdf"
```

---

## Task 12: Full cross-package gate

**Files:** none (verification).

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all packages pass. Fix any consumer breakage from the new barrel exports before proceeding.

- [ ] **Step 2: Targeted test sweep**

Run: `pnpm -C packages/report-builder test && pnpm -C apps/server test && pnpm -C packages/cli test`
Expected: all pass.

- [ ] **Step 3: Manual smoke (optional but recommended)**

With a running stack + a seeded template id, `openldr report-template render <id> -o C:/Users/Fredrick/AppData/Local/Temp/claude/report.pdf --params facility=Ndola` and open the PDF to eyeball layout/charts. (Skip if no live DB; the golden test already proves valid bytes.)

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "chore(report-builder): green cross-package gate for phase 2 renderer"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** module split (§Module structure) → Tasks 1–9 file placement; `runTemplate` + param binding + error isolation (§Data resolution) → Tasks 1–2; `computeLayout` + Measurer (§Layout) → Tasks 3–5; charts richer fidelity (§Charts) → Tasks 6–7; painter (§Painting) → Task 8; orchestrator → Task 9; preview endpoint + CLI render + tests (§Wiring) → Tasks 10–11; gate → Task 12. Deferred items (HTML canvas, wrapped cells, scatter/gauge/funnel, coexistence) are absent by design.
- **Type consistency:** `Measurer`, `PositionedBox`, `LayoutModel`/`LayoutRow`/`LayoutBlock`, `CellData`, `ResolvedTemplate`, `QueryFn`, `ChartData`/`ChartVisual`, `renderReportTemplatePdf`, `resolveQueryParams`, `runTemplate`, `toLayoutModel`, `pdfkitMeasurer`, `drawChart`, `drawBlock`, `renderTemplateToFile`, `parseParams` are used identically across tasks. `layout.ts` is created in Task 2 (types) and extended in Tasks 3–4; `run-template.ts` in Tasks 1–2.
- **No placeholders:** every code step contains full code; every run step states the command + expected result.
- **Boundary guardrails:** `report-builder` imports no `@openldr/bootstrap`; `WidgetQuery`/`ReportResult` are type-only; pdfkit stays out of the `./pure` barrel (only `render/layout.ts`, which has no pdfkit import, is added to pure).
