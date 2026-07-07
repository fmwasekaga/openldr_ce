# Report Designer — Design Spec (looks first)

**Date:** 2026-07-08
**Status:** Design approved; implementation not started
**Scope of this document:** Visual/layout design of a new **Report Designer** page. This
pass delivers the *look* — a self-contained page shell with placeholder/mock content and
real interaction chrome (menus, tabs, selection). It intentionally does **not** wire up data
fetching, real PDF/Excel export, or persistence. Those are ported from the proven
`database_reporter` Designer in a later pass, once this design is locked.

---

## 1. Purpose & paradigm

A **free-form, absolute-positioning page designer** for printable reports. The user drops
primitive elements (Text, Image, Line, Rectangle, Date/time, Table) onto a printable page
and positions/sizes them anywhere via drag + handles. Tables bind to reports/datasets and
render sample data. This is the paradigm already working in
`D:\Projects\Repositories\database_reporter` (`apps/web/src/pages/DesignerPage.tsx`).

It is deliberately a **separate page** from the existing `apps/studio/src/reports-builder`
(a flowed row/cell grid builder) and the `apps/studio/src/reports` library. The two builder
paradigms coexist for now; convergence is out of scope.

Design cues are borrowed from the polished `/query` page
(`apps/studio/src/query/QueryPage.tsx`): `fullBleed` `AppShell`, a `w-60` collapsible
explorer with an `h-10` `bg-muted/40` header, edge-to-edge hairline dividers, and uppercase
muted section labels.

---

## 2. Route, nav, and shell

- **Nav:** new **top-level** item labeled `Report Designer`.
- **Route:** `/report-designer` (list/empty state) and `/report-designer/:id` (a template
  open). New-template flow may use a transient id until first save (mirrors the current
  report-builder pattern).
- **Shell:** `AppShell` with `title` = "Report Designer" and `fullBleed`.
- **Top-level layout:** a full-height flex row with three regions:

  ```
  ┌──────────────┬───────────────────────────────┬──────────────┐
  │  Templates   │            Canvas             │  Inspector   │
  │ (collapsible)│  header + printable page(s)   │  3 tabs      │
  └──────────────┴───────────────────────────────┴──────────────┘
  ```

  - Left: fixed `w-60`, collapsible to a thin `w-8` rail, `border-r border-border`.
  - Center: `flex-1 min-w-0`, its own header + scrollable canvas body.
  - Right: fixed width (`w-64` target), `border-l border-border`.

All three regions use edge-to-edge hairline dividers (`border-border`) per the house
"edge-to-edge dividers" rule. All controls are shadcn primitives — no native `<select>`,
etc.

---

## 3. Left pane — Templates explorer

Organization: **flat list + search** (matches database_reporter; simplest first cut).

**Header row** (`h-10`, `bg-muted/40`, `border-b border-border`, `px-3`):
- Left: uppercase `text-[11px] tracking-wide text-muted-foreground` label **"Templates"**.
- Right: collapse button (`PanelLeftClose` icon), identical behavior to `/query`.

**Body** (`p-2`, vertical stack, scrolls):
1. **Search** field (shadcn `Input` with a leading search icon), filters the list by name.
2. **New template** button (outline, full-width, `Plus` icon).
3. **Template list** — a flat, newest-first column of cards. Each card:
   - Name (`text-sm font-medium`).
   - Meta line: mono uppercase `paper · orientation · N` (e.g. `A4 · portrait · 2`).
   - Selected card: accent border + `bg-accent`/`text-accent-foreground`.
   - Hover: `bg-muted`.

**Collapsed state:** an `w-8` rail with a single expand button (`PanelLeftOpen`), exactly
like the query explorer's collapsed rail.

For this looks-only pass the list is seeded with 2–3 mock templates so the pane reads
correctly; no fetch.

---

## 4. Center pane — Canvas

### 4.1 Canvas header (`border-b border-border`, `px-3`, ~`h-11`)

- **Left:** the report **name** shown as an inline editable chip/`Input` (small, `h-8`,
  `max-w-xs`).
- **Right cluster** (in order):
  1. **`Insert ▾`** — a shadcn `DropdownMenu` button (`Plus` + chevron) listing the six
     element kinds with icons: Text (`Type`/`letter-t`), Table (`Table2`), Image
     (`Image`), Line (`Minus`), Rectangle (`Square`), Date/time (`CalendarClock`).
     Choosing one inserts that element onto the active page. Table is disabled inside
     repeating bands (parity with database_reporter's rule); shown with a tooltip.
  2. **Zoom stepper** — `−  75%  +` control (shadcn), cycling a fixed set of zoom levels
     (`0.5 / 0.75 / 1 / 1.25`).
  3. **`Preview`** — outline button (`Eye`), opens the full-document preview overlay.
  4. **`⋯` kebab** — a shadcn `DropdownMenu` (`MoreHorizontal`) holding the less-frequent
     document actions: **Save**, **Export PDF**, **Export Excel**, **Check** (legibility
     lint), **Duplicate**, and a separated destructive **Delete**.

Rationale: keep the two constantly-used affordances (Insert, zoom) and Preview inline;
tuck everything else behind the kebab so the header stays calm. This is the "options in
horizontal dots" the user asked for.

### 4.2 Canvas body

- Backdrop: `bg-muted/30`, `overflow-auto`, centered content, generous padding.
- One or more **printable pages** stacked vertically (portrait/landscape per template).
  Each page is a white surface with a `border-border` hairline and a subtle shadow, sized
  to the paper + zoom.
- **Elements** are absolutely positioned within the page (x/y/w/h rects).
- **Selection:** the selected element shows an accent outline (`ring`/outline in the accent
  color) with **four corner handles** (small squares). Drag to move; handles to resize
  (interaction ported later — this pass renders the selected/handle *look*).
- Each page shows a small caption (e.g. `Page 1 of 2`, plus an "auto pages from table
  overflow" note in the full port).

For the looks pass the page renders mock content: a title, a subtitle, a sample bound
table with a few rows, and a footer date token — enough to read as a real report.

---

## 5. Right pane — Inspector (3 tabs)

Tab header: `h-10`, `bg-muted/40`, `border-b border-border`, three equal-width tabs with
uppercase labels and an active underline (accent/foreground). Tabs: **Properties**,
**Layers**, **Data**.

### 5.1 Properties
- When an **element is selected:** its editable fields — position (X/Y), size, and
  kind-specific props (e.g. a Table's bound report + column list with drag handles; a
  Text's content/size/weight; etc.).
- When **nothing is selected:** **page settings** — paper, orientation, margins — i.e. the
  document defaults live here (no separate "settings" surface).

### 5.2 Layers
- A z-ordered list of every element on the active page (icon + name), newest/topmost first.
- Click to select (syncs canvas selection); reorder to change z-order (port later).
- Selected element highlighted with the accent treatment.

### 5.3 Data
- **Reports on this page:** the distinct reports/datasets bound by tables on the page, each
  with a small readiness indicator.
- **Parameters:** the parameter inputs those reports consume (e.g. Facility, Period), so
  sample data can be shaped without leaving the page.

For the looks pass all three tabs render representative mock content.

---

## 6. States & chrome details

- **Empty state** (no template selected / none exist): a centered dashed-border panel with
  a frame icon, a one-line heading ("Select or create a template"), and a short helper
  sentence — matching database_reporter's empty design.
- **Loading / error:** thin inline messages consistent with the rest of studio (deferred
  in looks-only since there's no fetch yet, but the layout reserves space).
- **Preview overlay:** a modal/portal presenting the composed document (look only this
  pass; real rendering ported later).
- **Typography & tokens:** shadcn + Tailwind house tokens; sentence case; hairline
  `border-border`; muted uppercase section labels; accent for selection/active.

---

## 7. Component decomposition (for the looks pass)

Proposed new files under `apps/studio/src/report-designer/` (mirrors the `query/` folder
structure so the two feel like siblings):

- `ReportDesignerPage.tsx` — top-level shell: AppShell + three-column layout + collapse
  state; owns "selected template" and "selected element" UI state (mock).
- `templates/TemplatesExplorer.tsx` — search + New + flat card list (+ collapsed rail).
- `canvas/CanvasHeader.tsx` — name chip, Insert menu, zoom stepper, Preview, kebab menu.
- `canvas/PageCanvas.tsx` — backdrop + printable page(s) + element rendering + selection
  outline/handles (render-only this pass).
- `inspector/InspectorTabs.tsx` — the 3-tab container.
- `inspector/PropertiesTab.tsx`, `inspector/LayersTab.tsx`, `inspector/DataTab.tsx`.
- `mockTemplates.ts` — seed data so the shell reads correctly without a backend.

Each unit has a single clear purpose and a small, well-defined prop interface, so the later
functional port (state model, drag/resize, data, export) slots in behind these seams
without reshaping the UI.

---

## 8. Explicitly out of scope (this pass)

- Real template persistence / API (`create/get/update/delete`).
- Real element drag/resize/keyboard-nudge logic and the design state model.
- Real report/dataset binding, parameter evaluation, and sample data.
- Real PDF and Excel export; real legibility lint ("Check").
- Convergence with `reports-builder` / `reports` library.

These are the functionality that already works in `database_reporter` and will be ported
onto the approved shell in follow-up slices.

---

## 9. Reference

- Working paradigm to port: `D:\Projects\Repositories\database_reporter\apps\web\src\pages\DesignerPage.tsx`
  (+ its `components/designer/*`: `PageCanvas`, `Inspector`, `LayersPanel`, `PreviewModal`).
- Design-cue source: `apps/studio/src/query/QueryPage.tsx` and `apps/studio/src/query/**`.
- Existing (different-paradigm) builder to sit beside: `apps/studio/src/reports-builder/**`.
