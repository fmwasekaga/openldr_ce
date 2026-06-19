# Forms Corlix-Parity — SP-B: Builder Shell + Header + Field-List Pane (Design)

**Date:** 2026-06-19
**Status:** Approved-in-principle design (decomposition + approach approved during SP-A brainstorming) — confirm before plan.
**Builds on:** SP-A (`docs/superpowers/specs/2026-06-19-forms-corlix-model-sp-a-design.md`), branch `feat/forms-corlix-sp-a`.

## Context

SP-A replaced `@openldr/forms` with Corlix's flat model and trimmed the web builder to a minimal field editor. SP-B begins rebuilding the **rich Corlix builder** on that model: the three-pane shell, the header controls, and the left field-list pane. Reference (read-only, copy exactly): Corlix `D:/Projects/Repositories/corlix/apps/desktop/src/renderer/pages/FormBuilderPage.tsx` (~3120 lines) — specifically the page shell, header bar, and `SortableFieldRow`/`SortableSectionListRow` components.

## Goal

The builder page (`apps/web/src/forms-builder/FormBuilderPage.tsx`) becomes a faithful three-pane Corlix shell:
- **Header bar:** Form Name, Version, FHIR Version selector, Target pages multiselect (forms/users/facilities), Resource Type selector, a language/globe control (add/remove `languages[]`), and a lifecycle ⋯ menu (Add field, Save, Publish, Compare, Archive, Export submenu, Close, Disable, Delete). A lint/warning banner under the header.
- **Left field-list pane:** "N fields (N enabled)" counter, search box, "Sections (n)" dropdown, and sortable **field cards** (drag handle, enabled checkbox, label + required asterisk, fhir-path subtitle, type badge, section badge, lint marker, per-row ⋯ menu: duplicate / required toggle / delete). DnD reorder + undo/redo (reuse `useTemplateHistory`/`useBuilderKeyboard`).
- **Center/right panes:** placeholders in SP-B — the slide-out **Edit Field sheet** is SP-C and the live **Preview** is SP-D. In SP-B the right region shows the existing minimal inline properties (or a "select a field" placeholder) so the page stays functional.

## Scope

In: header controls + their wiring to the `FormSchema` form-level fields (`fhirVersion`, `targetPages`, `fhirResourceType`, `fhirProfileUrl`, `languages`) and lifecycle actions; the field-list pane with cards, search, section grouping (read-only grouping by `field.section`), DnD reorder, history; the lifecycle ⋯ menu (wired to existing `createForm/updateForm/publishForm/duplicateForm` + `setFormStatus` for archive/disable). Out: the Edit Field sheet (SP-C), live Preview rendering (SP-D), section/group **editing** UX (SP-E — SP-B only groups/displays by existing `section`), publish-contract enforcement UI (SP-F — `validateTemplateTargets` already exists and feeds the lint banner).

## Components (mirror Corlix names where practical)

| File | Responsibility |
| --- | --- |
| `apps/web/src/forms-builder/FormBuilderPage.tsx` | Three-pane shell + state (reuse history/keyboard) |
| `apps/web/src/forms-builder/BuilderHeader.tsx` | Form Name/Version inputs, FHIR Version / Target pages / Resource Type selects, language control, lifecycle ⋯ menu, lint banner |
| `apps/web/src/forms-builder/FieldListPane.tsx` | counter, search, Sections dropdown, list of field cards |
| `apps/web/src/forms-builder/SortableFieldRow.tsx` | one field card (drag/enable/label/required/fhirPath/type+section badges/⋯) |
| `apps/web/src/forms-builder/LanguageControl.tsx` | add/remove `languages[]` (globe popover) |
| (reuse) `builderModel.ts`, `useTemplateHistory.ts`, `useBuilderKeyboard.ts`, `LintSummary.tsx`, `CompareDialog.tsx` | from SP-A |

## Data flow

All edits mutate the in-memory `FormSchema` (flat `fields[]` with `order`/`section`/`enabled`). Field reorder updates `order`. Header selects set form-level fields. Lint runs via `lintFormSchema` (+ `validateTemplateTargets`) → banner. Save/publish/duplicate via the existing web API client (already carries the new form-level fields after SP-A).

## Testing

Component tests (Vitest + Testing Library): header renders + edits form-level fields; target-pages multiselect; language add/remove; field card renders badges + required marker + enabled toggle; add/select/duplicate/delete field; DnD reorder updates order (button-driven in tests, drag in e2e); lint banner shows target-contract violations. Keep `@openldr/web typecheck`/`build` green; reuse the existing e2e smoke (extend in SP-D/E).

## Out of scope / deferred

Edit Field sheet (SP-C), live Preview + Fill example/Reset (SP-D), section/group create/edit + per-language translation tabs (SP-E), publish-contract gating + archive/export/compare polish (SP-F).

## Open questions to confirm before the plan

1. SP-B right pane: keep SP-A's minimal inline properties, or a bare "select a field" placeholder until SP-C? (Lean: keep minimal inline properties so the builder stays usable.)
2. Resource Type / FHIR Version option lists: copy Corlix's exact option sets, or a short curated list? (Lean: copy Corlix's.)
