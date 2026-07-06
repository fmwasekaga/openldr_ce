# Report Builder — Starter-Template Gallery + Wider Chart Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Report Builder useful beyond AMR — "New report" opens a gallery of ready-to-edit starters across lab categories, and the chart palette gains area/donut/horizontal-bar/scatter on both the PDF and canvas render paths.

**Architecture:** Starters are pure builder functions in `@openldr/report-builder` collected in a registry exported from the `/pure` barrel (no DB, no migration); the studio gallery dialog lists them and preloads the chosen one into the in-memory `/new` draft via a `?starter=<id>` param. Chart types extend the shared `chartType` enum and get a drawer on the PDF path (`render/charts/index.ts`) and the recharts canvas (`ReportChart.tsx`), both consuming the unchanged `chart-data.ts` shape.

**Tech Stack:** TypeScript, Zod (schema), pdfkit (PDF drawers), React + recharts (canvas), react-router `useSearchParams`, shadcn (Dialog/Badge/Button), react-i18next (en/fr/pt typed `EnShape`), Vitest + Testing Library.

**Build order:** chart types first (schema → PDF → canvas → authoring), because the starters reference the new `area`/`donut`/`row` chart types and won't `parse()` until the enum is widened. Then the starter registry, then the gallery UI + preload, then the forced gate.

**Important pre-existing facts (do not re-derive):**
- `category` on a template is a Zod **enum** `['amr','operational','quality','regulatory']` (`packages/report-builder/src/schema.ts:4,64`), NOT a free string. Every built template's `category` MUST be one of those. The gallery's per-card badge uses a **separate** display token (`'general'|'amr'|'operational'|'quality'`) resolved through i18n — decoupled from the template's enum.
- The AMR starter REUSES the existing `buildAmrResistanceTemplate()` (`packages/report-builder/src/amr-resistance-template.ts`) — do not duplicate its content.
- Seeding is unchanged: `rt-sample-amr` (`sample.ts`) and `rt-amr-resistance` (`amr-resistance-template.ts`) still seed as today. The registry is additive.
- Lint understands the `daterange` → `{{param.from}}`/`{{param.to}}` binding (fix `625e08aa`), so the reused AMR template with its `dateRange` param is lint-clean.

---

## Task 1: Widen the `chartType` schema enum

**Files:**
- Modify: `packages/report-builder/src/schema.ts:36`
- Test: `packages/report-builder/src/schema.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `packages/report-builder/src/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BlockSchema } from './schema';

describe('chart block chartType', () => {
  for (const chartType of ['bar', 'line', 'pie', 'area', 'donut', 'row', 'scatter'] as const) {
    it(`accepts chartType='${chartType}'`, () => {
      const parsed = BlockSchema.parse({
        kind: 'chart',
        chartType,
        query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] },
      });
      expect(parsed).toMatchObject({ kind: 'chart', chartType });
    });
  }

  it('rejects an unknown chartType', () => {
    expect(() => BlockSchema.parse({
      kind: 'chart', chartType: 'bogus',
      query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] },
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- schema.test.ts`
Expected: FAIL — `area`/`donut`/`row`/`scatter` rejected by the current `z.enum(['bar','line','pie'])`.

- [ ] **Step 3: Widen the enum**

In `packages/report-builder/src/schema.ts:36`, change the chart block line:

```ts
  z.object({ kind: z.literal('chart'), query: WidgetQuerySchema, chartType: z.enum(['bar', 'line', 'pie', 'area', 'donut', 'row', 'scatter']), visual: z.record(z.unknown()).default({}) }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- schema.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/schema.ts packages/report-builder/src/schema.test.ts
git commit -m "feat(report-builder): add area/donut/row/scatter to chart schema enum"
```

---

## Task 2: PDF drawers for area/donut/row/scatter

**Files:**
- Modify: `packages/report-builder/src/render/charts/index.ts`
- Test: `packages/report-builder/src/render/charts/index.test.ts:20`

The existing file has `drawBar`, `drawLine`, `drawPie`, `drawKpi`, a `plotArea`, `drawAxes`, `drawLegend`, `seriesColor`, `maxValue`, and `ChartKind = 'bar' | 'line' | 'pie'`. Reuse them.

- [ ] **Step 1: Extend the failing test**

In `packages/report-builder/src/render/charts/index.test.ts:20`, widen the kinds loop:

```ts
  for (const kind of ['bar', 'line', 'pie', 'kpi', 'area', 'donut', 'row', 'scatter'] as const) {
```

Also add a multi-series case after the empty-data test (so area/row/legend paths run with >1 series):

```ts
  const multi: ChartData = { title: 'Multi', categories: ['A', 'B', 'C'], series: [{ name: 'R', values: [1, 2, 3] }, { name: 'S', values: [3, 2, 1] }] };
  for (const kind of ['area', 'row', 'scatter', 'donut'] as const) {
    it(`draws a multi-series ${kind} chart without throwing`, async () => {
      const buf = await render((doc) => drawChart(doc, box, kind, multi, {}));
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(500);
    });
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- charts/index.test.ts`
Expected: FAIL — `drawChart` typed to `ChartKind | 'kpi'` doesn't accept the new kinds; tsc/runtime error.

- [ ] **Step 3: Implement the drawers**

In `packages/report-builder/src/render/charts/index.ts`:

(a) Widen the type at line 8:

```ts
export type ChartKind = 'bar' | 'line' | 'pie' | 'area' | 'donut' | 'row' | 'scatter';
```

(b) Refactor `drawPie` into a shared `drawPieLike` that takes an inner ratio, and keep `drawPie`/add `drawDonut`. Replace the existing `drawPie` function (lines 101–124) with:

```ts
function drawPieLike(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual, innerRatio: number): void {
  const plot = plotArea(box, true);
  const values = d.categories.map((_, i) => d.series[0]?.values[i] ?? 0);
  const total = values.reduce((s, n) => s + n, 0) || 1;
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2, r = Math.min(plot.w, plot.h) / 2 - 4;
  let a0 = -Math.PI / 2;
  values.forEach((val, i) => {
    const a1 = a0 + (val / total) * Math.PI * 2;
    // pdfkit has no reliable `arc`; approximate each slice as a filled polygon fan.
    const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
    doc.moveTo(cx, cy);
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      doc.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    doc.lineTo(cx, cy).fill(seriesColor(v, i));
    a0 = a1;
  });
  // Donut: punch a white hole (the report page is a light-theme white surface).
  if (innerRatio > 0) doc.circle(cx, cy, r * innerRatio).fill('#ffffff');
  const legend = layoutLegend(d.categories, { x: box.x + box.w - LEGEND_W + 8, y: box.y + TITLE_H + 4, swatch: 8, lineHeight: 14 });
  legend.forEach((it, i) => {
    doc.rect(it.swatchX, it.y, it.swatch, it.swatch).fill(seriesColor(v, i));
    doc.fillColor('#333').font('Helvetica').fontSize(8).text(it.label, it.labelX, it.y - 1, { width: LEGEND_W - 20, ellipsis: true });
  });
}

function drawPie(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  drawPieLike(doc, box, d, v, 0);
}

function drawDonut(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  drawPieLike(doc, box, d, v, 0.55);
}
```

(c) Add `drawArea`, `drawRow`, `drawScatter` (place after `drawLine`, before `drawPieLike`):

```ts
function drawArea(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const y = drawAxes(doc, plot, max);
  const n = Math.max(1, d.categories.length - 1);
  const x = linearScale(0, n, plot.x, plot.x + plot.w);
  d.series.forEach((s, si) => {
    const col = seriesColor(v, si);
    const last = Math.max(0, s.values.length - 1);
    // Filled area: baseline -> points -> baseline.
    doc.moveTo(x(0), plot.y + plot.h);
    s.values.forEach((val, i) => doc.lineTo(x(i), y(val)));
    doc.lineTo(x(last), plot.y + plot.h);
    doc.fillOpacity(0.22).fill(col);
    doc.fillOpacity(1);
    // Line on top.
    s.values.forEach((val, i) => { const px = x(i), py = y(val); if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py); });
    doc.strokeColor(col).lineWidth(1.25).stroke();
  });
  d.categories.forEach((cat, ci) =>
    doc.fillColor('#555').font('Helvetica').fontSize(7).text(cat, x(ci) - 20, plot.y + plot.h + 3, { width: 40, align: 'center', ellipsis: true }));
  if (hasLegend) drawLegend(doc, box, d, v);
}

function drawRow(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const x = linearScale(0, max || 1, plot.x, plot.x + plot.w);
  const ticks = niceTicks(0, max || 1, 4);
  doc.fontSize(7).font('Helvetica');
  for (const t of ticks) {
    const xx = x(t);
    doc.moveTo(xx, plot.y).lineTo(xx, plot.y + plot.h).strokeColor(GRID).lineWidth(0.5).stroke();
    doc.fillColor('#666').text(String(t), xx - 12, plot.y + plot.h + 2, { width: 24, align: 'center' });
  }
  doc.moveTo(plot.x, plot.y).lineTo(plot.x, plot.y + plot.h).strokeColor(AXIS).lineWidth(0.75).stroke();
  const nCat = d.categories.length || 1;
  const groupH = plot.h / nCat;
  const barH = (groupH * 0.7) / Math.max(1, d.series.length);
  d.categories.forEach((cat, ci) => {
    const gy = plot.y + ci * groupH + groupH * 0.15;
    d.series.forEach((s, si) => {
      const val = s.values[ci] ?? 0;
      doc.rect(plot.x, gy + si * barH, Math.max(0, x(val) - plot.x), barH - 1).fill(seriesColor(v, si));
    });
    doc.fillColor('#555').font('Helvetica').fontSize(7).text(cat, plot.x - 30, gy + barH / 2 - 3, { width: 28, align: 'right', ellipsis: true });
  });
  if (hasLegend) drawLegend(doc, box, d, v);
}

function drawScatter(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const y = drawAxes(doc, plot, max);
  const n = Math.max(1, d.categories.length - 1);
  const x = linearScale(0, n, plot.x, plot.x + plot.w);
  d.series.forEach((s, si) => {
    const col = seriesColor(v, si);
    s.values.forEach((val, i) => doc.circle(x(i), y(val), 2.5).fill(col));
  });
  d.categories.forEach((cat, ci) =>
    doc.fillColor('#555').font('Helvetica').fontSize(7).text(cat, x(ci) - 20, plot.y + plot.h + 3, { width: 40, align: 'center', ellipsis: true }));
  if (hasLegend) drawLegend(doc, box, d, v);
}
```

(d) Replace the `drawChart` dispatch (lines 131–137) with:

```ts
export function drawChart(doc: PDFKit.PDFDocument, box: Box, kind: ChartKind | 'kpi', data: ChartData, visual: ChartVisual): void {
  drawTitle(doc, box, data.title);
  if (kind === 'kpi') { drawKpi(doc, box, data); return; }
  if (kind === 'pie') { drawPie(doc, box, data, visual); return; }
  if (kind === 'donut') { drawDonut(doc, box, data, visual); return; }
  if (kind === 'line') { drawLine(doc, box, data, visual); return; }
  if (kind === 'area') { drawArea(doc, box, data, visual); return; }
  if (kind === 'row') { drawRow(doc, box, data, visual); return; }
  if (kind === 'scatter') { drawScatter(doc, box, data, visual); return; }
  drawBar(doc, box, data, visual);
}
```

Note: `linearScale` and `niceTicks` are already imported at the top of the file; `GRID`, `AXIS`, `LEGEND_W`, `TITLE_H` are module constants already defined.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- charts/index.test.ts`
Expected: PASS (8 kinds × valid-PDF + empty + 4 multi-series).

- [ ] **Step 5: Verify `paint.ts` still type-checks (it passes `block.chartType` to `drawChart`)**

Run: `pnpm --filter @openldr/report-builder typecheck`
Expected: clean — `paint.ts:79` `drawChart(doc, box, block.chartType, ...)` now accepts the widened union.

- [ ] **Step 6: Commit**

```bash
git add packages/report-builder/src/render/charts/index.ts packages/report-builder/src/render/charts/index.test.ts
git commit -m "feat(report-builder): PDF drawers for area/donut/row/scatter charts"
```

---

## Task 3: Canvas recharts renderers for the new chart types

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportChart.tsx`
- Test: `apps/studio/src/reports-builder/ReportChart.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `apps/studio/src/reports-builder/ReportChart.test.tsx` inside the `describe('ReportChart', ...)` block:

```ts
  it('renders an area layer per series', () => {
    const { container } = render(<div style={{ width: 300, height: 200 }}><ReportChart chartType="area" data={two} /></div>);
    expect(container.querySelectorAll('.recharts-area').length).toBe(2);
  });

  it('renders a donut (pie sectors) for one series', () => {
    const { container } = render(<div style={{ width: 300, height: 200 }}><ReportChart chartType="donut" data={one} /></div>);
    expect(container.querySelector('.recharts-pie')).toBeInTheDocument();
  });

  it('renders horizontal bars (row) — one bar layer per series', () => {
    const { container } = render(<div style={{ width: 300, height: 200 }}><ReportChart chartType="row" data={two} /></div>);
    expect(container.querySelectorAll('.recharts-bar').length).toBe(2);
  });

  it('renders scatter points per series', () => {
    const { container } = render(<div style={{ width: 300, height: 200 }}><ReportChart chartType="scatter" data={two} /></div>);
    expect(container.querySelectorAll('.recharts-scatter').length).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- ReportChart.test.tsx`
Expected: FAIL — the `chartType` prop is typed `'bar' | 'line' | 'pie'`; `area`/`donut`/`row`/`scatter` are type errors and fall through to the bar branch.

- [ ] **Step 3: Implement the renderers**

Rewrite `apps/studio/src/reports-builder/ReportChart.tsx`:

```tsx
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { ChartData } from '@openldr/report-builder/pure';

const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#D4537E'];
export type ReportChartType = 'bar' | 'line' | 'pie' | 'area' | 'donut' | 'row' | 'scatter';

// Convert { categories, series[] } into recharts row-objects: one row per category with a key per series.
function toRows(data: ChartData): Record<string, unknown>[] {
  return data.categories.map((cat, i) => {
    const row: Record<string, unknown> = { category: cat };
    for (const s of data.series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
}

export function ReportChart({ chartType, data }: { chartType: ReportChartType; data: ChartData }): JSX.Element {
  if (data.categories.length === 0) return <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No data</div>;
  const rows = toRows(data);
  const multi = data.series.length > 1;

  if (chartType === 'pie' || chartType === 'donut') {
    const pieRows = data.categories.map((cat, i) => ({ category: cat, value: data.series[0]?.values[i] ?? 0 }));
    return (
      <ResponsiveContainer><PieChart>
        <Pie data={pieRows} dataKey="value" nameKey="category" outerRadius="80%" innerRadius={chartType === 'donut' ? '50%' : 0} label>
          {pieRows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie><Tooltip /><Legend />
      </PieChart></ResponsiveContainer>
    );
  }
  if (chartType === 'line') {
    return (
      <ResponsiveContainer><LineChart data={rows}>
        <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} />)}
      </LineChart></ResponsiveContainer>
    );
  }
  if (chartType === 'area') {
    return (
      <ResponsiveContainer><AreaChart data={rows}>
        <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => <Area key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.25} />)}
      </AreaChart></ResponsiveContainer>
    );
  }
  if (chartType === 'row') {
    return (
      <ResponsiveContainer><BarChart data={rows} layout="vertical">
        <CartesianGrid stroke="var(--border)" /><XAxis type="number" stroke="var(--text-muted)" /><YAxis type="category" dataKey="category" width={80} stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />)}
      </BarChart></ResponsiveContainer>
    );
  }
  if (chartType === 'scatter') {
    return (
      <ResponsiveContainer><ScatterChart>
        <CartesianGrid stroke="var(--border)" /><XAxis type="number" dataKey="x" stroke="var(--text-muted)" /><YAxis type="number" dataKey="y" stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => (
          <Scatter key={s.name} name={s.name} fill={COLORS[i % COLORS.length]}
            data={data.categories.map((_, ci) => ({ x: ci, y: s.values[ci] ?? 0 }))} />
        ))}
      </ScatterChart></ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer><BarChart data={rows}>
      <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
      {multi && <Legend />}
      {data.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />)}
    </BarChart></ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- ReportChart.test.tsx`
Expected: PASS (existing 2 bar tests + 4 new).

- [ ] **Step 5: Verify `CanvasBlock` type-checks**

`apps/studio/src/reports-builder/CanvasBlock.tsx:18` renders `<ReportChart chartType={block.chartType} data={cd} />`. `block.chartType` is now the widened union and assignable to `ReportChartType`.

Run: `pnpm --filter @openldr/studio typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/ReportChart.tsx apps/studio/src/reports-builder/ReportChart.test.tsx
git commit -m "feat(studio): canvas renderers for area/donut/row/scatter report charts"
```

---

## Task 4: Chart-type toggle options + i18n labels

**Files:**
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx:15`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (the `reportBuilder.query` block)
- Test: `apps/studio/src/i18n/parity.test.ts` (existing — guards fr/pt key parity; no edit, must stay green)

- [ ] **Step 1: Add the i18n keys (en)**

In `apps/studio/src/i18n/en.ts`, in the `reportBuilder.query` object (which already has `bar: 'Bar', line: 'Line', pie: 'Pie'` around line 536), add after `pie`:

```ts
      area: 'Area',
      donut: 'Donut',
      row: 'Row',
      scatter: 'Scatter',
```

- [ ] **Step 2: Add the same keys to fr and pt**

`apps/studio/src/i18n/fr.ts` (`reportBuilder.query`):

```ts
      area: 'Aire',
      donut: 'Anneau',
      row: 'Barres horizontales',
      scatter: 'Nuage de points',
```

`apps/studio/src/i18n/pt.ts` (`reportBuilder.query`):

```ts
      area: 'Área',
      donut: 'Rosca',
      row: 'Barras horizontais',
      scatter: 'Dispersão',
```

- [ ] **Step 3: Widen `CHART_TYPES` in QueryEditor**

In `apps/studio/src/reports-builder/QueryEditor.tsx:15`, replace the `CHART_TYPES` constant:

```ts
const CHART_TYPES: { v: 'bar' | 'line' | 'pie' | 'area' | 'donut' | 'row' | 'scatter'; labelKey: string }[] = [
  { v: 'bar', labelKey: 'reportBuilder.query.bar' },
  { v: 'line', labelKey: 'reportBuilder.query.line' },
  { v: 'area', labelKey: 'reportBuilder.query.area' },
  { v: 'pie', labelKey: 'reportBuilder.query.pie' },
  { v: 'donut', labelKey: 'reportBuilder.query.donut' },
  { v: 'row', labelKey: 'reportBuilder.query.row' },
  { v: 'scatter', labelKey: 'reportBuilder.query.scatter' },
];
```

The existing render loop (lines 120–122) maps `CHART_TYPES` to toggle buttons and calls `onChange({ chartType: c.v })` — no change needed; it now emits all seven types. The buttons wrap via the existing `flex gap-1` container.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/studio test -- i18n QueryEditor`
Expected: PASS — `parity.test.ts` confirms fr/pt have every en key (the four new ones present in all three); typecheck of `en.ts` as `EnShape` source stays valid.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): chart-type toggle offers area/donut/row/scatter (en/fr/pt)"
```

---

## Task 5: Starter registry in `@openldr/report-builder`

**Files:**
- Create: `packages/report-builder/src/starters/index.ts`
- Create: `packages/report-builder/src/starters/index.test.ts`
- Modify: `packages/report-builder/src/pure.ts`

**Registry shape.** `StarterMeta.category` is a **display token** for the gallery badge (`'general'|'amr'|'operational'|'quality'`), decoupled from the built template's enum `category`. `listStarters()` returns metadata only; `getStarterTemplate(id)` builds a schema-valid, lint-clean `ReportTemplate` normalized to `status: 'draft'`. The AMR starter reuses `buildAmrResistanceTemplate()`.

- [ ] **Step 1: Write the failing test**

Create `packages/report-builder/src/starters/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listStarters, getStarterTemplate, STARTER_IDS } from './index';
import { ReportTemplateSchema } from '../schema';
import { lintReportTemplate } from '../lint';

describe('starter registry', () => {
  it('lists all starters in order, blank first', () => {
    const metas = listStarters();
    expect(metas.map((m) => m.id)).toEqual(['blank', 'amr-resistance', 'test-volume', 'patient-demographics', 'specimen-results']);
    expect(metas[0]).toMatchObject({ id: 'blank', category: 'general' });
    for (const m of metas) expect(typeof m.category).toBe('string');
  });

  it('every starter builds a schema-valid, draft, lint-clean template', () => {
    for (const id of STARTER_IDS) {
      const t = getStarterTemplate(id);
      expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
      expect(t.status).toBe('draft');
      const issues = lintReportTemplate(t);
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      expect(errors, `${id} errors: ${JSON.stringify(errors)}`).toHaveLength(0);
      expect(warnings, `${id} warnings: ${JSON.stringify(warnings)}`).toHaveLength(0);
    }
  });

  it('blank is an empty-rows template', () => {
    expect(getStarterTemplate('blank').rows).toHaveLength(0);
  });

  it('the amr-resistance starter reuses the resistance table (observations)', () => {
    const t = getStarterTemplate('amr-resistance');
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table');
    expect(table?.block).toMatchObject({ kind: 'table' });
  });

  it('throws on an unknown starter id', () => {
    expect(() => getStarterTemplate('nope' as never)).toThrow();
  });
});
```

Note on the lint assertion: `ReportLintIssue` has a `severity: 'error' | 'warning'` field (see `packages/report-builder/src/lint.ts`). If the field name differs, read `lint.ts` and match it — do NOT weaken the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- starters`
Expected: FAIL — `./starters/index` does not exist.

- [ ] **Step 3: Implement the registry**

Create `packages/report-builder/src/starters/index.ts`:

```ts
import { ReportTemplateSchema, type ReportTemplate } from '../schema';
import { createEmptyTemplate } from '../helpers';
import { buildAmrResistanceTemplate } from '../amr-resistance-template';

export const STARTER_IDS = ['blank', 'amr-resistance', 'test-volume', 'patient-demographics', 'specimen-results'] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface StarterMeta {
  id: StarterId;
  /** Display token for the gallery badge — resolved to a label via i18n. NOT the template's enum category. */
  category: 'general' | 'amr' | 'operational' | 'quality';
}

const META: Record<StarterId, StarterMeta> = {
  'blank': { id: 'blank', category: 'general' },
  'amr-resistance': { id: 'amr-resistance', category: 'amr' },
  'test-volume': { id: 'test-volume', category: 'operational' },
  'patient-demographics': { id: 'patient-demographics', category: 'quality' },
  'specimen-results': { id: 'specimen-results', category: 'operational' },
};

export function listStarters(): StarterMeta[] {
  return STARTER_IDS.map((id) => META[id]);
}

// A builder query over `model` with a count metric by default; merge `extra` for dimension/breakdown/metric.
function q(model: string, extra: Record<string, unknown> = {}) {
  return { mode: 'builder' as const, model, metric: { key: 'count', label: 'Count', agg: 'count' as const }, filters: [], ...extra };
}

function testVolume(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: 'rt-starter-test-volume', name: 'Test Volume',
    description: 'Monthly test order volume and top tests.', category: 'operational', status: 'draft',
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Test Volume', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Test order volume across the laboratory.', style: { italic: true } } }] },
      { id: 'r3', cells: [
        { colSpan: 6, block: { kind: 'kpi', label: 'Total test orders', query: q('service_requests') } },
        { colSpan: 6, block: { kind: 'kpi', label: 'Distinct patients', query: q('service_requests', { metric: { key: 'distinct_subjects', label: 'Distinct Patients', agg: 'count_distinct', column: 'subject_ref' } }) } },
      ] },
      { id: 'r4', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Monthly order volume by status', style: { bold: true } } }] },
      { id: 'r5', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'area', visual: {}, query: q('service_requests', { dimension: { key: 'authored_on', grain: 'month' }, breakdown: { key: 'status' } }) } }] },
      { id: 'r6', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Orders by test', style: { bold: true } } }] },
      { id: 'r7', cells: [{ colSpan: 12, block: { kind: 'table', source: q('service_requests', { dimension: { key: 'code_text' } }), columns: [] } }] },
    ],
  });
}

function patientDemographics(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: 'rt-starter-patient-demographics', name: 'Patient Demographics',
    description: 'Patient counts by gender.', category: 'quality', status: 'draft',
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Patient Demographics', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Registered patients by gender.', style: { italic: true } } }] },
      { id: 'r3', cells: [
        { colSpan: 5, block: { kind: 'kpi', label: 'Total patients', query: q('patients') } },
        { colSpan: 7, block: { kind: 'chart', chartType: 'donut', visual: {}, query: q('patients', { dimension: { key: 'gender' } }) } },
      ] },
    ],
  });
}

function specimenResults(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: 'rt-starter-specimen-results', name: 'Specimen & Results',
    description: 'Specimen types and result summaries.', category: 'operational', status: 'draft',
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Specimen & Results', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Specimen types received and results by analyte.', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Specimens by type', style: { bold: true } } }] },
      { id: 'r4', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'row', visual: {}, query: q('specimens', { dimension: { key: 'type_text' } }) } }] },
      { id: 'r5', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Results by analyte', style: { bold: true } } }] },
      { id: 'r6', cells: [{ colSpan: 12, block: { kind: 'table', source: q('observations', { dimension: { key: 'code_text' } }), columns: [] } }] },
    ],
  });
}

export function getStarterTemplate(id: StarterId): ReportTemplate {
  switch (id) {
    case 'blank': return createEmptyTemplate('rt-starter-blank', '');
    case 'amr-resistance': return { ...buildAmrResistanceTemplate(), status: 'draft' };
    case 'test-volume': return testVolume();
    case 'patient-demographics': return patientDemographics();
    case 'specimen-results': return specimenResults();
    default: throw new Error(`Unknown starter id: ${String(id)}`);
  }
}
```

- [ ] **Step 4: Export from the pure barrel**

In `packages/report-builder/src/pure.ts`, append:

```ts
export * from './starters';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/report-builder test -- starters`
Expected: PASS (5 tests). If any starter trips a lint warning (e.g. an unused param or empty query), fix the starter's query — do not weaken the lint assertion.

- [ ] **Step 6: Run the package typecheck (pure barrel must stay pdfkit-free)**

Run: `pnpm --filter @openldr/report-builder typecheck`
Expected: clean. `starters/index.ts` imports only `schema`, `helpers`, and `amr-resistance-template` — none pull pdfkit, so `./pure` stays browser-safe.

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/starters packages/report-builder/src/pure.ts
git commit -m "feat(report-builder): starter-template registry (blank + 4 lab starters)"
```

---

## Task 6: Starter gallery dialog + New-report entry point + i18n

**Files:**
- Create: `apps/studio/src/reports-builder/StarterGalleryDialog.tsx`
- Create: `apps/studio/src/reports-builder/StarterGalleryDialog.test.tsx`
- Modify: `apps/studio/src/pages/Reports.tsx` (`NewReportButton`, ~line 258)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (new `reportBuilder.gallery` block)

- [ ] **Step 1: Add gallery i18n (en)**

In `apps/studio/src/i18n/en.ts`, add a `gallery` object inside `reportBuilder` (sibling of `query`/`settings`/`palette`/`inspector`):

```ts
    gallery: {
      title: 'Start a new report',
      subtitle: 'Pick a starter, then customize it.',
      category: { general: 'General', amr: 'AMR', operational: 'Operational', quality: 'Quality' },
      starters: {
        blank: { name: 'Blank report', description: 'Start from an empty canvas.' },
        'amr-resistance': { name: 'AMR Resistance', description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.' },
        'test-volume': { name: 'Test Volume', description: 'Monthly order volume, KPIs, and orders by test.' },
        'patient-demographics': { name: 'Patient Demographics', description: 'Patient counts by gender.' },
        'specimen-results': { name: 'Specimen & Results', description: 'Specimen types and results by analyte.' },
      },
    },
```

- [ ] **Step 2: Add gallery i18n (fr, pt)**

`apps/studio/src/i18n/fr.ts` — inside `reportBuilder`:

```ts
    gallery: {
      title: 'Créer un nouveau rapport',
      subtitle: 'Choisissez un modèle, puis personnalisez-le.',
      category: { general: 'Général', amr: 'RAM', operational: 'Opérationnel', quality: 'Qualité' },
      starters: {
        blank: { name: 'Rapport vierge', description: 'Partir d’une page vierge.' },
        'amr-resistance': { name: 'Résistance RAM', description: 'Décomptes R/I/S et %R par antibiotique.' },
        'test-volume': { name: 'Volume d’analyses', description: 'Volume mensuel de commandes, indicateurs et commandes par test.' },
        'patient-demographics': { name: 'Démographie des patients', description: 'Nombre de patients par sexe.' },
        'specimen-results': { name: 'Échantillons et résultats', description: 'Types d’échantillons et résultats par analyte.' },
      },
    },
```

`apps/studio/src/i18n/pt.ts` — inside `reportBuilder`:

```ts
    gallery: {
      title: 'Iniciar um novo relatório',
      subtitle: 'Escolha um modelo inicial e personalize-o.',
      category: { general: 'Geral', amr: 'RAM', operational: 'Operacional', quality: 'Qualidade' },
      starters: {
        blank: { name: 'Relatório em branco', description: 'Começar de uma tela vazia.' },
        'amr-resistance': { name: 'Resistência RAM', description: 'Contagens R/I/S e %R por antibiótico.' },
        'test-volume': { name: 'Volume de exames', description: 'Volume mensal de pedidos, KPIs e pedidos por exame.' },
        'patient-demographics': { name: 'Demografia de pacientes', description: 'Contagem de pacientes por sexo.' },
        'specimen-results': { name: 'Amostras e resultados', description: 'Tipos de amostra e resultados por analito.' },
      },
    },
```

- [ ] **Step 3: Write the failing dialog test**

Create `apps/studio/src/reports-builder/StarterGalleryDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

import { StarterGalleryDialog } from './StarterGalleryDialog';

function open() {
  return render(<MemoryRouter><StarterGalleryDialog open onOpenChange={() => {}} /></MemoryRouter>);
}

describe('StarterGalleryDialog', () => {
  it('renders a card per starter, including Blank', () => {
    open();
    expect(screen.getByText('Blank report')).toBeInTheDocument();
    expect(screen.getByText('AMR Resistance')).toBeInTheDocument();
    expect(screen.getByText('Test Volume')).toBeInTheDocument();
    expect(screen.getByText('Patient Demographics')).toBeInTheDocument();
    expect(screen.getByText('Specimen & Results')).toBeInTheDocument();
  });

  it('navigates to /new?starter=<id> when a card is picked', () => {
    navigate.mockClear();
    open();
    fireEvent.click(screen.getByText('Test Volume'));
    expect(navigate).toHaveBeenCalledWith('/reports/builder/new?starter=test-volume');
  });

  it('navigates to a blank new report for the Blank card', () => {
    navigate.mockClear();
    open();
    fireEvent.click(screen.getByText('Blank report'));
    expect(navigate).toHaveBeenCalledWith('/reports/builder/new?starter=blank');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- StarterGalleryDialog`
Expected: FAIL — the component does not exist.

- [ ] **Step 5: Implement the dialog**

Create `apps/studio/src/reports-builder/StarterGalleryDialog.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Activity, BarChart3, Users, FlaskConical, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { listStarters, type StarterId } from '@openldr/report-builder/pure';

const ICONS: Record<StarterId, LucideIcon> = {
  'blank': FileText,
  'amr-resistance': Activity,
  'test-volume': BarChart3,
  'patient-demographics': Users,
  'specimen-results': FlaskConical,
};

export function StarterGalleryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const starters = listStarters();

  const pick = (id: StarterId) => {
    onOpenChange(false);
    navigate(`/reports/builder/new?starter=${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('reportBuilder.gallery.title')}</DialogTitle>
          <DialogDescription>{t('reportBuilder.gallery.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {starters.map((s) => {
            const Icon = ICONS[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s.id)}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-accent"
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <Badge variant="secondary">{t(`reportBuilder.gallery.category.${s.category}`)}</Badge>
                </div>
                <div className="mt-1 text-sm font-medium">{t(`reportBuilder.gallery.starters.${s.id}.name`)}</div>
                <div className="text-xs text-muted-foreground">{t(`reportBuilder.gallery.starters.${s.id}.description`)}</div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`@/components/ui/badge` exists (`apps/studio/src/components/ui/badge.tsx`) — import `Badge` from it directly; no need to create it.

- [ ] **Step 6: Wire `NewReportButton` to open the dialog**

In `apps/studio/src/pages/Reports.tsx`, replace `NewReportButton` (~lines 258–263). The current body is:

```tsx
export function NewReportButton(): JSX.Element | null {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  if (!(hasRole('lab_admin') || hasRole('lab_manager'))) return null;
  return <Button size="sm" onClick={() => navigate('/reports/builder/new')}>New report</Button>;
}
```

Replace it with (keep the literal `New report` label — there is no `reports.newReport` i18n key, and the dialog owns the localized strings):

```tsx
export function NewReportButton(): JSX.Element | null {
  const { hasRole } = useAuth();
  const [galleryOpen, setGalleryOpen] = useState(false);
  if (!(hasRole('lab_admin') || hasRole('lab_manager'))) return null;
  return (
    <>
      <Button size="sm" onClick={() => setGalleryOpen(true)}>New report</Button>
      <StarterGalleryDialog open={galleryOpen} onOpenChange={setGalleryOpen} />
    </>
  );
}
```

Add the import at the top of `Reports.tsx`: `import { StarterGalleryDialog } from '@/reports-builder/StarterGalleryDialog';`. `useState` is already imported (line 1). `useNavigate` is no longer used by `NewReportButton`, but leave the top-level import if any other code in the file uses it (check; if unused after this change, remove it to keep the build clean).

- [ ] **Step 7: Update `Reports.newReport.test.tsx`**

The existing `apps/studio/src/pages/Reports.newReport.test.tsx` asserts the old navigate-on-click behavior. Update it to assert the button now opens the gallery (a dialog with the starter cards appears) rather than navigating directly. Concretely, render `<NewReportButton />` inside a `MemoryRouter` with a mocked `useAuth` returning an admin role, click the button, and assert `screen.getByText('Blank report')` is visible. Read the current test to preserve its auth-mock setup.

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @openldr/studio test -- StarterGalleryDialog Reports.newReport i18n`
Expected: PASS. `parity.test.ts` confirms fr/pt have the full `reportBuilder.gallery.*` tree.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/reports-builder/StarterGalleryDialog.tsx apps/studio/src/reports-builder/StarterGalleryDialog.test.tsx apps/studio/src/pages/Reports.tsx apps/studio/src/pages/Reports.newReport.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): starter gallery dialog on New report (en/fr/pt)"
```

---

## Task 7: Preload the chosen starter into the builder draft

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx:30` (initial template state)
- Test: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

The existing test file renders `ReportBuilderPage` under a `MemoryRouter` with routes for `/reports/builder/new` and `/:id` (see its `renderNew` helper around line 38). Add a helper + tests. Append to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`:

```tsx
function renderWithStarter(starter: string) {
  return render(
    <MemoryRouter initialEntries={[`/reports/builder/new?starter=${starter}`]}>
      <Routes>
        <Route path="/reports/builder/new" element={<ReportBuilderPage />} />
        <Route path="/reports/builder/:id" element={<ReportBuilderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReportBuilderPage starter preload', () => {
  it('preloads the Test Volume starter content when ?starter=test-volume', async () => {
    renderWithStarter('test-volume');
    // The starter title block text appears in the name input / canvas title.
    expect(await screen.findByDisplayValue('Test Volume')).toBeInTheDocument();
  });

  it('falls back to a blank draft for an unknown starter', async () => {
    renderWithStarter('does-not-exist');
    // Blank draft has an empty name input.
    const nameInput = await screen.findByPlaceholderText(/report name|untitled/i);
    expect((nameInput as HTMLInputElement).value).toBe('');
  });
});
```

Adjust the two selectors to the page's real DOM: the name field is an `Input` bound to `template.name` (find it the way the existing tests in this file do — reuse their query, e.g. a `getByPlaceholderText` or a `data-testid`). Do NOT invent a placeholder; read the existing test to copy its name-field query. The point of the assertions: starter → `template.name === 'Test Volume'`; unknown/blank → `template.name === ''`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- ReportBuilderPage.test.tsx`
Expected: FAIL — the page always initializes via `createEmptyTemplate` (empty name), so the Test-Volume assertion fails.

- [ ] **Step 3: Implement the preload**

In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`:

(a) Import `useSearchParams` and the starter helpers. Change line 2:

```ts
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
```

Add to the `@openldr/report-builder/pure` import (line 8):

```ts
import { createEmptyTemplate, getStarterTemplate, lintReportTemplate, type Block, type BlockKind, type PageSpec, type ReportTemplate, type StarterId } from '@openldr/report-builder/pure';
```

(b) Replace the initial template state (line 30). Read `?starter=` once at mount and build the initial draft:

```ts
  const [searchParams] = useSearchParams();
  const [template, setTemplate] = useState<ReportTemplate>(() => {
    const starter = searchParams.get('starter');
    const fresh = `rt-${Date.now()}`;
    if (starter && starter !== 'blank') {
      try {
        return { ...getStarterTemplate(starter as StarterId), id: fresh, status: 'draft' as const };
      } catch {
        return createEmptyTemplate(fresh, ''); // unknown starter → blank
      }
    }
    return createEmptyTemplate(fresh, '');
  });
```

Place the `useSearchParams()` call with the other hooks near the top of the component (before the `useState` that consumes it). The `id`-load effect (lines 46–51) is unaffected: when editing an existing template (`:id` present) it overwrites this initial draft as today; `?starter=` only matters on the `/new` route where `id` is undefined.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- ReportBuilderPage.test.tsx`
Expected: PASS (existing 10 tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "feat(studio): preload chosen starter into the builder via ?starter="
```

---

## Task 8: Forced full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck across all packages**

Run: `pnpm turbo run typecheck --force`
Expected: `31 successful, 31 total`. NEVER pipe turbo through `tail`. If a consumer of `@openldr/report-builder` (studio, server, bootstrap, cli) fails to typecheck on the widened `chartType` union or the new `starters` export, fix it there.

- [ ] **Step 2: Forced test across all packages**

Run: `pnpm turbo run test --force`
Expected: green except the two known pre-existing flakes — studio `api.test.ts > "includes server error messages…"` (vitest-dedupe) and parallel-load timeouts (users/audit/etc. that pass in isolation). Confirm any red is one of those by re-running the package in isolation (e.g. `pnpm --filter @openldr/studio test`, `pnpm --filter @openldr/report-builder test`). A genuine failure in report-builder or the touched studio files is a regression — fix it.

- [ ] **Step 3: Commit (only if a gate fix was needed)**

```bash
git add -A && git commit -m "fix(report-builder): resolve cross-package gate breakage from chart/starter changes"
```

If no fix was needed, skip.

---

## Post-plan: review + finish

After Task 8, the subagent-driven flow runs the final holistic review of the whole branch, then `finishing-a-development-branch` (merge `--no-ff` to local `main`, delete branch, update memory). A live visual check (gallery → pick each starter → confirm live data + each new chart type on canvas and in Preview PDF, in dark + light) can be done in the running dev stack (API `:3000` bypass + vite `:5199` are already up).

---

## Self-review notes (checked against the spec)

- **Spec §A1 registry** → Task 5 (`listStarters`/`getStarterTemplate`, pure export, AMR reuse, draft+lint-clean).
- **Spec §A2 starter set** → Task 5 builders (blank/amr/test-volume/patient-demographics/specimen-results), bound to real `registry.ts` models.
- **Spec §A3 gallery UI + preload** → Task 6 (dialog + NewReportButton) and Task 7 (`?starter=` preload). i18n en/fr/pt in Task 6.
- **Spec §B1 schema** → Task 1. **§B2 PDF drawers** → Task 2. **§B3 canvas** → Task 3. **§B4 authoring toggle** → Task 4.
- **Spec testing/gate** → per-task tests + Task 8 forced gate.
- **Correction vs spec:** the spec called `category` a "free string"; it is a Zod enum. Resolved: template `category` uses the enum; the gallery badge uses a decoupled display token (`StarterMeta.category`) resolved via i18n. Documented in Task 5.
- **Type consistency:** `chartType` union `'bar'|'line'|'pie'|'area'|'donut'|'row'|'scatter'` is identical across schema (Task 1), `ChartKind` (Task 2), `ReportChartType` (Task 3), and `CHART_TYPES` (Task 4). `StarterId` / `STARTER_IDS` are shared from Task 5 and reused in Tasks 6–7.
