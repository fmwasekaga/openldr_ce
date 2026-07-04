# Report Builder — Phase 3c-3: Authoring UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add block duplicate, a header/footer-repeat toggle, a canvas empty state, keyboard shortcuts, and true drag-reorder to the report builder.

**Architecture:** Two new pure model helpers (`duplicateRow`, `moveRowFromCellDrag`) drive the state changes; the UI adds inspector controls, a document keydown handler, a canvas empty placeholder, and per-cell drag handles (`useDraggable`/`useDroppable`) whose drops flow through the existing `onDragEnd` → `moveRow`. Studio-only; no schema change.

**Tech Stack:** TypeScript, React, `@dnd-kit/core`, Vitest + React Testing Library, `@openldr/report-builder/pure`.

**Spec:** `docs/superpowers/specs/2026-07-04-report-builder-phase3c3-authoring-ux-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `apps/studio/src/reports-builder/reportBuilderModel.ts` | `duplicateRow`, `moveRowFromCellDrag` | Modify |
| `apps/studio/src/reports-builder/reportBuilderModel.test.ts` | pure helper tests | Modify/Create |
| `apps/studio/src/reports-builder/BlockInspector.tsx` | Duplicate button + Row-repeat control | Modify |
| `apps/studio/src/reports-builder/BlockInspector.test.tsx` | inspector controls | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` | wire handlers, keyboard, DragOverlay, cell-drag branch | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` | keyboard tests | Modify |
| `apps/studio/src/reports-builder/ReportCanvas.tsx` | empty state + `CanvasCell` drag handle/droppable | Modify |
| `apps/studio/src/reports-builder/ReportCanvas.test.tsx` | empty state + handle presence | Modify |

---

## Task 1: Pure model helpers — `duplicateRow` + `moveRowFromCellDrag`

**Files:**
- Modify: `apps/studio/src/reports-builder/reportBuilderModel.ts`
- Test: `apps/studio/src/reports-builder/reportBuilderModel.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/reportBuilderModel.test.ts` (create the file with these imports if it doesn't exist — it may already test other helpers; ADD to it):

```ts
import { describe, it, expect } from 'vitest';
import { createEmptyTemplate } from '@openldr/report-builder/pure';
import { addRowWithBlock, newBlock, duplicateRow, moveRowFromCellDrag } from './reportBuilderModel';

function twoRows() {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('title'));
  t = addRowWithBlock(t, newBlock('divider'));
  return t;
}

describe('duplicateRow', () => {
  it('inserts a deep clone with a fresh id right after the row', () => {
    const t = twoRows();
    const out = duplicateRow(t, 0);
    expect(out.rows).toHaveLength(3);
    expect(out.rows[1].cells[0].block.kind).toBe('title'); // clone sits at index 1
    expect(out.rows[1].id).not.toBe(t.rows[0].id);          // fresh id
    expect(out.rows[0].id).toBe(t.rows[0].id);              // original untouched
  });
  it('is a deep clone (mutating the copy does not touch the original)', () => {
    const t = twoRows();
    const out = duplicateRow(t, 0);
    (out.rows[1].cells[0].block as { text: string }).text = 'changed';
    expect((t.rows[0].cells[0].block as { text: string }).text).toBe('');
  });
  it('returns the template unchanged for an out-of-range index', () => {
    const t = twoRows();
    expect(duplicateRow(t, 5)).toBe(t);
  });
});

describe('moveRowFromCellDrag', () => {
  it('reorders rows from cell drag ids', () => {
    const t = twoRows();
    const out = moveRowFromCellDrag(t, 'cell:1:0', 'cell:0:0');
    expect(out).not.toBeNull();
    expect(out!.rows[0].cells[0].block.kind).toBe('divider');
  });
  it('returns null for same-row, non-cell, or missing over', () => {
    const t = twoRows();
    expect(moveRowFromCellDrag(t, 'cell:0:0', 'cell:0:1')).toBeNull();
    expect(moveRowFromCellDrag(t, 'palette:title', 'cell:0:0')).toBeNull();
    expect(moveRowFromCellDrag(t, 'cell:0:0', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/reportBuilderModel.test.ts`
Expected: FAIL — `duplicateRow`/`moveRowFromCellDrag` not exported.

- [ ] **Step 3: Implement the helpers**

In `apps/studio/src/reports-builder/reportBuilderModel.ts`, add (after `moveRow`, and note `rowId`/`moveRow` already exist in this file):

```ts
export function duplicateRow(t: ReportTemplate, r: number): ReportTemplate {
  if (r < 0 || r >= t.rows.length) return t;
  const clone = { ...(JSON.parse(JSON.stringify(t.rows[r])) as ReportTemplate['rows'][number]), id: rowId() };
  const rows = [...t.rows];
  rows.splice(r + 1, 0, clone);
  return { ...t, rows };
}

// Decide a row reorder from a dnd-kit cell drag (ids are `cell:${rowIndex}:${cellIndex}`).
// Returns the reordered template, or null when the drag isn't a cross-row cell move.
export function moveRowFromCellDrag(t: ReportTemplate, activeId: string, overId: string | null): ReportTemplate | null {
  if (!activeId.startsWith('cell:') || !overId || !overId.startsWith('cell:')) return null;
  const from = Number(activeId.split(':')[1]);
  const to = Number(overId.split(':')[1]);
  if (Number.isNaN(from) || Number.isNaN(to) || from === to) return null;
  return moveRow(t, from, to);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/reportBuilderModel.test.ts`
Expected: PASS. Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/reportBuilderModel.ts apps/studio/src/reports-builder/reportBuilderModel.test.ts
git commit -m "feat(studio): duplicateRow + moveRowFromCellDrag model helpers"
```

---

## Task 2: BlockInspector — Duplicate button + Row-repeat control

**Files:**
- Modify: `apps/studio/src/reports-builder/BlockInspector.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Test: `apps/studio/src/reports-builder/BlockInspector.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/BlockInspector.test.tsx` (reuse the file's existing `base` props object; it already renders `BlockInspector` with the required props — add `parameters`/`sqlEnabled` etc. are already there. Add `onDuplicate`, `repeat`, `onSetRepeat` to the base props):

```tsx
it('calls onDuplicate when Duplicate is clicked', () => {
  const onDuplicate = vi.fn();
  render(<BlockInspector {...base} onDuplicate={onDuplicate} />);
  fireEvent.click(screen.getByRole('button', { name: /duplicate block/i }));
  expect(onDuplicate).toHaveBeenCalled();
});

it('reflects and sets the row repeat mode', () => {
  const onSetRepeat = vi.fn();
  render(<BlockInspector {...base} repeat="header" onSetRepeat={onSetRepeat} />);
  // Header is the active variant
  expect(screen.getByRole('button', { name: /^header$/i })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^footer$/i }));
  expect(onSetRepeat).toHaveBeenCalledWith('footer');
  fireEvent.click(screen.getByRole('button', { name: /^normal$/i }));
  expect(onSetRepeat).toHaveBeenCalledWith(undefined);
});
```

Update the shared `base` props object in this test file to include `onDuplicate: () => {}`, `repeat: undefined`, `onSetRepeat: () => {}` (so the other existing tests keep compiling with the new required props).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/BlockInspector.test.tsx`
Expected: FAIL — no Duplicate button / repeat control / props.

- [ ] **Step 3: Add props + controls to `BlockInspector.tsx`**

Add to the props type + destructure: `onDuplicate: () => void; repeat: 'header' | 'footer' | undefined; onSetRepeat: (v: 'header' | 'footer' | undefined) => void;`.

Add a **Row repeat** control after the "Row order" block (before the Delete button):
```tsx
      <div className="flex flex-col gap-1 text-xs">Row repeat
        <div className="flex gap-1">
          {([['Normal', undefined], ['Header', 'header'], ['Footer', 'footer']] as const).map(([label, val]) => (
            <Button key={label} type="button" size="sm" variant={repeat === val ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onSetRepeat(val)}>{label}</Button>
          ))}
        </div>
      </div>
```

Replace the final Delete button with a Duplicate + Delete pair:
```tsx
      <div className="flex flex-col gap-1">
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onDuplicate}>Duplicate block</Button>
        <Button type="button" variant="ghost" className="justify-start text-destructive hover:text-destructive" onClick={onDelete}>Delete block</Button>
      </div>
```

- [ ] **Step 4: Wire handlers in `ReportBuilderPage.tsx`**

Add imports: merge `duplicateRow, setRepeat` into the existing `./reportBuilderModel` import.
On the `<BlockInspector … />` element, add:
```tsx
                  repeat={template.rows[selected.row].repeat}
                  onSetRepeat={(v) => pushUpdate(setRepeat(template, selected.row, v))}
                  onDuplicate={() => { pushUpdate(duplicateRow(template, selected.row)); setSelected({ row: selected.row + 1, cell: selected.cell }); }}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/BlockInspector.test.tsx`
Expected: PASS. Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/BlockInspector.tsx apps/studio/src/reports-builder/BlockInspector.test.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx
git commit -m "feat(studio): block duplicate + header/footer-repeat controls in the inspector"
```

---

## Task 3: Keyboard shortcuts

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`. Render a saved report with two rows (via the mocked `getReportTemplate`), select the first block by clicking its canvas cell, then exercise `Ctrl+D`:

```tsx
it('duplicates the selected block row on Ctrl+D and ignores keys while typing in an input', async () => {
  const t = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r0', cells: [{ colSpan: 12, block: { kind: 'title', text: 'A', style: {} } }] }] };
  vi.mocked(getReportTemplate).mockResolvedValue(t as never);
  renderId();
  // select the block
  fireEvent.click(await screen.findByTestId('canvas-cell-0-0'));
  // typing guard: a keydown targeted at the name input must NOT duplicate
  fireEvent.keyDown(screen.getByLabelText(/report name/i), { key: 'd', ctrlKey: true });
  expect(screen.queryByTestId('canvas-cell-1-0')).toBeNull();
  // Ctrl+D on the document duplicates the row → a second cell appears
  fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
  expect(await screen.findByTestId('canvas-cell-1-0')).toBeTruthy();
});
```

(If the file's render helper differs, use it. `canvas-cell-0-0` is `ReportCanvas`'s existing per-cell testid.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: FAIL — Ctrl+D does nothing (no handler).

- [ ] **Step 3: Add the keydown handler**

In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`, add a `useEffect` (after the other effects). It needs `duplicateRow`/`removeCell` (already imported or importable from `./reportBuilderModel`) and the existing `history`/`applyHistory`/`pushUpdate`/`selected`/`template`:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); applyHistory(e.shiftKey ? history.redo() : history.undo()); return; }
      if (mod && e.key.toLowerCase() === 'd' && selected) { e.preventDefault(); pushUpdate(duplicateRow(template, selected.row)); setSelected({ row: selected.row + 1, cell: selected.cell }); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); pushUpdate(removeCell(template, selected.row, selected.cell)); setSelected(null); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, selected]);
```

(`removeCell` is already imported in the file. Ensure `duplicateRow` is imported from `./reportBuilderModel` — it is after Task 2.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: PASS (new test + existing). Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "feat(studio): report builder keyboard shortcuts (undo/redo, delete, duplicate)"
```

---

## Task 4: Canvas empty state

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx`
- Modify: `apps/studio/src/reports-builder/ReportCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportCanvas.test.tsx`:

```tsx
it('renders an empty-state placeholder when the template has no rows', () => {
  const t = createEmptyTemplate('rt', 'R'); // no rows
  render(<ReportCanvas template={t} selected={null} onSelect={() => {}} />);
  expect(screen.getByText(/drag a block from the palette/i)).toBeInTheDocument();
});
```

(`createEmptyTemplate` is already imported in this test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: FAIL — no placeholder text.

- [ ] **Step 3: Add the empty state to `ReportCanvas.tsx`**

At the start of the `ReportCanvas` return (before the pages `.map`), add an early empty-state branch. Right after the `boxes`/`maxPage` computation and before `return (`, add:
```tsx
  if (template.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Drag a block from the palette, or click one to add it.
      </div>
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: PASS (new + existing). Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/ReportCanvas.test.tsx
git commit -m "feat(studio): report canvas empty-state placeholder"
```

---

## Task 5: True drag-reorder (drag handle + droppable cells + onDragEnd)

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Test: `apps/studio/src/reports-builder/ReportCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportCanvas.test.tsx` (a `template()` helper with a title block already exists in the file — reuse it):

```tsx
it('renders a drag handle on each cell', () => {
  render(<ReportCanvas template={template()} selected={null} onSelect={() => {}} />);
  expect(screen.getAllByRole('button', { name: /drag to reorder/i }).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: FAIL — no drag handle.

NOTE: `ReportCanvas.test.tsx` renders `ReportCanvas` WITHOUT a `DndContext`. dnd-kit's `useDraggable`/`useDroppable` read a context with safe defaults and DO NOT throw outside a provider, so the existing tests keep passing after `CanvasCell` gains the hooks. If your dnd-kit version DOES throw outside a provider, wrap every `render(<ReportCanvas … />)` in this test file with `<DndContext>…</DndContext>` (import `DndContext` from `@dnd-kit/core`) — a one-line wrapper, no behavior change.

- [ ] **Step 3: Extract `CanvasCell` with drag/drop in `ReportCanvas.tsx`**

In `apps/studio/src/reports-builder/ReportCanvas.tsx`:
- Add imports: `import { useDraggable, useDroppable } from '@dnd-kit/core';`
- Add a `CanvasCell` component (above `ReportCanvas`) that wraps one positioned cell. It takes the box, scale, selection, severity, handlers, block, and data, renders the droppable wrapper + a draggable grip handle + the lint marker + `<CanvasBlock>`:
```tsx
function CanvasCell({ b, scale, isSel, sev, onSelect, block, data }: {
  b: PositionedBox; scale: number; isSel: boolean; sev: 'error' | 'warning' | null;
  onSelect: (row: number, cell: number) => void; block: Block; data?: BlockData;
}): JSX.Element {
  const id = `cell:${b.rowIndex}:${b.cellIndex}`;
  const { setNodeRef: dropRef } = useDroppable({ id });
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={dropRef}
      data-testid={`canvas-cell-${b.rowIndex}-${b.cellIndex}`}
      data-selected={isSel ? 'true' : 'false'}
      onClick={(e) => { e.stopPropagation(); onSelect(b.rowIndex, b.cellIndex); }}
      className={`group absolute cursor-pointer overflow-hidden rounded-sm ${isDragging ? 'opacity-40' : ''} ${isSel ? 'ring-2 ring-[#378ADD]' : 'ring-1 ring-transparent hover:ring-border'}`}
      style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, padding: 2 }}
    >
      {sev && <span data-testid={`lint-marker-${b.rowIndex}-${b.cellIndex}`} className={`pointer-events-none absolute right-1 top-1 z-10 h-2 w-2 rounded-full ${sev === 'error' ? 'bg-destructive' : 'bg-amber-500'}`} />}
      <button
        ref={dragRef}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
        className="absolute left-1 top-1 z-10 cursor-grab rounded bg-muted/80 px-1 text-[9px] leading-none text-muted-foreground opacity-0 group-hover:opacity-100"
      >⋮⋮</button>
      <CanvasBlock block={block} data={data} />
    </div>
  );
}
```
Import `Block` and `BlockData` types (`Block` from `@openldr/report-builder/pure`, `BlockData` already imported from `./useBlockData`).
- Replace the inline cell `<div>` inside the page `.map` with `<CanvasCell … />`, passing the props (keep the `cellSeverity` call for `sev`):
```tsx
{boxes.filter((b) => b.page === pageNo).map((b) => (
  <CanvasCell
    key={`${b.rowIndex}-${b.cellIndex}`}
    b={b}
    scale={scale}
    isSel={selected?.row === b.rowIndex && selected?.cell === b.cellIndex}
    sev={cellSeverity(b.rowIndex, b.cellIndex)}
    onSelect={onSelect}
    block={template.rows[b.rowIndex].cells[b.cellIndex].block}
    data={data?.get(`${b.rowIndex}:${b.cellIndex}`)}
  />
))}
```
(Keep the existing `Page N / maxPage` footer div and the outer page wrapper.)

- [ ] **Step 4: Wire the cell-drag branch + DragOverlay in `ReportBuilderPage.tsx`**

- Add imports: `import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';` (extend the existing dnd import with `DragOverlay` + `DragStartEvent`). Merge `moveRowFromCellDrag` into the `./reportBuilderModel` import.
- Add state: `const [activeDrag, setActiveDrag] = useState<string | null>(null);`
- Add `onDragStart`:
```tsx
  const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));
```
- Update `onDragEnd` to clear the overlay and handle cell drags via the pure helper (keep the `palette:` branch; the legacy `row:` branch may be removed):
```tsx
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (active.startsWith('palette:')) { addBlock(active.slice('palette:'.length) as BlockKind); return; }
    const reordered = moveRowFromCellDrag(template, active, over);
    if (reordered) pushUpdate(reordered);
  };
```
- Pass `onDragStart` to `<DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>`.
- Add a `DragOverlay` just before `</DndContext>` (after the main flex column div):
```tsx
        <DragOverlay>
          {activeDrag && activeDrag.startsWith('cell:') ? (
            <div className="rounded border border-border bg-background px-2 py-1 text-xs shadow">Moving row</div>
          ) : null}
        </DragOverlay>
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: PASS (drag-handle test + existing ReportCanvas/marker/empty tests).
Run the whole suite: `pnpm --filter @openldr/studio exec vitest run src/reports-builder` → all green.
`pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportCanvas.test.tsx
git commit -m "feat(studio): true drag-reorder on the report canvas (per-cell handle + moveRow)"
```

---

## Task 6: Full gate — forced typecheck + suites

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages pass (studio-only change, but run per convention).

- [ ] **Step 2: Run the studio reports-builder suite**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder`
Expected: all green. (The pre-existing `apps/studio/src/api.test.ts` vitest-dedupe flake is a different file.)

- [ ] **Step 3: Final commit (only if lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(report-builder): P3c-3 authoring UX gate green"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** `duplicateRow` + `moveRowFromCellDrag` (Task 1) · duplicate + repeat controls (Task 2) · keyboard shortcuts (Task 3) · empty state (Task 4) · drag-reorder handle/droppable/onDragEnd/overlay (Task 5). All five features covered.
- **jsdom limits:** full pointer-drag isn't simulated; the reorder decision is unit-tested via the pure `moveRowFromCellDrag` (Task 1) and handle presence via RTL (Task 5) — matches the spec's testing note.
- **Type consistency:** dnd ids are `cell:${rowIndex}:${cellIndex}` everywhere (`CanvasCell` + `moveRowFromCellDrag`); `onSetRepeat(v: 'header'|'footer'|undefined)` matches `setRepeat`; `onDuplicate: () => void` matches the page handler.
- **Keyboard guard:** the handler early-returns on INPUT/TEXTAREA/SELECT/contenteditable targets so the SQL editor and text blocks aren't hijacked (tested).
- **Click vs drag:** the grip handle (not the cell) is draggable, its `onClick` stops propagation, and `PointerSensor` `distance:4` remains — click-to-select preserved.
- **Out of scope:** cross-row single-cell drag, drag-resize, i18n (P3c-4), P4.
- **Cross-package:** none (studio-only); forced typecheck in Task 6 per convention.
```
