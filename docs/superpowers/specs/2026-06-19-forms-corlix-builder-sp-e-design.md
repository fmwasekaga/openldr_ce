# Forms Corlix-Parity — SP-E: Sections & Groups Management (Design)

**Date:** 2026-06-19
**Builds on:** SP-A/B/C/D, branch `feat/forms-corlix-sp-a`.

## Context
Fields reference a `section` (id) and `groupId`, and the Edit Field sheet (SP-C) lets you pick a field's section/group — but there is no way to **create/manage sections**, and the field-list pane (SP-B) shows a flat list (no section headers, no visual group nesting). SP-E adds section CRUD + field-list grouping, mirroring Corlix's `SortableSectionListRow` + grouped field rendering.

## Goal
1. **SectionsManager** — add / rename / delete / reorder `schema.sections` (`FormSection { id, label, order, fhirResourceType?, visibility? }`). Deleting a section unassigns its fields (`field.section` cleared). Reachable from the builder (a "Sections" control in the header row or a small panel above the field list).
2. **Grouped field list** — `FieldListPane` renders fields under their **section** (a section header per distinct section + "No section"), and visually **nests group children** (fields whose `groupId` points at a `group`-type field are indented under it). Reorder still works within the flat `order`.

## Components
| File | Responsibility |
| --- | --- |
| `apps/web/src/forms-builder/SectionsManager.tsx` (+ test) | section CRUD (add/rename/delete/reorder) over `schema.sections` via `onChange(sections)` (+ `onFieldsChange` to clear `section` on delete) |
| modify `apps/web/src/forms-builder/FieldListPane.tsx` (+ test) | group rows by `field.section` with section headers; indent group children under their group field |
| modify `apps/web/src/forms-builder/FormBuilderPage.tsx` | mount `SectionsManager`; wire section changes into the schema (with history) |

## Scope
In: section CRUD + field-list section headers + group-child indentation. Out: drag-between-sections to reassign (keep section assignment via the Edit Field sheet's Section select from SP-C); lifecycle gating (SP-F). The field-list **drag-all bug** is an end-of-run fix.

## Testing
`SectionsManager.test.tsx`: add a section → `onChange` includes it; rename → updates label; delete → `onChange` drops it AND `onFieldsChange` clears `section` on its fields; reorder updates `order`. `FieldListPane.test.tsx` (extend): fields render under section headers; a group field's children are indented/nested. Page test: SectionsManager present; adding a section updates the field-list grouping. Keep `@openldr/web` typecheck+build+test green; depcruise clean.
