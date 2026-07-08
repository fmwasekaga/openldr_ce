# Report Designer — Data-Binding + PDF + Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Report Designer designs produce real output — a table element binds to a `/query` Custom Query, a server route resolves each bound table's rows and renders the whole design to PDF (pdfkit), and a Preview modal shows it.

**Architecture:** Approach A — the renderer is a **pure** `renderReportDesignPdf(design, resolved) → Buffer` (absolute layout needs no data to lay out). The new resource-less `POST /api/report-designs/preview` route does all DB/query/param work (via an extracted `runStoredQuery` helper that shares the `/query` SELECT-only + Postgres gate) and passes pre-resolved table data to the renderer. Studio binds tables in a rewritten Data tab and previews via `authFetch`.

**Tech Stack:** TS monorepo (pnpm), pdfkit (Node-only render), Kysely/Postgres, Fastify, Zod, React (studio), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-report-designer-data-binding-design.md`

**Reference (copy these patterns):** `@openldr/report-builder/src/render/{index,paint}.ts` (pdfkit buffering, `drawTable` striped rows, `drawErrorPlaceholder`); `@openldr/report-pdf/src/index.ts` (pre-resolved-data table draw); `apps/server/src/report-templates-routes.ts:45-54` (`POST /:id/preview`); `apps/server/src/query-routes.ts:94-122` (`/api/query/run` pipeline to share) + `apps/server/src/query-sql.ts` (`substituteParams`); `apps/studio/src/reports-builder/PreviewPdfDialog.tsx` + `apps/studio/src/reports/PdfCanvasViewer.tsx`; `apps/studio/src/query/api.ts` (`queryApi.list`/`run`); `apps/studio/src/report-designer/PageCanvas.tsx` + `model.ts` (coords/style source of truth).

**Commands:** `pnpm --filter <pkg> exec vitest run <path>`, `pnpm --filter <pkg> typecheck`. After adding a dep: `pnpm install` at repo root. Gate: `pnpm turbo run typecheck test --force` (NEVER pipe turbo through `tail`).

**Key facts the implementer must not re-derive:**
- `CustomQuery = { id; name; connectorId; sql; params: CustomQueryParam[] }`; `CustomQueryParam = { id; label; type: 'text'|'select'|'daterange'; required: boolean; optionsSql? }` (`packages/db/src/custom-query-store.ts`, `@openldr/dashboards` `custom-query.ts`).
- `queryApi.list(): Promise<CustomQuery[]>` returns FULL records (incl. `connectorId`/`sql`/`params`) — no separate get needed for the picker or Load-columns. `queryApi.run({connectorId, sql, params, values, limit?}): Promise<{columns:{key,label}[]; rows; rowCount; ms; total?}>` (`apps/studio/src/query/api.ts`). ALL query api calls go through `authFetch`.
- Server run building blocks: `substituteParams(sql, params, values)` from `./query-sql`; `validateSelectSql(sql)` from `@openldr/dashboards`; `runConnectorSql({connectorId, sql}): Promise<{columns:{key,label}[]; rows: Record<string,unknown>[]}>`.
- Designer coords are **px @96dpi** (`PAPER_PX` A4 794×1123 / Letter 816×1056 portrait, `paperSize()` swaps for landscape). PDF is **pt @72dpi** (A4 595.28×841.89 / Letter 612×792). **Convert ×0.75.**
- Canvas style defaults (match in PDF): text `fontSize` 11, `color #262626`, `bold`, `align`; line stroke `#a3a3a3` w1; rect border `#d4d4d4` w1, `fill:'none'`→transparent.

---

## File Structure

| File | Change |
|------|--------|
| `packages/report-designer/src/schema.ts` (modify) | Add `dataSource`, `boundColumns`; extend `TemplateParam`. |
| `packages/report-designer/src/render/units.ts` (new) | `PX_TO_PT`, `paperSizePt`, `toPt`. |
| `packages/report-designer/src/render/draw.ts` (new) | Per-element pdfkit draw fns. |
| `packages/report-designer/src/render/index.ts` (new) | `renderReportDesignPdf` + `ResolvedTable` type + buffering. |
| `packages/report-designer/src/index.ts` (modify) | `export * from './render';` (Node `.` barrel only — NOT `pure.ts`). |
| `packages/report-designer/package.json` (modify) | Add `pdfkit` + `@types/pdfkit`. |
| `packages/report-designer/src/render/*.test.ts` (new) | Renderer + units tests. |
| `apps/server/src/run-stored-query.ts` (new) | `prepareSelect` + `runStoredQuery`. |
| `apps/server/src/query-routes.ts` (modify) | Use `prepareSelect` in `/api/query/run`. |
| `apps/server/src/run-stored-query.test.ts` (new) | Helper tests. |
| `apps/server/src/report-designs-routes.ts` (modify) | Add `POST /api/report-designs/preview` + accept deps. |
| `apps/server/src/app.ts` (modify) | Pass `{ customQueries, runConnectorSql }` deps to `registerReportDesignRoutes`. |
| `apps/server/src/report-designs-routes.test.ts` (modify) | Preview-route tests. |
| `apps/studio/src/api.ts` (modify) | `previewReportDesign(design)`. |
| `apps/studio/src/api.reportDesigns.test.ts` (modify) | `previewReportDesign` URL/method test. |
| `apps/studio/src/report-designer/DataTab.tsx` (rewrite) | Query picker + Load columns + column pick/reorder/relabel + design-param editor. |
| `apps/studio/src/report-designer/ReportDesignerPage.tsx` (modify) | Wire DataTab props (selected element, patch fns, design params) + Preview kebab. |
| `apps/studio/src/report-designer/PreviewReportDesignDialog.tsx` (new) | Mirror `PreviewPdfDialog`. |
| `apps/studio/src/report-designer/DataTab.test.tsx` (new) | Binding + param editor tests. |
| `apps/studio/src/report-designer/PreviewReportDesignDialog.test.tsx` (new) | Preview dialog test. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` (modify) | New strings (EnShape parity). |

---

## Task 1: Model — table binding + typed params (`@openldr/report-designer/pure`)

**Files:** modify `packages/report-designer/src/schema.ts`, `packages/report-designer/src/schema.test.ts`.

- [ ] **Step 1: Failing test** — append to `schema.test.ts`:

```ts
import { ReportDesignSchema } from './schema';

describe('ReportDesignSchema — data binding', () => {
  it('accepts a table dataSource + boundColumns', () => {
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      pages: [{ id: 'p', elements: [{
        id: 'e', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 100, h: 50 },
        dataSource: { kind: 'custom-query', queryId: 'cq_1' },
        boundColumns: [{ key: 'organism', label: 'Organism' }, { key: 'pct_r', label: '%R' }],
      }] }],
    });
    const el = out.pages[0].elements[0];
    expect(el.dataSource).toEqual({ kind: 'custom-query', queryId: 'cq_1' });
    expect(el.boundColumns).toEqual([{ key: 'organism', label: 'Organism' }, { key: 'pct_r', label: '%R' }]);
  });

  it('accepts a string param and a daterange param', () => {
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      parameters: [
        { key: 'facility', label: 'Facility', type: 'text', value: 'HQ' },
        { key: 'range', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
      ],
    });
    expect(out.parameters[0].value).toBe('HQ');
    expect(out.parameters[1].value).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });

  it('still accepts a bare {key,label,value} param (back-compat)', () => {
    const out = ReportDesignSchema.parse({ id: 'd', name: 'N', parameters: [{ key: 'k', label: 'L', value: 'v' }] });
    expect(out.parameters[0]).toMatchObject({ key: 'k', label: 'L', value: 'v' });
  });
});
```

- [ ] **Step 2: Run — verify it fails.** `pnpm --filter @openldr/report-designer exec vitest run src/schema.test.ts` → FAIL (`dataSource`/`boundColumns` stripped; daterange value rejected).

- [ ] **Step 3: Implement** in `schema.ts`. Add before `DesignElementSchema`:

```ts
export const DataSourceSchema = z.object({ kind: z.literal('custom-query'), queryId: z.string() });
export type DataSource = z.infer<typeof DataSourceSchema>;

export const BoundColumnSchema = z.object({ key: z.string(), label: z.string() });
export type BoundColumn = z.infer<typeof BoundColumnSchema>;
```

Add these fields inside `DesignElementSchema` (after `boundReport`):

```ts
  /** real table binding (supersedes boundReport) */
  dataSource: DataSourceSchema.optional(),
  /** picked/reordered/relabeled projection of the query's result columns */
  boundColumns: z.array(BoundColumnSchema).optional(),
```

Replace `TemplateParamSchema` with:

```ts
export const DateRangeValueSchema = z.object({ from: z.string(), to: z.string() });
export type DateRangeValue = z.infer<typeof DateRangeValueSchema>;

export const TemplateParamSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'daterange']).optional(),
  value: z.union([z.string(), DateRangeValueSchema]).optional(),
});
export type TemplateParam = z.infer<typeof TemplateParamSchema>;
```

- [ ] **Step 4: Run — verify pass.** `pnpm --filter @openldr/report-designer exec vitest run src/schema.test.ts` → PASS. Also `pnpm --filter @openldr/report-designer typecheck` and `pnpm --filter @openldr/studio typecheck` (studio re-exports these types via the alias — the wider `value` union must not break existing DataTab usage; if studio's current `DataTab.tsx` renders `pm.value` as a string and now the type is a union, that's fine because Task 6 rewrites DataTab — but if typecheck fails HERE, note it and proceed; Task 6 fixes the consumer). If studio typecheck fails only inside `DataTab.tsx` on `pm.value`, that is expected and resolved in Task 6; confirm no OTHER studio file breaks.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/schema.ts packages/report-designer/src/schema.test.ts
git commit -m "feat(report-designer): table dataSource + boundColumns + typed params"
```

---

## Task 2: PDF renderer (Node-only, pure)

**Files:** create `packages/report-designer/src/render/{units.ts, draw.ts, index.ts, index.test.ts, units.test.ts}`; modify `packages/report-designer/src/index.ts`, `packages/report-designer/package.json`.

- [ ] **Step 1: Add deps.** In `packages/report-designer/package.json` add to `dependencies`: `"pdfkit": "^0.15.0"` and to `devDependencies`: `"@types/pdfkit": "^0.13.4"`. **Match the exact versions `@openldr/report-builder/package.json` pins for pdfkit + @types/pdfkit** (open it; the numbers here are placeholders — the repo's pins win). Then `pnpm install` at repo root.

- [ ] **Step 2: `units.ts` + failing test.** `units.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PX_TO_PT, toPt, paperSizePt } from './units';

describe('units', () => {
  it('converts px@96 to pt@72 (×0.75)', () => {
    expect(PX_TO_PT).toBeCloseTo(0.75);
    expect(toPt({ x: 100, y: 200, w: 40, h: 20 })).toEqual({ x: 75, y: 150, w: 30, h: 15 });
  });
  it('gives A4 portrait + Letter landscape point sizes', () => {
    expect(paperSizePt('A4', 'portrait')).toEqual([595.28, 841.89]);
    const [w, h] = paperSizePt('Letter', 'landscape');
    expect([w, h]).toEqual([792, 612]);
  });
});
```

`units.ts`:

```ts
import type { Paper, Orientation, Rect } from '../schema';

export const PX_TO_PT = 72 / 96; // 0.75

const PORTRAIT_PT: Record<Paper, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
};

export function paperSizePt(paper: Paper, orientation: Orientation): [number, number] {
  const [w, h] = PORTRAIT_PT[paper];
  return orientation === 'landscape' ? [h, w] : [w, h];
}

export function toPt(r: Rect): Rect {
  return { x: r.x * PX_TO_PT, y: r.y * PX_TO_PT, w: r.w * PX_TO_PT, h: r.h * PX_TO_PT };
}
```

Run: `pnpm --filter @openldr/report-designer exec vitest run src/render/units.test.ts` → PASS.

- [ ] **Step 3: `draw.ts`** — per-element drawing. `ResolvedTable` lives in `index.ts` (Step 4); import its type. Interpolation supports `{{param.<key>}}` (from a prebuilt map) and `{{date}}`.

```ts
import type PDFDocument from 'pdfkit';
import type { DesignElement, ReportDesign } from '../schema';
import { toPt } from './units';
import type { ResolvedTable } from './index';

type Doc = InstanceType<typeof PDFDocument>;

const TEXT_COLOR = '#262626';
const LINE_COLOR = '#a3a3a3';
const RECT_BORDER = '#d4d4d4';

export function paramMap(design: ReportDesign, now: Date): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of design.parameters) {
    if (typeof p.value === 'string') m.set(p.key, p.value);
    else if (p.value) { m.set('from', p.value.from); m.set('to', p.value.to); }
  }
  m.set('date', now.toLocaleDateString());
  return m;
}

export function interpolate(input: string, tokens: Map<string, string>): string {
  return input
    .replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => tokens.get(k) ?? '')
    .replace(/\{\{\s*date\s*\}\}/g, tokens.get('date') ?? '');
}

export function drawElement(
  doc: Doc, el: DesignElement, tokens: Map<string, string>, resolved: ResolvedTable | undefined,
): void {
  const r = toPt(el.rect);
  const s = el.style ?? {};
  switch (el.kind) {
    case 'rect': {
      if (s.fill && s.fill !== 'none') doc.save().rect(r.x, r.y, r.w, r.h).fill(s.fill).restore();
      doc.save().lineWidth(s.strokeWidth ?? 1).strokeColor(s.strokeColor ?? RECT_BORDER)
        .rect(r.x, r.y, r.w, r.h).stroke().restore();
      return;
    }
    case 'line': {
      doc.save().lineWidth(s.strokeWidth ?? 1).strokeColor(s.strokeColor ?? LINE_COLOR)
        .moveTo(r.x, r.y).lineTo(r.x + r.w, r.y + r.h).stroke().restore();
      return;
    }
    case 'text':
    case 'datetime': {
      const raw = el.text ?? (el.kind === 'datetime' ? '{{date}}' : '');
      drawText(doc, interpolate(raw, tokens), r, s);
      return;
    }
    case 'image': {
      try {
        if (el.src) { doc.save().image(el.src, r.x, r.y, { fit: [r.w, r.h] }).restore(); return; }
      } catch { /* fall through to placeholder */ }
      doc.save().lineWidth(1).strokeColor(RECT_BORDER).dash(3, { space: 2 })
        .rect(r.x, r.y, r.w, r.h).stroke().undash().restore();
      return;
    }
    case 'table': {
      drawTable(doc, el, r, resolved);
      return;
    }
  }
}

function drawText(doc: Doc, str: string, r: { x: number; y: number; w: number; h: number }, s: DesignElement['style']): void {
  const st = s ?? {};
  doc.save()
    .font(st.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize((st.fontSize ?? 11) * 0.75) // element fontSize is px@96 too → to pt
    .fillColor(st.color ?? TEXT_COLOR)
    .text(str, r.x, r.y, { width: r.w, height: r.h, align: st.align ?? 'left', ellipsis: true });
  doc.restore();
}

function drawTable(
  doc: Doc, el: DesignElement, r: { x: number; y: number; w: number; h: number }, resolved: ResolvedTable | undefined,
): void {
  // Unbound → static columns/rows (looks-only fallback).
  if (!el.dataSource || !resolved) { drawStaticTable(doc, el, r); return; }
  if ('error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
  const cols = (el.boundColumns && el.boundColumns.length ? el.boundColumns : resolved.columns);
  const headers = cols.map((c) => c.label);
  const body = resolved.rows.map((row) => cols.map((c) => String(row[c.key] ?? '')));
  drawGrid(doc, r, headers, body);
}

function drawStaticTable(doc: Doc, el: DesignElement, r: { x: number; y: number; w: number; h: number }): void {
  drawGrid(doc, r, el.columns ?? [], (el.rows ?? []).map((row) => row.map(String)));
}

// Striped header + rows, CLIPPED to the element rect (v1: overflow truncated, no pagination).
// Mirror the striping/format approach of @openldr/report-builder/src/render/paint.ts drawTable.
function drawGrid(
  doc: Doc, r: { x: number; y: number; w: number; h: number }, headers: string[], rows: string[][],
): void {
  const n = Math.max(headers.length, 1);
  const colW = r.w / n;
  const rowH = 16; // pt
  doc.save().rect(r.x, r.y, r.w, r.h).clip();
  // header
  doc.rect(r.x, r.y, r.w, rowH).fill('#f5f5f5');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#262626');
  headers.forEach((h, i) => doc.text(h, r.x + i * colW + 3, r.y + 4, { width: colW - 6, ellipsis: true }));
  // rows (truncate to rect height)
  doc.font('Helvetica').fontSize(8).fillColor('#404040');
  const maxRows = Math.max(0, Math.floor((r.h - rowH) / rowH));
  rows.slice(0, maxRows).forEach((row, ri) => {
    const y = r.y + rowH + ri * rowH;
    if (ri % 2 === 1) doc.rect(r.x, y, r.w, rowH).fill('#fafafa').fillColor('#404040');
    row.forEach((cell, ci) => doc.text(cell, r.x + ci * colW + 3, y + 4, { width: colW - 6, ellipsis: true }));
  });
  doc.restore();
}

function drawErrorPlaceholder(doc: Doc, r: { x: number; y: number; w: number; h: number }, msg: string): void {
  doc.save().rect(r.x, r.y, r.w, r.h).fill('#fef2f2');
  doc.fillColor('#b91c1c').font('Helvetica').fontSize(8)
    .text(`Query error: ${msg}`, r.x + 4, r.y + 4, { width: r.w - 8, height: r.h - 8, ellipsis: true });
  doc.restore();
}
```

(Open `@openldr/report-builder/src/render/paint.ts` and match its `drawTable` striping + `drawErrorPlaceholder` idioms where they differ from the above — the above is a faithful adaptation, but if pdfkit fill/stroke ordering differs in the sibling, follow the sibling.)

- [ ] **Step 4: `index.ts` + failing test.** `index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import type { ReportDesign } from '../schema';

const NOW = new Date('2026-07-08T00:00:00Z');

function baseDesign(over: Partial<ReportDesign> = {}): ReportDesign {
  return { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p1', elements: [] }], ...over } as ReportDesign;
}

describe('renderReportDesignPdf', () => {
  it('returns a non-empty PDF buffer starting with %PDF', async () => {
    const buf = await renderReportDesignPdf(baseDesign(), new Map(), { now: NOW });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a bound table from resolved rows and a query-error placeholder without throwing', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'A', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q1' }, boundColumns: [{ key: 'org', label: 'Organism' }] },
      { id: 't2', kind: 'table', name: 'B', rect: { x: 10, y: 200, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q2' } },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([
      ['t1', { columns: [{ key: 'org', label: 'Organism' }], rows: [{ org: 'E. coli' }] }],
      ['t2', { error: 'boom' }],
    ]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('emits one PDF page per design page', async () => {
    const two = baseDesign({ pages: [{ id: 'a', elements: [] }, { id: 'b', elements: [] }] });
    const buf = await renderReportDesignPdf(two, new Map(), { now: NOW });
    expect(buf.toString('latin1')).toContain('/Type /Pages');
    // 2 pages → the Pages /Count is 2
    expect(buf.toString('latin1')).toMatch(/\/Count 2/);
  });
});
```

`index.ts`:

```ts
import PDFDocument from 'pdfkit';
import type { ReportDesign } from '../schema';
import { paperSizePt } from './units';
import { drawElement, paramMap } from './draw';

export type ResolvedTable =
  | { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
  | { error: string };

export interface RenderOptions { now?: Date }

/** Pure render: (design, pre-resolved table data) → PDF Buffer. No DB, no query execution. */
export function renderReportDesignPdf(
  design: ReportDesign, resolved: Map<string, ResolvedTable>, opts: RenderOptions = {},
): Promise<Buffer> {
  const now = opts.now ?? new Date();
  const tokens = paramMap(design, now);
  const pages = design.pages.length ? design.pages : [{ id: '_empty', elements: [] }];
  const [w, h] = paperSizePt(design.paper, design.orientation);

  const doc = new PDFDocument({ size: [w, h], margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const page of pages) {
    doc.addPage({ size: [w, h], margin: 0 });
    for (const el of page.elements) drawElement(doc, el, tokens, resolved.get(el.id));
  }
  doc.end();
  return done;
}
```

Run: `pnpm --filter @openldr/report-designer exec vitest run src/render` → all PASS. (If the `/Count 2` assertion is brittle against the installed pdfkit version, assert instead that the buffer contains two `/Type /Page` occurrences — adjust to what the version emits, but keep a real page-count assertion.)

- [ ] **Step 5: Export from the `.` barrel only.** In `packages/report-designer/src/index.ts` add a line: `export * from './render';`. Do NOT touch `pure.ts` (studio must stay browser-safe — pdfkit is Node-only). Verify studio still typechecks (it imports `/pure`, which does not re-export render): `pnpm --filter @openldr/studio typecheck`.

- [ ] **Step 6: Verify** — `pnpm --filter @openldr/report-designer exec vitest run` (all pass) + `pnpm --filter @openldr/report-designer typecheck` (clean).

- [ ] **Step 7: Commit**

```bash
git add packages/report-designer/src/render packages/report-designer/src/index.ts packages/report-designer/package.json pnpm-lock.yaml
git commit -m "feat(report-designer): server-side pdfkit renderer (pure, pre-resolved data)"
```

---

## Task 3: Server — shared `prepareSelect` + `runStoredQuery`

**Files:** create `apps/server/src/run-stored-query.ts`, `apps/server/src/run-stored-query.test.ts`; modify `apps/server/src/query-routes.ts`.

- [ ] **Step 1: Failing test** — `run-stored-query.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { prepareSelect, runStoredQuery } from './run-stored-query';

const PARAMS = [{ id: 'facility', label: 'F', type: 'text' as const, required: true }];

describe('prepareSelect', () => {
  it('substitutes params then validates SELECT-only', () => {
    const sql = prepareSelect("select * from t where f = {{param.facility}}", PARAMS, { facility: 'HQ' });
    expect(sql).toContain("f = 'HQ'");
  });
  it('rejects non-SELECT', () => {
    expect(() => prepareSelect('delete from t', [], {})).toThrow();
  });
  it('throws on a missing required param', () => {
    expect(() => prepareSelect('select * from t where f = {{param.facility}}', PARAMS, {})).toThrow(/facility/);
  });
});

describe('runStoredQuery', () => {
  const rec = { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select * from t where f = {{param.facility}}', params: PARAMS };
  const deps = () => ({
    customQueries: { get: vi.fn(async (id: string) => (id === 'cq_1' ? rec : undefined)) } as never,
    runConnectorSql: vi.fn(async () => ({ columns: [{ key: 'f', label: 'f' }], rows: [{ f: 'HQ' }] })),
  });

  it('loads the record, substitutes, validates, runs against its connector', async () => {
    const d = deps();
    const out = await runStoredQuery(d, 'cq_1', { facility: 'HQ' });
    expect(out.rows).toEqual([{ f: 'HQ' }]);
    expect(d.runConnectorSql).toHaveBeenCalledWith({ connectorId: 'c1', sql: expect.stringContaining("'HQ'") });
  });
  it('throws when the query id is unknown', async () => {
    await expect(runStoredQuery(deps(), 'nope', {})).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/server exec vitest run src/run-stored-query.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `run-stored-query.ts`:

```ts
import type { CustomQueryParam, CustomQueryStore } from '@openldr/db';
import { validateSelectSql } from '@openldr/dashboards';
import { substituteParams } from './query-sql';

const ROW_CAP = 1000;

export interface RunStoredQueryDeps {
  customQueries: Pick<CustomQueryStore, 'get'>;
  runConnectorSql(input: { connectorId: string; sql: string }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

/** Substitute {{param.*}} then enforce SELECT-only. Returns the safe inner SQL. Throws on bad param/SQL. */
export function prepareSelect(sql: string, params: CustomQueryParam[], values: Record<string, unknown>): string {
  const inner = params.length ? substituteParams(sql, params, values) : sql;
  validateSelectSql(inner);
  return inner;
}

/** Load a stored custom query by id, run it (SELECT-only, row-capped) against its connector. */
export async function runStoredQuery(
  deps: RunStoredQueryDeps, queryId: string, values: Record<string, unknown>,
): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }> {
  const rec = await deps.customQueries.get(queryId);
  if (!rec) throw new Error(`custom query not found: ${queryId}`);
  const inner = prepareSelect(rec.sql, rec.params, values).replace(/;\s*$/, '');
  const sql = `select * from (${inner}) as _q limit ${ROW_CAP}`;
  return deps.runConnectorSql({ connectorId: rec.connectorId, sql });
}
```

Note: `CustomQueryParam`/`CustomQueryStore` are exported from `@openldr/db` (confirm — `query-routes.ts` imports `CustomQueryStore` from `@openldr/db` and `CustomQueryParam` from `@openldr/dashboards`; use whichever the repo actually exports for each. If `CustomQueryParam` is only in `@openldr/dashboards`, import it from there, matching `query-sql.ts`'s import).

- [ ] **Step 4: Run — verify pass.** `pnpm --filter @openldr/server exec vitest run src/run-stored-query.test.ts` → PASS.

- [ ] **Step 5: Refactor `/api/query/run` to share `prepareSelect`** (no behavior change). In `query-routes.ts`, replace the inline substitute+validate block (currently lines ~100-103):

```ts
    let inner: string;
    try {
      inner = prepareSelect(parsed.data.sql, (parsed.data.params ?? []) as never, parsed.data.values ?? {});
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
```

Add `import { prepareSelect } from './run-stored-query';` and remove the now-unused `substituteParams`/`validateSelectSql` imports IF they are no longer referenced elsewhere in the file (they are still used by `param-options`/connectors introspection — check; keep whichever remain used). Keep the rest of the handler (the `inner.replace(/;\s*$/,'')`, LIMIT/offset wrap, count) exactly as-is.

- [ ] **Step 6: Verify no behavior change** — `pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts` (existing query-run tests still green) + `pnpm --filter @openldr/server typecheck`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/run-stored-query.ts apps/server/src/run-stored-query.test.ts apps/server/src/query-routes.ts
git commit -m "feat(server): extract runStoredQuery + prepareSelect (shared /query run pipeline)"
```

---

## Task 4: Server — `POST /api/report-designs/preview`

**Files:** modify `apps/server/src/report-designs-routes.ts`, `apps/server/src/app.ts`, `apps/server/src/report-designs-routes.test.ts`.

- [ ] **Step 1: Failing test** — add to `report-designs-routes.test.ts` (mirror its existing harness that builds the app with a fake ctx + role injection). Add a `reportDesignRouteDeps` object to the registration and cases:

```ts
// in the harness, register with deps:
//   registerReportDesignRoutes(app, ctx, { customQueries: fakeCq, runConnectorSql: fakeRun });
// where fakeCq.get returns a record for 'cq_1', fakeRun returns rows.

it('renders a design body to a PDF (bound table resolved)', async () => {
  const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [{ key: 'facility', label: 'F', type: 'text', value: 'HQ' }],
    pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
  const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design, headers: adminHeaders });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
});

it('400s an invalid design body', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: { id: 'd' }, headers: adminHeaders });
  expect(res.statusCode).toBe(400);
});

it('403s a non-manager/non-analyst role', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: { id: 'd', name: 'N' }, headers: technicianHeaders });
  expect(res.statusCode).toBe(403);
});

it('renders a per-table error placeholder when a bound query fails (no 500)', async () => {
  // fakeRun rejects for this test's connector; still 200 + %PDF
  const design = { id: 'd', name: 'N', pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
  const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design, headers: adminHeaders });
  expect(res.statusCode).toBe(200);
});
```

(Copy the EXACT role-header + fake-ctx harness from the existing `report-designs-routes.test.ts`; add `data_analyst` to whatever produces an allowed role and a technician header for the 403. Provide `fakeCq.get` returning `{ id:'cq_1', name:'Q', connectorId:'c1', sql:'select 1 as n', params:[] }` and a `fakeRun` returning `{ columns:[{key:'n',label:'n'}], rows:[{n:1}] }`; for the error test, make `fakeRun` reject.)

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/server exec vitest run src/report-designs-routes.test.ts` → FAIL (route missing / deps arg).

- [ ] **Step 3: Implement.** In `report-designs-routes.ts`:
  - Imports: `import { ReportDesignSchema, renderReportDesignPdf, type ResolvedTable } from '@openldr/report-designer';` (the Node `.` barrel — server may import it; `report-designs-routes.ts` currently imports `@openldr/report-designer/pure`, so switch that import to the barrel OR add a second import line for the render bits). `import { runStoredQuery, type RunStoredQueryDeps } from './run-stored-query';`
  - Change the signature to accept deps:

```ts
export function registerReportDesignRoutes(
  app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: RunStoredQueryDeps,
): void {
```

  - Add the route (place after the CRUD routes; **reads/CRUD unchanged**):

```ts
  const PREVIEW = { preHandler: requireRole('lab_admin', 'lab_manager', 'data_analyst') };

  app.post('/api/report-designs/preview', PREVIEW, async (req, reply) => {
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const design = p.data;

    const resolved = new Map<string, ResolvedTable>();
    for (const page of design.pages) {
      for (const el of page.elements) {
        if (el.kind !== 'table' || !el.dataSource) continue;
        // Map the query's declared params → values from the design's parameters (by id === key).
        const rec = await deps.customQueries.get(el.dataSource.queryId);
        const values: Record<string, unknown> = {};
        if (rec) for (const qp of rec.params) {
          const dp = design.parameters.find((x) => x.key === qp.id);
          if (dp?.value != null) values[qp.id] = dp.value;
        }
        try {
          const { columns, rows } = await runStoredQuery(deps, el.dataSource.queryId, values);
          resolved.set(el.id, { columns, rows });
        } catch (e) {
          resolved.set(el.id, { error: (e as Error).message });
        }
      }
    }

    const pdf = await renderReportDesignPdf(design, resolved);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', 'inline; filename="report-design.pdf"');
    return reply.send(pdf);
  });
```

  Note: `deps.customQueries.get` is used both for param-mapping and inside `runStoredQuery`; that double-load is fine (cheap, and keeps `runStoredQuery` self-contained). If you prefer, load `rec` once and pass values — but keep it simple.

- [ ] **Step 4: Wire deps in `app.ts`.** Change line 87 `registerReportDesignRoutes(app, ctx);` to:

```ts
  registerReportDesignRoutes(app, ctx, {
    customQueries: createCustomQueryStore(ctx.internalDb),
    runConnectorSql: (input) => {
      const run = ctx.workflows.services.runConnectorSql;
      if (!run) throw new Error('connector SQL runner unavailable');
      return run(input);
    },
  });
```

(`createCustomQueryStore` is already imported in `app.ts:27`. This mirrors the `registerQueryRoutes` wiring at `app.ts:92-112`.)

- [ ] **Step 5: Verify** — `pnpm --filter @openldr/server exec vitest run src/report-designs-routes.test.ts` (all pass incl. the 4 new) + `pnpm --filter @openldr/server typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/report-designs-routes.ts apps/server/src/app.ts apps/server/src/report-designs-routes.test.ts
git commit -m "feat(server): POST /api/report-designs/preview (resolve bound tables + render PDF)"
```

---

## Task 5: Studio — `previewReportDesign` client fn

**Files:** modify `apps/studio/src/api.ts`, `apps/studio/src/api.reportDesigns.test.ts`.

- [ ] **Step 1: Failing test** — add to `api.reportDesigns.test.ts` (mirror the existing per-fn URL/method assertions using the mocked `authFetch`/`fetch`):

```ts
it('previewReportDesign POSTs the design and returns a Blob', async () => {
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => blob } as never);
  const design = { id: 'd', name: 'N' } as never;
  const out = await previewReportDesign(design);
  expect(fetchMock).toHaveBeenCalledWith('/api/report-designs/preview', expect.objectContaining({ method: 'POST' }));
  expect(out).toBe(blob);
});
```

(Match the existing test file's mock mechanism — it mocks `authFetch`/`fetch`; use the same handle and import `previewReportDesign`.)

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/studio exec vitest run src/api.reportDesigns.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `api.ts`, next to the other report-design fns:

```ts
export const previewReportDesign = (design: ReportDesign): Promise<Blob> =>
  authFetch('/api/report-designs/preview', { ...json(design), method: 'POST' }).then((r) => {
    if (!r.ok) throw new Error(`preview failed: ${r.status}`);
    return r.blob();
  });
```

(Use the file's real JSON-body helper — the report-design CRUD fns already use one, e.g. `json(...)`/`jbody(...)`; match it. `ReportDesign` is already imported in `api.ts` from `@openldr/report-designer/pure`.)

- [ ] **Step 4: Verify** — `pnpm --filter @openldr/studio exec vitest run src/api.reportDesigns.test.ts` (pass) + `pnpm --filter @openldr/studio typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.reportDesigns.test.ts
git commit -m "feat(report-designer): previewReportDesign client fn (authFetch)"
```

---

## Task 6: Studio — Data tab table binding (query picker + Load columns + column editor)

**Files:** rewrite `apps/studio/src/report-designer/DataTab.tsx`; modify `apps/studio/src/report-designer/ReportDesignerPage.tsx`, `apps/studio/src/report-designer/InspectorTabs.tsx` (prop threading); create `apps/studio/src/report-designer/DataTab.test.tsx`; modify i18n.

**Context:** The Data tab today (`DataTab.tsx`) takes `{ template }` and lists distinct `boundReport` labels + read-only params. It must become a real editor scoped to the **selected table element**. It needs: the selected element, a patch fn (`onPatchElement(id, patch, opts?)` — already used by `PropertiesTab`; reuse the SAME wiring), the list of custom queries, and a query-runner for Load columns. Read `PropertiesTab.tsx` for the exact `onPatchElement` signature + how `ReportDesignerPage` passes patch fns into the inspector, and `apps/studio/src/query/api.ts` for `queryApi.list()`/`queryApi.run(...)`.

- [ ] **Step 1: Failing test** — `DataTab.test.tsx`. Mock `../../query/api` (`queryApi.list` → one query `{ id:'cq_1', name:'AMR', connectorId:'c1', sql:'select 1', params:[] }`; `queryApi.run` → `{ columns:[{key:'org',label:'Organism'},{key:'pct',label:'%R'}], rows:[] }`). Render `DataTab` with a selected table element + a spy `onPatchElement`. Assert:
  1. picking a query calls `onPatchElement('t', { dataSource: { kind:'custom-query', queryId:'cq_1' } }, ...)`.
  2. clicking **Load columns** calls `queryApi.run` and then including a column calls `onPatchElement` with `boundColumns` containing `{ key:'org', label:'Organism' }`.

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { DataTab } from './DataTab';

vi.mock('../../query/api', () => ({ queryApi: {
  list: vi.fn(async () => [{ id: 'cq_1', name: 'AMR', connectorId: 'c1', sql: 'select 1', params: [] }]),
  run: vi.fn(async () => ({ columns: [{ key: 'org', label: 'Organism' }, { key: 'pct', label: '%R' }], rows: [] })),
} }));

const tableEl = { id: 't', kind: 'table' as const, name: 'T', rect: { x: 0, y: 0, w: 100, h: 50 } };

it('binds a query and loads/includes a column', async () => {
  const onPatchElement = vi.fn();
  render(<DataTab element={tableEl} parameters={[]} onPatchElement={onPatchElement} onPatchParameters={vi.fn()} />);
  // (drive the query Select + Load columns + include a column per the real controls; assert onPatchElement calls)
});
```

(Fill the interaction body against the real controls you build in Step 3. jsdom 25 + Radix: menus/selects open on pointerDown — the repo's `setupTests.ts` polyfills PointerEvent; follow existing report-designer test patterns for opening a shadcn `Select`.)

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/studio exec vitest run src/report-designer/DataTab.test.tsx` → FAIL.

- [ ] **Step 3: Rewrite `DataTab.tsx`.** New props + behavior (param editor is Task 7 — this task wires `onPatchParameters` prop but the param UI can be a stub list this task, fully built in Task 7; OR build both here and make Task 7 empty — prefer: build binding here, params in Task 7):

```tsx
interface Props {
  element: DesignElement | undefined;             // the selected element (may be non-table)
  parameters: TemplateParam[];                     // design-level params (edited in Task 7)
  onPatchElement: (id: string, patch: Partial<DesignElement>, opts?: { discrete?: boolean }) => void;
  onPatchParameters: (next: TemplateParam[]) => void; // used in Task 7
}
```

Binding UI (only when `element?.kind === 'table'`):
- **Query Select** (shadcn `Select`) sourced from `queryApi.list()` (load in a `useEffect`, store `CustomQuery[]`); on change → `onPatchElement(element.id, { dataSource: { kind: 'custom-query', queryId } }, { discrete: true })`.
- **Load columns** button → find the selected `CustomQuery` in the loaded list; build `values` from `parameters` (match `qp.id === param.key`, pass `param.value`); `queryApi.run({ connectorId: cq.connectorId, sql: cq.sql, params: cq.params, values, limit: 1 })`; store `result.columns` in local state. Show a thin error line if it throws (e.g. missing required param).
- **Column list** — for each loaded result column: a checkbox to include (adds/removes `{ key, label }` in `boundColumns`), an editable label `Input` (relabels the included column), and up/down (or drag) to reorder. Each change → `onPatchElement(element.id, { boundColumns: next }, { discrete: true })`. Included set + order = the current `element.boundColumns` (fallback: none → nothing selected). Reuse shared `Input`/`Button`/`Checkbox` primitives + edge-to-edge rows (house style).

When `element` is undefined or not a table: show a thin hint (`t('reportDesigner.selectTableToBind')`). Keep the design-param editor section rendered regardless (Task 7).

- [ ] **Step 4: Thread props** in `ReportDesignerPage.tsx` + `InspectorTabs.tsx`. The inspector currently passes `template` to `DataTab`; change it to pass the selected element (`template.pages.flatMap(...).find(id === selectedId)` — reuse the existing `allElements`/`findElement` helper), `template.parameters`, the existing `onPatchElement`, and a new `onPatchParameters` that patches `template.parameters` at the design level (coalesced vs discrete via the existing `updateTemplate`/`pushTemplate` seam — mirror how `PropertiesTab`'s page patches flow). Read `InspectorTabs.tsx` for how `DataTab` is currently mounted and swap the prop set.

- [ ] **Step 5: i18n** — add `reportDesigner.{bindQuery, loadColumns, selectTableToBind, columns, noColumnsLoaded, loadColumnsError}` to `en.ts`/`fr.ts`/`pt.ts` (translated, `EnShape` parity). Run `pnpm --filter @openldr/studio exec vitest run src/i18n/parity.test.ts`.

- [ ] **Step 6: Verify** — `pnpm --filter @openldr/studio exec vitest run src/report-designer/DataTab.test.tsx src/report-designer src/i18n/parity.test.ts` (pass; existing report-designer tests still green) + `pnpm --filter @openldr/studio typecheck` (clean — this also resolves any `pm.value` union breakage from Task 1).

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/report-designer/DataTab.tsx apps/studio/src/report-designer/DataTab.test.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/InspectorTabs.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): Data tab table binding (query picker + load/pick columns)"
```

---

## Task 7: Studio — Data tab design-parameter editor

**Files:** modify `apps/studio/src/report-designer/DataTab.tsx`, `apps/studio/src/report-designer/DataTab.test.tsx`, i18n.

- [ ] **Step 1: Failing test** — add to `DataTab.test.tsx`:

```tsx
it('adds and edits a design parameter (text + daterange)', () => {
  const onPatchParameters = vi.fn();
  render(<DataTab element={undefined} parameters={[]} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
  fireEvent.click(screen.getByText(/add parameter/i));
  expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ key: expect.any(String), type: 'text' })]);
});

it('renders from/to inputs for a daterange param and patches its value', () => {
  const onPatchParameters = vi.fn();
  const params = [{ key: 'range', label: 'Range', type: 'daterange' as const, value: { from: '', to: '' } }];
  render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
  const from = screen.getByLabelText(/from/i);
  fireEvent.change(from, { target: { value: '2026-01-01' } });
  fireEvent.blur(from);
  expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ value: { from: '2026-01-01', to: '' } })]);
});
```

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/studio exec vitest run src/report-designer/DataTab.test.tsx` → FAIL.

- [ ] **Step 3: Implement the param editor** section in `DataTab.tsx` (always visible, below the binding section):
  - **Parameters** header + **Add parameter** button → appends `{ key: 'param' + (n+1), label: 'Param ' + (n+1), type: 'text', value: '' }` via `onPatchParameters([...parameters, newParam])`.
  - Per param row: `key` Input, `label` Input, `type` Select (`text`/`select`/`daterange`), a value editor by type — text/select → a single Input (`value` string); `daterange` → two date `Input`s labeled From/To writing `value: { from, to }`. A remove (×) button. Each edit rebuilds the array immutably and calls `onPatchParameters(next)`. Use the blur-commit pattern (the report-designer `NumberField`/text fields commit on blur — mirror it) so typing isn't clobbered.

- [ ] **Step 4: i18n** — add `reportDesigner.{addParameter, paramKey, paramLabel, paramType, from, to, removeParameter}` to en/fr/pt (parity). Run the parity test.

- [ ] **Step 5: Verify** — `pnpm --filter @openldr/studio exec vitest run src/report-designer/DataTab.test.tsx src/i18n/parity.test.ts` (pass) + `pnpm --filter @openldr/studio typecheck`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/report-designer/DataTab.tsx apps/studio/src/report-designer/DataTab.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): design-level parameter editor in the Data tab"
```

---

## Task 8: Studio — Preview modal

**Files:** create `apps/studio/src/report-designer/PreviewReportDesignDialog.tsx`, `apps/studio/src/report-designer/PreviewReportDesignDialog.test.tsx`; modify `apps/studio/src/report-designer/ReportDesignerPage.tsx` (+ the kebab wiring in `CanvasHeader.tsx`), i18n.

**Context:** Mirror `apps/studio/src/reports-builder/PreviewPdfDialog.tsx` (loading/error/blob states, `active` stale-guard, effect keyed on open + inputs) and render the blob via `apps/studio/src/reports/PdfCanvasViewer.tsx`. The Preview kebab item currently maps to a `noop` `onPreview` in `ReportDesignerPage.tsx` — wire it to open this dialog with the **current in-editor design** (`template`).

- [ ] **Step 1: Failing test** — `PreviewReportDesignDialog.test.tsx`. Mock `../api` (`previewReportDesign` → a `Blob`) and `../reports/PdfCanvasViewer` (a stub that shows a testid). Assert opening the dialog calls `previewReportDesign(design)` and renders the viewer.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PreviewReportDesignDialog } from './PreviewReportDesignDialog';

vi.mock('../api', () => ({ previewReportDesign: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })) }));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div data-testid="pdf-viewer" /> }));

it('fetches and renders the design PDF when open', async () => {
  const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [] } as never;
  render(<PreviewReportDesignDialog open design={design} onOpenChange={vi.fn()} />);
  const { previewReportDesign } = await import('../api');
  await waitFor(() => expect(previewReportDesign).toHaveBeenCalledWith(design));
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — verify fail.** `pnpm --filter @openldr/studio exec vitest run src/report-designer/PreviewReportDesignDialog.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `PreviewReportDesignDialog.tsx` — copy `PreviewPdfDialog.tsx`'s structure verbatim, swapping: props `{ open; design: ReportDesign; onOpenChange }`; the fetch call → `previewReportDesign(design)`; the effect key → `[open, design]` (or a stable serialization: `[open, JSON.stringify(design)]` to re-render on edits); keep the `active` stale-guard, loading (`t('reportDesigner.rendering')`), error (destructive text), and blob→`PdfCanvasViewer` states; `DialogContent` `max-w-4xl` + `h-[70vh]`.

- [ ] **Step 4: Wire the kebab** in `ReportDesignerPage.tsx`: add `const [previewOpen, setPreviewOpen] = useState(false);`, change the Preview action from `noop` to `() => setPreviewOpen(true)`, and render `<PreviewReportDesignDialog open={previewOpen} design={template} onOpenChange={setPreviewOpen} />` (guard `template` exists). If the kebab item lives in `CanvasHeader.tsx`, thread an `onPreview` prop (it likely already exists as a `noop` — repoint it).

- [ ] **Step 5: i18n** — add `reportDesigner.{previewTitle, rendering, previewError}` to en/fr/pt (parity). Run parity test.

- [ ] **Step 6: Verify** — `pnpm --filter @openldr/studio exec vitest run src/report-designer src/i18n/parity.test.ts` (pass) + `pnpm --filter @openldr/studio typecheck`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/report-designer/PreviewReportDesignDialog.tsx apps/studio/src/report-designer/PreviewReportDesignDialog.test.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/CanvasHeader.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): Preview modal (renders the working design to PDF)"
```

---

## Task 9: Full gate + live smoke

- [ ] **Step 1: Whole-repo gate** — `pnpm turbo run typecheck test --force` (NEVER pipe through `tail`). Expect green except the two known flakes (studio `api.test.ts` dedupe flake; parallel-turbo package timeouts — re-run those in isolation to confirm). Fix any real cross-package breakage.

- [ ] **Step 2: Live smoke** (per [[playwright-live-troubleshooting]] / MEMORY): `docker compose up -d postgres`; start API `node dev.mjs` (NO `--watch`) with `AUTH_DEV_BYPASS=true`; start vite studio. Seed/create a **Custom Query** in the `/query` workbench against the dev Postgres connector (e.g. `select organism, count(*) as n from observations group by 1` — or reuse a seeded one), noting its params. Then in `/report-designer`: open a design → select a table element → Data tab → pick that query → Load columns → include/reorder a couple → set any required design parameters → **Preview** → the modal shows a PDF with **real rows** from the query. Confirm: an unbound table still renders its static sample; a query error shows the red placeholder (not a crashed modal); text `{{date}}`/`{{param.*}}` interpolate. Tear down (stop API + vite, `docker compose stop postgres`, no `-v`).

---

## Self-Review

**Spec coverage:** §2 model (dataSource/boundColumns/typed params) → Task 1. §4 renderer (pure, px→pt, all kinds, clip, error placeholder, `.`-only export) → Task 2. §5 `runStoredQuery` + shared gate + resource-less preview route (roles incl. data_analyst, body-driven, per-table error) → Tasks 3–4. §6 studio: `previewReportDesign` via authFetch → Task 5; Data tab binding (picker + Load columns + pick/reorder/relabel) → Task 6; design-param editor → Task 7; Preview modal (working design) → Task 8. §7 testing distributed per task; §9 gate + live smoke → Task 9. §8 deferrals (Excel, pagination, chart/kpi, caching, non-Postgres, autosave) untouched. ✓

**Placeholder scan:** The UI tasks (6/7/8) reference "mirror `PreviewPdfDialog`/`PropertiesTab`/`queryApi` and fill the interaction body against the real controls" — these are pointers to concrete existing code the engineer transcribes, matching how the persistence plan handled the large `ReportDesignerPage` rewire. The renderer, helper, route, api fn, and schema steps carry complete code. No TODO/TBD.

**Type consistency:** `dataSource:{kind:'custom-query',queryId}`, `boundColumns:{key,label}[]`, `TemplateParam.value: string|{from,to}`, `ResolvedTable = {columns,rows} | {error}`, `renderReportDesignPdf(design, resolved, opts?)`, `RunStoredQueryDeps = {customQueries, runConnectorSql}`, `runStoredQuery(deps, id, values)`, `prepareSelect(sql, params, values)`, `previewReportDesign(design)` — names are consistent across Tasks 1→8. The renderer imports the model types from `../schema`; the route imports render + schema from the `@openldr/report-designer` `.` barrel (Node), studio imports only `/pure` (no pdfkit). `runConnectorSql` result `{columns:{key,label}[], rows:Record<string,unknown>[]}` matches the renderer's `ResolvedTable`. Preview route param-mapping (`qp.id === design param.key`) matches `substituteParams` (which keys by param `id`).
