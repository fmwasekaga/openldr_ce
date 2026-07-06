# Report Builder — Layout & Space (collapsible palette + non-blank collapsible inspector)

**Date:** 2026-07-06
**Origin:** UX review after live-viewing the builder + reference projects (inerttila/Report-Builder, react-awesome-query-builder). First of a suggested three-part improvement sequence (this = layout/space; then starter-template gallery + chart breadth; then a visual/nested query builder).
**Status:** Design approved — ready for implementation plan.

## Goal

Reclaim horizontal space in the Report Builder and stop wasting the right pane on
a blank "select a block" placeholder. Two changes: (1) the block palette (inner
left sidebar) becomes a collapsible icon-rail; (2) the right pane is never blank
(shows Report settings when nothing is selected) **and** can collapse on demand.
Frontend-only; no schema/engine changes.

## Current layout (the problem)

`apps/studio/src/reports-builder/ReportBuilderPage.tsx` renders a fixed 3-pane row:
- `w-40` **block palette** (`BlockPalette`) — always open; 8 draggable/click-to-add
  kinds (title/text/kpi/chart/table/image/divider/pageBreak).
- flexible **canvas** (`ReportCanvas`) — click empty area deselects.
- `w-64` **right pane** — renders `BlockInspector` when a block is selected, else a
  blank *"Select a block to edit…"* placeholder.

On a narrow screen that is ~416px of fixed chrome squeezing the canvas, and the
right 256px sits blank whenever nothing is selected. Available shadcn primitives:
`Sheet`, `Tooltip` (no Collapsible/Resizable). Constraint: the palette supports
**drag-to-canvas** via dnd-kit, so any collapse must preserve dragging.

## Design

### 1. Collapsible block palette → icon-rail (`BlockPalette` + `ReportBuilderPage`)

The palette toggles between:
- **Expanded** (`w-40`): icon + label per kind (as today, plus a leading icon).
- **Collapsed** (icon-rail, ~`w-10`): icon only, the label shown on hover via
  shadcn `Tooltip`.

A chevron toggle at the palette top switches modes; the state persists
(localStorage). Each item stays **draggable AND click-to-add** in both modes
(dnd-kit `useDraggable` on the icon), so drag-to-canvas keeps working — this is
why an icon-rail is chosen over a "+"/popover (you cannot drag out of a popover
cleanly). Add a small lucide-icon map keyed by `BlockKind` (Title→Heading,
Text→Type, KPI→Gauge, Chart→BarChart3, Table→Table, Image→Image, Divider→Minus,
Page break→SeparatorHorizontal).

### 2. Right pane: never blank (Report settings) + collapsible

Two changes to the `w-64` right pane in `ReportBuilderPage.tsx`:

**(a) Never blank — Report settings when idle.** New `ReportSettings` component.
When a block is selected → `BlockInspector` (unchanged). When nothing is selected
→ `ReportSettings`: edit `template.page` (size A4/Letter, orientation
portrait/landscape, margins top/right/bottom/left) + a **Parameters** button that
opens the existing parameters dialog. This fills the dead space and surfaces page
settings that currently have **no** builder UI (the schema has `page` but it is not
editable today). `ReportSettings` patches the template via the existing `update()`.

**(b) Collapse on demand.** A chevron collapses the whole right pane to a thin rail
(canvas reclaims the ~256px); expanding restores it. Selecting a block
**auto-expands** the pane (the user clearly wants to edit it). Collapse state
persists (localStorage). When collapsed, the rail shows only an expand chevron —
never a blank 256px pane.

### 3. Persistence helper

A tiny local hook (e.g. `useReportsBuilderPref(key, default)` backed by
localStorage) for the two boolean prefs (palette-collapsed, inspector-collapsed),
mirroring the app's existing `useSidebar` persistence pattern. Keep it in
`apps/studio/src/reports-builder/`.

## Scope / non-goals

- Frontend-only, under `apps/studio/src/reports-builder/` (+ shadcn `Tooltip`,
  `Sheet` if used). No `@openldr/report-builder` schema/engine change, no new block
  types, no chart-type additions (that is the next slice).
- i18n: any new visible strings use the existing `reportBuilder.*` en/fr/pt
  bundles (fr/pt typed `EnShape`, so keys must be added to all three).

## Testing

Component tests (`apps/studio/src/reports-builder/*.test.tsx`, Testing Library):
- **Palette:** toggling collapses to the icon-rail and back; a rail item still
  calls `onAdd(kind)` on click; the toggle control is present.
- **ReportSettings:** renders page size/orientation/margins controls + a
  Parameters button; changing page size/orientation/a margin calls the patch with
  the updated `page`; clicking Parameters invokes the open-params callback.
- **Right pane:** renders `ReportSettings` when `selected` is null and
  `BlockInspector` when a block is selected; the collapse toggle hides/shows the
  pane; selecting a block auto-expands a collapsed pane.
- Visual check (dark + light) in the running builder.

## Gate

- Forced 31-package typecheck (`pnpm turbo run typecheck --force`) — studio-only
  change but run the full gate; never pipe turbo through `tail`.
- Pre-existing unrelated flakes (studio `api.test.ts` vitest-dedupe; parallel-load
  timeouts that pass in isolation) are not regressions.

## Follow-ups (later slices, per the agreed sequence)

- Starter-template gallery across categories (operational/quality/TAT/volume, not
  just AMR) + wider report chart types (reuse dashboards' area/scatter/gauge/…).
- Visual/nested query builder for non-scripters (adopt react-awesome-query-builder;
  query-model flat-filters → condition-tree — its own capability slice).
