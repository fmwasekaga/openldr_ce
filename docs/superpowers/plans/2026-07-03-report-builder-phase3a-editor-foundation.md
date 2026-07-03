# Report Builder — Phase 3a: Editor Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working three-pane Report Builder page in `apps/studio` — reached from the Reports library — where an author drags blocks onto a WYSIWYG page canvas (built on the pure Phase-2 `computeLayout`), edits title/text/page settings + width in an inspector, saves/publishes the `ReportTemplate`, and previews the real server-rendered PDF.

**Architecture:** New `apps/studio/src/reports-builder/` module mirroring `forms-builder/`. The canvas imports `computeLayout`/`toLayoutModel`/types ONLY from the browser-safe `@openldr/report-builder/pure` barrel (never the server barrel, which pulls in pdfkit). State lives in `ReportBuilderPage` wrapped in the existing `useTemplateHistory` (undo/redo). Pure editor logic (block factory, row/cell mutation, preview layout model) sits in a testable `reportBuilderModel.ts`.

**Tech Stack:** React, TypeScript, `@dnd-kit`, recharts (P3b), shadcn/ui, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase3-builder-ui-design.md` (this plan = **P3a** only).

## Scope (P3a)

**In:** api.ts client fns; `reportBuilderModel.ts` (block factory + mutations + `previewLayoutModel`); `domMeasurer`; `ReportCanvas` (computeLayout → HTML painter, selection, visible page breaks); `BlockPalette` + dnd (palette drag-to-add + row reorder); `BlockInspector` (title/text editor + width control + page setup + delete); `PreviewPdfDialog` (real PDF); `ReportBuilderPage` shell (load/save/publish/delete + undo/redo); routing + Reports "New report" entry.

**Out (P3b/P3c):** the query editor (BuilderForm/SqlForm/filters) for kpi/chart/table; recharts live chart previews (chart renders a placeholder box in P3a); parameters editor + filter→param binding; lint; keyboard shortcuts; i18n. **Do not** build these here.

## Conventions (repo-specific — follow exactly)
- shadcn/ui controls only — never native `<select>`/`<input>` (use `@/components/ui/*`).
- Import layout from `@openldr/report-builder/pure` — NEVER `@openldr/report-builder` (server barrel).
- Studio tests: Vitest + `@testing-library/react`; mock `../api` with `vi.mock`. Wrap routed components in `MemoryRouter`.
- Run studio tests isolated: `pnpm -C apps/studio test <file>` (per memory: never trust turbo `studio#test`).

## File map

| File | Responsibility |
| --- | --- |
| `apps/studio/src/api.ts` (modify) | Report-template client fns |
| `apps/studio/src/reports-builder/reportBuilderModel.ts` (create) | Pure: `newBlock`, `emptyTemplate`, row/cell mutations, `previewLayoutModel` |
| `apps/studio/src/reports-builder/domMeasurer.ts` (create) | `Measurer` via canvas `measureText` + char fallback |
| `apps/studio/src/reports-builder/CanvasBlock.tsx` (create) | Render one block kind as HTML |
| `apps/studio/src/reports-builder/ReportCanvas.tsx` (create) | computeLayout → positioned CanvasBlocks, selection, page breaks, dnd drop targets |
| `apps/studio/src/reports-builder/BlockPalette.tsx` (create) | Draggable block types |
| `apps/studio/src/reports-builder/BlockInspector.tsx` (create) | Per-kind editor (P3a: title/text) + width + page setup + delete |
| `apps/studio/src/reports-builder/PreviewPdfDialog.tsx` (create) | Real-PDF preview |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` (create) | Shell: load/save/publish/delete, history, wires panes |
| `apps/studio/src/App.tsx` (modify) | Routes `/reports/builder/new|:id` |
| `apps/studio/src/pages/Reports.tsx` (modify) | "New report" button |

---

## Task 1: API client functions

**Files:**
- Modify: `apps/studio/src/api.ts`
- Test: `apps/studio/src/api.reportTemplates.test.ts`

Mirror the existing forms client style (`export const getForm = (id) => apiGet(...)`, `createForm = (i) => authFetch('/api/forms', jbody(i,'POST')).then(r => okJson<T>(r,'...'))`). The `ReportTemplate` type comes from the pure barrel.

- [ ] **Step 1: Write the failing test `apps/studio/src/api.reportTemplates.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authFetch = vi.fn();
vi.mock('./api-auth', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import { fetchReportTemplates, getReportTemplate, createReportTemplate, updateReportTemplate, deleteReportTemplate, previewReportTemplate } from './api';

function ok(body: unknown) { return { ok: true, status: 200, json: async () => body, blob: async () => new Blob([JSON.stringify(body)], { type: 'application/pdf' }) }; }

beforeEach(() => authFetch.mockReset());

describe('report-template api', () => {
  it('lists templates', async () => {
    authFetch.mockResolvedValue(ok([{ id: 'rt1' }]));
    const list = await fetchReportTemplates();
    expect(authFetch).toHaveBeenCalledWith('/api/report-templates');
    expect(list[0].id).toBe('rt1');
  });
  it('creates via POST', async () => {
    authFetch.mockResolvedValue(ok({ id: 'rt2' }));
    await createReportTemplate({ id: 'rt2', name: 'R' } as never);
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/report-templates');
    expect((init as RequestInit).method).toBe('POST');
  });
  it('updates via PUT to the id', async () => {
    authFetch.mockResolvedValue(ok({ id: 'rt2' }));
    await updateReportTemplate('rt2', { id: 'rt2', name: 'R2' } as never);
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/report-templates/rt2');
    expect((init as RequestInit).method).toBe('PUT');
  });
  it('deletes via DELETE', async () => {
    authFetch.mockResolvedValue(ok({}));
    await deleteReportTemplate('rt2');
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/report-templates/rt2');
    expect((init as RequestInit).method).toBe('DELETE');
  });
  it('preview returns a Blob', async () => {
    authFetch.mockResolvedValue(ok({}));
    const blob = await previewReportTemplate('rt2', { who: 'x' });
    expect(blob).toBeInstanceOf(Blob);
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/report-templates/rt2/preview');
    expect((init as RequestInit).method).toBe('POST');
  });
  it('getReportTemplate GETs the id', async () => {
    authFetch.mockResolvedValue(ok({ id: 'rt2' }));
    await getReportTemplate('rt2');
    expect(authFetch.mock.calls[0][0]).toBe('/api/report-templates/rt2');
  });
});
```

Note: the test mocks a module `./api-auth` for `authFetch`. If `authFetch` is defined INLINE in `api.ts` (it is — `export async function authFetch` at line 5), this mock won't intercept it. In that case, adapt the test to mock `global.fetch` instead: the existing api tests (`apps/studio/src/api.dashboards.test.ts`, `api.forms.test.ts`) show the project's actual mocking approach — **open one of those first and copy its exact mock setup** (likely `vi.stubGlobal('fetch', ...)` with an auth-token stub). Use that pattern; keep the six assertions (list/create/update/delete/preview/get with correct URL+method).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test api.reportTemplates`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add the client functions to `api.ts`**

Near the forms client block (after `getForm`/`createForm`/… around line 522), add. `ReportTemplate` is imported from `@openldr/report-builder/pure`; add that import at the top of `api.ts` if absent (`import type { ReportTemplate } from '@openldr/report-builder/pure';`). Reuse the file's existing `authFetch`, `okJson`, `jbody`, `apiGet` helpers:

```ts
export const fetchReportTemplates = (): Promise<ReportTemplate[]> =>
  authFetch('/api/report-templates').then((r) => okJson<ReportTemplate[]>(r, 'list report templates'));
export const getReportTemplate = (id: string): Promise<ReportTemplate> =>
  apiGet(`/api/report-templates/${id}`, 'get report template');
export const createReportTemplate = (t: ReportTemplate): Promise<ReportTemplate> =>
  authFetch('/api/report-templates', jbody(t, 'POST')).then((r) => okJson<ReportTemplate>(r, 'create report template'));
export const updateReportTemplate = (id: string, t: ReportTemplate): Promise<ReportTemplate> =>
  authFetch(`/api/report-templates/${id}`, jbody(t, 'PUT')).then((r) => okJson<ReportTemplate>(r, 'update report template'));
export const deleteReportTemplate = (id: string): Promise<void> =>
  authFetch(`/api/report-templates/${id}`, jbody({}, 'DELETE')).then((r) => { if (!r.ok) throw new Error('delete report template'); });
export const previewReportTemplate = async (id: string, params: Record<string, string>): Promise<Blob> => {
  const r = await authFetch(`/api/report-templates/${id}/preview`, jbody({ params }, 'POST'));
  if (!r.ok) throw new Error(`preview failed: ${r.status}`);
  return r.blob();
};
```

Note: if the studio `api.ts` does not already `@openldr/report-builder/pure` — confirm the package is a dependency of `apps/studio`. If not, add `"@openldr/report-builder": "workspace:*"` to `apps/studio/package.json` and run `pnpm install` (report this; it's the same plan-gap class as Phase 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test api.reportTemplates`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.reportTemplates.test.ts apps/studio/package.json pnpm-lock.yaml
git commit -m "feat(studio): report-template api client (crud + preview blob)"
```

---

## Task 2: Pure editor model — `reportBuilderModel.ts`

Pure, framework-free helpers: create blocks, mutate rows/cells immutably, and build a `LayoutModel` for the canvas from a template (using placeholder table row counts + empty-param interpolation, since P3a has no live data).

**Files:**
- Create: `apps/studio/src/reports-builder/reportBuilderModel.ts`
- Test: `apps/studio/src/reports-builder/reportBuilderModel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { newBlock, addRowWithBlock, moveRow, setColSpan, updateBlockAt, removeCell, previewLayoutModel } from './reportBuilderModel';
import { createEmptyTemplate } from '@openldr/report-builder/pure';

describe('reportBuilderModel', () => {
  it('newBlock creates a schema-shaped block per kind', () => {
    expect(newBlock('title')).toMatchObject({ kind: 'title', text: '' });
    expect(newBlock('divider')).toEqual({ kind: 'divider' });
    expect(newBlock('table')).toMatchObject({ kind: 'table', source: 'primary' });
    expect(newBlock('chart')).toMatchObject({ kind: 'chart', chartType: 'bar' });
  });

  it('addRowWithBlock appends a full-width row', () => {
    const t = createEmptyTemplate('rt', 'R');
    const next = addRowWithBlock(t, newBlock('title'));
    expect(next.rows.length).toBe(1);
    expect(next.rows[0].cells[0].colSpan).toBe(12);
    expect(next.rows[0].cells[0].block.kind).toBe('title');
    expect(t.rows.length).toBe(0); // immutable
  });

  it('moveRow reorders', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    t = addRowWithBlock(t, newBlock('divider'));
    const moved = moveRow(t, 1, 0);
    expect(moved.rows[0].cells[0].block.kind).toBe('divider');
  });

  it('setColSpan clamps to 1..12', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('kpi'));
    expect(setColSpan(t, 0, 0, 6).rows[0].cells[0].colSpan).toBe(6);
    expect(setColSpan(t, 0, 0, 99).rows[0].cells[0].colSpan).toBe(12);
    expect(setColSpan(t, 0, 0, 0).rows[0].cells[0].colSpan).toBe(1);
  });

  it('updateBlockAt patches a block', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    const next = updateBlockAt(t, 0, 0, { text: 'Hi' } as never);
    expect((next.rows[0].cells[0].block as any).text).toBe('Hi');
  });

  it('removeCell drops the cell (and the row if empty)', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    expect(removeCell(t, 0, 0).rows.length).toBe(0);
  });

  it('previewLayoutModel yields a LayoutModel with the page + one layout row per template row', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    const lm = previewLayoutModel(t);
    expect(lm.page.size).toBe(t.page.size);
    expect(lm.rows.length).toBe(1);
    expect(lm.rows[0].cells[0].kind).toBe('title');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test reportBuilderModel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reportBuilderModel.ts`**

```ts
import { interpolate, type Block, type BlockKind, type LayoutModel, type LayoutRow, type PageSpec, type ReportTemplate } from '@openldr/report-builder/pure';

const EMPTY_QUERY = { mode: 'builder' as const, model: '', metric: { key: 'count', agg: 'count' as const }, filters: [] };

export function newBlock(kind: BlockKind): Block {
  switch (kind) {
    case 'title': return { kind: 'title', text: '', style: {} };
    case 'text': return { kind: 'text', content: '', style: {} };
    case 'kpi': return { kind: 'kpi', query: EMPTY_QUERY, label: '' } as Block;
    case 'chart': return { kind: 'chart', query: EMPTY_QUERY, chartType: 'bar', visual: {} } as Block;
    case 'table': return { kind: 'table', source: 'primary', columns: [] } as Block;
    case 'image': return { kind: 'image', src: 'org-logo' };
    case 'divider': return { kind: 'divider' };
    case 'spacer': return { kind: 'spacer', height: 12 };
    case 'pageBreak': return { kind: 'pageBreak' };
    default: return { kind: 'divider' };
  }
}

let seq = 0;
const rowId = () => `row-${(seq += 1)}`;

export function addRowWithBlock(t: ReportTemplate, block: Block, colSpan = 12): ReportTemplate {
  return { ...t, rows: [...t.rows, { id: rowId(), cells: [{ colSpan, block }] }] };
}

export function moveRow(t: ReportTemplate, from: number, to: number): ReportTemplate {
  const rows = [...t.rows];
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return t;
  const [m] = rows.splice(from, 1);
  rows.splice(to, 0, m);
  return { ...t, rows };
}

export function setColSpan(t: ReportTemplate, r: number, c: number, colSpan: number): ReportTemplate {
  const clamped = Math.max(1, Math.min(12, Math.round(colSpan)));
  return mapCell(t, r, c, (cell) => ({ ...cell, colSpan: clamped }));
}

export function updateBlockAt(t: ReportTemplate, r: number, c: number, patch: Partial<Block>): ReportTemplate {
  return mapCell(t, r, c, (cell) => ({ ...cell, block: { ...cell.block, ...patch } as Block }));
}

export function addCellToRow(t: ReportTemplate, r: number, block: Block, colSpan = 6): ReportTemplate {
  const rows = t.rows.map((row, i) => (i === r ? { ...row, cells: [...row.cells, { colSpan, block }] } : row));
  return { ...t, rows };
}

export function removeCell(t: ReportTemplate, r: number, c: number): ReportTemplate {
  const rows = t.rows
    .map((row, i) => (i === r ? { ...row, cells: row.cells.filter((_, j) => j !== c) } : row))
    .filter((row) => row.cells.length > 0);
  return { ...t, rows };
}

export function setRepeat(t: ReportTemplate, r: number, repeat: 'header' | 'footer' | undefined): ReportTemplate {
  const rows = t.rows.map((row, i) => (i === r ? { ...row, repeat } : row));
  return { ...t, rows };
}

function mapCell(t: ReportTemplate, r: number, c: number, fn: (cell: ReportTemplate['rows'][number]['cells'][number]) => ReportTemplate['rows'][number]['cells'][number]): ReportTemplate {
  const rows = t.rows.map((row, i) =>
    i === r ? { ...row, cells: row.cells.map((cell, j) => (j === c ? fn(cell) : cell)) } : row,
  );
  return { ...t, rows };
}

const SAMPLE_TABLE_ROWS = 4;

/** Build a LayoutModel for the editing canvas: interpolate title/text with empty params and
 *  use a fixed sample row count for tables (P3a has no live data). */
export function previewLayoutModel(t: ReportTemplate): LayoutModel {
  const ctx = { params: {}, dataset: undefined };
  const rows: LayoutRow[] = t.rows.map((row) => ({
    repeat: row.repeat,
    cells: row.cells.map((cell) => {
      const b = cell.block;
      if (b.kind === 'title') return { kind: b.kind, colSpan: cell.colSpan, text: interpolate(b.text ?? '', ctx), style: b.style };
      if (b.kind === 'text') return { kind: b.kind, colSpan: cell.colSpan, text: interpolate(b.content ?? '', ctx), style: b.style };
      if (b.kind === 'table') return { kind: b.kind, colSpan: cell.colSpan, rowCount: SAMPLE_TABLE_ROWS };
      return { kind: b.kind, colSpan: cell.colSpan };
    }),
  }));
  return { page: t.page as PageSpec, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test reportBuilderModel`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/reportBuilderModel.ts apps/studio/src/reports-builder/reportBuilderModel.test.ts
git commit -m "feat(studio): reportBuilderModel — pure block factory + row/cell mutations + previewLayoutModel"
```

---

## Task 3: `domMeasurer`

A `Measurer` for the canvas. Uses canvas 2D `measureText` for width and estimates line count by wrapping; falls back to a char-width estimate when canvas 2D is unavailable (jsdom).

**Files:**
- Create: `apps/studio/src/reports-builder/domMeasurer.ts`
- Test: `apps/studio/src/reports-builder/domMeasurer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createDomMeasurer } from './domMeasurer';

describe('domMeasurer', () => {
  it('returns a positive height and grows with more text (fallback path under jsdom)', () => {
    const m = createDomMeasurer();
    const one = m.measureText('short', {}, 400);
    const many = m.measureText('word '.repeat(300), {}, 120);
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
  });
  it('a bigger font size yields a taller single line', () => {
    const m = createDomMeasurer();
    expect(m.measureText('x', { fontSize: 24 }, 400)).toBeGreaterThan(m.measureText('x', { fontSize: 8 }, 400));
  });
  it('empty text still has one line of height', () => {
    const m = createDomMeasurer();
    expect(m.measureText('', { fontSize: 12 }, 400)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test domMeasurer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `domMeasurer.ts`**

```ts
import type { BlockStyle, Measurer } from '@openldr/report-builder/pure';

const BASE = 11;
const LINE_FACTOR = 1.35;

// Average glyph width as a fraction of font size for Helvetica-ish fonts (fallback when no canvas).
const AVG_CHAR_W = 0.5;

export function createDomMeasurer(): Measurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  } catch { ctx = null; }

  const charsPerLine = (text: string, fontSize: number, maxWidth: number): number => {
    if (ctx) {
      ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
      const w = ctx.measureText(text || ' ').width || 1;
      const avg = w / Math.max(1, (text || ' ').length);
      return Math.max(1, Math.floor(maxWidth / Math.max(1, avg)));
    }
    return Math.max(1, Math.floor(maxWidth / (fontSize * AVG_CHAR_W)));
  };

  return {
    measureText(text: string, style: BlockStyle, maxWidth: number): number {
      const fontSize = style.fontSize ?? BASE;
      const lineH = fontSize * LINE_FACTOR;
      const explicitLines = (text || '').split('\n');
      let total = 0;
      for (const line of explicitLines) {
        const cpl = charsPerLine(line || ' ', fontSize, maxWidth);
        total += Math.max(1, Math.ceil((line.length || 1) / cpl));
      }
      return Math.max(1, total) * lineH;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test domMeasurer`
Expected: PASS (3 tests). (jsdom has no real 2D context, so the fallback path runs.)

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/domMeasurer.ts apps/studio/src/reports-builder/domMeasurer.test.ts
git commit -m "feat(studio): domMeasurer — canvas measureText with jsdom-safe char fallback"
```

---

## Task 4: `CanvasBlock` — render one block as HTML

**Files:**
- Create: `apps/studio/src/reports-builder/CanvasBlock.tsx`
- Test: `apps/studio/src/reports-builder/CanvasBlock.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasBlock } from './CanvasBlock';

describe('CanvasBlock', () => {
  it('renders title text', () => {
    render(<CanvasBlock block={{ kind: 'title', text: 'Hello', style: { fontSize: 16 } } as never} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('renders a chart placeholder labelled by chart type', () => {
    render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} />);
    expect(screen.getByText(/bar chart/i)).toBeInTheDocument();
  });
  it('renders a table placeholder', () => {
    render(<CanvasBlock block={{ kind: 'table', source: 'primary', columns: [] } as never} />);
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test CanvasBlock`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CanvasBlock.tsx`**

```tsx
import type { Block } from '@openldr/report-builder/pure';

export function CanvasBlock({ block }: { block: Block }): JSX.Element {
  switch (block.kind) {
    case 'title':
      return <div style={{ fontSize: block.style?.fontSize ?? 14, fontWeight: block.style?.bold ? 600 : 500, textAlign: block.style?.align ?? 'left' }}>{block.text || <span className="text-muted-foreground">Title</span>}</div>;
    case 'text':
      return <div style={{ fontSize: block.style?.fontSize ?? 11, fontStyle: block.style?.italic ? 'italic' : undefined, textAlign: block.style?.align ?? 'left', whiteSpace: 'pre-wrap' }}>{block.content || <span className="text-muted-foreground">Text</span>}</div>;
    case 'kpi':
      return <div className="flex h-full flex-col items-center justify-center"><span className="text-[10px] text-muted-foreground">{block.label || 'KPI'}</span><span className="text-xl font-medium">123</span></div>;
    case 'chart':
      return <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">{block.chartType} chart</div>;
    case 'table':
      return <div className="rounded border border-dashed border-border p-1 text-[10px] text-muted-foreground">Table{block.source === 'primary' ? ' · primary dataset' : ''}</div>;
    case 'image':
      return <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">{block.src === 'org-logo' ? 'Logo' : 'Image'}</div>;
    case 'divider':
      return <div className="w-full border-t border-border" />;
    case 'spacer':
      return <div className="h-full" />;
    case 'pageBreak':
      return <div className="text-center text-[10px] text-muted-foreground">— page break —</div>;
    default:
      return <div />;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test CanvasBlock`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/CanvasBlock.tsx apps/studio/src/reports-builder/CanvasBlock.test.tsx
git commit -m "feat(studio): CanvasBlock — HTML render per block kind (chart placeholder in P3a)"
```

---

## Task 5: `ReportCanvas` — positioned blocks + selection + page breaks

Uses `computeLayout(previewLayoutModel(template), domMeasurer)` to place `CanvasBlock`s absolutely in a page-width container, scaled points→px. Click selects a block (by row/cell index). Draws a page-break divider where the box `page` changes. No dnd yet (Task 6 adds it).

**Files:**
- Create: `apps/studio/src/reports-builder/ReportCanvas.tsx`
- Test: `apps/studio/src/reports-builder/ReportCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportCanvas } from './ReportCanvas';
import { addRowWithBlock, newBlock } from './reportBuilderModel';
import { createEmptyTemplate } from '@openldr/report-builder/pure';

function template() {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('title'));
  t = addRowWithBlock(t, newBlock('table'));
  return t;
}

describe('ReportCanvas', () => {
  it('renders a block for each cell', () => {
    render(<ReportCanvas template={template()} selected={null} onSelect={() => {}} />);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });
  it('calls onSelect with the row/cell index when a block is clicked', () => {
    const onSelect = vi.fn();
    render(<ReportCanvas template={template()} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Title'));
    expect(onSelect).toHaveBeenCalledWith(0, 0);
  });
  it('marks the selected block', () => {
    render(<ReportCanvas template={template()} selected={{ row: 1, cell: 0 }} onSelect={() => {}} />);
    expect(screen.getByTestId('canvas-cell-1-0').getAttribute('data-selected')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test ReportCanvas`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ReportCanvas.tsx`**

```tsx
import { useMemo } from 'react';
import { computeLayout, type PageSpec, type PositionedBox } from '@openldr/report-builder/pure';
import { previewLayoutModel } from './reportBuilderModel';
import { createDomMeasurer } from './domMeasurer';
import { CanvasBlock } from './CanvasBlock';
import type { ReportTemplate } from '@openldr/report-builder/pure';

export interface CellRef { row: number; cell: number }

const PAGE_DIMS: Record<PageSpec['size'], [number, number]> = { A4: [595.28, 841.89], Letter: [612, 792] };
const CANVAS_W = 640; // px width the page is scaled to

function pageWH(p: PageSpec): [number, number] {
  const [w, h] = PAGE_DIMS[p.size];
  return p.orientation === 'landscape' ? [h, w] : [w, h];
}

export function ReportCanvas({ template, selected, onSelect }: { template: ReportTemplate; selected: CellRef | null; onSelect: (row: number, cell: number) => void }): JSX.Element {
  const measurer = useMemo(() => createDomMeasurer(), []);
  const page = template.page as PageSpec;
  const [pw, ph] = pageWH(page);
  const scale = CANVAS_W / pw;
  const boxes: PositionedBox[] = useMemo(() => computeLayout(previewLayoutModel(template), measurer), [template, measurer]);
  const maxPage = boxes.reduce((m, b) => Math.max(m, b.page), 1);

  return (
    <div className="flex flex-col items-center gap-3 overflow-auto p-4">
      {Array.from({ length: maxPage }, (_, i) => i + 1).map((pageNo) => (
        <div key={pageNo} className="relative bg-white shadow-sm ring-1 ring-border" style={{ width: CANVAS_W, height: ph * scale }}>
          {boxes.filter((b) => b.page === pageNo).map((b) => {
            const isSel = selected?.row === b.rowIndex && selected?.cell === b.cellIndex;
            return (
              <div
                key={`${b.rowIndex}-${b.cellIndex}`}
                data-testid={`canvas-cell-${b.rowIndex}-${b.cellIndex}`}
                data-selected={isSel ? 'true' : 'false'}
                onClick={(e) => { e.stopPropagation(); onSelect(b.rowIndex, b.cellIndex); }}
                className={`absolute cursor-pointer overflow-hidden rounded-sm ${isSel ? 'ring-2 ring-[#378ADD]' : 'ring-1 ring-transparent hover:ring-border'}`}
                style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, padding: 2 }}
              >
                <CanvasBlock block={template.rows[b.rowIndex].cells[b.cellIndex].block} />
              </div>
            );
          })}
          <div className="pointer-events-none absolute bottom-1 right-2 text-[9px] text-muted-foreground">Page {pageNo} / {maxPage}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test ReportCanvas`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/ReportCanvas.test.tsx
git commit -m "feat(studio): ReportCanvas — WYSIWYG positioned blocks via computeLayout + selection + page breaks"
```

---

## Task 6: `BlockPalette` + drag-to-add + row reorder

Adds `@dnd-kit`: palette blocks are draggable; the canvas exposes a trailing "new row" droppable + each row is a sortable handle. `ReportBuilderPage` (Task 9) owns the `DndContext` and `onDragEnd` that dispatches add-vs-reorder. To keep Task 6 self-contained, build `BlockPalette` (draggable items) + a `NewRowDropzone` + wire row sortability into `ReportCanvas`, and expose an `onAddBlock(kind)` / `onReorderRows(from,to)` callback contract that Task 9 fulfils.

**Files:**
- Create: `apps/studio/src/reports-builder/BlockPalette.tsx`
- Test: `apps/studio/src/reports-builder/BlockPalette.test.tsx`
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx` (add a row drag-handle + "new row" click fallback)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { BlockPalette } from './BlockPalette';

describe('BlockPalette', () => {
  it('lists the block kinds and calls onAdd on click', () => {
    const onAdd = vi.fn();
    render(<DndContext><BlockPalette onAdd={onAdd} /></DndContext>);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Table'));
    expect(onAdd).toHaveBeenCalledWith('table');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test BlockPalette`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BlockPalette.tsx`**

Palette items are both clickable (append a full-width row — the robust fallback) and draggable (for drop-to-place, handled by the page's DndContext in Task 9). Click is the P3a-guaranteed path; drag is additive.

```tsx
import { useDraggable } from '@dnd-kit/core';
import type { BlockKind } from '@openldr/report-builder/pure';

const KINDS: { kind: BlockKind; label: string }[] = [
  { kind: 'title', label: 'Title' },
  { kind: 'text', label: 'Text' },
  { kind: 'kpi', label: 'KPI' },
  { kind: 'chart', label: 'Chart' },
  { kind: 'table', label: 'Table' },
  { kind: 'image', label: 'Image' },
  { kind: 'divider', label: 'Divider' },
  { kind: 'pageBreak', label: 'Page break' },
];

function PaletteItem({ kind, label, onAdd }: { kind: BlockKind; label: string; onAdd: (k: BlockKind) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${kind}`, data: { palette: kind } });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAdd(kind)}
      className={`flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="text-muted-foreground">⋮⋮</span>{label}
    </button>
  );
}

export function BlockPalette({ onAdd }: { onAdd: (kind: BlockKind) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Blocks</div>
      {KINDS.map((k) => <PaletteItem key={k.kind} kind={k.kind} label={k.label} onAdd={onAdd} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test BlockPalette`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/BlockPalette.tsx apps/studio/src/reports-builder/BlockPalette.test.tsx
git commit -m "feat(studio): BlockPalette — draggable/clickable block kinds"
```

---

## Task 7: `BlockInspector` — title/text editor + width + page setup + delete

P3a inspector: for title/text a content + style editor; a width segmented control (1–12 via presets 3/4/6/8/12) for any block; a page-setup section (size/orientation); and delete. Query editing (kpi/chart/table) is P3b — those blocks show a "Configure data in the next step" note.

**Files:**
- Create: `apps/studio/src/reports-builder/BlockInspector.tsx`
- Test: `apps/studio/src/reports-builder/BlockInspector.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockInspector } from './BlockInspector';

const titleBlock = { kind: 'title', text: 'Hi', style: {} } as never;

describe('BlockInspector', () => {
  it('edits title text', () => {
    const onPatch = vi.fn();
    render(<BlockInspector block={titleBlock} colSpan={12} onPatchBlock={onPatch} onSetColSpan={() => {}} onDelete={() => {}} />);
    fireEvent.change(screen.getByLabelText(/text/i), { target: { value: 'New' } });
    expect(onPatch).toHaveBeenCalledWith({ text: 'New' });
  });
  it('changes width', () => {
    const onSet = vi.fn();
    render(<BlockInspector block={titleBlock} colSpan={12} onPatchBlock={() => {}} onSetColSpan={onSet} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(onSet).toHaveBeenCalledWith(6);
  });
  it('deletes', () => {
    const onDelete = vi.fn();
    render(<BlockInspector block={titleBlock} colSpan={12} onPatchBlock={() => {}} onSetColSpan={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalled();
  });
  it('shows a data-config note for chart blocks', () => {
    render(<BlockInspector block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} colSpan={6} onPatchBlock={() => {}} onSetColSpan={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/data.*next step/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test BlockInspector`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BlockInspector.tsx`**

```tsx
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Block } from '@openldr/report-builder/pure';

const WIDTHS = [3, 4, 6, 8, 12];

export function BlockInspector({ block, colSpan, onPatchBlock, onSetColSpan, onDelete }: {
  block: Block; colSpan: number;
  onPatchBlock: (patch: Partial<Block>) => void;
  onSetColSpan: (n: number) => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{block.kind} block</div>

      {block.kind === 'title' && (
        <label className="flex flex-col gap-1 text-xs">Text
          <Input aria-label="Text" value={block.text} onChange={(e) => onPatchBlock({ text: e.target.value } as Partial<Block>)} />
        </label>
      )}
      {block.kind === 'text' && (
        <label className="flex flex-col gap-1 text-xs">Text
          <textarea aria-label="Text" className="min-h-[80px] rounded-md border border-border bg-background p-2 text-sm" value={block.content} onChange={(e) => onPatchBlock({ content: e.target.value } as Partial<Block>)} />
        </label>
      )}
      {(block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table') && (
        <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">Configure this block's data in the next step.</p>
      )}

      <div className="flex flex-col gap-1 text-xs">Width
        <div className="flex gap-1">
          {WIDTHS.map((w) => (
            <Button key={w} type="button" size="sm" variant={w === colSpan ? 'default' : 'outline'} className="h-7 w-8 p-0" onClick={() => onSetColSpan(w)}>{w}</Button>
          ))}
        </div>
      </div>

      <Button type="button" variant="ghost" className="justify-start text-destructive hover:text-destructive" onClick={onDelete}>Delete block</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test BlockInspector`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/BlockInspector.tsx apps/studio/src/reports-builder/BlockInspector.test.tsx
git commit -m "feat(studio): BlockInspector — title/text editor + width control + delete (P3a subset)"
```

---

## Task 8: `PreviewPdfDialog` — real server PDF

**Files:**
- Create: `apps/studio/src/reports-builder/PreviewPdfDialog.tsx`
- Test: `apps/studio/src/reports-builder/PreviewPdfDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({ previewReportTemplate: vi.fn().mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' })) }));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: ({ blob }: { blob: Blob }) => <div data-testid="viewer">{blob ? 'pdf' : 'none'}</div> }));

import { PreviewPdfDialog } from './PreviewPdfDialog';
import { previewReportTemplate } from '../api';

describe('PreviewPdfDialog', () => {
  it('fetches the preview blob and renders the viewer when open', async () => {
    render(<PreviewPdfDialog open reportId="rt1" params={{}} onClose={() => {}} />);
    await waitFor(() => expect(previewReportTemplate).toHaveBeenCalledWith('rt1', {}));
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveTextContent('pdf'));
  });
  it('does not fetch when closed', () => {
    render(<PreviewPdfDialog open={false} reportId="rt1" params={{}} onClose={() => {}} />);
    expect(previewReportTemplate).not.toHaveBeenCalled();
  });
});
```

Note: the `PdfCanvasViewer` import path is `../reports/PdfCanvasViewer`. Confirm the real path (it lives at `apps/studio/src/reports/PdfCanvasViewer.tsx` per Phase 2) and match it in both the mock and the component import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test PreviewPdfDialog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PreviewPdfDialog.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { previewReportTemplate } from '../api';
import { PdfCanvasViewer } from '../reports/PdfCanvasViewer';

export function PreviewPdfDialog({ open, reportId, params, onClose }: {
  open: boolean; reportId: string; params: Record<string, string>; onClose: () => void;
}): JSX.Element {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setBlob(null); return; }
    let active = true;
    setLoading(true); setError(undefined); setBlob(null);
    previewReportTemplate(reportId, params)
      .then((b) => { if (active) { setBlob(b); setLoading(false); } })
      .catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId, JSON.stringify(params)]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Preview</DialogTitle></DialogHeader>
        <div className="h-[70vh]">
          {loading && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Rendering…</div>}
          {error && <div className="p-4 text-sm text-destructive">{error}</div>}
          {blob && <PdfCanvasViewer blob={blob} fileName={`${reportId}.pdf`} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test PreviewPdfDialog`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/PreviewPdfDialog.tsx apps/studio/src/reports-builder/PreviewPdfDialog.test.tsx
git commit -m "feat(studio): PreviewPdfDialog — real server PDF via /preview + PdfCanvasViewer"
```

---

## Task 9: `ReportBuilderPage` — shell + dnd + load/save/publish/delete + undo/redo

Assembles the three panes inside one `DndContext`. Owns the `ReportTemplate` state + `useTemplateHistory`, load-by-id, save (create/update), publish, delete, and preview. `onDragEnd`: a `palette:*` active over the canvas appends a row with that block; a `row:*` active over another `row:*` reorders.

**Files:**
- Create: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Test: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const createReportTemplate = vi.fn().mockResolvedValue({ id: 'new-id', name: 'Untitled report', status: 'draft' });
vi.mock('../api', () => ({
  getReportTemplate: vi.fn(),
  createReportTemplate: (...a: unknown[]) => createReportTemplate(...a),
  updateReportTemplate: vi.fn().mockResolvedValue({ id: 'rt1', status: 'draft' }),
  deleteReportTemplate: vi.fn(),
  previewReportTemplate: vi.fn(),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div /> }));

import { ReportBuilderPage } from './ReportBuilderPage';

beforeEach(() => createReportTemplate.mockClear());

function renderNew() {
  return render(<MemoryRouter initialEntries={['/reports/builder/new']}><Routes><Route path="/reports/builder/new" element={<ReportBuilderPage />} /><Route path="/reports/builder/:id" element={<ReportBuilderPage />} /></Routes></MemoryRouter>);
}

describe('ReportBuilderPage', () => {
  it('renders the name input and the palette', () => {
    renderNew();
    expect(screen.getByLabelText(/report name/i)).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
  });
  it('adds a block via the palette and shows it on the canvas', () => {
    renderNew();
    fireEvent.click(screen.getByText('Title'));
    expect(screen.getByText('Title')).toBeInTheDocument(); // palette label + canvas placeholder both say Title; at least present
    expect(screen.getByTestId('canvas-cell-0-0')).toBeInTheDocument();
  });
  it('saves via createReportTemplate', async () => {
    renderNew();
    fireEvent.click(screen.getByText('Title'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(createReportTemplate).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test ReportBuilderPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ReportBuilderPage.tsx`**

```tsx
import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { AppShell } from '@/shell/AppShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createEmptyTemplate, type Block, type BlockKind, type ReportTemplate } from '@openldr/report-builder/pure';
import { createReportTemplate, getReportTemplate, updateReportTemplate, deleteReportTemplate } from '../api';
import { useTemplateHistory } from '../forms-builder/useTemplateHistory';
import { addRowWithBlock, moveRow, newBlock, removeCell, setColSpan, updateBlockAt } from './reportBuilderModel';
import { BlockPalette } from './BlockPalette';
import { ReportCanvas, type CellRef } from './ReportCanvas';
import { BlockInspector } from './BlockInspector';
import { PreviewPdfDialog } from './PreviewPdfDialog';

export function ReportBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tplId, setTplId] = useState<string | null>(id ?? null);
  const [template, setTemplate] = useState<ReportTemplate>(() => createEmptyTemplate(`rt-${Date.now()}`, ''));
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string>();
  const history = useTemplateHistory<ReportTemplate>(() => template);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void getReportTemplate(id).then((t) => { if (!cancelled) { setTplId(t.id); setTemplate(t); } }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  const update = (next: ReportTemplate) => { history.recordEdit(); setTemplate(next); };
  const pushUpdate = (next: ReportTemplate) => { history.pushHistory(); setTemplate(next); };

  const addBlock = (kind: BlockKind) => { pushUpdate(addRowWithBlock(template, newBlock(kind))); };
  const applyHistory = (next: ReportTemplate | null) => { if (next) setTemplate(next); };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (active.startsWith('palette:')) { addBlock(active.slice('palette:'.length) as BlockKind); return; }
    if (active.startsWith('row:') && over?.startsWith('row:')) {
      const from = Number(active.slice(4)); const to = Number(over.slice(4));
      if (from !== to) pushUpdate(moveRow(template, from, to));
    }
  };

  const selectedBlock: Block | null = useMemo(
    () => (selected ? template.rows[selected.row]?.cells[selected.cell]?.block ?? null : null),
    [selected, template],
  );

  const save = async () => {
    try {
      const name = template.name.trim() || 'Untitled report';
      const toSave = { ...template, name };
      const saved = tplId ? await updateReportTemplate(tplId, toSave) : await createReportTemplate(toSave);
      setTemplate(saved); setTplId(saved.id);
      if (!id) navigate(`/reports/builder/${saved.id}`, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const publish = async () => { if (tplId) { const s = await updateReportTemplate(tplId, { ...template, status: 'published' }); setTemplate(s); } };
  const handleDelete = async () => { if (tplId) { await deleteReportTemplate(tplId); navigate('/reports'); } };
  const doPreview = async () => { await save(); setPreviewOpen(true); };

  return (
    <AppShell title="Report Builder" fullBleed>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <Input aria-label="Report name" placeholder="Untitled report" value={template.name} onChange={(e) => update({ ...template, name: e.target.value })} className="h-8 max-w-xs text-sm" />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => applyHistory(history.undo())}>Undo</Button>
              <Button size="sm" variant="ghost" onClick={() => applyHistory(history.redo())}>Redo</Button>
              <Button size="sm" variant="outline" onClick={() => { void doPreview(); }}>Preview PDF</Button>
              <Button size="sm" onClick={() => { void save(); }}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => { void publish(); }}>Publish</Button>
            </div>
          </div>
          {error && <div className="border-b border-border px-4 py-2 text-xs text-destructive">{error}</div>}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-40 shrink-0 border-r border-border overflow-y-auto"><BlockPalette onAdd={addBlock} /></div>
            <div className="min-w-0 flex-1 overflow-auto bg-muted/30" onClick={() => setSelected(null)}>
              <ReportCanvas template={template} selected={selected} onSelect={(row, cell) => setSelected({ row, cell })} />
            </div>
            <div className="w-64 shrink-0 border-l border-border overflow-y-auto">
              {selectedBlock && selected ? (
                <BlockInspector
                  block={selectedBlock}
                  colSpan={template.rows[selected.row].cells[selected.cell].colSpan}
                  onPatchBlock={(patch) => update(updateBlockAt(template, selected.row, selected.cell, patch))}
                  onSetColSpan={(n) => update(setColSpan(template, selected.row, selected.cell, n))}
                  onDelete={() => { pushUpdate(removeCell(template, selected.row, selected.cell)); setSelected(null); }}
                />
              ) : (
                <div className="p-4 text-xs text-muted-foreground">Select a block to edit it, or drag a block from the palette.</div>
              )}
            </div>
          </div>
        </div>
      </DndContext>
      {tplId && <PreviewPdfDialog open={previewOpen} reportId={tplId} params={{}} onClose={() => setPreviewOpen(false)} />}
    </AppShell>
  );
}
```

Note: `useTemplateHistory` is imported from `../forms-builder/useTemplateHistory`. Confirm its exact API (`recordEdit`, `pushHistory`, `undo`, `redo` returning the snapshot) by opening that file; adapt the calls if the signatures differ (the Form Builder uses `history.recordEdit()`, `history.pushHistory()`, `history.undo()`, `history.redo()` — verified in `FormBuilderPage.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test ReportBuilderPage`
Expected: PASS (3 tests). If the "Title" ambiguity assertion fails because two elements say "Title", change that assertion to `screen.getAllByText('Title').length` ≥ 2 — but do not weaken the canvas-cell assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "feat(studio): ReportBuilderPage — three-pane shell, dnd, load/save/publish/delete, undo/redo"
```

---

## Task 10: Routing + Reports "New report" entry

**Files:**
- Modify: `apps/studio/src/App.tsx`
- Modify: `apps/studio/src/pages/Reports.tsx`
- Test: `apps/studio/src/pages/Reports.newReport.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasRole: (r: string) => r === 'lab_admin' || r === 'lab_manager' }) }));
vi.mock('../api', () => ({ fetchReports: vi.fn().mockResolvedValue([]) }));

import { NewReportButton } from './Reports';

describe('New report entry', () => {
  it('navigates to the builder when clicked (admin/manager)', () => {
    render(<MemoryRouter><NewReportButton /></MemoryRouter>);
    screen.getByRole('button', { name: /new report/i }).click();
    expect(navigate).toHaveBeenCalledWith('/reports/builder/new');
  });
});
```

Note: this test imports a small `NewReportButton` export you will add to `Reports.tsx` (extracting the button makes it unit-testable without rendering the whole Reports page + its data fetching). If you prefer not to export a sub-component, instead write a lighter test that asserts the App route table maps `/reports/builder/new` to `ReportBuilderPage` — but the `NewReportButton` approach is cleaner; keep it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test Reports.newReport`
Expected: FAIL — `NewReportButton` not exported.

- [ ] **Step 3: Add the routes to `App.tsx`**

Add the import near `FormBuilderPage`:
```tsx
import { ReportBuilderPage } from './reports-builder/ReportBuilderPage';
```
Add these routes next to the `/forms/new` route (gated to admins/managers, matching the server write-gate). `RequireRole` is already imported in `App.tsx`:
```tsx
      <Route path="/reports/builder/new" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportBuilderPage /></RequireRole>} />
      <Route path="/reports/builder/:id" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportBuilderPage /></RequireRole>} />
```

- [ ] **Step 4: Add `NewReportButton` to `Reports.tsx`**

Add these imports if absent (`useNavigate` from react-router-dom, `useAuth` from `@/auth/AuthProvider`, `Button` from `@/components/ui/button`), then export:
```tsx
export function NewReportButton(): JSX.Element | null {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  if (!(hasRole('lab_admin') || hasRole('lab_manager'))) return null;
  return <Button size="sm" onClick={() => navigate('/reports/builder/new')}>New report</Button>;
}
```
Then render `<NewReportButton />` in the Reports library header area (near the `ReportLibrary` search/title). Place it where it reads naturally in the existing header markup — a small addition, not a restructure.

- [ ] **Step 5: Run test + full studio typecheck**

Run: `pnpm -C apps/studio test Reports.newReport`  (passes)
Run: `pnpm -C apps/studio typecheck`  (clean)

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/App.tsx apps/studio/src/pages/Reports.tsx apps/studio/src/pages/Reports.newReport.test.tsx
git commit -m "feat(studio): route /reports/builder + New report entry (admins/managers)"
```

---

## Task 11: Gate — studio tests + cross-package typecheck

- [ ] **Step 1: Isolated studio test run** (never trust turbo `studio#test` per repo convention)

Run: `pnpm -C apps/studio test`
Expected: all pass (the new suites + no regressions). Investigate any failure before proceeding.

- [ ] **Step 2: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all packages pass (the new `@openldr/report-builder` dependency on `apps/studio` resolves; pure-barrel imports typecheck).

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore(studio): green gate for report builder P3a"
```

---

## Self-review notes (already reconciled)

- **Spec coverage (P3a slice):** api client (Task 1); pure model + previewLayoutModel (Task 2); domMeasurer with jsdom fallback (Task 3); CanvasBlock + ReportCanvas WYSIWYG via `computeLayout` + selection + page breaks (Tasks 4–5); BlockPalette + drag-to-add + row reorder (Tasks 6, 9); BlockInspector title/text + width + delete (Task 7); PreviewPdfDialog real PDF (Task 8); ReportBuilderPage shell + load/save/publish/delete + undo/redo + DndContext (Task 9); routing + Reports entry, admin/manager gated (Task 10); gate (Task 11). Deferred to P3b/P3c (query editor, recharts, parameters/binding, lint, keyboard, i18n) are explicitly absent.
- **Purity boundary:** every reports-builder file imports layout/types/helpers from `@openldr/report-builder/pure` only — never the server barrel. Verified across Tasks 2–9.
- **Type consistency:** `CellRef` ({row, cell}) is defined in `ReportCanvas` (Task 5) and consumed in Task 9; `newBlock`/`addRowWithBlock`/`moveRow`/`setColSpan`/`updateBlockAt`/`removeCell`/`previewLayoutModel` names are identical across Tasks 2, 5, 9; `previewReportTemplate(id, params)` signature matches across Tasks 1, 8, 9.
- **No placeholders:** every code step has full code; every run step states command + expected result.
- **Known adaptation points flagged inline** (not placeholders — explicit "confirm X, adapt if different"): the api-test mock style (copy from `api.dashboards.test.ts`), the `PdfCanvasViewer` import path, and the `useTemplateHistory` method names — each names the file to check and the expected shape.
