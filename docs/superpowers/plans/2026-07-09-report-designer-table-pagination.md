# Report Designer — Multi-Page Table Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make an overflowing table in the pdfkit renderer continue onto extra PDF pages (repeat-page / tables-advance) instead of clipping.

**Architecture:** Pure-renderer change only, in `packages/report-designer/src/render/{draw,index}.ts`. Each design page expands into `N = max(1, max over tables of ceil(rowCount/maxRows))` physical pages; non-table elements repeat each page, each table draws its row slice `[chunk·maxRows … +maxRows]` with a repeated header. Fixed 16pt rows ⇒ deterministic chunking. No studio/server/model changes; Preview + PDF export benefit automatically.

**Tech Stack:** TS, pdfkit (Node-only), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-report-designer-table-pagination-design.md`

**Current code:** `drawGrid` (draw.ts:91) clips a table to its box and truncates via `rows.slice(0, maxRows)`; `index.ts:30-33` draws one physical page per `design.pages[]`.

---

## Task 1: Paginate tables in the renderer

**Files:** modify `packages/report-designer/src/render/draw.ts`, `packages/report-designer/src/render/index.ts`; extend `packages/report-designer/src/render/draw.test.ts`, `packages/report-designer/src/render/index.test.ts`.

- [ ] **Step 1: Failing pure-logic tests** — append to `draw.test.ts`:

```ts
import { tableChunkCount, pageChunkCount, rowsFor } from './draw';
import type { DesignElement, DesignPage } from '../schema';
import type { ResolvedTable } from './index';

const tbl = (over: Partial<DesignElement>): DesignElement =>
  ({ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 300, h: 100 }, ...over } as DesignElement);

describe('tableChunkCount', () => {
  // box h=100px → 75pt; maxRows = floor((75-16)/16) = 3
  it('splits a bound table into ceil(rows/maxRows) chunks', () => {
    const el = tbl({ dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] });
    const resolved: ResolvedTable = { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: i })) };
    expect(tableChunkCount(el, resolved)).toBe(3); // ceil(7/3)
  });
  it('returns 1 for a non-table, an error table, and a degenerate (too-short) box', () => {
    expect(tableChunkCount(tbl({ kind: 'text' } as Partial<DesignElement>), undefined)).toBe(1);
    expect(tableChunkCount(tbl({ dataSource: { kind: 'custom-query', queryId: 'q' } }), { error: 'x' })).toBe(1);
    expect(tableChunkCount(tbl({ rect: { x: 0, y: 0, w: 300, h: 10 }, columns: ['A'], rows: [['1'], ['2']] }), undefined)).toBe(1);
  });
  it('counts static (unbound) table rows', () => {
    expect(tableChunkCount(tbl({ columns: ['A'], rows: [['1'], ['2'], ['3'], ['4']] }), undefined)).toBe(2); // ceil(4/3)
  });
});

describe('pageChunkCount', () => {
  it('is the max chunk count across the page tables (min 1)', () => {
    const page: DesignPage = { id: 'p', elements: [
      tbl({ id: 'a', columns: ['A'], rows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7']] }), // ceil(7/3)=3
      tbl({ id: 'b', columns: ['A'], rows: [['1']] }),                                            // 1
      { id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement,
    ] };
    expect(pageChunkCount(page, new Map())).toBe(3);
  });
  it('is 1 for a page with no tables', () => {
    const page: DesignPage = { id: 'p', elements: [{ id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement] };
    expect(pageChunkCount(page, new Map())).toBe(1);
  });
});
```

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/report-designer exec vitest run src/render/draw.test.ts` → FAIL (`tableChunkCount`/`pageChunkCount`/`rowsFor` not exported).

- [ ] **Step 3: Implement in `draw.ts`.**
  - Add near the top: `export const ROW_H = 16;` and import `DesignPage` in the type import from `../schema`.
  - Add helpers (place after `interpolate`, before `drawElement`):

```ts
/** The projected body rows for a table element (bound → project columns from resolved.rows; static → el.rows; error/unresolved → []). */
export function rowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (el.kind !== 'table') return [];
  if (el.dataSource) {
    if (!resolved || 'error' in resolved) return [];
    const cols = el.boundColumns && el.boundColumns.length ? el.boundColumns : resolved.columns;
    return resolved.rows.map((row) => cols.map((c) => String(row[c.key] ?? '')));
  }
  return el.rows ?? [];
}

/** How many physical pages this one table needs (repeat-page model). 1 for non-tables/errors/degenerate boxes. */
export function tableChunkCount(el: DesignElement, resolved: ResolvedTable | undefined): number {
  if (el.kind !== 'table') return 1;
  const maxRows = Math.floor((toPt(el.rect).h - ROW_H) / ROW_H);
  if (maxRows < 1) return 1;
  const rowCount = rowsFor(el, resolved).length;
  return Math.max(1, Math.ceil(rowCount / maxRows));
}

/** Physical pages needed for a design page = the largest table's chunk count (min 1). */
export function pageChunkCount(page: DesignPage, resolved: Map<string, ResolvedTable>): number {
  return Math.max(1, ...page.elements.map((el) => tableChunkCount(el, resolved.get(el.id))));
}
```

  - Change `drawElement` to accept a trailing `chunk = 0` and pass it to `drawTable`:
    `export function drawElement(doc, el, tokens, resolved, chunk = 0): void { … case 'table': { drawTable(doc, el, r, resolved, chunk); return; } … }`
  - Change `drawTable(doc, el, r, resolved, chunk)`: keep the error branch (`'error' in resolved` → `drawErrorPlaceholder`, chunk-independent). For the drawn path, build `headers` (from `boundColumns`/`resolved.columns` for bound, or `el.columns ?? []` for static) and `const allRows = rowsFor(el, resolved);` then `drawGrid(doc, r, headers, allRows, chunk)`. (Bound-vs-static header selection mirrors the current logic; rows now come from `rowsFor`.) Remove the separate `drawStaticTable` (fold into `drawTable`, both use `rowsFor`).
  - Change `drawGrid(doc, r, headers, allRows, chunk)`: compute `const maxRows = Math.floor((r.h - ROW_H) / ROW_H);` and `const rows = maxRows >= 1 ? allRows.slice(chunk * maxRows, chunk * maxRows + maxRows) : [];`, then draw the header + `rows` exactly as today (clipped to `r`, striped, `ROW_H` spacing). It no longer truncates via `slice(0, maxRows)` — it draws precisely the passed slice.

- [ ] **Step 4: Run — verify pure tests pass.** `pnpm --filter @openldr/report-designer exec vitest run src/render/draw.test.ts` → PASS.

- [ ] **Step 5: Implement the page loop in `index.ts`.** Import `pageChunkCount` from `./draw`; replace the render loop:

```ts
for (const page of pages) {
  const chunks = pageChunkCount(page, resolved);
  for (let c = 0; c < chunks; c += 1) {
    doc.addPage({ size: [w, h], margin: 0 });
    for (const el of page.elements) drawElement(doc, el, tokens, resolved.get(el.id), c);
  }
}
```

- [ ] **Step 6: Render tests** — append to `index.test.ts` (mirror its existing `%PDF` + page-count assertion style; reuse its `baseDesign` helper):

```ts
it('paginates an overflowing table onto extra pages and repeats non-table elements', async () => {
  // box h=100px → maxRows 3; 7 rows → 3 pages
  const design = baseDesign({ pages: [{ id: 'p1', elements: [
    { id: 'title', kind: 'text', name: 'Title', rect: { x: 10, y: 10, w: 300, h: 20 }, text: 'Turnaround time' },
    { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 40, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
  ] }] });
  const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: `row${i}` })) }]]);
  const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
  expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  expect(buf.toString('latin1')).toMatch(/\/Count 3/); // 3 physical pages
});

it('renders exactly one page when the table fits (no regression)', async () => {
  const design = baseDesign({ pages: [{ id: 'p1', elements: [
    { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 200 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
  ] }] });
  const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'x' }, { a: 'y' }] }]]);
  const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
  expect(buf.toString('latin1')).toMatch(/\/Count 1/);
});

it('an error table does not paginate (1 page) and does not throw', async () => {
  const design = baseDesign({ pages: [{ id: 'p1', elements: [
    { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' } },
  ] }] });
  const buf = await renderReportDesignPdf(design, new Map([['t1', { error: 'boom' }]]), { now: NOW });
  expect(buf.toString('latin1')).toMatch(/\/Count 1/);
});
```

(If the installed pdfkit emits page count differently than `/Count N`, assert the count of `/Type /Page` occurrences instead — but keep a real physical-page-count assertion. Confirm the existing `/Count`-style assertion the file already uses and match it.)

- [ ] **Step 7: Verify** — `pnpm --filter @openldr/report-designer exec vitest run` (all pass, incl. the pre-existing render tests unchanged) + `pnpm --filter @openldr/report-designer typecheck` (clean).

- [ ] **Step 8: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/index.ts packages/report-designer/src/render/draw.test.ts packages/report-designer/src/render/index.test.ts
git commit -m "feat(report-designer): paginate overflowing tables across PDF pages"
```

---

## Task 2: Gate + live smoke

- [ ] **Step 1: Gate** — `pnpm turbo run typecheck test --force` (NEVER pipe through `tail`). Expect green except the known flakes (studio `api.test.ts` dedupe; parallel-turbo contention — re-run failing packages in isolation to confirm). Fix any real breakage.

- [ ] **Step 2: Live smoke** (per [[playwright-live-troubleshooting]] / MEMORY): `docker compose up -d postgres`; API `node dev.mjs` (NO `--watch`) with `AUTH_DEV_BYPASS=true MIGRATE_ON_START=true SEED_ON_START=true`. Create a Custom Query returning **many rows** against the seeded `openldr_target` (e.g. `select interpretation_code, analyte_code from observations` — an unaggregated, >20-row result) on the seeded "Target Warehouse (Postgres)" connector. POST a design to `/api/report-designs/preview` with a **small** table box (e.g. `h: 120`) bound to it. Assert: HTTP 200, `application/pdf`, and the PDF has **multiple pages** (`pdftotext -layout` shows later rows on page 2+, and a non-table title element repeats on each page). Save + inspect the PDF. Tear down (kill API, `docker compose stop postgres` — no `-v`; delete throwaway files). Report the page count + evidence.

---

## Self-Review

**Spec coverage:** §2 behaviour (N pages/design page, tables advance, header repeat, header-only when exhausted, fixed ROW_H, degenerate box→1, error→1, static paginates, multi design-page) → Task 1 (`rowsFor`/`tableChunkCount`/`pageChunkCount`/`drawGrid` slice/`index` loop). §3 impl (draw.ts + index.ts only, no studio/server/model) → Task 1. §4 testing (pure chunk-count + render page-count + no-regression + error + live smoke) → Tasks 1–2. §2 deferrals (footer chrome, variable heights, column overflow) untouched. ✓

**Placeholder scan:** none — complete code + exact assertions.

**Type consistency:** `ROW_H`, `rowsFor(el, resolved): string[][]`, `tableChunkCount(el, resolved): number`, `pageChunkCount(page, resolved): number`, `drawElement(…, chunk = 0)`, `drawGrid(doc, r, headers, allRows, chunk)` — consistent across Task 1 steps; `index.ts` calls `pageChunkCount` + `drawElement(…, c)`. `ResolvedTable` + `renderReportDesignPdf` signature unchanged. `rowsFor` is the single source of the projected body used by both counting and drawing, so chunk math and drawn rows agree.
