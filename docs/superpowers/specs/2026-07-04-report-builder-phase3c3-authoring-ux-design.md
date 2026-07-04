# Report Builder — Phase 3c-3: Authoring UX — Design Spec

**Date:** 2026-07-04
**Status:** Approved for planning
**Depends on:** P3c-2 (`9e05223c`) — lint system
**Parent:** P3c polish (A safety ✓, B lint ✓, **C authoring UX** ← this, D i18n)
**Related:** [report-builder-workstream]; closes the carried P3a "true drag-reorder" hardening item

## Problem

The report builder's authoring ergonomics lag the Form Builder: no block duplicate, no UI for the
header/footer-repeat row flag (the model supports it), a blank canvas gives no guidance, there are no
keyboard shortcuts, and blocks can only be reordered via up/down buttons (P3a deferred true drag-reorder on
the absolute-positioned canvas). P3c-3 adds all five.

## What already exists

- `reportBuilderModel.ts`: `moveRow`, `addCellToRow`, `setRepeat` (the last two are exported-but-unused from
  P3a). `setRepeat(t, r, 'header'|'footer'|undefined)` is ready to wire.
- `ReportBuilderPage` has a `DndContext` whose `onDragEnd` already handles `palette:<kind>` (add block) and
  `row:<n>` → `row:<n>` (reorder via `moveRow`) — but canvas cells are not draggable, so the `row:` branch
  never fires today.
- `computeLayout` already honours `row.repeat` (`'header'`/`'footer'` rows repeat on every PDF page).
- `useTemplateHistory` provides undo/redo (`history.undo()/redo()`, `applyHistory`).

## Decisions (locked during brainstorm 2026-07-04)

1. **Reorder + duplicate operate at ROW level** (a drag/duplicate moves the whole row) — consistent with the
   existing up/down controls.
2. **Drag via a per-cell drag HANDLE** (grip icon), not a whole-cell draggable — preserves click-to-select.
3. **Drag uses `useDraggable`/`useDroppable` per cell** (not `SortableContext`, which assumes a DOM list; the
   canvas is an absolute `computeLayout` grid).

## Architecture

### A. Model — `duplicateRow` (pure)

Add to `reportBuilderModel.ts`:
```ts
export function duplicateRow(t: ReportTemplate, r: number): ReportTemplate;
```
Inserts a deep clone of `t.rows[r]` (via `structuredClone`/JSON round-trip) with a fresh `rowId()`
immediately after index `r`. Out-of-range `r` → returns `t` unchanged.

### B. Block duplicate UI + shortcut

- `BlockInspector` gains a **Duplicate** button (beside Delete) calling a new `onDuplicate` prop →
  `ReportBuilderPage` runs `pushUpdate(duplicateRow(template, selected.row))` and selects the new row
  (`row: selected.row + 1`).
- Also bound to `Cmd/Ctrl+D` (see §D).

### C. Header/footer-repeat toggle

`BlockInspector` gains a **Row repeat** segmented control (*Normal / Header / Footer*) reflecting
`template.rows[selected.row].repeat`. Selecting calls a new `onSetRepeat(value)` prop →
`ReportBuilderPage` runs `pushUpdate(setRepeat(template, selected.row, value))` (`value` is `undefined` for
Normal). Row-level (all cells in the row share the flag).

### D. Keyboard shortcuts

A `keydown` listener on the builder (document-level `useEffect` in `ReportBuilderPage`), **ignored when the
event target is an `input`, `textarea`, `select`, or `contenteditable`** (so typing into title/text/SQL
isn't hijacked), and when a dialog/popover is the active element (best-effort via the input-focus guard):
- `Cmd/Ctrl+Z` → `applyHistory(history.undo())`; `Cmd/Ctrl+Shift+Z` → `applyHistory(history.redo())`.
- `Delete` / `Backspace` when a block is selected → delete it (`pushUpdate(removeCell(...))`, clear
  selection).
- `Cmd/Ctrl+D` when a block is selected → duplicate its row.
- `preventDefault()` on handled combos.

### E. Empty state

When `template.rows.length === 0`, `ReportCanvas` renders a centered placeholder instead of a blank page:
"Drag a block from the palette, or click one to add it." The inspector's existing "Select a block…" empty
state is unchanged.

### F. True drag-reorder

- **`CanvasCell` child component:** the per-cell wrapper in `ReportCanvas` (currently an inline `<div>` in
  the `.map`) becomes a `CanvasCell` component so the dnd hooks run once per cell (hooks can't live in a map
  body). It calls `useDroppable({ id: \`cell:${r}:${c}\` })` on the wrapper and renders a **drag handle**
  (grip icon, shown on hover/selection) wired to `useDraggable({ id: \`cell:${r}:${c}\` })`. The cell body
  keeps its `onClick` → select. The lint marker (P3c-2) and selection ring stay.
- **`onDragEnd`** gains a `cell:` branch: from `active.id = cell:${ar}:${ac}` and `over.id = cell:${br}:${bc}`,
  if `ar !== br` run `pushUpdate(moveRow(template, ar, br))`. The `palette:` and legacy `row:` branches stay.
- **`DragOverlay`:** `ReportBuilderPage` renders a `DragOverlay` showing the dragged block (a lightweight
  `CanvasBlock`/label) via an `activeDrag` state set in `onDragStart`.
- Collision detection: dnd-kit default (`rectIntersection`) works for absolute elements — no list strategy.

`ReportCanvas` gains no new required props beyond threading `data`/`issues`/`selected`/`onSelect` into
`CanvasCell`; the dnd hooks work because `ReportCanvas` renders inside `ReportBuilderPage`'s `DndContext`.

## Testing

- **`duplicateRow`** (pure unit): clones the row after `r` with a new id; out-of-range → unchanged; deep
  (mutating the clone doesn't touch the original).
- **`onDragEnd` reorder logic** (unit): feed a synthetic `{ active: { id: 'cell:2:0' }, over: { id: 'cell:0:0' } }`
  → asserts `moveRow(2, 0)` applied; same-row drop → no-op; `palette:` still adds.
- **`BlockInspector`** (RTL): Duplicate button calls `onDuplicate`; the Row-repeat control reflects/writes
  `repeat` via `onSetRepeat`.
- **Keyboard** (RTL): `Ctrl+D` with a selection duplicates; `Delete` removes; `Ctrl+Z` undoes; a keydown
  while focus is in a text input is ignored.
- **Empty state** (RTL): a zero-row template renders the placeholder text.
- **Drag handle presence** (RTL): a `CanvasCell` renders a grip handle with an accessible label. (Full
  pointer-drag is not simulated in jsdom — covered by the `onDragEnd`-logic unit test + manual/e2e.)

## Scope boundaries (YAGNI for P3c-3)

**In:** the five features above (duplicate, repeat toggle, empty state, keyboard shortcuts, drag-reorder).
**Out:** dragging a single cell BETWEEN rows / multi-cell reflow (reorder is whole-row); drag-to-resize
colSpan (width control already exists); i18n of the new strings (P3c-4); P4 coexistence.

## Non-obvious constraints

- **Click vs drag:** the drag handle (not the cell body) is the draggable, and the `PointerSensor` already
  uses `activationConstraint: { distance: 4 }` — together these keep click-to-select working.
- **Unique dnd ids:** each cell's draggable/droppable id is `cell:${rowIndex}:${cellIndex}` (unique even
  across a multi-cell row); `onDragEnd` parses the row index from it.
- **Keyboard guard:** the shortcut handler MUST early-return when `document.activeElement` (or the event
  target) is a form field / contenteditable, or it will eat characters in the SQL editor and text blocks.
- **Purity:** `duplicateRow` is pure (studio model helper, mirrors `moveRow`); no schema change. All
  `@openldr/report-builder/pure` imports stay pure. Studio-only slice — no cross-package change, but run the
  forced typecheck per convention.
- **History:** duplicate/repeat/delete/drag use `pushUpdate` (records undo history); the keyboard undo/redo
  route through the existing `useTemplateHistory`.
