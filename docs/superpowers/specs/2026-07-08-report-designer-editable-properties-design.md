# Report Designer — Editable Properties Design Spec

**Date:** 2026-07-08
**Status:** Design approved; implementation not started
**Builds on:** the interactive-canvas slice (`docs/superpowers/specs/2026-07-08-report-designer-interactive-canvas-design.md`, merged `ee80e958`) and the looks-first shell.
**Scope of this document:** Turn the read-only Properties tab into a real editor and add element **styling** — extending the model and the canvas renderer so text/line/rect/image elements can be styled and the page can carry margins. Still no backend; templates remain in-memory.

---

## 1. Purpose

Today `PropertiesTab` shows read-only `Field` values (X/Y/W/H, table bound-report/columns, page paper/orientation). This slice makes those editable and adds style: a text element can set font size, weight, alignment, and color; line/rect can set stroke and fill; image can set a source; the page can set margins. Editing goes through the existing undo/redo history — typed edits coalesce, discrete toggles are separate steps.

Editing is **panel-driven** (the Properties tab), operating on the **single** selected element (or the page when nothing is selected). On-canvas inline text editing and multi-select bulk-edit are out of scope (see §8).

---

## 2. Model extensions (`types.ts`)

```ts
export type TextAlign = 'left' | 'center' | 'right';

export interface ElementStyle {
  fontSize?: number;      // text/datetime, model px
  bold?: boolean;         // text/datetime
  align?: TextAlign;      // text/datetime
  color?: string;         // text/datetime text color; hex string
  strokeColor?: string;   // line + rect border
  strokeWidth?: number;   // line + rect border, model px
  fill?: string;          // rect background; hex or 'none'
}

export interface Margins { top: number; right: number; bottom: number; left: number; }
```

- `DesignElement` gains `style?: ElementStyle` and `src?: string` (image source — URL or `data:` URI).
- `ReportTemplate` gains `margins?: Margins`.

All new fields are optional; existing mock templates and the seed renderer keep working with sensible defaults (see §3). The flat `DesignElement` interface stays flat (no discriminated union), consistent with the rest of the module — `style`/`src` are read with optional chaining.

---

## 3. Renderer (`PageCanvas` `ElementContent` + page)

Defaults live in one place (a `resolveStyle(el)` helper or inline constants) so unset fields render exactly as they do today:

- **text / datetime:** apply `fontSize` (default 11, scaled by `zoom`), `fontWeight` (bold → 600), `textAlign` (default left), `color` (default the current neutral‑800). Content is still `el.text`.
- **line:** height = `strokeWidth` (default 1) × zoom; background = `strokeColor` (default neutral‑400).
- **rect:** border = `strokeWidth`/`strokeColor` (defaults 1 / neutral‑300); background = `fill` (default transparent; `'none'` = transparent).
- **image:** if `src` is set, render `<img src>` (object-fit contain); else the existing dashed placeholder with the image icon.
- **table:** unchanged (bound-report + columns/rows). Table cell styling is out of scope.
- **page margins:** the `PageSurface` draws a **non-printing** dashed inset rectangle at the template's `margins` (default 0 = no guide), `aria-hidden`, `pointer-events-none`, above the page background but below elements. It is purely a visual guide (elements are not clamped to it in this slice).

Colors are applied via inline `style` (they're user data, not tokens); the printable page stays white.

---

## 4. `PropertiesTab` becomes an editor

Rendered when **exactly one** element is selected (element editor) or **nothing** is selected (page settings). For **2+** selected it keeps the existing `selectedCount` summary.

Controls (all shadcn primitives — `Input`, `Select`, `Button`, `Popover`, plus a small `ColorField`, see §6):

**Common (all element kinds)** — a header `Element · <kind>` and a **Position & size** group: `X`, `Y`, `W`, `H` number inputs. On commit each is clamped to the page via `clampRectToPage`.

**Per kind:**
- **text / datetime:** `Content` textarea; a row of `Font size` (number), `Bold` toggle button, `Align` 3-button group (left/center/right); `Color` (`ColorField`).
- **line:** `Stroke color` (`ColorField`) + `Stroke width` (number).
- **rect:** `Stroke color` + `Stroke width` + `Fill` (`ColorField`, with a "none" affordance).
- **image:** `Source` text input (URL / data URI).
- **table:** `Bound report` (`Select` over a mock report list) + a `Columns` editor — reorderable list with rename inputs, per-row remove, and an "Add column" button.

**Page settings (nothing selected):** `Paper` (`Select`: A4 / Letter), `Orientation` (`Select`: portrait / landscape), and `Margins` — four number inputs (top/right/bottom/left).

Number inputs accept typed values and commit on change/blur; empty/invalid input is ignored (keeps last valid value).

---

## 5. Wiring & undo history

`InspectorTabs` → `PropertiesTab` gains two callbacks, threaded from `ReportDesignerPage`:

```ts
onPatchElement(id: string, patch: Partial<DesignElement>, opts?: { discrete?: boolean }): void
onPatchPage(patch: Partial<ReportTemplate>, opts?: { discrete?: boolean }): void
```

`ReportDesignerPage` implements them on the existing history helpers:
- **Coalesced** (typing in Content / dragging a number field): `updateTemplate` (`history.recordEdit()`) — a burst is one undo step.
- **Discrete** (`opts.discrete`: Bold/Align toggles, Add/Remove column, Paper/Orientation change): `pushTemplate` (`history.pushHistory()`).

New pure transform in `model.ts`:
```ts
export function updateElement(tpl: ReportTemplate, id: string, patch: Partial<DesignElement>): ReportTemplate
```
(merges `patch` into the matching element immutably; for a `style` patch, shallow-merges into the existing `style`). Geometry edits reuse `updateElementRects`; style/content/src edits use `updateElement`.

Editing never changes selection; the selection-reconcile effect already drops ids that vanish.

---

## 6. `ColorField` component

A small reusable control (`apps/studio/src/report-designer/ColorField.tsx`): a color **swatch button** + a hex `Input`; clicking the swatch opens a shadcn `Popover` with a **preset palette** (a dozen swatches incl. black/white/grays and a few accents) and the hex input. Emits a normalized hex string (or `'none'` for fill when the "None" preset is chosen). No native `<input type="color">`. Reused by text color, stroke color, and rect fill.

---

## 7. Files

Under `apps/studio/src/report-designer/`:
- `types.ts` — add `ElementStyle`, `TextAlign`, `Margins`; extend `DesignElement`, `ReportTemplate`.
- `model.ts` — add `updateElement`; a `resolveStyle` default helper (or keep defaults in the renderer).
- `PageCanvas.tsx` — `ElementContent` applies style; `PageSurface` draws the margin guide.
- `PropertiesTab.tsx` — the editor (grows; if it gets unwieldy, split per-kind sub-editors into a `properties/` subfolder — decide during implementation).
- `ColorField.tsx` — new.
- `InspectorTabs.tsx` — thread `onPatchElement` / `onPatchPage`.
- `ReportDesignerPage.tsx` — implement the patch handlers on history; pass down.
- i18n en/fr/pt — new `reportDesigner.*` keys (content, fontSize, bold, align, color, stroke, strokeWidth, fill, source, margins, addColumn, none, etc.).
- Tests: `model` (updateElement), `PropertiesTab` (edits emit the right patch + discrete flag; page settings; per-kind controls), `ColorField`, `PageCanvas` (style renders), `ReportDesignerPage` (a property edit is undoable; a toggle is one discrete step).

---

## 8. Explicitly out of scope (fast-follows)

- **Multi-select bulk edit** (apply a style to all selected) — single-selection editing only this slice.
- **On-canvas inline text editing** (double-click to edit) — panel-only.
- **Table cell/header styling**; per-column width/alignment.
- Margins **affecting layout/clamping** (guide is visual only).
- Real font-family choice, opacity, rotation, shadows.
- Real data/persistence/export/preview (tracked in prior specs).

---

## 9. Testing

- **Pure:** `updateElement` merges patch immutably (incl. nested `style` shallow-merge); geometry clamp on X/Y/W/H edits.
- **`PropertiesTab`:** editing X fires `onPatchElement(id, { rect })` (coalesced); toggling Bold fires `onPatchElement(id, { style:{bold:true} }, { discrete:true })`; changing Paper fires `onPatchPage({ paper }, { discrete:true })`; Add column mutates `columns`; multi-select shows the count (no editor); page settings shown when nothing selected.
- **`ColorField`:** typing a hex emits it; picking a preset emits its value; "None" emits `'none'`.
- **`PageCanvas`:** a text element with `style.bold`/`fontSize`/`color` renders those; a rect with `fill` shows it; an image with `src` renders `<img>`; a template with `margins` renders the dashed guide.
- **`ReportDesignerPage`:** a Content edit then undo restores the old text; a Bold toggle is a single discrete undo step. Reuse the existing pointer/keyboard tests unchanged.
- i18n `EnShape` parity holds (en/fr/pt).

---

## 10. Reference

- Richer element model to borrow field names/semantics from: `D:\Projects\Repositories\database_reporter` designer element/inspector.
- Current read-only surface: `apps/studio/src/report-designer/PropertiesTab.tsx`; renderer `PageCanvas.tsx` `ElementContent`; history helpers + patch wiring in `ReportDesignerPage.tsx`.
