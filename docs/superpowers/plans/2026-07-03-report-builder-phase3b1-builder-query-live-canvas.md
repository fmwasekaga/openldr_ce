# Report Builder — Phase 3b-1: Builder Query + Live Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a report author configure a data block's query with the visual builder and see the block render **live data** on the WYSIWYG canvas — charts via recharts, KPIs, and real tables — with true row counts driving canvas pagination.

**Architecture:** A client-side live-data layer (`useBlockData`) resolves + runs each data block's query through the existing dashboards `runWidgetQuery`, cached by resolved-query-JSON and debounced. The inspector embeds the existing `BuilderForm`; the canvas renders each data block through the existing `renderWidget(config, result)` by mapping a report block → a `WidgetConfig`. Single-series only (multi-series is P3b-4); filters/params are P3b-2; SQL is P3b-3.

**Tech Stack:** React, TypeScript, recharts (via `renderWidget`), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase3b-data-parameters-design.md` (this plan = **P3b-1**).
**Builds on:** Phase 3a (`reports-builder/` module, `ReportCanvas`, `CanvasBlock`, `BlockInspector`, `ReportBuilderPage`, `reportBuilderModel`).

## Scope (P3b-1)

**In:** `blockToWidgetConfig` (block → WidgetConfig mapping); `QueryEditor` (builder mode: `BuilderForm` + chart-type + table source, fetches models); `useBlockData` (fetch/dedup/debounce live data); `CanvasBlock` live rendering (recharts/table/KPI/loading/error); `ReportCanvas` threads live data + real table row counts into `computeLayout`; wiring in `BlockInspector` + `ReportBuilderPage`.

**Out (later sub-plans):** filters + parameter binding (P3b-2); SQL mode (P3b-3); multi-series/breakdown (P3b-4). Chart blocks stay single-series; `QueryEditor` shows only source/metric/group-by + chart type (no filters, no breakdown, no SQL toggle yet).

## Reuse (confirmed signatures)
- `runWidgetQuery(q: WidgetQuery): Promise<ReportResult>` and `listModels(): Promise<QueryModel[]>` — from `apps/studio/src/api.ts`.
- `renderWidget(config: WidgetConfig, result: ReportResult)` — from `apps/studio/src/dashboard/widgets` (types: `WidgetConfig` = `{ id, type, title, query, refreshIntervalSec, visual }`; chart types include `'bar-chart' | 'line-chart' | 'pie-chart' | 'kpi' | 'table'`).
- `BuilderForm({ models, value, onChange })` — `apps/studio/src/dashboard/editor/BuilderForm.tsx`; `value` is a builder-mode `WidgetQuery` (`{ mode:'builder', model, metric, dimension?, filters }`).

## File map

| File | Responsibility |
| --- | --- |
| `apps/studio/src/reports-builder/blockToWidgetConfig.ts` (create) | Pure: report data block (+ result) → `WidgetConfig` for `renderWidget` |
| `apps/studio/src/reports-builder/QueryEditor.tsx` (create) | Inspector builder-query editor (BuilderForm + chart-type + table source) |
| `apps/studio/src/reports-builder/useBlockData.ts` (create) | Live-data hook: fetch/dedup/debounce per block |
| `apps/studio/src/reports-builder/CanvasBlock.tsx` (modify) | Accept `data` prop; render live recharts/table/KPI |
| `apps/studio/src/reports-builder/reportBuilderModel.ts` (modify) | `previewLayoutModel` accepts real table row counts |
| `apps/studio/src/reports-builder/ReportCanvas.tsx` (modify) | Accept `data` map; pass per-box data; use real row counts |
| `apps/studio/src/reports-builder/BlockInspector.tsx` (modify) | Render `QueryEditor` for kpi/chart/table (replace the P3a note) |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` (modify) | Run `useBlockData`; pass map to canvas |

---

## Task 1: `blockToWidgetConfig` — map a report block to a WidgetConfig

**Files:**
- Create: `apps/studio/src/reports-builder/blockToWidgetConfig.ts`
- Test: `apps/studio/src/reports-builder/blockToWidgetConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { blockToWidgetConfig } from './blockToWidgetConfig';

const result = {
  columns: [{ key: 'label', label: 'Organism', kind: 'string' }, { key: 'value', label: 'Count', kind: 'number' }],
  rows: [{ label: 'E. coli', value: 5 }],
  chart: { type: 'bar', x: 'label', y: 'value' },
  meta: { generatedAt: 'n', rowCount: 1 },
} as any;

describe('blockToWidgetConfig', () => {
  it('maps a bar chart block to a bar-chart widget with x/y from result columns', () => {
    const cfg = blockToWidgetConfig({ kind: 'chart', query: {} as any, chartType: 'bar', visual: {} } as any, result);
    expect(cfg.type).toBe('bar-chart');
    expect(cfg.visual.xAxisKey).toBe('label');
    expect(cfg.visual.yAxisKey).toBe('value');
  });
  it('maps line and pie chart types', () => {
    expect(blockToWidgetConfig({ kind: 'chart', query: {} as any, chartType: 'line', visual: {} } as any, result).type).toBe('line-chart');
    expect(blockToWidgetConfig({ kind: 'chart', query: {} as any, chartType: 'pie', visual: {} } as any, result).type).toBe('pie-chart');
  });
  it('maps a kpi block to a kpi widget using the numeric column', () => {
    const cfg = blockToWidgetConfig({ kind: 'kpi', query: {} as any, label: 'Total' } as any, result);
    expect(cfg.type).toBe('kpi');
    expect(cfg.visual.yAxisKey).toBe('value');
    expect(cfg.title).toBe('Total');
  });
  it('maps a table block to a table widget', () => {
    expect(blockToWidgetConfig({ kind: 'table', source: 'primary', columns: [] } as any, result).type).toBe('table');
  });
  it('carries the block visual overrides (color) onto the chart widget', () => {
    const cfg = blockToWidgetConfig({ kind: 'chart', query: {} as any, chartType: 'bar', visual: { color: '#123456' } } as any, result);
    expect(cfg.visual.color).toBe('#123456');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test blockToWidgetConfig`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `blockToWidgetConfig.ts`**

```ts
import type { WidgetConfig, ReportResult } from '../api';
import type { Block } from '@openldr/report-builder/pure';

const CHART_TYPE: Record<string, WidgetConfig['type']> = { bar: 'bar-chart', line: 'line-chart', pie: 'pie-chart' };

function axisKeys(result?: ReportResult): { x: string; y: string } {
  const cols = result?.columns ?? [];
  const x = cols.find((c) => c.kind !== 'number')?.key ?? cols[0]?.key ?? 'label';
  const y = cols.find((c) => c.kind === 'number')?.key ?? cols[1]?.key ?? 'value';
  return { x, y };
}

/** Map a report data block (+ its fetched result) to a dashboard WidgetConfig for renderWidget. */
export function blockToWidgetConfig(block: Block, result?: ReportResult): WidgetConfig {
  const { x, y } = axisKeys(result);
  const base = { id: 'preview', title: '', query: { mode: 'sql', sql: '' } as WidgetConfig['query'], refreshIntervalSec: 0 };
  if (block.kind === 'chart') {
    return { ...base, type: CHART_TYPE[block.chartType] ?? 'bar-chart', visual: { xAxisKey: x, yAxisKey: y, ...(block.visual as object) } };
  }
  if (block.kind === 'kpi') {
    return { ...base, type: 'kpi', title: block.label ?? '', visual: { yAxisKey: y } };
  }
  return { ...base, type: 'table', visual: {} };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test blockToWidgetConfig`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/blockToWidgetConfig.ts apps/studio/src/reports-builder/blockToWidgetConfig.test.ts
git commit -m "feat(studio): blockToWidgetConfig — report block -> dashboard WidgetConfig for renderWidget"
```

---

## Task 2: `QueryEditor` — builder-mode query editor

Embeds `BuilderForm` (fetches `listModels`), plus a chart-type toggle (chart blocks) and a primary/own-query switch (table blocks). Emits block patches through `onChange`.

**Files:**
- Create: `apps/studio/src/reports-builder/QueryEditor.tsx`
- Test: `apps/studio/src/reports-builder/QueryEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  listModels: vi.fn().mockResolvedValue([
    { id: 'observations', label: 'Results', dimensions: [{ key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' }], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
  ]),
}));

import { QueryEditor } from './QueryEditor';

const chartBlock = { kind: 'chart', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any;

describe('QueryEditor', () => {
  it('renders the builder source select once models load', async () => {
    render(<QueryEditor block={chartBlock} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/source/i)).toBeInTheDocument());
  });
  it('changes chart type and patches the block', async () => {
    const onChange = vi.fn();
    render(<QueryEditor block={chartBlock} onChange={onChange} />);
    await waitFor(() => screen.getByLabelText(/source/i));
    fireEvent.click(screen.getByRole('button', { name: /line/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chartType: 'line' }));
  });
  it('toggles a table block between primary dataset and its own query', async () => {
    const onChange = vi.fn();
    const tableBlock = { kind: 'table', source: 'primary', columns: [] } as any;
    render(<QueryEditor block={tableBlock} onChange={onChange} />);
    await waitFor(() => screen.getByText(/primary dataset/i));
    fireEvent.click(screen.getByRole('button', { name: /own query/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ mode: 'builder' }) }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test QueryEditor`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `QueryEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listModels, type QueryModel, type WidgetQuery } from '../api';
import { BuilderForm } from '../dashboard/editor/BuilderForm';
import type { Block } from '@openldr/report-builder/pure';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
const EMPTY: BuilderQuery = { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] };
const CHART_TYPES: { v: 'bar' | 'line' | 'pie'; label: string }[] = [{ v: 'bar', label: 'Bar' }, { v: 'line', label: 'Line' }, { v: 'pie', label: 'Pie' }];

export function QueryEditor({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }): JSX.Element {
  const [models, setModels] = useState<QueryModel[]>([]);
  useEffect(() => { listModels().then(setModels).catch(() => setModels([])); }, []);

  // The query lives on the block: kpi/chart carry `query`; table carries `source`.
  const isTable = block.kind === 'table';
  const query: BuilderQuery = isTable
    ? (block.source === 'primary' ? EMPTY : (block.source as BuilderQuery))
    : ((block as { query?: WidgetQuery }).query?.mode === 'builder' ? (block as { query: BuilderQuery }).query : EMPTY);

  const setQuery = (q: BuilderQuery) => {
    if (block.kind === 'kpi' || block.kind === 'chart') onChange({ query: q } as Partial<Block>);
    else if (isTable) onChange({ source: q } as Partial<Block>);
  };

  return (
    <div className="flex flex-col gap-3">
      {isTable && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={block.source === 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: 'primary' } as Partial<Block>)}>Primary dataset</Button>
          <Button type="button" size="sm" variant={block.source !== 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: { ...EMPTY } } as Partial<Block>)}>Own query</Button>
        </div>
      )}

      {(!isTable || block.source !== 'primary') && (
        models.length ? <BuilderForm models={models} value={query} onChange={setQuery} /> : <p className="text-xs text-muted-foreground">Loading data sources…</p>
      )}

      {block.kind === 'chart' && (
        <div className="flex flex-col gap-1 text-xs">Chart type
          <div className="flex gap-1">
            {CHART_TYPES.map((c) => (
              <Button key={c.v} type="button" size="sm" variant={block.chartType === c.v ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ chartType: c.v } as Partial<Block>)}>{c.label}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test QueryEditor`
Expected: PASS (3 tests).

If `BuilderForm`'s `Source` control uses a native `<select>` with `aria-label="Source"` (it does — verified), `getByLabelText(/source/i)` resolves it.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/reports-builder/QueryEditor.test.tsx
git commit -m "feat(studio): QueryEditor — builder-mode query (BuilderForm + chart type + table source)"
```

---

## Task 3: `useBlockData` — live-data hook

Fetches each data block's builder query via `runWidgetQuery`, deduped by query-JSON and debounced. Skips blocks with an empty model (no source chosen yet). Params are `{}` in P3b-1 (param binding is P3b-2), but the resolve step is included so P3b-2 only extends it.

**Files:**
- Create: `apps/studio/src/reports-builder/useBlockData.ts`
- Test: `apps/studio/src/reports-builder/useBlockData.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const runWidgetQuery = vi.fn();
vi.mock('../api', () => ({ runWidgetQuery: (...a: unknown[]) => runWidgetQuery(...a) }));

import { useBlockData } from './useBlockData';
import { createEmptyTemplate } from '@openldr/report-builder/pure';
import { addRowWithBlock, newBlock, updateBlockAt } from './reportBuilderModel';

function result(n: number) { return { columns: [], rows: Array.from({ length: n }, () => ({})), chart: {}, meta: { generatedAt: 'n', rowCount: n } }; }
const bq = (model: string) => ({ mode: 'builder', model, metric: { key: 'count', agg: 'count' }, filters: [] });

beforeEach(() => runWidgetQuery.mockReset());

describe('useBlockData', () => {
  it('fetches a chart block query and exposes the result by cell key', async () => {
    runWidgetQuery.mockResolvedValue(result(3));
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('chart'));
    t = updateBlockAt(t, 0, 0, { query: bq('observations') } as any);
    const { result: hook } = renderHook(() => useBlockData(t, {}));
    await waitFor(() => expect(hook.current.get('0:0')?.result?.rows.length).toBe(3));
    expect(runWidgetQuery).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a block whose query has no model', async () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('chart')); // EMPTY_QUERY has model:''
    renderHook(() => useBlockData(t, {}));
    await new Promise((r) => setTimeout(r, 60));
    expect(runWidgetQuery).not.toHaveBeenCalled();
  });

  it('dedups two blocks with identical queries into one fetch', async () => {
    runWidgetQuery.mockResolvedValue(result(1));
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('kpi'));
    t = addRowWithBlock(t, newBlock('kpi'));
    t = updateBlockAt(t, 0, 0, { query: bq('observations') } as any);
    t = updateBlockAt(t, 1, 0, { query: bq('observations') } as any);
    const { result: hook } = renderHook(() => useBlockData(t, {}));
    await waitFor(() => expect(hook.current.get('1:0')?.result).toBeTruthy());
    expect(runWidgetQuery).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test useBlockData`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useBlockData.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import { runWidgetQuery, type WidgetQuery, type ReportResult } from '../api';
import type { Block, ReportTemplate } from '@openldr/report-builder/pure';

export interface BlockData { result?: ReportResult; error?: string; loading: boolean }

const TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;
function resolve(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  const sub = (v: unknown) => (typeof v === 'string' && v.includes('{{') ? v.replace(TOKEN, (_m, k: string) => params[k] ?? '') : v);
  if (clone.mode === 'builder') clone.filters = (clone.filters ?? []).map((f) => ({ ...f, value: sub(f.value) as never }));
  return clone;
}

// A block's runnable query, or null. table:'primary' has no own query (P3b-1 doesn't fetch the primary dataset).
function blockQuery(block: Block): WidgetQuery | null {
  if (block.kind === 'kpi' || block.kind === 'chart') return block.query;
  if (block.kind === 'table' && block.source !== 'primary') return block.source;
  return null;
}
function hasModel(q: WidgetQuery): boolean {
  return q.mode === 'sql' ? Boolean(q.sql?.trim()) : Boolean(q.model);
}

export function useBlockData(template: ReportTemplate, params: Record<string, string>): Map<string, BlockData> {
  const [data, setData] = useState<Map<string, BlockData>>(new Map());

  // Build the list of { key, resolvedQuery } to fetch this render.
  const wanted: { key: string; q: WidgetQuery; json: string }[] = [];
  template.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    const q = blockQuery(cell.block);
    if (q && hasModel(q)) { const rq = resolve(q, params); wanted.push({ key: `${r}:${c}`, q: rq, json: JSON.stringify(rq) }); }
  }));
  const signature = wanted.map((w) => `${w.key}=${w.json}`).join('|');

  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      let cancelled = false;
      // mark loading
      setData((prev) => { const next = new Map(prev); for (const w of wanted) next.set(w.key, { ...next.get(w.key), loading: true }); return next; });
      // dedup by json
      const byJson = new Map<string, { key: string; q: WidgetQuery }[]>();
      for (const w of wanted) { const a = byJson.get(w.json) ?? []; a.push({ key: w.key, q: w.q }); byJson.set(w.json, a); }
      byJson.forEach((cells, _json) => {
        runWidgetQuery(cells[0].q)
          .then((result) => { if (!cancelled) setData((prev) => { const next = new Map(prev); for (const c of cells) next.set(c.key, { result, loading: false }); return next; }); })
          .catch((e) => { if (!cancelled) setData((prev) => { const next = new Map(prev); for (const c of cells) next.set(c.key, { error: e instanceof Error ? e.message : String(e), loading: false }); return next; }); });
      });
      // drop keys no longer wanted
      setData((prev) => { const keep = new Set(wanted.map((w) => w.key)); const next = new Map<string, BlockData>(); prev.forEach((v, k) => { if (keep.has(k)) next.set(k, v); }); return next; });
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/studio test useBlockData`
Expected: PASS (3 tests). The 250ms debounce + `waitFor` default 1000ms timeout leave ample margin.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/useBlockData.ts apps/studio/src/reports-builder/useBlockData.test.tsx
git commit -m "feat(studio): useBlockData — live per-block query fetch (dedup + debounce via runWidgetQuery)"
```

---

## Task 4: `CanvasBlock` live rendering

Add an optional `data` prop. When present, render kpi/chart via `renderWidget(blockToWidgetConfig(block, result), result)`, tables via the same, and show loading/error/placeholder otherwise.

**Files:**
- Modify: `apps/studio/src/reports-builder/CanvasBlock.tsx`
- Test: `apps/studio/src/reports-builder/CanvasBlock.test.tsx` (add cases)

- [ ] **Step 1: Write the failing test (append cases)**

Add to the existing `CanvasBlock.test.tsx`. Mock `renderWidget` so the test asserts wiring, not recharts internals:

```tsx
import { vi } from 'vitest';
vi.mock('../dashboard/widgets', () => ({ renderWidget: (config: { type: string }) => <div data-testid="widget">{config.type}</div> }));

describe('CanvasBlock live data', () => {
  const result = { columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }], rows: [{ label: 'a', value: 1 }], chart: {}, meta: { generatedAt: 'n', rowCount: 1 } } as any;
  it('renders a widget for a chart block with data', () => {
    render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} data={{ result, loading: false }} />);
    expect(screen.getByTestId('widget')).toHaveTextContent('bar-chart');
  });
  it('shows a loading state', () => {
    render(<CanvasBlock block={{ kind: 'kpi', query: {} as never, label: 'X' } as never} data={{ loading: true }} />);
    expect(screen.getByText(/loading|…/i)).toBeInTheDocument();
  });
  it('shows an error state', () => {
    render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} data={{ error: 'boom', loading: false }} />);
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });
});
```

(Keep the existing P3a tests — they render `CanvasBlock` without `data`, which must still show the placeholder.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test CanvasBlock`
Expected: FAIL — `data` prop unsupported / no widget testid.

- [ ] **Step 3: Update `CanvasBlock.tsx`**

Add the import and the `data` prop; branch data blocks on `data` before the placeholder switch:

```tsx
import type { Block } from '@openldr/report-builder/pure';
import { renderWidget } from '../dashboard/widgets';
import { blockToWidgetConfig } from './blockToWidgetConfig';
import type { BlockData } from './useBlockData';

export function CanvasBlock({ block, data }: { block: Block; data?: BlockData }): JSX.Element {
  const isData = block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table';
  if (isData && data) {
    if (data.loading) return <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">Loading…</div>;
    if (data.error) return <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-destructive">{data.error}</div>;
    if (data.result) return <div className="h-full w-full">{renderWidget(blockToWidgetConfig(block, data.result), data.result)}</div>;
  }
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
Expected: PASS (existing 3 + new 3).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/CanvasBlock.tsx apps/studio/src/reports-builder/CanvasBlock.test.tsx
git commit -m "feat(studio): CanvasBlock live data — recharts/table/KPI via renderWidget, loading/error"
```

---

## Task 5: `ReportCanvas` — thread live data + real row counts

Add a `data` map prop; pass each box's `data` to `CanvasBlock`; feed real table row counts into `previewLayoutModel` so pagination reflects fetched data.

**Files:**
- Modify: `apps/studio/src/reports-builder/reportBuilderModel.ts` (`previewLayoutModel` accepts counts)
- Modify: `apps/studio/src/reports-builder/reportBuilderModel.test.ts` (add a case)
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx` (data prop)
- Modify: `apps/studio/src/reports-builder/ReportCanvas.test.tsx` (add a case)

- [ ] **Step 1: Write the failing tests**

Append to `reportBuilderModel.test.ts`:
```ts
it('previewLayoutModel uses a supplied table row count over the sample default', () => {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('table'));
  const lm = previewLayoutModel(t, { '0:0': 9 });
  expect(lm.rows[0].cells[0].rowCount).toBe(9);
});
```

Append to `ReportCanvas.test.tsx`:
```tsx
it('passes block data to the rendered block', () => {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('kpi'));
  const data = new Map([['0:0', { loading: true } as any]]);
  render(<ReportCanvas template={t} selected={null} onSelect={() => {}} data={data} />);
  // loading state from CanvasBlock live-data branch
  expect(screen.getByText(/loading|…/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/studio test reportBuilderModel ReportCanvas`
Expected: FAIL — `previewLayoutModel` arity; `ReportCanvas` has no `data` prop.

- [ ] **Step 3: Update `previewLayoutModel` in `reportBuilderModel.ts`**

Change its signature to accept an optional per-cell row-count map (key `${r}:${c}`), falling back to the sample constant:

```ts
export function previewLayoutModel(t: ReportTemplate, tableRowCounts: Record<string, number> = {}): LayoutModel {
  const ctx = { params: {}, dataset: undefined };
  const rows: LayoutRow[] = t.rows.map((row, r) => ({
    repeat: row.repeat,
    cells: row.cells.map((cell, c) => {
      const b = cell.block;
      if (b.kind === 'title') return { kind: b.kind, colSpan: cell.colSpan, text: interpolate(b.text ?? '', ctx), style: b.style };
      if (b.kind === 'text') return { kind: b.kind, colSpan: cell.colSpan, text: interpolate(b.content ?? '', ctx), style: b.style };
      if (b.kind === 'table') return { kind: b.kind, colSpan: cell.colSpan, rowCount: tableRowCounts[`${r}:${c}`] ?? SAMPLE_TABLE_ROWS };
      return { kind: b.kind, colSpan: cell.colSpan };
    }),
  }));
  return { page: t.page as PageSpec, rows };
}
```

(Leave `SAMPLE_TABLE_ROWS` as the fallback. All other lines unchanged.)

- [ ] **Step 4: Update `ReportCanvas.tsx`**

Add the `data` prop, compute `tableRowCounts` from it, and pass per-box data to `CanvasBlock`:

```tsx
import type { BlockData } from './useBlockData';
// ...
export function ReportCanvas({ template, selected, onSelect, data }: { template: ReportTemplate; selected: CellRef | null; onSelect: (row: number, cell: number) => void; data?: Map<string, BlockData> }): JSX.Element {
  const measurer = useMemo(() => createDomMeasurer(), []);
  const page = template.page as PageSpec;
  const [pw, ph] = pageWH(page);
  const scale = CANVAS_W / pw;
  const tableRowCounts = useMemo(() => {
    const m: Record<string, number> = {};
    data?.forEach((d, k) => { if (d.result) m[k] = d.result.rows.length; });
    return m;
  }, [data]);
  const boxes: PositionedBox[] = useMemo(() => computeLayout(previewLayoutModel(template, tableRowCounts), measurer), [template, tableRowCounts, measurer]);
  // ... rest unchanged, except the CanvasBlock render line becomes:
  //   <CanvasBlock block={template.rows[b.rowIndex].cells[b.cellIndex].block} data={data?.get(`${b.rowIndex}:${b.cellIndex}`)} />
```

Apply the two changes: the `data` param + `tableRowCounts` (above), and pass `data={data?.get(\`${b.rowIndex}:${b.cellIndex}\`)}` on the `<CanvasBlock>` element. Everything else in the file stays.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -C apps/studio test reportBuilderModel ReportCanvas`  (all pass)
Run: `pnpm -C apps/studio typecheck`  (clean)

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/reportBuilderModel.ts apps/studio/src/reports-builder/reportBuilderModel.test.ts apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/ReportCanvas.test.tsx
git commit -m "feat(studio): ReportCanvas threads live block data + real table row counts into layout"
```

---

## Task 6: Wire `QueryEditor` into the inspector + `useBlockData` into the page

**Files:**
- Modify: `apps/studio/src/reports-builder/BlockInspector.tsx` (render QueryEditor for data blocks)
- Modify: `apps/studio/src/reports-builder/BlockInspector.test.tsx` (update the data-block case)
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx` (run useBlockData; pass to canvas)

- [ ] **Step 1: Update the BlockInspector test**

The P3a test asserts a chart block shows the "configure in next step" note. Replace that case to assert the QueryEditor renders instead. Mock `listModels` (QueryEditor calls it):

```tsx
vi.mock('../api', () => ({ listModels: vi.fn().mockResolvedValue([]) }));

it('renders the QueryEditor for a chart block', async () => {
  render(<BlockInspector {...base} block={{ kind: 'chart', query: { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] } as never, chartType: 'bar', visual: {} } as never} colSpan={6} />);
  // chart-type control from QueryEditor
  expect(await screen.findByRole('button', { name: /^bar$/i })).toBeInTheDocument();
});
```

Delete the old `shows a data-config note for chart blocks` test (superseded). Add `import { vi } from 'vitest'` if absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test BlockInspector`
Expected: FAIL — no Bar button (QueryEditor not wired).

- [ ] **Step 3: Update `BlockInspector.tsx`**

Import `QueryEditor` and render it for data blocks instead of the note:

```tsx
import { QueryEditor } from './QueryEditor';
```
Replace the P3a data-block note block:
```tsx
      {(block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table') && (
        <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">Configure this block's data in the next step.</p>
      )}
```
with:
```tsx
      {(block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table') && (
        <QueryEditor block={block} onChange={onPatchBlock} />
      )}
```

- [ ] **Step 4: Wire `useBlockData` in `ReportBuilderPage.tsx`**

Add the import and call the hook, then pass its map to `ReportCanvas`:
```tsx
import { useBlockData } from './useBlockData';
```
Inside the component (after `template` state is defined):
```tsx
  const blockData = useBlockData(template, {});
```
Change the canvas render to pass it:
```tsx
              <ReportCanvas template={template} selected={selected} onSelect={(row, cell) => setSelected({ row, cell })} data={blockData} />
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -C apps/studio test BlockInspector ReportBuilderPage`  (all pass)
Run: `pnpm -C apps/studio typecheck`  (clean)

Note: `ReportBuilderPage.test.tsx` mocks `../api`; since `useBlockData` (via the page) imports `runWidgetQuery` and `QueryEditor` imports `listModels`, add both to that test's `../api` mock factory (`runWidgetQuery: vi.fn().mockResolvedValue({ columns: [], rows: [], chart: {}, meta: { generatedAt: 'n', rowCount: 0 } })`, `listModels: vi.fn().mockResolvedValue([])`). Update the mock only — not the assertions. Report the change.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/BlockInspector.tsx apps/studio/src/reports-builder/BlockInspector.test.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx
git commit -m "feat(studio): wire QueryEditor into inspector + live useBlockData into the builder page"
```

---

## Task 7: Gate — studio tests + cross-package typecheck

- [ ] **Step 1: Isolated studio test run** (never trust turbo `studio#test`)

Run: `pnpm -C apps/studio test reports-builder`
Expected: all reports-builder suites pass. Then `pnpm -C apps/studio test` — expect only the pre-existing known-red `api.test.ts` failure (documented in memory), nothing new.

- [ ] **Step 2: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages pass.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore(studio): green gate for report builder P3b-1"
```

---

## Self-review notes (already reconciled)

- **Spec coverage (P3b-1 slice):** live-data layer (`useBlockData`, Task 3); `renderWidget`-based live canvas (`blockToWidgetConfig` Task 1, `CanvasBlock` Task 4, `ReportCanvas` real row counts Task 5); builder `QueryEditor` reusing `BuilderForm` (Task 2); wiring (Task 6). Deferred to P3b-2/3/4 (filters/params/binding, SQL, multi-series) are explicitly absent — `QueryEditor` shows no filter list, no SQL toggle, no breakdown.
- **Type consistency:** `BlockData` ({result?, error?, loading}) defined in `useBlockData` (Task 3) and consumed in `CanvasBlock` (Task 4) + `ReportCanvas` (Task 5); `blockToWidgetConfig(block, result?)` signature stable across Tasks 1, 4; `previewLayoutModel(t, tableRowCounts?)` extended in Task 5 (backward-compatible optional arg — Task earlier callers unaffected).
- **Purity:** `useBlockData` re-implements the tiny `{{param.x}}` token replace client-side (does NOT import the server `runTemplate`); all `@openldr/report-builder/pure` imports stay pure. `blockToWidgetConfig`/`QueryEditor`/`useBlockData`/`CanvasBlock` import studio api + dashboard components (browser code) — fine.
- **No placeholders:** every code step has full code; run steps state command + expected result.
- **Flagged adaptation points (not gaps):** `BuilderForm`'s `Source` aria-label (verified `aria-label="Source"`); the `ReportBuilderPage.test.tsx` `../api` mock must gain `runWidgetQuery` + `listModels` (Task 6 step 5).
