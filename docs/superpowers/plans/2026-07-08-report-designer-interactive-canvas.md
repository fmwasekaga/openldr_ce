# Report Designer — Interactive Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Report Designer canvas interactive — drag to move, resize via 8 handles, multi-select (click / Shift-click / marquee), alignment guides — all on the in-memory template with per-gesture undo.

**Architecture:** Pure, unit-tested geometry (`geometry.ts`) and snap math (`alignmentGuides.ts`) + template transforms in `model.ts`. A `useCanvasInteraction` hook runs the pointer state machine (move / resize / marquee), converts pointer deltas to model space (÷ zoom), clamps to the page, and snaps to guides; it emits selection changes and rect commits. `PageCanvas` renders the chrome (outlines, handles, guide lines, marquee) and wires pointer events per page. `ReportDesignerPage` owns `selectedIds`, builds commit/delete/nudge handlers on the existing `pushTemplate`/`recordEdit` history, and adds keyboard.

**Tech Stack:** React + TS, Tailwind/shadcn, Vitest + @testing-library/react (jsdom; `setupTests.ts` polyfills pointer-capture and imports `@/i18n`). No backend.

**Reference spec:** `docs/superpowers/specs/2026-07-08-report-designer-interactive-canvas-design.md`

---

## File Structure

Under `apps/studio/src/report-designer/`:

| File | Responsibility |
|------|----------------|
| `geometry.ts` (new) | Pure: `Handle`, `Box`, `clampRectToPage`, `clampGroupDelta`, `boundingBox`, `rectsIntersect`, `marqueeHits`, `resizeRect`, `boxFromPoints`. |
| `alignmentGuides.ts` (new) | Pure: `GuideLine`, `Snap`, `axisCandidates`, `snapAxis`, `computeMoveGuides`, `computeResizeGuides`, `applyResizeSnap`. |
| `model.ts` (modify) | Add `allElements`, `updateElementRects`, `removeElements`. |
| `useCanvasInteraction.ts` (new) | Pointer state machine hook; transient preview/guides/marquee; emits `onSelect`/`onCommitRects`. |
| `PageCanvas.tsx` (modify) | Multi-select rendering, 8 handles, guides, marquee; per-page interaction surface. |
| `ReportDesignerPage.tsx` (modify) | `selectedIds` state, commit/delete/nudge handlers, keyboard, undo selection reconcile. |
| `InspectorTabs.tsx` / `PropertiesTab.tsx` / `LayersTab.tsx` (modify) | Accept `selectedIds` + `onSelect(ids)`; Layers Shift-click; Properties multi summary. |

**Test command:** `pnpm --filter @openldr/studio exec vitest run <path>`; typecheck `pnpm --filter @openldr/studio typecheck`.

---

## Task 1: Pure geometry module

**Files:** Create `apps/studio/src/report-designer/geometry.ts`, `geometry.test.ts`

- [ ] **Step 1: Write the failing test** — `geometry.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { clampRectToPage, clampGroupDelta, boundingBox, rectsIntersect, marqueeHits, resizeRect, boxFromPoints } from './geometry';
import type { DesignElement } from './types';

const PAGE = { w: 800, h: 1000 };
const el = (id: string, x: number, y: number, w = 50, h = 50): DesignElement => ({ id, kind: 'rect', name: id, rect: { x, y, w, h } });

describe('geometry', () => {
  it('clampRectToPage keeps a rect inside the page', () => {
    expect(clampRectToPage({ x: -10, y: 5, w: 40, h: 40 }, PAGE)).toEqual({ x: 0, y: 5, w: 40, h: 40 });
    expect(clampRectToPage({ x: 790, y: 990, w: 40, h: 40 }, PAGE)).toEqual({ x: 760, y: 960, w: 40, h: 40 });
    expect(clampRectToPage({ x: 0, y: 0, w: 9999, h: 9999 }, PAGE)).toEqual({ x: 0, y: 0, w: 800, h: 1000 });
  });

  it('clampGroupDelta limits movement to the most-constrained member', () => {
    const rects = [{ x: 10, y: 10, w: 20, h: 20 }, { x: 700, y: 10, w: 20, h: 20 }];
    expect(clampGroupDelta(rects, -50, 0, PAGE)).toEqual({ dx: -10, dy: 0 }); // left member hits 0
    expect(clampGroupDelta(rects, 200, 0, PAGE)).toEqual({ dx: 80, dy: 0 });  // right member hits 800
  });

  it('boundingBox spans all rects', () => {
    expect(boundingBox([{ x: 10, y: 20, w: 30, h: 40 }, { x: 100, y: 5, w: 10, h: 10 }])).toEqual({ x: 10, y: 5, w: 100, h: 55 });
    expect(boundingBox([])).toBeNull();
  });

  it('rectsIntersect / marqueeHits find overlapping elements', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
    const els = [el('a', 0, 0), el('b', 500, 500)];
    expect(marqueeHits({ x: -5, y: -5, w: 60, h: 60 }, els)).toEqual(['a']);
  });

  it('resizeRect moves the dragged edge and honors the min floor', () => {
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'se', 20, 30)).toEqual({ x: 100, y: 100, w: 120, h: 130 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'nw', 20, 20)).toEqual({ x: 120, y: 120, w: 80, h: 80 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'e', -200, 0)).toEqual({ x: 100, y: 100, w: 8, h: 100 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'n', 200, 0)).toEqual({ x: 100, y: 192, w: 100, h: 8 });
  });

  it('boxFromPoints normalizes to a positive box', () => {
    expect(boxFromPoints(30, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cannot resolve ./geometry`)

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/geometry.test.ts`

- [ ] **Step 3: Write `geometry.ts`**

```ts
import type { DesignElement, Rect } from './types';

export interface Box { x: number; y: number; w: number; h: number; }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function clampRectToPage(rect: Rect, page: { w: number; h: number }): Rect {
  const w = Math.min(rect.w, page.w);
  const h = Math.min(rect.h, page.h);
  return { w, h, x: Math.max(0, Math.min(rect.x, page.w - w)), y: Math.max(0, Math.min(rect.y, page.h - h)) };
}

/** Clamp a group move delta so the most-constrained member stays on the page. */
export function clampGroupDelta(rects: Rect[], dx: number, dy: number, page: { w: number; h: number }): { dx: number; dy: number } {
  let cdx = dx, cdy = dy;
  for (const r of rects) {
    cdx = Math.max(cdx, -r.x); cdx = Math.min(cdx, page.w - (r.x + r.w));
    cdy = Math.max(cdy, -r.y); cdy = Math.min(cdy, page.h - (r.y + r.h));
  }
  return { dx: cdx, dy: cdy };
}

export function boundingBox(rects: Rect[]): Box | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function marqueeHits(marquee: Box, elements: DesignElement[]): string[] {
  return elements.filter((el) => rectsIntersect(marquee, el.rect)).map((el) => el.id);
}

/** Resize `rect` by dragging `handle` by (dx, dy) model px; opposite edge stays fixed; min-size floor. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, min = 8): Rect {
  let { x, y, w, h } = rect;
  const right = x + w, bottom = y + h;
  if (handle.includes('w')) { x = Math.min(x + dx, right - min); w = right - x; }
  if (handle.includes('e')) { w = Math.max(min, w + dx); }
  if (handle.includes('n')) { y = Math.min(y + dy, bottom - min); h = bottom - y; }
  if (handle.includes('s')) { h = Math.max(min, h + dy); }
  return { x, y, w, h };
}

export function boxFromPoints(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}
```

- [ ] **Step 4: Run — expect PASS** (6 tests)
- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/geometry.ts apps/studio/src/report-designer/geometry.test.ts
git commit -m "feat(report-designer): pure canvas geometry (clamp, resize, marquee)"
```

---

## Task 2: Alignment guide math

**Files:** Create `apps/studio/src/report-designer/alignmentGuides.ts`, `alignmentGuides.test.ts`

- [ ] **Step 1: Write the failing test** — `alignmentGuides.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeMoveGuides, computeResizeGuides, applyResizeSnap } from './alignmentGuides';
import type { DesignElement } from './types';

const PAGE = { w: 800, h: 1000 };
const el = (id: string, x: number, y: number, w = 50, h = 50): DesignElement => ({ id, kind: 'rect', name: id, rect: { x, y, w, h } });

describe('alignmentGuides', () => {
  it('snaps a move to a nearby element left edge and returns a guide line', () => {
    const others = [el('a', 100, 400)];
    const snap = computeMoveGuides({ x: 103, y: 10, w: 50, h: 50 }, others, PAGE, 6);
    expect(snap.dx).toBe(-3); // left edge 103 → 100
    expect(snap.lines.some((l) => l.axis === 'x' && l.pos === 100)).toBe(true);
  });

  it('snaps a move to the page horizontal center', () => {
    const snap = computeMoveGuides({ x: 372, y: 10, w: 50, h: 50 }, [], PAGE, 6);
    // box centerX 397 → page centerX 400
    expect(snap.dx).toBe(3);
  });

  it('does not snap when nothing is within the threshold', () => {
    const snap = computeMoveGuides({ x: 200, y: 200, w: 50, h: 50 }, [el('a', 100, 400)], PAGE, 6);
    expect(snap.dx).toBe(0);
    expect(snap.dy).toBe(0);
    expect(snap.lines).toHaveLength(0);
  });

  it('resize snap nudges only the dragged edge', () => {
    const others = [el('a', 300, 400)];
    // right edge at 297, snapping to a's left edge 300
    const rect = { x: 100, y: 100, w: 197, h: 100 };
    const snap = computeResizeGuides(rect, 'e', others, PAGE, 6);
    expect(snap.dx).toBe(3);
    const out = applyResizeSnap(rect, 'e', snap);
    expect(out).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/alignmentGuides.test.ts`

- [ ] **Step 3: Write `alignmentGuides.ts`**

```ts
import type { DesignElement, Rect } from './types';
import type { Box, Handle } from './geometry';

export interface GuideLine { axis: 'x' | 'y'; pos: number; from: number; to: number; }
export interface Snap { dx: number; dy: number; lines: GuideLine[]; }

interface AxisCand { pos: number; lo: number; hi: number; }

export function axisCandidates(axis: 'x' | 'y', others: DesignElement[], page: { w: number; h: number }): AxisCand[] {
  const c: AxisCand[] = [];
  if (axis === 'x') {
    c.push({ pos: 0, lo: 0, hi: page.h }, { pos: page.w / 2, lo: 0, hi: page.h }, { pos: page.w, lo: 0, hi: page.h });
    for (const e of others) { const r = e.rect; c.push({ pos: r.x, lo: r.y, hi: r.y + r.h }, { pos: r.x + r.w / 2, lo: r.y, hi: r.y + r.h }, { pos: r.x + r.w, lo: r.y, hi: r.y + r.h }); }
  } else {
    c.push({ pos: 0, lo: 0, hi: page.w }, { pos: page.h / 2, lo: 0, hi: page.w }, { pos: page.h, lo: 0, hi: page.w });
    for (const e of others) { const r = e.rect; c.push({ pos: r.y, lo: r.x, hi: r.x + r.w }, { pos: r.y + r.h / 2, lo: r.x, hi: r.x + r.w }, { pos: r.y + r.h, lo: r.x, hi: r.x + r.w }); }
  }
  return c;
}

export function snapAxis(probes: number[], cands: AxisCand[], threshold: number): { delta: number; cand: AxisCand } | null {
  let best: { delta: number; cand: AxisCand; dist: number } | null = null;
  for (const p of probes) for (const cand of cands) {
    const delta = cand.pos - p; const dist = Math.abs(delta);
    if (dist <= threshold && (!best || dist < best.dist)) best = { delta, cand, dist };
  }
  return best ? { delta: best.delta, cand: best.cand } : null;
}

export function computeMoveGuides(box: Box, others: DesignElement[], page: { w: number; h: number }, threshold: number): Snap {
  const sx = snapAxis([box.x, box.x + box.w / 2, box.x + box.w], axisCandidates('x', others, page), threshold);
  const sy = snapAxis([box.y, box.y + box.h / 2, box.y + box.h], axisCandidates('y', others, page), threshold);
  const lines: GuideLine[] = [];
  if (sx) lines.push({ axis: 'x', pos: sx.cand.pos, from: sx.cand.lo, to: sx.cand.hi });
  if (sy) lines.push({ axis: 'y', pos: sy.cand.pos, from: sy.cand.lo, to: sy.cand.hi });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, lines };
}

export function computeResizeGuides(rect: Rect, handle: Handle, others: DesignElement[], page: { w: number; h: number }, threshold: number): Snap {
  const xProbes: number[] = []; const yProbes: number[] = [];
  if (handle.includes('w')) xProbes.push(rect.x);
  if (handle.includes('e')) xProbes.push(rect.x + rect.w);
  if (handle.includes('n')) yProbes.push(rect.y);
  if (handle.includes('s')) yProbes.push(rect.y + rect.h);
  const sx = xProbes.length ? snapAxis(xProbes, axisCandidates('x', others, page), threshold) : null;
  const sy = yProbes.length ? snapAxis(yProbes, axisCandidates('y', others, page), threshold) : null;
  const lines: GuideLine[] = [];
  if (sx) lines.push({ axis: 'x', pos: sx.cand.pos, from: sx.cand.lo, to: sx.cand.hi });
  if (sy) lines.push({ axis: 'y', pos: sy.cand.pos, from: sy.cand.lo, to: sy.cand.hi });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, lines };
}

/** Apply a resize snap delta to the moving edge(s) of `rect`. */
export function applyResizeSnap(rect: Rect, handle: Handle, snap: Snap): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes('w')) { x += snap.dx; w -= snap.dx; }
  else if (handle.includes('e')) { w += snap.dx; }
  if (handle.includes('n')) { y += snap.dy; h -= snap.dy; }
  else if (handle.includes('s')) { h += snap.dy; }
  return { x, y, w, h };
}
```

- [ ] **Step 4: Run — expect PASS** (4 tests)
- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/alignmentGuides.ts apps/studio/src/report-designer/alignmentGuides.test.ts
git commit -m "feat(report-designer): alignment guide snap math"
```

---

## Task 3: Template transforms in model.ts

**Files:** Modify `apps/studio/src/report-designer/model.ts`, `model.test.ts`

- [ ] **Step 1: Add failing tests** — append inside `describe('report-designer model', ...)` in `model.test.ts`:

```ts
  it('allElements flattens across pages', () => {
    expect(allElements(MOCK_TEMPLATES[0]).length).toBe(
      MOCK_TEMPLATES[0].pages.reduce((n, p) => n + p.elements.length, 0),
    );
  });

  it('updateElementRects replaces only the given rects, immutably', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = updateElementRects(tpl, new Map([[id, { x: 1, y: 2, w: 3, h: 4 }]]));
    expect(next.pages[0].elements[0].rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(tpl.pages[0].elements[0].rect).not.toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('removeElements drops the given ids', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = removeElements(tpl, new Set([id]));
    expect(allElements(next).some((e) => e.id === id)).toBe(false);
  });
```

Add to the import at the top of `model.test.ts`:

```ts
import { newElement, addElement, reportsOnPage, paperSize, findElement, allElements, updateElementRects, removeElements } from './model';
```

- [ ] **Step 2: Run — expect FAIL** (`allElements` etc. not exported)

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/model.test.ts`

- [ ] **Step 3: Add to `model.ts`** — append these exports (the file already imports `DesignElement`, `Rect`, `ReportTemplate` types; ensure `Rect` and `DesignElement` are in the import):

```ts
export function allElements(tpl: ReportTemplate): DesignElement[] {
  return tpl.pages.flatMap((p) => p.elements);
}

export function updateElementRects(tpl: ReportTemplate, rects: Map<string, Rect>): ReportTemplate {
  if (rects.size === 0) return tpl;
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => (rects.has(e.id) ? { ...e, rect: rects.get(e.id)! } : e)),
    })),
  };
}

export function removeElements(tpl: ReportTemplate, ids: Set<string>): ReportTemplate {
  if (ids.size === 0) return tpl;
  return { ...tpl, pages: tpl.pages.map((p) => ({ ...p, elements: p.elements.filter((e) => !ids.has(e.id)) })) };
}
```

If `model.ts`'s type import is `import type { DesignElement, DesignPage, ElementKind, Orientation, Paper, ReportTemplate } from './types';`, add `Rect`: `import type { DesignElement, DesignPage, ElementKind, Orientation, Paper, Rect, ReportTemplate } from './types';`.

- [ ] **Step 4: Run — expect PASS** (10 tests)
- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/model.ts apps/studio/src/report-designer/model.test.ts
git commit -m "feat(report-designer): template rect-update and element-removal transforms"
```

---

## Task 4: Selection model → `selectedIds[]` (plumbing + static handles)

Refactor the selection from a single id to a list, threaded through the page and inspector. Canvas gains click / Shift-click select and renders outlines on all selected + 8 handles when exactly one is selected (static — dragging comes in Task 6). No new behavior beyond multi-select-by-click yet.

**Files:** Modify `ReportDesignerPage.tsx`, `InspectorTabs.tsx`, `PropertiesTab.tsx`, `LayersTab.tsx`, `PageCanvas.tsx` and their tests.

- [ ] **Step 1: Update `PropertiesTab.tsx`** — accept `selectedIds` and handle 0/1/many:

Replace the `Props` interface and the component signature/body head:

```tsx
import { useTranslation } from 'react-i18next';
import { GripVertical } from 'lucide-react';
import type { ReportTemplate } from './types';
import { findElement } from './model';

interface Props { template: ReportTemplate; selectedIds: string[]; }
```

Then change the component:

```tsx
export function PropertiesTab({ template, selectedIds }: Props): JSX.Element {
  const { t } = useTranslation();
  const selected = selectedIds.length === 1 ? findElement(template, selectedIds[0]) : null;

  if (selectedIds.length > 1) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {t('reportDesigner.selectedCount', { count: selectedIds.length })}
      </div>
    );
  }
  if (!selected) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.pageSettings')}</div>
        <Field label={t('reportDesigner.paper')} value={template.paper} />
        <Field label={t('reportDesigner.orientation')} value={template.orientation} />
      </div>
    );
  }
  // ...unchanged element-fields block (X/Y/W/H + table bound report/columns)...
}
```

Keep the existing `Field` helper and the element-fields JSX exactly as-is. (Only the imports, `Props`, signature, and the two guards above change; the `GripVertical`/`DesignElement`-less element block stays — note `DesignElement` is no longer imported, which is fine since the type is inferred from `findElement`.)

- [ ] **Step 2: Update `LayersTab.tsx`** — multi-select props + Shift-click:

```tsx
interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onSelect(ids: string[]): void;
}
```

Change the component to compute `active` from the list and toggle on Shift-click:

```tsx
export function LayersTab({ template, selectedIds, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const elements = template.pages.flatMap((p) => p.elements).slice().reverse();
  const toggle = (id: string, additive: boolean) =>
    onSelect(additive ? (selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]) : [id]);
  return (
    <div>
      {elements.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t('reportDesigner.noElements')}</p>}
      {elements.map((el) => {
        const Icon = KIND_ICON[el.kind];
        const active = selectedIds.includes(el.id);
        return (
          <button key={el.id} onClick={(e) => toggle(el.id, e.shiftKey)}
            className={cn('flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
            <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{el.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Update `InspectorTabs.tsx`** — thread `selectedIds` / `onSelect`:

```tsx
interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onSelect(ids: string[]): void;
}

export function InspectorTabs({ template, selectedIds, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('properties');
  // ...tabs array unchanged...
  return (
    <div className="flex h-full flex-col">
      {/* tab bar unchanged */}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'properties' && <PropertiesTab template={template} selectedIds={selectedIds} />}
        {tab === 'layers' && <LayersTab template={template} selectedIds={selectedIds} onSelect={onSelect} />}
        {tab === 'data' && <DataTab template={template} />}
      </div>
    </div>
  );
}
```

Remove the now-unused `findElement` import and the `selected` line and the `DesignElement` import from `InspectorTabs.tsx`.

- [ ] **Step 4: Update `PageCanvas.tsx`** — multi-select props, click/Shift-click, outline all selected, 8 handles when single. Replace the whole file:

```tsx
import type { MouseEvent, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DesignElement, ReportTemplate } from './types';
import { paperSize } from './model';
import { HANDLES, type Handle } from './geometry';

interface Props {
  template: ReportTemplate;
  zoom: number;
  selectedIds: string[];
  onSelect(ids: string[]): void;
}

export function PageCanvas({ template, zoom, selectedIds, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const size = paperSize(template.paper, template.orientation);
  const toggle = (id: string, additive: boolean) =>
    onSelect(additive ? (selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]) : [id]);
  return (
    <div data-testid="page-canvas" onClick={() => onSelect([])}
      className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-neutral-200 p-6 dark:bg-neutral-800">
      {template.pages.map((page, i) => (
        <div key={page.id} className="flex flex-col items-center gap-1.5">
          <div className="relative bg-white shadow-md ring-1 ring-border" style={{ width: size.w * zoom, height: size.h * zoom }}>
            {page.elements.map((el) => (
              <ElementBox key={el.id} el={el} zoom={zoom}
                selected={selectedIds.includes(el.id)}
                showHandles={selectedIds.length === 1 && selectedIds[0] === el.id}
                onSelect={(e) => { e.stopPropagation(); toggle(el.id, e.shiftKey); }} />
            ))}
          </div>
          <span className="text-[11px] text-neutral-600 dark:text-neutral-300">
            {t('reportDesigner.pageOf', { n: i + 1, total: template.pages.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

const HANDLE_CLASS: Record<Handle, string> = {
  nw: '-left-1 -top-1', n: 'left-1/2 -top-1 -translate-x-1/2', ne: '-right-1 -top-1',
  e: '-right-1 top-1/2 -translate-y-1/2', se: '-right-1 -bottom-1', s: 'left-1/2 -bottom-1 -translate-x-1/2',
  sw: '-left-1 -bottom-1', w: '-left-1 top-1/2 -translate-y-1/2',
};

function ElementBox({ el, zoom, selected, showHandles, onSelect }: {
  el: DesignElement; zoom: number; selected: boolean; showHandles: boolean; onSelect(e: MouseEvent): void;
}): JSX.Element {
  const style: CSSProperties = { left: el.rect.x * zoom, top: el.rect.y * zoom, width: el.rect.w * zoom, height: el.rect.h * zoom };
  return (
    <div role="button" tabIndex={0} aria-label={el.name} onClick={onSelect} data-testid={`el-${el.id}`}
      className={cn('absolute cursor-pointer', selected && 'outline outline-2 outline-offset-2 outline-primary')}
      style={style}>
      <ElementContent el={el} />
      {showHandles && HANDLES.map((h) => (
        <span key={h} data-testid={`handle-${h}`} className={cn('absolute h-2 w-2 border border-primary bg-white', HANDLE_CLASS[h])} />
      ))}
    </div>
  );
}

// ...ElementContent unchanged from the current file...
```

Keep the existing `ElementContent` function verbatim.

- [ ] **Step 5: Update `ReportDesignerPage.tsx`** — rename state to `selectedIds`:

Change the state line:
```tsx
const [selectedIds, setSelectedIds] = useState<string[]>([]);
```
Change `insert` selection: `setSelectedIds([el.id]);`
Change `newTemplate` and `onSelect` (template) selection: `setSelectedIds([]);`
Change the explorer `onSelect`: `onSelect={(id) => { setSelectedId(id); setSelectedIds([]); }}`
Change the `PageCanvas` usage:
```tsx
<PageCanvas template={template} zoom={zoom} selectedIds={selectedIds} onSelect={setSelectedIds} />
```
Change the `InspectorTabs` usage:
```tsx
<InspectorTabs template={template} selectedIds={selectedIds} onSelect={setSelectedIds} />
```

- [ ] **Step 6: Add i18n key `selectedCount`** to en/fr/pt (plural interpolation is fine as a plain string here):
- `en.ts` (in `reportDesigner`): `selectedCount: '{{count}} elements selected',`
- `fr.ts`: `selectedCount: '{{count}} éléments sélectionnés',`
- `pt.ts`: `selectedCount: '{{count}} elementos selecionados',`

Place it right after `noElements` in each file.

- [ ] **Step 7: Update tests**

`InspectorTabs.test.tsx` — change the three render calls from `selectedElementId={...} onSelectElement={...}` to `selectedIds={[...]} onSelect={...}`:
- `<InspectorTabs template={tpl} selectedIds={[]} onSelect={vi.fn()} />` (page-settings test)
- `<InspectorTabs template={tpl} selectedIds={['amr-table']} onSelect={vi.fn()} />` (element-props test)
- The Layers-select test: `onSelect` receives `['amr-table']`:
  ```tsx
  const onSelect = vi.fn();
  render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
  fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }));
  expect(onSelect).toHaveBeenCalledWith(['amr-table']);
  ```
- Data test: `selectedIds={[]}`.

`PageCanvas.test.tsx` — update to the new props and handle testids:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';

describe('PageCanvas', () => {
  it('renders every element and the table columns', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resistance table' })).toBeInTheDocument();
    expect(screen.getByText('Organism')).toBeInTheDocument();
  });

  it('selects an element on click and clears on backdrop click', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resistance table' }));
    expect(onSelect).toHaveBeenCalledWith(['amr-table']);
    fireEvent.click(screen.getByTestId('page-canvas'));
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it('shift-click extends the selection', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-title']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resistance table' }), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
  });

  it('draws eight handles on a single selected element', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-table']} onSelect={vi.fn()} />);
    const el = screen.getByTestId('el-amr-table');
    ['nw','n','ne','e','se','s','sw','w'].forEach((h) => expect(el.querySelector(`[data-testid="handle-${h}"]`)).toBeTruthy());
  });
});
```

`ReportDesignerPage.test.tsx` — the insert/undo tests query the Layers list, which is unchanged, but the insert now sets `selectedIds`. No assertion changes needed except the tests already pass through `setSelectedIds`. Re-run to confirm.

- [ ] **Step 8: Run the suite + typecheck — expect PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer src/i18n/parity.test.ts`
Run: `pnpm --filter @openldr/studio typecheck`

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/report-designer/ apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): multi-select selection model and 8-handle chrome"
```

---

## Task 5: `useCanvasInteraction` hook

The pointer state machine. It is exercised through `PageCanvas` tests in Task 6, so this task adds the hook and a typecheck-only gate (no standalone test file — jsdom interaction is tested at the component level in Task 6).

**Files:** Create `apps/studio/src/report-designer/useCanvasInteraction.ts`

- [ ] **Step 1: Write `useCanvasInteraction.ts`**

```tsx
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { DesignElement, DesignPage, Rect } from './types';
import { type Handle, type Box, clampRectToPage, clampGroupDelta, resizeRect, boundingBox, boxFromPoints, marqueeHits } from './geometry';
import { type GuideLine, computeMoveGuides, computeResizeGuides, applyResizeSnap } from './alignmentGuides';

const DRAG_THRESHOLD = 4;   // px before a press becomes a drag
const SNAP_SCREEN = 6;      // guide snap threshold in screen px

interface Args {
  page: DesignPage;
  zoom: number;
  pageSize: { w: number; h: number };
  selectedIds: string[];
  originRef: RefObject<HTMLElement>;
  onSelect(ids: string[]): void;
  onCommitRects(rects: Map<string, Rect>): void;
}

type Drag =
  | { mode: 'move'; sx: number; sy: number; base: Map<string, Rect> }
  | { mode: 'resize'; sx: number; sy: number; id: string; handle: Handle; base: Rect }
  | { mode: 'marquee'; sx: number; sy: number; additive: boolean };

export interface CanvasInteraction {
  preview: Map<string, Rect> | null;
  guides: GuideLine[];
  marquee: Box | null;
  onElementPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, id: string, handle: Handle): void;
  onSurfacePointerDown(e: ReactPointerEvent): void;
}

export function useCanvasInteraction(args: Args): CanvasInteraction {
  const latest = useRef(args);
  latest.current = args;

  const dragRef = useRef<Drag | null>(null);
  const movedRef = useRef(false);
  const [preview, setPreview] = useState<Map<string, Rect> | null>(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);

  const toModel = (clientX: number, clientY: number, zoom: number) => {
    const r = latest.current.originRef.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0)) / zoom, y: (clientY - (r?.top ?? 0)) / zoom };
  };

  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    dragRef.current = null;
    setPreview(null); setGuides([]); setMarquee(null);
  };

  function onMove(e: PointerEvent) {
    const d = dragRef.current; if (!d) return;
    const { page, zoom, pageSize, selectedIds } = latest.current;
    const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
    if (Math.abs(e.clientX - d.sx) > DRAG_THRESHOLD || Math.abs(e.clientY - d.sy) > DRAG_THRESHOLD) movedRef.current = true;
    const thr = SNAP_SCREEN / zoom;

    if (d.mode === 'move') {
      const ids = new Set(d.base.keys());
      const others = page.elements.filter((el) => !ids.has(el.id));
      const baseRects = [...d.base.values()];
      const clamped = clampGroupDelta(baseRects, dx, dy, pageSize);
      const bbox = boundingBox(baseRects.map((r) => ({ ...r, x: r.x + clamped.dx, y: r.y + clamped.dy })))!;
      const snap = computeMoveGuides(bbox, others, pageSize, thr);
      const fdx = clamped.dx + snap.dx, fdy = clamped.dy + snap.dy;
      const next = new Map<string, Rect>();
      for (const [id, r] of d.base) next.set(id, clampRectToPage({ ...r, x: r.x + fdx, y: r.y + fdy }, pageSize));
      setPreview(next); setGuides(snap.lines);
    } else if (d.mode === 'resize') {
      const others = page.elements.filter((el) => el.id !== d.id);
      let rect = resizeRect(d.base, d.handle, dx, dy);
      const snap = computeResizeGuides(rect, d.handle, others, pageSize, thr);
      rect = clampRectToPage(applyResizeSnap(rect, d.handle, snap), pageSize);
      setPreview(new Map([[d.id, rect]])); setGuides(snap.lines);
    } else {
      const a = toModel(d.sx, d.sy, zoom), b = toModel(e.clientX, e.clientY, zoom);
      setMarquee(boxFromPoints(a.x, a.y, b.x, b.y));
    }
    void selectedIds;
  }

  function onUp(e: PointerEvent) {
    const d = dragRef.current; if (!d) { end(); return; }
    const { page, zoom, selectedIds, onSelect, onCommitRects } = latest.current;
    if (d.mode === 'move' || d.mode === 'resize') {
      if (movedRef.current && preview) onCommitRects(preview);
    } else {
      if (movedRef.current) {
        const a = toModel(d.sx, d.sy, zoom), b = toModel(e.clientX, e.clientY, zoom);
        const hits = marqueeHits(boxFromPoints(a.x, a.y, b.x, b.y), page.elements);
        onSelect(d.additive ? [...new Set([...selectedIds, ...hits])] : hits);
      } else if (!d.additive) {
        onSelect([]);
      }
    }
    end();
  }

  const begin = (drag: Drag) => {
    dragRef.current = drag; movedRef.current = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onElementPointerDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    const { selectedIds, page, onSelect } = latest.current;
    if (e.shiftKey) {
      onSelect(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
      return; // shift-click toggles; no drag
    }
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) onSelect([id]);
    const base = new Map<string, Rect>();
    for (const el of page.elements) if (ids.includes(el.id)) base.set(el.id, el.rect);
    begin({ mode: 'move', sx: e.clientX, sy: e.clientY, base });
  };

  const onHandlePointerDown = (e: ReactPointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    const el = latest.current.page.elements.find((x) => x.id === id);
    if (!el) return;
    begin({ mode: 'resize', sx: e.clientX, sy: e.clientY, id, handle, base: el.rect });
  };

  const onSurfacePointerDown = (e: ReactPointerEvent) => {
    begin({ mode: 'marquee', sx: e.clientX, sy: e.clientY, additive: e.shiftKey });
  };

  return { preview, guides, marquee, onElementPointerDown, onHandlePointerDown, onSurfacePointerDown };
}
```

- [ ] **Step 2: Typecheck — expect clean**

Run: `pnpm --filter @openldr/studio typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/report-designer/useCanvasInteraction.ts
git commit -m "feat(report-designer): canvas pointer interaction hook (move/resize/marquee/guides)"
```

---

## Task 6: Wire interaction into PageCanvas

Give each page an interaction surface driven by the hook: pointer-down on elements/handles/surface, live preview rects, guide lines, marquee overlay. Selection stays owned by the page.

**Files:** Modify `PageCanvas.tsx`, `PageCanvas.test.tsx`

- [ ] **Step 1: Add failing interaction tests** — append to `PageCanvas.test.tsx`:

```tsx
import { within } from '@testing-library/react';

function pd(el: Element, x: number, y: number, extra: object = {}) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, ...extra });
}

describe('PageCanvas interaction', () => {
  it('commits a drag as a rect change', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const el = screen.getByTestId('el-amr-table');
    pd(el, 100, 100);
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 130 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0] as Map<string, { x: number; y: number }>;
    expect(rects.get('amr-table')).toBeTruthy();
  });

  it('a plain click (no move) does not commit', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const el = screen.getByTestId('el-amr-table');
    pd(el, 100, 100);
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resizes from a handle', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const handle = within(screen.getByTestId('el-amr-table')).getByTestId('handle-se');
    pd(handle, 0, 0);
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

Update the existing `PageCanvas.test.tsx` render calls (from Task 4) to also pass `onCommitRects={vi.fn()}`.

- [ ] **Step 2: Run — expect FAIL** (`onCommitRects` not a prop; pointer handlers absent)

- [ ] **Step 3: Rewrite `PageCanvas.tsx`** to use the hook per page:

```tsx
import { useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DesignElement, DesignPage, Rect, ReportTemplate } from './types';
import { paperSize } from './model';
import { HANDLES, type Handle } from './geometry';
import { useCanvasInteraction } from './useCanvasInteraction';

interface Props {
  template: ReportTemplate;
  zoom: number;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onCommitRects(rects: Map<string, Rect>): void;
}

export function PageCanvas({ template, zoom, selectedIds, onSelect, onCommitRects }: Props): JSX.Element {
  const { t } = useTranslation();
  const size = paperSize(template.paper, template.orientation);
  return (
    <div data-testid="page-canvas"
      className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-neutral-200 p-6 dark:bg-neutral-800">
      {template.pages.map((page, i) => (
        <div key={page.id} className="flex flex-col items-center gap-1.5">
          <PageSurface page={page} zoom={zoom} pageSize={size}
            selectedIds={selectedIds} onSelect={onSelect} onCommitRects={onCommitRects} />
          <span className="text-[11px] text-neutral-600 dark:text-neutral-300">
            {t('reportDesigner.pageOf', { n: i + 1, total: template.pages.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

function PageSurface({ page, zoom, pageSize, selectedIds, onSelect, onCommitRects }: {
  page: DesignPage; zoom: number; pageSize: { w: number; h: number };
  selectedIds: string[]; onSelect(ids: string[]): void; onCommitRects(rects: Map<string, Rect>): void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const ix = useCanvasInteraction({ page, zoom, pageSize, selectedIds, originRef: ref, onSelect, onCommitRects });
  return (
    <div ref={ref} data-testid={`page-surface-${page.id}`} onPointerDown={ix.onSurfacePointerDown}
      className="relative bg-white shadow-md ring-1 ring-border" style={{ width: pageSize.w * zoom, height: pageSize.h * zoom }}>
      {page.elements.map((el) => {
        const rect = ix.preview?.get(el.id) ?? el.rect;
        return (
          <ElementBox key={el.id} el={el} rect={rect} zoom={zoom}
            selected={selectedIds.includes(el.id)}
            showHandles={selectedIds.length === 1 && selectedIds[0] === el.id}
            onPointerDown={(e) => ix.onElementPointerDown(e, el.id)}
            onHandlePointerDown={(e, h) => ix.onHandlePointerDown(e, el.id, h)} />
        );
      })}
      {ix.guides.map((g, idx) => (
        <span key={idx} aria-hidden style={g.axis === 'x'
          ? { position: 'absolute', left: g.pos * zoom, top: g.from * zoom, height: (g.to - g.from) * zoom, width: 1, background: '#e0369a' }
          : { position: 'absolute', top: g.pos * zoom, left: g.from * zoom, width: (g.to - g.from) * zoom, height: 1, background: '#e0369a' }} />
      ))}
      {ix.marquee && (
        <span aria-hidden className="absolute border border-dashed border-primary bg-primary/10"
          style={{ left: ix.marquee.x * zoom, top: ix.marquee.y * zoom, width: ix.marquee.w * zoom, height: ix.marquee.h * zoom }} />
      )}
    </div>
  );
}

const HANDLE_CLASS: Record<Handle, string> = {
  nw: '-left-1 -top-1 cursor-nwse-resize', n: 'left-1/2 -top-1 -translate-x-1/2 cursor-ns-resize',
  ne: '-right-1 -top-1 cursor-nesw-resize', e: '-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize',
  se: '-right-1 -bottom-1 cursor-nwse-resize', s: 'left-1/2 -bottom-1 -translate-x-1/2 cursor-ns-resize',
  sw: '-left-1 -bottom-1 cursor-nesw-resize', w: '-left-1 top-1/2 -translate-y-1/2 cursor-ew-resize',
};

function ElementBox({ el, rect, zoom, selected, showHandles, onPointerDown, onHandlePointerDown }: {
  el: DesignElement; rect: Rect; zoom: number; selected: boolean; showHandles: boolean;
  onPointerDown(e: React.PointerEvent): void; onHandlePointerDown(e: React.PointerEvent, h: Handle): void;
}): JSX.Element {
  const style: CSSProperties = { left: rect.x * zoom, top: rect.y * zoom, width: rect.w * zoom, height: rect.h * zoom };
  return (
    <div role="button" tabIndex={0} aria-label={el.name} data-testid={`el-${el.id}`} onPointerDown={onPointerDown}
      className={cn('absolute cursor-move touch-none', selected && 'outline outline-2 outline-offset-2 outline-primary')}
      style={style}>
      <ElementContent el={el} />
      {showHandles && HANDLES.map((h) => (
        <span key={h} data-testid={`handle-${h}`} onPointerDown={(e) => onHandlePointerDown(e, h)}
          className={cn('absolute h-2 w-2 border border-primary bg-white touch-none', HANDLE_CLASS[h])} />
      ))}
    </div>
  );
}

// ...ElementContent unchanged...
```

Keep `ElementContent` verbatim. Note selection now happens on pointer-down inside the hook (not `onClick`), so backdrop-clear and shift-extend are exercised through pointer events; the Task 4 `PageCanvas.test.tsx` click assertions must be updated to pointer events:

Replace the Task-4 "selects an element" / "clears on backdrop" / "shift-click" tests with pointer-based equivalents:
```tsx
it('selects an element on pointer-down and clears on empty surface', () => {
  const onSelect = vi.fn();
  render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={[]} onSelect={onSelect} onCommitRects={vi.fn()} />);
  pd(screen.getByTestId('el-amr-table'), 10, 10);
  fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
  expect(onSelect).toHaveBeenCalledWith(['amr-table']);
  pd(screen.getByTestId('page-surface-rt-amr-summary-p1'), 5, 5);
  fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
  expect(onSelect).toHaveBeenLastCalledWith([]);
});

it('shift pointer-down extends the selection', () => {
  const onSelect = vi.fn();
  render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']} onSelect={onSelect} onCommitRects={vi.fn()} />);
  pd(screen.getByTestId('el-amr-table'), 10, 10, { shiftKey: true });
  expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/PageCanvas.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/PageCanvas.tsx apps/studio/src/report-designer/PageCanvas.test.tsx
git commit -m "feat(report-designer): drag/resize/marquee interaction + guide rendering on the canvas"
```

---

## Task 7: ReportDesignerPage — commit, delete, keyboard, undo reconcile

**Files:** Modify `ReportDesignerPage.tsx`, `ReportDesignerPage.test.tsx`

- [ ] **Step 1: Add failing test** — append to `ReportDesignerPage.test.tsx`:

```tsx
it('deletes the selected element with the Delete key', async () => {
  renderPage();
  // insert a Text element (kebab → Insert → Text), which becomes selected
  const kebab = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
  const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
  insertSub.focus();
  fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
  fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
  expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'Delete' });
  expect(within(screen.getByTestId('inspector')).queryByRole('button', { name: /^Text$/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect FAIL** (Delete does nothing yet)

- [ ] **Step 3: Update `ReportDesignerPage.tsx`**

Add imports: `import { addElement, allElements, newElement, removeElements, updateElementRects } from './model';` and `import type { Rect } from './types';` (extend the existing type import).

Add handlers after `applyHistory`/`undo`/`redo`:

```tsx
  const commitRects = (rects: Map<string, Rect>) => { if (template) pushTemplate(updateElementRects(template, rects)); };
  const deleteSelected = () => {
    if (!template || selectedIds.length === 0) return;
    pushTemplate(removeElements(template, new Set(selectedIds)));
    setSelectedIds([]);
  };
  const nudge = (dx: number, dy: number) => {
    if (!template || selectedIds.length === 0) return;
    const size = paperSize(template.paper, template.orientation);
    const rects = new Map<string, Rect>();
    for (const el of allElements(template)) if (selectedIds.includes(el.id)) rects.set(el.id, clampRectToPage({ ...el.rect, x: el.rect.x + dx, y: el.rect.y + dy }, size));
    updateTemplate(updateElementRects(template, rects)); // coalesced
  };
```

Add imports for `paperSize` and `clampRectToPage`: extend `./model` import with `paperSize`, and add `import { clampRectToPage } from './geometry';`.

Extend the keyboard effect to also handle arrows/Delete/Esc/Ctrl-A (replace the existing effect body):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); if (template) setSelectedIds(allElements(template).map((x) => x.id)); return; }
      if (e.key === 'Escape') { setSelectedIds([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, selectedIds]);
```

Add a selection-reconcile effect (drop ids that no longer exist after undo/redo/delete), right after the history reset effect:

```tsx
  useEffect(() => {
    if (!template) return;
    const present = new Set(allElements(template).map((e) => e.id));
    setSelectedIds((ids) => { const kept = ids.filter((id) => present.has(id)); return kept.length === ids.length ? ids : kept; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);
```

Pass `onCommitRects` to `PageCanvas`:

```tsx
<PageCanvas template={template} zoom={zoom} selectedIds={selectedIds} onSelect={setSelectedIds} onCommitRects={commitRects} />
```

- [ ] **Step 4: Run the suite + typecheck — expect PASS**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer`
Run: `pnpm --filter @openldr/studio typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx
git commit -m "feat(report-designer): commit drags, delete, keyboard nudge/select-all, undo reconcile"
```

---

## Task 8: Full-suite gate + manual smoke

- [ ] **Step 1: Whole studio suite**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS (ignore the pre-existing `api.test.ts > "includes server error messages…"` flake).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`

- [ ] **Step 3: Manual smoke (dev)** — start studio, open `/report-designer`, and confirm:
- Click an element → 8 handles; drag body to move (guides appear against other elements + page center); release commits (one undo step).
- Drag a corner and an edge handle to resize; guides snap edges.
- Shift-click a second element; drag moves both; guides use the group bbox.
- Marquee-drag on empty page selects intersecting elements; Shift-marquee adds.
- Arrow keys nudge (Shift = 10px); Delete removes; Esc clears; Ctrl/Cmd+A selects all.
- Undo/redo reverses each gesture; selection reconciles (no stale handles on a removed element).

---

## Self-Review

**Spec coverage:** §2 selection model → Task 4 (+ reconcile in 7). §3 move (single/group/clamp/threshold/commit) → hook (5) + PageCanvas (6) + commit (7). §4 resize 8-handles single → 4/5/6. §5 alignment guides → Task 2 + hook + render. §6 keyboard → Task 7. §7 undo integration + reconcile → Task 7. §8 out-of-scope respected (no group resize — handles only when `selectedIds.length === 1`; Properties stays read-only; multi shows count). §10 tests → geometry/guides units + PageCanvas/ReportDesignerPage interaction. ✓

**Placeholder scan:** none — every step has complete code or an exact command. `void selectedIds;` in the hook is deliberate (keeps the destructure lint-clean); no TODOs.

**Type consistency:** `Handle`/`Box`/`Rect`/`GuideLine` names and signatures match across `geometry.ts`, `alignmentGuides.ts`, `useCanvasInteraction.ts`, and `PageCanvas.tsx`. Prop renames (`selectedIds`, `onSelect(ids)`, `onCommitRects`) are applied consistently to `PageCanvas`, `InspectorTabs`, `PropertiesTab`, `LayersTab`, and `ReportDesignerPage`. `updateElementRects`/`removeElements`/`allElements` signatures match their callers.
