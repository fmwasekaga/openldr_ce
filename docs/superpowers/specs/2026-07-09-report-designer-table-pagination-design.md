# Report Designer — Multi-Page Table Pagination Design Spec

**Date:** 2026-07-09
**Status:** Design approved; implementation not started
**Builds on:** the data-binding + PDF + preview slice (`0057a0ae`) + export wirings. The pdfkit renderer currently **clips** each table to its element box and truncates rows that don't fit; this slice lets an overflowing table **continue onto additional pages**.
**Reference:** `packages/report-designer/src/render/{index,draw}.ts` (the pure renderer); `apps/server/src/report-designs-routes.ts` (the preview route that calls it — unchanged).

---

## 1. Purpose

Today `renderReportDesignPdf` draws one physical PDF page per `design.pages[]` entry, and `drawGrid` clips each table to its box, dropping rows beyond `maxRows = floor((boxH − 16) / 16)`. A bound query returning more rows than fit its box is silently truncated in the PDF.

This slice makes a table **paginate**: when its rows exceed its box, the design page repeats onto extra physical pages and the table advances through its rows.

**Chosen model — "repeat page, tables advance":** each *design page* expands into **N physical pages**; on every physical page the **non-table elements render identically** (titles/logos/lines/rects repeat), and **each table shows the next slice of its rows** with its column header repeated. Faithful to the authored layout for the common "header band + one results table" design.

---

## 2. Behaviour (settled)

- **Physical pages per design page:** `N = max(1, max over table elements of ceil(rowCount_t / maxRows_t))`, where `maxRows_t = floor((boxH_t − ROW_H) / ROW_H)` (in points) and `rowCount_t` is the table's total row count. A design page with no tables, or whose tables all fit, → **exactly 1 physical page** (no behaviour change).
- **Per physical page (chunk index `c`, 0-based):**
  - Non-table elements (`text`/`datetime`/`image`/`line`/`rect`) render identically on every chunk — they **repeat**.
  - Each table draws rows `[c·maxRows_t … c·maxRows_t + maxRows_t)` (a slice of its full row list), with the **column header row repeated** at the top of its box on every chunk.
  - A table whose rows are exhausted for chunk `c` (`c·maxRows_t ≥ rowCount_t`) draws **header-only** (empty body) — its box stays in the layout.
- **`ROW_H` stays fixed at 16 pt** (header 16 pt, each body row 16 pt, single-line cells with ellipsis). Fixed height ⇒ deterministic chunking, no text measurement.
- **Degenerate box** (`maxRows_t < 1`, box too short for even one row): contributes **1 chunk** (draws the header, no rows — same as today's truncation); never paginates (avoids divide-by-zero / infinite pages).
- **Error tables** (`resolved` is `{ error }`): draw the existing red placeholder; contribute **1 chunk** (no rows to advance). If another table on the page is longer, the placeholder simply **repeats** on the continuation pages (consistent with "non-advancing elements repeat").
- **Static / unbound tables** (no `dataSource`): paginate their static `rows` the same way (rowCount = `el.rows.length`).
- **Multiple design pages:** each `design.pages[]` entry independently expands into its own `N` physical pages; overall page order is design-page order, each followed by its continuations.

**Out of scope (deferred fast-follows):** a "Page X of Y" / "continued" footer or any page chrome the user didn't author; variable row heights / word-wrapped multi-line cells; column-overflow (too many columns for the width) pagination; keeping short "finished" tables from repeating their header (accepted as the chosen model's minor cost).

---

## 3. Implementation (pure renderer only)

All changes are in `packages/report-designer/src/render/`; **no studio, server, or model changes** — the preview route and PDF/Excel export automatically benefit (Excel already exports all rows via its own pagination).

### `draw.ts`
- Export `const ROW_H = 16;` (replace the inline `rowH`).
- Add a pure helper `rowsFor(el, resolved): string[][]` — the projected body rows (bound: project `boundColumns` or `resolved.columns` from `resolved.rows`; static: `el.rows ?? []`; error/unresolved-bound: `[]`). Used by both drawing and chunk-counting so they agree.
- Add `tableChunkCount(el, resolved): number` — `1` for non-tables/degenerate boxes/error; else `max(1, ceil(rowsFor(...).length / maxRows))`.
- Add `pageChunkCount(page, resolved: Map<string, ResolvedTable>): number` — `max(1, …page.elements.map(tableChunkCount))`.
- `drawElement(doc, el, tokens, resolved, chunk = 0)` — new trailing `chunk` param; passed through to `drawTable`. Non-table branches ignore it.
- `drawTable(doc, el, r, resolved, chunk)` — build headers + `rowsFor(el, resolved)`, then `drawGrid(doc, r, headers, allRows, chunk)`. Error path unchanged (placeholder, chunk-independent).
- `drawGrid(doc, r, headers, allRows, chunk)` — compute `maxRows = floor((r.h − ROW_H) / ROW_H)`; the visible slice is `maxRows >= 1 ? allRows.slice(chunk*maxRows, chunk*maxRows + maxRows) : []`; draw the repeated header + the slice, still clipped to `r`. (Replaces the current internal `slice(0, maxRows)` truncation.)

### `index.ts`
```ts
import { drawElement, paramMap, pageChunkCount } from './draw';
// ...
for (const page of pages) {
  const chunks = pageChunkCount(page, resolved);
  for (let c = 0; c < chunks; c += 1) {
    doc.addPage({ size: [w, h], margin: 0 });
    for (const el of page.elements) drawElement(doc, el, tokens, resolved.get(el.id), c);
  }
}
```

The `ResolvedTable` type and the public `renderReportDesignPdf` signature are unchanged.

---

## 4. Testing

- **`draw.test.ts` (pure):** `tableChunkCount` — non-table→1; a bound table with N rows and a box fitting M→`ceil(N/M)`; degenerate box (h < ROW_H)→1; error resolved→1; static table by `el.rows.length`. `pageChunkCount` — max across a page's tables; page with no tables→1.
- **`index.test.ts` (render):** a design page with a table whose rows overflow its box → the PDF has **>1 physical page** (assert the `/Count` / `/Type /Page` count); a non-table element (e.g. a title) appears on the continuation page (repeats); a **short + long** table together → physical pages = the long table's chunk count, the short table exhausted after its chunks; an **error** table paginates as 1 chunk (no throw, placeholder present); a fully-fitting table → **still exactly 1 page** (no regression); a multi-`design.pages` design → each expands independently.
- Keep the existing render tests green (the no-overflow cases must be unchanged).
- **Live smoke:** bind a table to a query returning many rows (e.g. `select ... from observations` unaggregated, >20 rows for a small box) → Preview shows a multi-page PDF; `pdftotext` confirms later rows appear on page 2+ and the title/header repeat. Download the PDF and verify page count. (Dev stack per [[playwright-live-troubleshooting]]: postgres 5433, API `node dev.mjs` no `--watch`, `AUTH_DEV_BYPASS=true`.)
- Gate: `pnpm turbo run typecheck test --force` green modulo the known flakes.

---

## 5. Reference

- Renderer to change: `packages/report-designer/src/render/draw.ts` (`drawGrid`/`drawTable`/`drawElement`) + `index.ts` (the page loop). Both are Node-only, exported from the package `.` barrel; studio still imports only `/pure` (unaffected).
- The preview route `apps/server/src/report-designs-routes.ts` and studio Preview/Export are unchanged — they call `renderReportDesignPdf` and get more pages for free.
