# Dynamic Widget Builder + Ad-hoc Join Columns

**Date:** 2026-07-23
**Status:** Approved (brainstorm) — pending implementation plan
**Related:** [dashboard-widget-builder-v2](2026-07-22-dashboard-widget-builder-v2-design.md), [query-model-slice-d-cross-model-facility-join](2026-07-06-query-model-slice-d-cross-model-facility-join-design.md)

## Problem

The dashboard widget builder (`apps/studio/src/dashboard/editor/BuilderForm.tsx`) presents a **fixed** set of sections — Source, Summarize, Filters, Group by, Grain, Breakdown, Limit — every one rendered whether used or not. Compared with Metabase's notebook editor, it feels static: clauses can't be added on the fly, there are no visual section boundaries, and there is no way to reach data outside a single curated model.

Two user goals:

1. **Make the builder feel dynamic** — add only the clauses you need, on demand, with clear visual separation between sections.
2. **Reach related tables** — the "multiple tables" capability admired in Metabase.

## Key finding that shapes the design

Joins are **already** fully supported, but declared server-side in the model registry rather than wired in the UI:

- `QueryModel` has a base `table` plus optional `joins: ModelJoin[]` (`packages/dashboards/src/models/registry.ts`).
- A `ModelDimension` opts into a join via `join: <alias>`; e.g. the `observations` model declares `joins: [{ table: 'patients', alias: 'jp', left: 'patient_id', right: 'id' }]` and exposes `{ key: 'facility', label: 'Facility', column: 'managing_organization', join: 'jp' }` as an ordinary dimension.
- The compiler's `collectUsedJoins` gathers the join aliases referenced by the dimensions a query uses, and `dimRef` qualifies joined columns as `alias.column`; the `leftJoin` is added automatically (`packages/dashboards/src/compile.ts`).

So within one model, an "advanced join builder" adds nothing the admin hasn't already wired. The escape hatch only earns its place by letting a power user reach a **column of a joined table that the admin did not pre-expose as a dimension**.

## Decisions (from brainstorm)

- **Direction: hybrid (C).** Keep the curated, model-driven data layer as the default; add a power-user escape hatch.
- **Layout: core + Add menu (C).** Source and Summarize are always present; every other clause is added on demand from a single `+ Add` menu and rendered as a labeled, removable section with separators.
- **Join scope: pick-your-own declared join (E3).** The set of joinable tables and their join keys stay admin-declared. The power user chooses *which* optional join to activate, *which* column to surface, and its label/kind.
- **Column scope: any column minus an admin denylist.** Exposable columns = `EXTERNAL_TABLE_COLUMNS[table]` minus a per-join `denyColumns`. Chosen over a strict allowlist for lower admin overhead.
  - **Fail-safe mitigation:** an `optional` join with **no `denyColumns` declared** is treated as **unavailable** (absent from the picker) until the admin declares the denylist. Because `EXTERNAL_TABLE_COLUMNS` is a compile-time map, a newly added schema column can only appear via a code change, so keeping the denylist current is a code-review checklist item, not a runtime leak vector. This directly addresses the "denylists fail open" risk.

## Architecture

Four layers. The core query shape is unchanged when no ad-hoc dimension exists, so existing recognizer/builder tests stay green.

### 1. Registry (`packages/dashboards/src/models/registry.ts`)

Extend `ModelJoin`:

```ts
export interface ModelJoin {
  table: keyof ExternalSchema;
  alias: string;
  left: string;
  leftReplace?: [string, string];
  right: string;
  optional?: boolean;      // NEW: not tied to a default dimension; offered in the "+ Add → Join column" picker
  denyColumns?: string[];  // NEW: columns that may NOT be exposed (required for an optional join to be usable)
}
```

Helper (pure, testable): `exposableColumns(model, alias): string[]` = `EXTERNAL_TABLE_COLUMNS[join.table]` minus `join.denyColumns`, returning `[]` when the join is `optional` and `denyColumns` is undefined (fail-safe → join not offered).

### 2. Widget query schema (`apps/studio/src/api.ts` + dashboards schema)

Add one field to the builder-mode `WidgetQuery`:

```ts
adhocDimensions?: { key: string; label: string; join: string; column: string; kind: 'string' | 'date' | 'number' }[];
```

This is the only new persisted state. `dimension`, `breakdown`, `filters`/`filterTree` continue to reference dimensions **by key** — they simply also see ad-hoc keys.

### 3. Compiler (`packages/dashboards/src/compile.ts`)

- Build an **effective dimension list** = `model.dimensions` ++ `query.adhocDimensions` (mapped to `ModelDimension` shape: they already carry `join`, `column`, `kind`, `label`, `key`). Resolve dimension/breakdown/filter keys against this merged list.
- `collectUsedJoins` and `dimRef` are unchanged: an ad-hoc dim carries `join`, so the existing `leftJoin` path fires automatically.
- **Validation (defense in depth):** reject an ad-hoc dim whose `join` is not an `optional` join on the model, or whose `column` is not in `exposableColumns(model, join)`. This stops a hand-edited widget JSON from smuggling a denied/foreign column past the UI.

### 4. UI (`apps/studio/src/dashboard/editor/`)

- **`BuilderForm.tsx`** restructured into: **pinned core** (Source, Summarize) + **dynamic clause sections** (Filter, Group by, Breakdown, Sort, Limit) each rendered only when active, separated by a divider and each carrying an `✕` remove control.
- **`+ Add` menu** listing only the clauses not yet present, plus "Join column".
- **`JoinColumnPicker`** (new): three steps — (1) pick an `optional` join, (2) pick a column from `exposableColumns`, (3) set label + kind (kind pre-filled by a small inference, user-overridable). Writes to `adhocDimensions` through a new pure patch helper alongside the existing `setDimensionPatch` / `setBreakdownPatch` family in `builderForm.model.ts`.
- Once added, an ad-hoc column is a first-class dimension for that widget: selectable in Group by, Breakdown, and Filter.

### Pure helpers (new, in `builderForm.model.ts`)

- `addAdhocDimensionPatch(value, dim)` / `removeAdhocDimensionPatch(value, key)` — set/clear entries in `adhocDimensions`, following the existing patch-function style (React/DOM-free, unit-testable without jsdom).
- On group-by/breakdown/filter removal, drop any now-orphaned ad-hoc reference (mirror the derived-measure cleanup already in `measures.model.ts`).

## Testing & safety

- **Pure-helper tests:** ad-hoc add/remove patches; orphan cleanup; `exposableColumns` incl. the **fail-safe** case (optional join without `denyColumns` → empty).
- **Compiler tests:** effective-dimension merge; auto-`leftJoin` fires for an ad-hoc dim; rejection of a denied column and of a non-optional/unknown join alias.
- **Regression:** existing recognizer corpus and builder tests unchanged when `adhocDimensions` is absent.
- **PII:** the `patients` join must ship with a `denyColumns` covering direct identifiers (names, identifiers, etc.); without it the join is simply not offered.

## Scope / non-goals

- One cohesive spec; buildable behind the existing builder without touching SQL mode.
- **Not** in scope: arbitrary user-chosen join tables or keys (that was direction B, explicitly rejected); cross-model joins where both sides are full models; drag-to-reorder clauses (Metabase B-style stack).

## Open questions for the plan

- Exact placement of the `+ Add` menu and remove affordance (visual detail — resolved during implementation against existing shadcn components).
- Kind-inference source for step 3 (simple column-name/type heuristic vs. defaulting to `string`).
