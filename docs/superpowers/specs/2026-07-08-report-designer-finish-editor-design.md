# Report Designer — Finish the Editor Design Spec

**Date:** 2026-07-08
**Status:** Design approved; implementation not started
**Builds on:** the interactive-canvas slice (`ee80e958`) and editable-properties slice (`a51a2421`).
**Scope of this document:** Three editor-completeness features on the interactive canvas — **inline text editing**, **multi-select bulk style edit**, and **group resize** — all on in-memory template state through the existing undo history. Still no backend.

---

## 1. Purpose

The designer already supports move / 8-handle resize (single) / multi-select / marquee / alignment guides / keyboard / undo / full property + style editing. Three direct-manipulation gaps remain, and this slice closes them:

1. **Inline text editing** — edit a text/date element's content in place on the canvas (double-click), not only via the Properties "Content" field.
2. **Multi-select bulk edit** — apply a style to every element in a homogeneous multi-selection at once.
3. **Group resize** — scale a whole multi-selection with a group bounding box.

---

## 2. Inline text editing

- **Trigger:** double-click (pointer `detail === 2`, or `onDoubleClick`) on a `text` or `datetime` element enters edit mode for that element. Other kinds ignore double-click.
- **Edit surface:** a `<textarea>` overlay rendered in place of the element's static `ElementContent`, absolutely positioned to fill the element's box (rect × zoom), with matching font style (`fontSize × zoom`, bold, align, color from `el.style`), transparent background, no border chrome beyond the existing selection outline. Autofocus + select-all on enter.
- **Editing:** `value` is bound to `el.text`; `onChange` live-updates via the **coalesced** patch (`onPatchElement(id, { text }, /* coalesced */)`), so the Properties Content field and the model stay in sync and a typing burst is one undo step.
- **While editing:** that element's pointer drag/select handlers and its resize handles are suppressed (so text selection works and a drag doesn't start). The rest of the canvas is inert to selection changes until edit mode exits.
- **Exit:** `Escape` or blur (click anywhere else) commits (already live-committed) and leaves edit mode. `Enter` inserts a newline (multi-line text), it does **not** exit — Escape/blur is the exit.
- **State:** `editingId: string | null` lives in `ReportDesignerPage` (or `PageSurface`); entering edit mode selects the element (`selectedIds = [id]`). Deleting/undo that removes the element exits edit mode (reconcile).
- **Keyboard guard:** the page's canvas keyboard handler already bails when the target is a `TEXTAREA`, so arrows/Delete won't nudge/delete while editing — verified against the existing guard.

---

## 3. Multi-select bulk edit

When **2+ elements** are selected, `PropertiesTab` shows a bulk panel instead of the plain count, but **only for a homogeneous selection**:

- **All text/datetime:** show Bold, Align, Font size, Color — each applies to **all** selected.
- **All line, or all rect (or a line+rect mix):** show Stroke color, Stroke width, and (rect-only, shown when every selected is a rect) Fill.
- **Mixed kinds** (e.g. text + rect) or any selection that isn't one of the above groups: keep the current **"N elements selected"** count, no bulk controls.

Details:
- **"Mixed" display:** a control whose value differs across the selection shows a `Mixed` placeholder (font size input empty w/ `Mixed` placeholder; a toggle/align shows no active state; a color swatch shows a neutral "mixed" state). Applying a control sets that value on **all** selected regardless.
- **Apply = one undo step:** a new pure transform `updateElements(tpl, ids, patch)` (like `updateElement` but over a set of ids, with the same `style` shallow-merge) + a `ReportDesignerPage` handler `onPatchElements(ids, patch, opts?)` routing to `pushTemplate` (discrete) or `updateTemplate` (coalesced, e.g. bulk font-size typing).
- **Geometry stays single-selection only** (no bulk X/Y/W/H — that's what group resize is for).
- Reuse `KindControls`' inner control widgets where practical; the bulk panel is a thin variant that fans a single patch out to many ids.

---

## 4. Group resize

For a **2+ selection**, in addition to the per-element outlines:

- Render a dashed **group bounding box** (the union rect of the selection) with **8 handles** (same handle set/positions as single-element). Single selection keeps its own element handles (unchanged).
- **Drag a group handle → proportional scale.** Compute a scale factor per axis from the handle drag about the **opposite** edge/corner as the anchor, then map each selected element's rect: `x' = anchorX + (x - anchorX) * sx`, `w' = w * sx` (and y/h with `sy`). Corner handles scale both axes; edge handles scale one.
- **This pass scales rect only** (position + size). `fontSize`/`strokeWidth` are left unchanged (scaling them with the box is a fast-follow).
- **Constraints:** each resulting rect is floored to min 8 (w/h) and clamped to the page. If a scale would drive any member below min, clamp the scale factor so the whole group stays valid (no per-element distortion).
- **Alignment guides** during group resize snap the group bbox's moving edge to page/other-element candidates (reuse `computeResizeGuides` on the bbox), same as single-element resize.
- **Commit:** on pointer up, one `onCommitRects(rects)` (→ `pushTemplate`) with the new rects for all selected — one undo step. No commits mid-drag (live preview only).

---

## 5. Model / geometry / hook changes

Under `apps/studio/src/report-designer/`:

- **`geometry.ts`** — add `scaleGroup(rects: Map<id,Rect>, bbox: Box, handle: Handle, dx: number, dy: number, page, min): Map<id,Rect>` (pure: anchor-based proportional scale + per-element floor/clamp + group-scale clamp). Unit-tested.
- **`model.ts`** — add `updateElements(tpl, ids: string[], patch: Partial<DesignElement>)` (fan-out of `updateElement`, style shallow-merge). Unit-tested.
- **`useCanvasInteraction.ts`** — add a `group-resize` drag mode: when 2+ selected, a pointer-down on a group handle starts it; `onMove` computes `scaleGroup` + guides and sets `preview` for all members; `onUp` commits via `onCommitRects`. Group-bbox + handle geometry is derived from `boundingBox(selected rects)`.
- **`PageCanvas.tsx`** — `PageSurface` renders: the group bbox + 8 group handles when `selectedIds.length > 1`; the inline-edit `<textarea>` overlay when `editingId` matches; wires `onDoubleClick` on text/date elements → enter edit mode; suppresses element pointer-drag while editing.
- **`PropertiesTab.tsx`** — the multi-select branch becomes the bulk panel (homogeneous) or the count (mixed); reuses control widgets fanned through `onPatchElements`.
- **`InspectorTabs.tsx`** — thread `onPatchElements`.
- **`ReportDesignerPage.tsx`** — `onPatchElements` handler; `editingId` state + enter/exit; pass down; reconcile `editingId` on template change (undo/delete).
- i18n en/fr/pt — a couple of new keys (`mixed`, `selectedTextCount`/`selectedShapeCount` or reuse `selectedCount`).

---

## 6. Explicitly out of scope (fast-follows)

- Scaling `fontSize`/`strokeWidth` with the group box.
- Bulk edit across **mixed** kinds (a universal color, etc.).
- `contentEditable` WYSIWYG inline editing (we use a textarea overlay).
- Rotation, group align/distribute buttons, copy/paste.
- Real data / persistence / export / preview (prior specs).

---

## 7. Testing

- **Pure:** `geometry.scaleGroup` — corner scales both axes about the opposite anchor; edge scales one; group-scale clamps so no member goes below min; page clamp. `model.updateElements` — fans a patch (incl. `style` shallow-merge) across ids immutably.
- **Interaction (`PageCanvas`):** double-click a text element shows a textarea bound to its text; typing calls `onPatchElement(id, {text}, /*coalesced*/)`; Escape/blur exits (textarea gone); a text element in edit mode doesn't start a drag on pointer-down. Group handles render only for 2+ selection; dragging a group handle commits scaled rects for all selected.
- **`PropertiesTab`:** an all-text 2-selection shows bulk Bold/Align/Size/Color; toggling Bold calls `onPatchElements([id1,id2], {style:{bold:true}}, {discrete:true})`; an all-rect selection shows stroke/fill; a mixed selection shows the count only; a differing value shows `Mixed`.
- **`ReportDesignerPage`:** a bulk Bold apply is one undo step restoring both; entering inline edit then undo/delete exits edit mode.
- i18n `EnShape` parity.

---

## 8. Reference

- Current interaction hook + canvas: `apps/studio/src/report-designer/useCanvasInteraction.ts`, `PageCanvas.tsx`.
- Editor + control widgets to reuse: `PropertiesTab.tsx` (`KindControls`), `ColorField.tsx`.
- Pure primitives: `geometry.ts` (`boundingBox`, `resizeRect`, `clampRectToPage`), `alignmentGuides.ts` (`computeResizeGuides`).
- History wiring: `ReportDesignerPage.tsx` (`updateTemplate`/`pushTemplate`, `patchElement`).
