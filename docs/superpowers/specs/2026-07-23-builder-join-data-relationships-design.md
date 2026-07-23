# Widget Builder — "Join data" (Multiple Curated Relationships)

**Date:** 2026-07-23
**Status:** Approved (brainstorm) — pending implementation plan
**Related:** [dynamic-builder-adhoc-joins](2026-07-23-dynamic-builder-adhoc-joins-design.md) (shipped; provides the machinery this reuses), [builder-minimal-core-sections](2026-07-23-builder-minimal-core-sections-design.md) (shipped; the section layout this slots into)

## Problem

Metabase's notebook editor presents joins as a first-class visual block — `Orders ⋈ People on User ID = ID` — where the user picks a related table and then browses its columns. The openldr builder already ships a narrower **join-column escape hatch**: `JoinColumnPicker` surfaces **one** admin-declared join column at a time, and results render as a flat chip list. Two gaps versus the Metabase feel:

1. **Not relationship-first.** There is no visual "this widget joins X to Y" block; joined columns are indistinguishable chips with no indication of the relationship or its keys.
2. **One column at a time, one relationship in practice.** Adding several columns from a related table is a repeated single-column dance, and the models only declare a single optional join, so "reach multiple related tables" is not yet expressible in the UI.

The goal is the Metabase "Join data" experience — **within the curated model** — letting a user activate one or more admin-declared relationships and pick several columns from each, presented as first-class relationship blocks.

## Key finding that shapes the design

**The persisted schema and the compiler already support this. No change is needed to either.**

- `adhocDimensions` (`packages/dashboards/src/types.ts`) is already an **array**; each `AdhocDimension` carries its own `join` alias, `column`, `label`, and `kind`.
- `effectiveModel()` folds every ad-hoc dimension into the model as a real dimension and **validates** each against the optional-join + denylist rules (`packages/dashboards/src/compile.ts`).
- `collectUsedJoins()` gathers the **distinct** join aliases referenced by the query's dimensions and emits one `leftJoin` per alias; `colName()` qualifies each joined column as `alias.column`, and each SELECT is aliased by the unique `adhocKey(join, column)` (`join__column`).

Therefore **multiple relationships × multiple columns is already compilable**: it is N `AdhocDimension` entries whose `join` aliases differ. What is missing is (a) the relationship-first UI that produces and groups them, and (b) admin-declared *additional* optional joins so there is more than one relationship to pick.

This keeps the feature squarely in the curated direction (a / E3) and leaves the server-side safety guard untouched.

## Decisions (from brainstorm)

- **Curation stance unchanged.** Both join keys (`ModelJoin.left`/`right`) and the set of joinable tables stay **admin-declared**. The user chooses only *which* declared relationship to activate and *which* denylist-filtered column(s) to surface. Direction B (user-chosen tables or keys) remains rejected.
- **Relationship-first, multi-column, multiple relationships.** A "Join data" section lists the model's declared relationships; the user activates one or more, and for each picks **multiple** columns at once.
- **No schema or compiler change.** The feature is UI + registry content. The only compiler-adjacent work is a *test* asserting two simultaneous optional joins still compile correctly (locking in the "no change needed" claim).
- **Transparency.** Each active relationship shows its join keys **read-only** (`on patient_id = id`), reinforcing that keys are curated, not chosen.

## Architecture

Three layers; two are UI/content, one is a test.

### 1. Registry content (`packages/dashboards/src/models/registry.ts`)

No structural change to `ModelJoin`, `exposableColumns`, `modelsForClient`, or `ClientOptionalJoin` — they already model N optional joins per model and ship each as `{ alias, label, exposableColumns }` (denylist-filtered, client-safe).

To make "multiple relationships" exercisable, declare **≥1 additional `optional` join** (each with a **non-empty `denyColumns`**, per the shipped fail-safe: an optional join without a denylist exposes nothing and is omitted from `modelsForClient`). This is admin content, reviewed like any denylist change; it is the enabling data, not new machinery. The exact additional relationship(s) are chosen during planning against the external schema and PII constraints (candidate: a second declared relationship on `lab_requests`).

### 2. UI (`apps/studio/src/dashboard/editor/`)

Replace the single-column `JoinColumnPicker` flow with a **"Join data" section** launched from the existing `+ Add` menu (shown only when `model.optionalJoins?.length`), reusing the minimal-core section-card chrome:

- **Relationship list → active blocks.** Selecting a relationship from `model.optionalJoins` adds an active **relationship block**. Multiple blocks may be active at once (one per distinct alias).
- **Per-block:**
  - Header shows the relationship label and its **read-only** join keys (`on <left> = <right>`), derived from the client model. (This requires the join keys to be present on `ClientOptionalJoin` for display — see Open questions; today it carries only `alias`/`label`/`exposableColumns`.)
  - A **multi-select** over `exposableColumns`. Each checked column writes one `AdhocDimension` via a pure patch helper; unchecking removes it. Reuse `adhocKey`, `inferKind`, and `humanize` from the current picker.
- **Removal.** Removing a block clears every `AdhocDimension` whose `join` matches that alias, and **orphan-cleans** any Group by / Breakdown / Filter (`filters`/`filterTree`) still referencing a removed key — mirroring the derived-measure cleanup in `measures.model.ts` and the ad-hoc cleanup already specced for the minimal-core layout.
- Once added, each joined column remains a first-class dimension (selectable in Group by, Breakdown, Filter) exactly as today.

**Pure helpers (new, in `builderForm.model.ts`)**, following the existing patch-function style (React/DOM-free, unit-testable):

- `setJoinColumnsPatch(value, alias, columns)` — reconcile the set of `AdhocDimension`s for one relationship alias to exactly `columns` (add missing, remove dropped), returning the new `adhocDimensions` **plus** the orphan-cleaned dimension/breakdown/filter fields.
- `removeRelationshipPatch(value, alias)` — remove all ad-hoc dims for an alias + orphan-clean.

These compose the existing single-add/single-remove semantics; the shipped `addAdhocDimensionPatch`/`removeAdhocDimensionPatch` remain the primitives.

### 3. Compiler test only (`packages/dashboards`)

No code change. Add a compiler test asserting that a query with **two ad-hoc dimensions on two different optional joins** compiles to two `leftJoin`s with correctly qualified refs and unique SELECT aliases — a regression guard for the claim that multi-relationship needs no compiler work.

## Testing & safety

- **Pure-helper tests:** `setJoinColumnsPatch` add/remove reconciliation; `removeRelationshipPatch` orphan cleanup across dimension/breakdown/filters/filterTree; multiple relationships coexisting.
- **Compiler test:** two simultaneous optional joins → two `leftJoin`s, qualified refs, distinct aliases (see layer 3).
- **UI tests (`BuilderForm`/section):** activating a relationship shows a block with read-only keys; multi-select writes/removes ad-hoc dims; a second relationship can be activated; removing a block clears its columns and any orphaned references.
- **Regression:** existing `JoinColumnPicker` corpus / recognizer / builder tests stay green; the single-relationship path is a subset of the new one.
- **PII / curation:** unchanged and load-bearing — every relationship is admin-declared with a non-empty `denyColumns`; `modelsForClient` still strips raw `joins`/`denyColumns` and omits any join whose `exposableColumns` is empty; `effectiveModel()` still rejects a hand-edited widget referencing a non-optional join or a denied column. The multi-relationship UI adds **no** new server trust surface.

## Scope / non-goals

- One cohesive spec; buildable behind the existing builder without touching SQL mode.
- **Not** in scope: user-chosen join tables or keys (direction B, rejected); cross-model joins where both sides are full models; drag-to-reorder; joins declared at query time. Adding *which* extra relationships exist is ongoing admin/registry content, not part of the UI feature's core.

## Open questions for the plan

- **Join-key display:** `ClientOptionalJoin` currently omits `left`/`right`. To render `on <left> = <right>` read-only, add them to the client shape in `modelsForClient` (they are not sensitive — they are FK column names, not data). Confirm during planning; alternatively omit the keys from the header and show only the relationship label + column count.
- Exact section-card visuals for a relationship block vs. the flat chip list (resolve against shipped section-card chrome).
- Which additional `optional` join(s) to declare first (external-schema + PII review).
