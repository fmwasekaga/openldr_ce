# Report Designer — Interactive Canvas Design Spec

**Date:** 2026-07-08
**Status:** Design approved; implementation not started
**Builds on:** the looks-first Report Designer shell (`docs/superpowers/specs/2026-07-08-report-designer-design.md`, merged) and its undo/redo history.
**Scope of this document:** Make the Report Designer canvas **interactive** — drag to move, resize via handles, multi-select, and alignment guides — operating on the in-memory template state. Still no backend/persistence/export; data binding remains mock.

---

## 1. Purpose

Today `PageCanvas` renders elements read-only and only supports click-to-select. This slice turns it into a real absolute-positioning editor: elements can be **moved** (body drag), **resized** (handles), **multi-selected** (click / Shift-click / marquee), and are helped into place by **alignment guides**. Every gesture is a single undo step via the existing `useTemplateHistory` integration.

The proven baseline is `D:\Projects\Repositories\database_reporter\apps\web\src\pages\DesignerPage.tsx` + `components/designer/PageCanvas.tsx` (body-drag move, corner resize, `clampRectTo`, arrow-key nudge, Delete). We port that model and extend it with 8 handles, multi-select, and alignment guides.

---

## 2. Selection model

Replace the single selection with a multi-selection list.

- `ReportDesignerPage` state: `selectedElementId: string | null` → **`selectedElementIds: string[]`**.
- Threaded to `PageCanvas` and `InspectorTabs` (and downstream `LayersTab` / `PropertiesTab`).
- Selection state is **UI-only** and is **not** part of undo/redo history (undoing an edit never restores a past selection; it just reconciles — see §7).
- After any edit, ids that no longer exist are dropped from the selection.

Selection interactions (on the canvas):
- **Click** an element → select just it.
- **Shift-click** an element → toggle it in/out of the selection.
- **Click empty canvas** (no drag) → clear selection.
- **Marquee**: press on empty canvas and drag → a dashed rectangle; on release, select every element whose rect **intersects** the marquee (Shift held → add to the existing selection instead of replacing).

Layers panel parity:
- **Click** a layer → select just it; **Shift-click** → toggle. All selected layers are highlighted.

---

## 3. Move (drag)

- Dragging the **body** of any selected element moves the **entire selection** by the same delta. Dragging an unselected element first selects it (just that one), then moves it.
- A small **activation threshold** (~4px in screen space) distinguishes a click from a drag, so a plain click still selects without nudging.
- Pointer deltas are converted to model space by dividing by `zoom`.
- Each element's rect is **clamped to the page** (`0..pageW-w`, `0..pageH-h`) using the page size from `paperSize()`. For a group move, the whole group is clamped so no member leaves the page (clamp the group delta by the most-constrained member).
- Commit the new rects to the template on **pointer up** as one `pushTemplate` (one undo step). No history entries during the drag.

---

## 4. Resize (8 handles, single selection only)

- Handles render **only when exactly one element is selected** (group resize is deferred — see §9).
- Eight handles: 4 corners (resize both axes) + 4 mid-edges (resize one axis). Rendered as the small accent squares shown in the approved chrome mockup.
- Dragging a handle adjusts the element's rect from the **opposite** edge/corner as the fixed anchor. Model-space deltas (÷ zoom).
- **Minimum size**: `w`/`h` clamp to a small floor (e.g. 8px) so an element can't invert or vanish. Result is also clamped within the page.
- Line elements resize like any rect (uniform behavior, matching database_reporter).
- Commit on pointer up as one `pushTemplate`.

---

## 5. Alignment guides

Active during **move** and **resize**. Pure snap math lives in `alignmentGuides.ts` so it's unit-testable; `PageCanvas` renders the resulting lines.

- **Candidates** (in model space):
  - For every element **not** in the current selection: vertical lines at its `left`, `centerX`, `right`; horizontal lines at its `top`, `centerY`, `bottom`.
  - The **page**: vertical at `0`, `pageW/2`, `pageW`; horizontal at `0`, `pageH/2`, `pageH`.
- **Probes** (the moving geometry):
  - Move: the selection bounding box's left/centerX/right and top/centerY/bottom.
  - Resize: the moving handle's edge(s) (and for corners, both).
- **Snap**: convert the threshold (~6px screen space) to model space (`/zoom`). For each axis, pick the nearest candidate within threshold; if found, offset the drag so the probe lands exactly on it.
- **Render**: for each active snap, draw a thin accent line (screen `1px`) spanning from the candidate's source extent to the snapped probe, as an overlay above the page (not part of the printable content). Guides disappear on pointer up.
- At most one vertical + one horizontal guide shown at a time (the nearest snap per axis).

---

## 6. Keyboard

Active when the canvas has a selection and focus isn't in an input/textarea/select/contenteditable:
- **Arrows**: nudge the selection by 1px (Shift = 10px), clamped to the page. A burst of nudges **coalesces** into one undo step (via `history.recordEdit()` semantics); a pause starts a new step.
- **Delete / Backspace**: remove all selected elements (one `pushTemplate`), then clear selection.
- **Esc**: clear selection.
- **Ctrl/Cmd+A**: select all elements on the (single) page.

These live alongside the existing undo/redo key handler in `ReportDesignerPage`; care is taken not to double-handle (undo/redo already guards modifier keys).

---

## 7. Undo/redo integration

- Move, resize, delete → discrete `pushTemplate` (one step per gesture).
- Keyboard nudge → `recordEdit` (coalesced) so holding an arrow is one step.
- After an undo/redo restores a template snapshot, **reconcile the selection**: drop any `selectedElementIds` that aren't present in the restored template. (We do not try to re-derive an old selection.)
- History remains **scoped per open template** (already reset on `selectedId` change).

---

## 8. Component & file changes

Under `apps/studio/src/report-designer/`:

- **`geometry.ts`** (new, pure): `Point`/`Box` helpers, `clampRectToPage(rect, page)`, `boundingBox(elements)`, `marqueeHits(marquee, elements)`, resize math `resizeRect(rect, handle, dx, dy, min)`. Unit-tested.
- **`alignmentGuides.ts`** (new, pure): `computeGuides(probe, candidates, thresholdModelPx)` → `{ dx, dy, lines: GuideLine[] }`. Unit-tested.
- **`useCanvasInteraction.ts`** (new hook): owns pointer state machine (idle / pressing / moving / resizing / marqueeing), converts pointer events → model deltas (÷ zoom), applies clamping + guide snapping, emits `onSelect(ids)`, `onCommit(nextTemplate)` (pushTemplate) and exposes transient render state (drag preview rects, active guides, marquee rect).
- **`PageCanvas.tsx`** (modify): consume `selectedElementIds` + `useCanvasInteraction`; render per-element outlines, 8 handles (single selection), guide lines, and the marquee overlay; wire pointer handlers on the page surface.
- **`ReportDesignerPage.tsx`** (modify): `selectedElementIds` state; move/resize/delete/nudge handlers built on `pushTemplate`/`recordEdit`; keyboard effect (arrows/Delete/Esc/Ctrl-A); selection reconcile after undo/redo; pass selection + handlers down.
- **`InspectorTabs.tsx` / `LayersTab.tsx` / `PropertiesTab.tsx`** (modify): accept `selectedElementIds`; Layers Shift-click multi-select + highlight all; Properties shows the single element's live (read-only) geometry, or an **"N elements selected"** summary when >1.

Pointer handling uses native pointer events (`setPointerCapture`) — `setupTests.ts` already polyfills pointer-capture for jsdom.

---

## 9. Explicitly out of scope (fast-follows)

- **Group resize** (2+ selected scale together via a group bbox with handles).
- **Editable Property inputs** (typing X/Y/W/H, text content, paper/orientation) — Properties stays read-only display this pass.
- Rotate, copy/paste/duplicate-in-place, z-order drag-reorder in Layers, align/distribute buttons, snap-to-grid toggle.
- Real data binding, persistence, PDF/Excel, Preview modal (tracked in the shell spec §8).

---

## 10. Testing

- **Pure units** (`geometry.test.ts`, `alignmentGuides.test.ts`): clamping, bounding box, marquee hit-testing, resize-from-handle math, and guide snapping (snaps within threshold, no snap outside, picks nearest, page-center + element-edge candidates).
- **Interaction** (`PageCanvas` / `ReportDesignerPage` via Testing Library + `fireEvent.pointerDown/Move/Up`): drag moves an element and commits one history step; Shift-click extends selection; marquee selects intersecting elements; a corner-handle drag resizes; Delete removes the selection; arrow nudges; undo reverses a move. jsdom has no layout, so tests inject positions/deltas directly rather than relying on real bounding rects.
- Keep the existing shell tests green; extend `ReportDesignerPage.test.tsx` for the new selection/undo paths.

---

## 11. Reference

- Port target: `D:\Projects\Repositories\database_reporter\apps\web\src\pages\DesignerPage.tsx` and `components/designer/PageCanvas.tsx` (drag/resize/clamp/keyboard).
- Current shell: `apps/studio/src/report-designer/*` (this slice modifies `PageCanvas`, `ReportDesignerPage`, inspector tabs; adds `geometry.ts`, `alignmentGuides.ts`, `useCanvasInteraction.ts`).
