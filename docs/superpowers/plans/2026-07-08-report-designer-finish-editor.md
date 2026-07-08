# Report Designer — Finish the Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three editor-completeness features to the interactive canvas — group resize (2+ selected), multi-select bulk style edit, and inline (on-canvas) text editing — on in-memory template state with per-gesture undo.

**Architecture:** A pure `scaleGroup` (geometry) + `updateElements` (model) underpin group resize and bulk edit. `useCanvasInteraction` gains a `group-resize` pointer mode; `PageCanvas` renders a group bounding box + handles when 2+ selected and a `<textarea>` overlay when a text element is being edited. `PropertiesTab`'s multi-select branch becomes a bulk-edit panel (homogeneous selections). `ReportDesignerPage` adds `onPatchElements` and `editingId` state.

**Tech Stack:** React + TS, Tailwind/shadcn, Vitest + @testing-library/react (jsdom; `setupTests.ts` has the PointerEvent polyfill + i18n).

**Reference spec:** `docs/superpowers/specs/2026-07-08-report-designer-finish-editor-design.md`

**Scoping note (refinement of spec §4):** group-resize does **not** show alignment guides this pass (single move/resize keeps guides) — deferred to keep the scale math tractable. Recorded in Task 2 + the deferred list.

---

## File Structure

Under `apps/studio/src/report-designer/`:

| File | Change |
|------|--------|
| `geometry.ts` | Add `scaleGroup`. |
| `model.ts` | Add `updateElements`. |
| `useCanvasInteraction.ts` | Add `group-resize` mode + `onGroupHandlePointerDown`. |
| `PageCanvas.tsx` | Group bbox + handles (2+ selected); inline `<textarea>` overlay + double-click wiring. |
| `PropertiesTab.tsx` | Bulk-edit panel for homogeneous multi-selection. |
| `InspectorTabs.tsx` | Thread `onPatchElements`. |
| `ReportDesignerPage.tsx` | `onPatchElements`, `editingId` state + enter/exit + reconcile. |
| `i18n/{en,fr,pt}.ts` | Add `mixed`. |

**Command:** `pnpm --filter @openldr/studio exec vitest run <path>`; typecheck `pnpm --filter @openldr/studio typecheck`.

---

## Task 1: Pure `scaleGroup` + `updateElements`

**Files:** `geometry.ts`, `geometry.test.ts`, `model.ts`, `model.test.ts`

- [ ] **Step 1: Failing tests** — append to `geometry.test.ts` (inside the describe):

```ts
import { scaleGroup } from './geometry';

describe('scaleGroup', () => {
  const PAGE2 = { w: 800, h: 1000 };
  const base = () => new Map([
    ['a', { x: 100, y: 100, w: 100, h: 100 }],
    ['b', { x: 300, y: 100, w: 100, h: 100 }],
  ]);
  const bbox = { x: 100, y: 100, w: 300, h: 100 };

  it('scales the group proportionally from the opposite anchor (se, +300 width)', () => {
    const out = scaleGroup(base(), bbox, 'se', 300, 0, PAGE2);
    expect(out.get('a')).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    expect(out.get('b')).toEqual({ x: 500, y: 100, w: 200, h: 100 });
  });

  it('floors the scale so the smallest member stays >= min (w handle shrink)', () => {
    const out = scaleGroup(base(), bbox, 'w', 290, 0, PAGE2, 8);
    expect(out.get('a')!.w).toBeCloseTo(8, 5); // 100 * (8/100)
  });

  it('clamps the scale so the group stays on the page (e handle, huge drag)', () => {
    const out = scaleGroup(base(), bbox, 'e', 10000, 0, PAGE2);
    const right = out.get('b')!.x + out.get('b')!.w;
    expect(right).toBeCloseTo(800, 5); // scaled bbox right edge pinned to page width
  });
});
```

Append to `model.test.ts` (inside the describe) + add `updateElements` to its model import:

```ts
  it('updateElements fans a patch across ids, shallow-merging style', () => {
    const tpl = MOCK_TEMPLATES[0];
    const ids = [tpl.pages[0].elements[0].id, tpl.pages[0].elements[1].id];
    const next = updateElements(tpl, ids, { style: { bold: true } });
    expect(next.pages[0].elements[0].style).toEqual({ bold: true });
    expect(next.pages[0].elements[1].style).toEqual({ bold: true });
    expect(tpl.pages[0].elements[0].style).toBeUndefined();
  });
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer/geometry.test.ts src/report-designer/model.test.ts`

- [ ] **Step 3: Add `scaleGroup` to `geometry.ts`**

```ts
export function scaleGroup(base: Map<string, Rect>, bbox: Box, handle: Handle, dx: number, dy: number, page: { w: number; h: number }, min = 8): Map<string, Rect> {
  const rects = [...base.values()];
  let sx = 1, anchorX = bbox.x;
  if (handle.includes('e')) { anchorX = bbox.x; sx = (bbox.w + dx) / bbox.w; }
  else if (handle.includes('w')) { anchorX = bbox.x + bbox.w; sx = (bbox.w - dx) / bbox.w; }
  let sy = 1, anchorY = bbox.y;
  if (handle.includes('s')) { anchorY = bbox.y; sy = (bbox.h + dy) / bbox.h; }
  else if (handle.includes('n')) { anchorY = bbox.y + bbox.h; sy = (bbox.h - dy) / bbox.h; }

  if (handle.includes('e') || handle.includes('w')) {
    const minW = Math.min(...rects.map((r) => r.w));
    sx = Math.max(sx, min / minW);
    sx = Math.min(sx, handle.includes('e') ? (page.w - anchorX) / bbox.w : anchorX / bbox.w);
  }
  if (handle.includes('s') || handle.includes('n')) {
    const minH = Math.min(...rects.map((r) => r.h));
    sy = Math.max(sy, min / minH);
    sy = Math.min(sy, handle.includes('s') ? (page.h - anchorY) / bbox.h : anchorY / bbox.h);
  }

  const out = new Map<string, Rect>();
  for (const [id, r] of base) {
    out.set(id, { x: anchorX + (r.x - anchorX) * sx, y: anchorY + (r.y - anchorY) * sy, w: r.w * sx, h: r.h * sy });
  }
  return out;
}
```

- [ ] **Step 4: Add `updateElements` to `model.ts`**

```ts
export function updateElements(tpl: ReportTemplate, ids: string[], patch: Partial<DesignElement>): ReportTemplate {
  if (ids.length === 0) return tpl;
  const set = new Set(ids);
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => {
        if (!set.has(e.id)) return e;
        const merged: DesignElement = { ...e, ...patch };
        if (patch.style) merged.style = { ...e.style, ...patch.style };
        return merged;
      }),
    })),
  };
}
```

- [ ] **Step 5: Run — PASS**, then **Step 6: Commit**

```bash
git add apps/studio/src/report-designer/geometry.ts apps/studio/src/report-designer/geometry.test.ts apps/studio/src/report-designer/model.ts apps/studio/src/report-designer/model.test.ts
git commit -m "feat(report-designer): scaleGroup geometry + updateElements transform"
```

---

## Task 2: Group resize (hook + canvas)

**Files:** `useCanvasInteraction.ts`, `PageCanvas.tsx`, `PageCanvas.test.tsx`

- [ ] **Step 1: Failing test** — append to `PageCanvas.test.tsx`:

```ts
describe('PageCanvas group resize', () => {
  it('renders group handles only for a 2+ selection and commits scaled rects', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title', 'amr-subtitle']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const handle = screen.getByTestId('group-handle-se');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0] as Map<string, unknown>;
    expect(rects.has('amr-title')).toBe(true);
    expect(rects.has('amr-subtitle')).toBe(true);
  });

  it('does not render group handles for a single selection', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.queryByTestId('group-handle-se')).toBeNull();
    expect(screen.getByTestId('handle-se')).toBeInTheDocument(); // element handles still show
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Extend `useCanvasInteraction.ts`**

Import `scaleGroup`: change the geometry import to include it — `import { type Handle, type Box, clampRectToPage, clampGroupDelta, resizeRect, boundingBox, boxFromPoints, marqueeHits, scaleGroup } from './geometry';`.

Add to the `Drag` union:

```ts
  | { mode: 'group-resize'; sx: number; sy: number; handle: Handle; base: Map<string, Rect>; bbox: Box };
```

Add to the `CanvasInteraction` interface:

```ts
  onGroupHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
```

In `onMove`, add a branch (after the `resize` branch, before the marquee `else`):

```ts
    } else if (d.mode === 'group-resize') {
      // Group resize scales all members; alignment guides are deferred for this mode.
      setPreviewBoth(scaleGroup(d.base, d.bbox, d.handle, dx, dy, pageSize)); setGuides([]);
```

Change the trailing `} else {` (marquee) to `} else if (d.mode === 'marquee') {` and keep its body; the group-resize commit reuses the existing `onUp` move/resize path — update the `onUp` guard to include it:

```ts
    if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'group-resize') {
      if (movedRef.current && previewRef.current) onCommitRects(previewRef.current);
    } else {
```

Add the handler (near `onHandlePointerDown`):

```ts
  const onGroupHandlePointerDown = (e: ReactPointerEvent, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { page, selectedIds } = latest.current;
    const sel = page.elements.filter((el) => selectedIds.includes(el.id));
    if (sel.length < 2) return;
    const b = new Map(sel.map((el) => [el.id, el.rect] as const));
    const box = boundingBox([...b.values()]);
    if (!box) return;
    begin({ mode: 'group-resize', sx: e.clientX, sy: e.clientY, handle, base: b, bbox: box });
  };
```

Add `onGroupHandlePointerDown` to the returned object.

- [ ] **Step 4: Extend `PageCanvas.tsx`** — render group chrome in `PageSurface`.

Import `boundingBox`: change the geometry import to `import { HANDLES, boundingBox, type Handle } from './geometry';`.

In `PageSurface`, after computing `ix`, add:

```tsx
  const selectedOnPage = page.elements.filter((el) => selectedIds.includes(el.id));
  const groupBox = selectedOnPage.length > 1
    ? boundingBox(selectedOnPage.map((el) => ix.preview?.get(el.id) ?? el.rect))
    : null;
```

Just before the guides block, render the group bbox + handles:

```tsx
      {groupBox && (
        <div aria-hidden data-testid="group-box" className="pointer-events-none absolute outline outline-1 outline-dashed outline-primary"
          style={{ left: groupBox.x * zoom, top: groupBox.y * zoom, width: groupBox.w * zoom, height: groupBox.h * zoom }}>
          {HANDLES.map((h) => (
            <span key={h} data-testid={`group-handle-${h}`} onPointerDown={(e) => ix.onGroupHandlePointerDown(e, h)}
              className={cn('pointer-events-auto absolute h-2 w-2 border border-primary bg-white touch-none', HANDLE_CLASS[h])} />
          ))}
        </div>
      )}
```

- [ ] **Step 5: Run — PASS** + typecheck.
- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/report-designer/useCanvasInteraction.ts apps/studio/src/report-designer/PageCanvas.tsx apps/studio/src/report-designer/PageCanvas.test.tsx
git commit -m "feat(report-designer): group resize (bounding box + proportional scale)"
```

---

## Task 3: Multi-select bulk edit

**Files:** `PropertiesTab.tsx`, `PropertiesTab.test.tsx`, `InspectorTabs.tsx`, `ReportDesignerPage.tsx`, `ReportDesignerPage.test.tsx`, i18n `en/fr/pt`

- [ ] **Step 1: Add `mixed` i18n** to each locale's `reportDesigner` namespace (after `none:`): en `mixed: 'Mixed'`, fr `mixed: 'Mixte'`, pt `mixed: 'Misto'`.

- [ ] **Step 2: Failing tests** — append to `PropertiesTab.test.tsx` (`setup` already passes `onPatchElement`/`onPatchPage`; add `onPatchElements`):

Update the `setup` helper's default props to include `onPatchElements: vi.fn()`. Then:

```tsx
  it('shows bulk text controls for an all-text multi-selection and applies bold to all', () => {
    const props = setup({ selectedIds: ['amr-title', 'amr-subtitle'] });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(props.onPatchElements).toHaveBeenCalledWith(['amr-title', 'amr-subtitle'], { style: { bold: true } }, { discrete: true });
  });

  it('shows only the count for a mixed-kind multi-selection', () => {
    setup({ selectedIds: ['amr-title', 'amr-table'] });
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });
```

- [ ] **Step 3: Run — FAIL** (props/branch missing)

- [ ] **Step 4: Update `PropertiesTab.tsx`**

Add `onPatchElements` to `Props`:

```tsx
  onPatchElements(ids: string[], patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
```

Add a `common` helper (top-level, near `NumberField`):

```tsx
function common<T>(vals: T[]): T | undefined { return vals.length > 0 && vals.every((v) => v === vals[0]) ? vals[0] : undefined; }
```

Add a `BulkControls` component (below `KindControls`):

```tsx
function BulkControls({ ids, els, onPatchElements }: {
  ids: string[]; els: import('./types').DesignElement[];
  onPatchElements(ids: string[], patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const style = (patch: Partial<import('./types').ElementStyle>, discrete?: boolean) => onPatchElements(ids, { style: patch }, discrete ? { discrete: true } : undefined);
  const styles = els.map((e) => e.style ?? {});
  const allText = els.every((e) => e.kind === 'text' || e.kind === 'datetime');
  const allShape = els.every((e) => e.kind === 'line' || e.kind === 'rect');
  const allRect = els.every((e) => e.kind === 'rect');
  if (!allText && !allShape) return null;

  if (allText) {
    const align = common(styles.map((s) => s.align ?? 'left'));
    const bold = common(styles.map((s) => !!s.bold));
    const size = common(styles.map((s) => s.fontSize ?? 11));
    const color = common(styles.map((s) => s.color ?? '#000000'));
    const aligns: { v: TextAlign; icon: typeof AlignLeft; label: string }[] = [
      { v: 'left', icon: AlignLeft, label: t('reportDesigner.alignLeft') },
      { v: 'center', icon: AlignCenter, label: t('reportDesigner.alignCenter') },
      { v: 'right', icon: AlignRight, label: t('reportDesigner.alignRight') },
    ];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.fontSize')}</div>
            <Input type="number" aria-label={t('reportDesigner.fontSize')} min={4} value={size ?? ''} placeholder={t('reportDesigner.mixed')}
              onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) style({ fontSize: Math.max(4, n) }); }}
              className="h-8 text-xs" />
          </div>
          <Button type="button" variant={bold ? 'default' : 'outline'} size="icon" className="h-8 w-8 font-bold"
            aria-label={t('reportDesigner.bold')} aria-pressed={!!bold} onClick={() => style({ bold: !bold }, true)}>B</Button>
          <div className="flex h-8 rounded-md border border-border">
            {aligns.map(({ v, icon: Icon, label }) => (
              <button key={v} type="button" aria-label={label} aria-pressed={align === v} onClick={() => style({ align: v }, true)}
                className={cn('flex w-8 items-center justify-center first:rounded-l-md last:rounded-r-md',
                  align === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.color')}</div>
          <ColorField value={color ?? 'none'} onChange={(c, opts) => style({ color: c }, !!opts?.discrete)} aria-label={t('reportDesigner.color')} />
        </div>
      </div>
    );
  }
  // allShape
  const strokeColor = common(styles.map((s) => s.strokeColor ?? '#9ca3af'));
  const strokeWidth = common(styles.map((s) => s.strokeWidth ?? 1));
  const fill = common(styles.map((s) => s.fill ?? 'none'));
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeColor')}</div>
        <ColorField value={strokeColor ?? 'none'} onChange={(c, opts) => style({ strokeColor: c }, !!opts?.discrete)} aria-label={t('reportDesigner.strokeColor')} />
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeWidth')}</div>
        <Input type="number" aria-label={t('reportDesigner.strokeWidth')} min={1} value={strokeWidth ?? ''} placeholder={t('reportDesigner.mixed')}
          onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) style({ strokeWidth: Math.max(1, n) }); }}
          className="h-8 text-xs" />
      </div>
      {allRect && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.fill')}</div>
          <ColorField value={fill ?? 'none'} onChange={(c, opts) => style({ fill: c }, !!opts?.discrete)} allowNone aria-label={t('reportDesigner.fill')} />
        </div>
      )}
    </div>
  );
}
```

Change the multi-select branch in `PropertiesTab` (the `if (selectedIds.length > 1)` block) to render the bulk panel:

```tsx
  if (selectedIds.length > 1) {
    const els = selectedIds.map((id) => findElement(template, id)).filter((e): e is import('./types').DesignElement => !!e);
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.selectedCount', { count: selectedIds.length })}</div>
        <BulkControls ids={selectedIds} els={els} onPatchElements={onPatchElements} />
      </div>
    );
  }
```

Add `onPatchElements` to the `PropertiesTab` destructure.

- [ ] **Step 5: Thread through `InspectorTabs.tsx`** — add to `Props` and pass to `PropertiesTab`:

```tsx
  onPatchElements(ids: string[], patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }): void;
```
```tsx
        {tab === 'properties' && <PropertiesTab template={template} selectedIds={selectedIds} onPatchElement={onPatchElement} onPatchPage={onPatchPage} onPatchElements={onPatchElements} />}
```

- [ ] **Step 6: Implement in `ReportDesignerPage.tsx`** — add `updateElements` to the `./model` import, add the handler after `patchPage`, and pass it to `InspectorTabs`:

```tsx
  const patchElements = (ids: string[], patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }) => {
    if (!template) return;
    const next = updateElements(template, ids, patch);
    if (opts?.discrete) pushTemplate(next); else updateTemplate(next);
  };
```
```tsx
              <InspectorTabs template={template} selectedIds={selectedIds} onSelect={setSelectedIds}
                onPatchElement={patchElement} onPatchPage={patchPage} onPatchElements={patchElements} />
```

- [ ] **Step 7: Add integration test** — append to `ReportDesignerPage.test.tsx`:

```tsx
  it('bulk-bolds a multi-text selection as one undo step', () => {
    renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Subtitle' }), { shiftKey: true });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Bold' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' })); // single-select Title
    // its per-element Bold now reflects active (both were bolded)
    expect(within(inspector()).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  });
```

- [ ] **Step 8: Run + typecheck — PASS**, then **Step 9: Commit**

```bash
git add apps/studio/src/report-designer/PropertiesTab.tsx apps/studio/src/report-designer/PropertiesTab.test.tsx apps/studio/src/report-designer/InspectorTabs.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(report-designer): multi-select bulk style edit"
```

---

## Task 4: Inline text editing

**Files:** `PageCanvas.tsx`, `PageCanvas.test.tsx`, `ReportDesignerPage.tsx`, `ReportDesignerPage.test.tsx`

- [ ] **Step 1: Failing test** — append to `PageCanvas.test.tsx`:

```tsx
describe('PageCanvas inline text editing', () => {
  it('double-click a text element shows a textarea bound to its text; typing patches it; Escape exits', () => {
    const onPatchElement = vi.fn();
    const onEditEnd = vi.fn();
    const { rerender } = render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']}
      onSelect={vi.fn()} onCommitRects={vi.fn()} editingId={null} onEditStart={vi.fn()} onEditChange={onPatchElement} onEditEnd={onEditEnd} />);
    rerender(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']}
      onSelect={vi.fn()} onCommitRects={vi.fn()} editingId="amr-title" onEditStart={vi.fn()} onEditChange={onPatchElement} onEditEnd={onEditEnd} />);
    const ta = screen.getByTestId('edit-amr-title');
    fireEvent.change(ta, { target: { value: 'New' } });
    expect(onPatchElement).toHaveBeenCalledWith('amr-title', 'New');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onEditEnd).toHaveBeenCalled();
  });

  it('does not start a drag when pointer-down lands on the edit textarea', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']}
      onSelect={vi.fn()} onCommitRects={onCommit} editingId="amr-title" onEditStart={vi.fn()} onEditChange={vi.fn()} onEditEnd={vi.fn()} />);
    const ta = screen.getByTestId('edit-amr-title');
    fireEvent.pointerDown(ta, { clientX: 20, clientY: 20, button: 0 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

Also update the existing `PageCanvas` render calls (Task 2 group tests + all others) to pass the new props — or make them optional with safe defaults (preferred): add the four inline props as optional in the `Props` interface and default them, so pre-existing tests don't need editing.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Extend `PageCanvas.tsx`**

Add to `Props` (optional so existing callers/tests keep working):

```tsx
  editingId?: string | null;
  onEditStart?(id: string): void;
  onEditChange?(id: string, text: string): void;
  onEditEnd?(): void;
```

Thread them from `PageCanvas` → `PageSurface` (add the same four to `PageSurface`'s props and pass through; default `editingId` to `null`).

In `PageSurface`, pass to each `ElementBox`:

```tsx
            editing={editingId === el.id}
            onDoubleClick={() => onEditStart?.(el.id)}
            onEditChange={(text) => onEditChange?.(el.id, text)}
            onEditEnd={() => onEditEnd?.()}
```

Extend `ElementBox` to accept `editing`, `onDoubleClick`, `onEditChange`, `onEditEnd`; when `editing`, suppress the drag pointer-down and render the textarea overlay instead of relying on the static content for text kinds:

```tsx
function ElementBox({ el, rect, zoom, selected, showHandles, editing, onPointerDown, onHandlePointerDown, onDoubleClick, onEditChange, onEditEnd }: {
  el: DesignElement; rect: Rect; zoom: number; selected: boolean; showHandles: boolean; editing: boolean;
  onPointerDown(e: ReactPointerEvent): void; onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
  onDoubleClick(): void; onEditChange(text: string): void; onEditEnd(): void;
}): JSX.Element {
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { editRef.current?.focus(); editRef.current?.select(); } }, [editing]);
  const style: CSSProperties = { left: rect.x * zoom, top: rect.y * zoom, width: rect.w * zoom, height: rect.h * zoom };
  const isText = el.kind === 'text' || el.kind === 'datetime';
  const s = el.style ?? {};
  return (
    <div role="button" tabIndex={0} aria-label={el.name} data-testid={`el-${el.id}`}
      onPointerDown={editing ? undefined : onPointerDown}
      onDoubleClick={isText ? onDoubleClick : undefined}
      className={cn('absolute touch-none', editing ? 'cursor-text' : 'cursor-move', selected && 'outline outline-2 outline-offset-2 outline-primary')}
      style={style}>
      {editing && isText ? (
        <textarea ref={editRef} data-testid={`edit-${el.id}`} value={el.text ?? ''}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onEditEnd(); } }}
          onBlur={onEditEnd}
          className="absolute inset-0 resize-none overflow-hidden border-0 bg-transparent p-0 leading-tight outline-none"
          style={{ fontSize: (s.fontSize ?? 11) * zoom, fontWeight: s.bold ? 600 : 400, textAlign: s.align ?? 'left', color: s.color ?? '#262626' }} />
      ) : (
        <ElementContent el={el} zoom={zoom} />
      )}
      {showHandles && !editing && HANDLES.map((h) => (
        <span key={h} data-testid={`handle-${h}`} onPointerDown={(e) => onHandlePointerDown(e, h)}
          className={cn('absolute h-2 w-2 border border-primary bg-white touch-none', HANDLE_CLASS[h])} />
      ))}
    </div>
  );
}
```

Add `useEffect` to the react import in `PageCanvas.tsx` (currently `useRef`), i.e. `import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';`.

- [ ] **Step 4: Wire `ReportDesignerPage.tsx`**

Add state: `const [editingId, setEditingId] = useState<string | null>(null);`

Add handlers:

```tsx
  const startEdit = (id: string) => { setSelectedIds([id]); setEditingId(id); };
  const editChange = (id: string, text: string) => { if (template) updateTemplate(updateElement(template, id, { text })); };
  const endEdit = () => setEditingId(null);
```

Reconcile `editingId` when it vanishes — extend the existing selection-reconcile effect (or add one): after computing `present`, also `if (editingId && !present.has(editingId)) setEditingId(null);`.

Pass to `PageCanvas`:

```tsx
              <PageCanvas template={template} zoom={zoom} selectedIds={selectedIds} onSelect={setSelectedIds} onCommitRects={commitRects}
                editingId={editingId} onEditStart={startEdit} onEditChange={editChange} onEditEnd={endEdit} />
```

- [ ] **Step 5: Add integration test** — append to `ReportDesignerPage.test.tsx`:

```tsx
  it('double-click a text element on the canvas edits it inline and syncs the model', () => {
    renderPage();
    fireEvent.doubleClick(screen.getByTestId('el-amr-title'));
    const ta = screen.getByTestId('edit-amr-title');
    fireEvent.change(ta, { target: { value: 'Inline edit' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    // Properties Content field reflects the inline edit (element stays selected)
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Properties' }));
    expect(within(screen.getByTestId('inspector')).getByLabelText('Content')).toHaveValue('Inline edit');
  });
```

- [ ] **Step 6: Run + typecheck — PASS**, then **Step 7: Commit**

```bash
git add apps/studio/src/report-designer/PageCanvas.tsx apps/studio/src/report-designer/PageCanvas.test.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx
git commit -m "feat(report-designer): inline (on-canvas) text editing"
```

---

## Task 5: Full-suite gate + manual smoke

- [ ] **Step 1:** `pnpm --filter @openldr/studio test` (PASS except the known `api.test.ts` flake).
- [ ] **Step 2:** `pnpm --filter @openldr/studio typecheck` (clean).
- [ ] **Step 3: Manual smoke** — `/report-designer`: select 2+ elements → group bbox with 8 handles, drag one to scale the group proportionally (undoable); select 2+ text elements → Properties bulk panel (Mixed shown where they differ), toggle Bold/align/size/color and see all update as one undo step; select 2 shapes → stroke/fill bulk; double-click a text element → edit inline, type, Esc/click-away commits and the Properties Content field matches.

---

## Self-Review

**Spec coverage:** §2 inline editing → Task 4 (textarea overlay, coalesced live-commit, Esc/blur exit, drag suppressed, editingId reconcile). §3 bulk edit → Task 3 (homogeneous text/shape panels, Mixed via `common`, `updateElements`/`onPatchElements`, mixed = count, geometry single-only). §4 group resize → Tasks 1+2 (scaleGroup proportional + min/page clamp, group bbox + 8 handles for 2+, single-step commit) — **guides deferred for group-resize, noted**. §5 wiring/files match. §6 deferrals respected (font/stroke scaling, mixed-kind bulk, contentEditable). §7 tests → each task. ✓

**Placeholder scan:** none — complete code or exact commands per step. The Task-4 optional props avoid touching every prior PageCanvas test.

**Type consistency:** `scaleGroup`/`updateElements`/`onPatchElements(ids, patch, opts?)`/`editingId`/`onEditStart|Change|End` names and signatures match across geometry/model/hook/PageCanvas/PropertiesTab/InspectorTabs/ReportDesignerPage. `group-resize` mode reuses the existing `onUp` commit path. Bulk `common<T>` + `PatchOpts` reused. `Box`/`Handle`/`Rect` from geometry are consistent.
