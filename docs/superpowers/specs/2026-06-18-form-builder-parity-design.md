# Form Builder Parity Design

**Date:** 2026-06-18  
**Status:** Approved design  
**Reference:** `openldr-ce-phase1-phase2-status-and-loe.md`; Corlix read-only design reference at `D:\Projects\Repositories\corlix`  
**Scope decision:** Option C, one integrated Corlix-style builder slice. Include rich authoring, lifecycle, versioning, and diff/compare. Exclude marketplace/install/update/drift flows.

## Purpose

OpenLDR CE currently has a forms list, JSON import/export, basic capture runtime, and form persistence, but no visual builder. The goal is to build a Corlix-style Form Builder as a first-class OpenLDR CE surface so operators can create, edit, validate, publish, and compare forms without hand-editing JSON.

Corlix is the read-only design reference. OpenLDR CE must implement original code using CE's existing architecture: `packages/forms` for the canonical `FormSchema` and Questionnaire engine, `packages/db` for migrations, `apps/server` for Fastify routes, and `apps/web` for the React/Vite UI.

Marketplace form packages, install/update flows, drift detection, and registry publishing are out of scope for this slice.

## Scope

In scope:

- New builder routes: `/forms/new` and `/forms/:id/builder`.
- Corlix-like three-pane builder layout.
- Form metadata, target pages, sections, fields, ordering, repeats, required/cardinality, and status editing.
- Field and section property editing, including labels/translations, type, FHIR binding, terminology binding, visibility, observation extraction, code, and unit.
- Drag/drop reorder for fields and sections.
- Search/filter, multi-select, bulk actions, keyboard shortcuts, and undo/redo.
- Live preview/test mode using the same runtime behavior as capture.
- Backend version snapshots for publish and compare.
- Publish, archive, duplicate, import/export, version list, version detail, and diff/compare.
- Linting and publish gating.
- Focused tests across backend lifecycle, pure builder helpers, web API client, components, and e2e smoke.

Out of scope:

- Marketplace package install/update/publish/drift.
- Full external FHIR StructureDefinition catalog management unless needed as a lightweight local path suggestion source.
- Arbitrary FHIRPath evaluation.
- Multi-user real-time collaboration.
- Permission enforcement beyond existing route conventions, except where this slice records audit events.

## Architecture

The feature is implemented as one integrated product slice with testable internal boundaries:

- `packages/db` owns schema migration for immutable published form snapshots.
- `packages/forms` owns store methods and pure lifecycle, lint, diff, visibility, and normalization helpers.
- `apps/server` exposes builder/lifecycle/version routes and records audit events for mutations.
- `apps/web/src/forms-builder` owns the builder-specific UI components, hooks, and page composition.
- `apps/web/src/pages/Forms.tsx` enables creation and routes users into builder actions.
- `apps/web/src/pages/FormCapture.tsx` shares reusable renderer logic with builder preview. If extraction becomes too large for one pass, the implementation must at least move field rendering and client validation behind shared functions used by both pages.

Avoid a single giant builder file. The page composes smaller modules: palette, field row, section row, properties sheet, preview panel, bulk action bar, visibility editor, terminology binding, diff view, history hook, keyboard hook, and lint summary.

## Data Model And Lifecycle

`form_definitions` remains the editable working copy. The slice adds a `form_versions` table for immutable published snapshots. Each version stores:

- snapshot id
- form id
- numeric version
- version label
- name
- FHIR resource type
- schema JSON
- target pages JSON
- canonical Questionnaire JSON
- published timestamp
- published actor when available

Publishing a form validates and lints the working copy, marks it `published`, and inserts a new `form_versions` snapshot. Editing meaningful content on a published form flips it back to `draft`, preserving published snapshots for runtime pinning and compare. Archiving and deleting keep their existing user-visible semantics, with delete still removing the working definition unless a later retention policy is chosen.

Duplicate creates a draft copy with a new id, copied schema, target pages, and version label adjusted by the UI or store helper.

## API

Existing routes remain:

- `GET /api/forms`
- `GET /api/forms/published`
- `GET /api/forms/:id`
- `POST /api/forms`
- `PUT /api/forms/:id`
- `POST /api/forms/:id/status`
- `DELETE /api/forms/:id`
- `GET /api/forms/:id/questionnaire`
- `POST /api/forms/:id/responses`

New routes:

- `POST /api/forms/:id/publish`
- `POST /api/forms/:id/duplicate`
- `GET /api/forms/:id/versions`
- `GET /api/forms/:id/versions/:version`

The web API client adds typed functions for update, publish, duplicate, version list, and version detail. Route tests cover happy paths and validation failures.

## Builder Workspace

The Forms list enables **New form** and adds actions for **Edit builder**, **Duplicate**, **Publish**, **Archive**, **Compare**, **Export**, and **Delete**. `View/Run` remains the capture/runtime route.

The builder uses a Corlix-like three-pane layout:

- Left pane: available field palette and section navigator. Includes CE `FieldType` entries, quick custom field creation, search, and field/section counts.
- Center pane: form canvas and structure. Authors edit metadata, target pages, sections, ordering, enabled state, required/cardinality, repeats, and status.
- Right pane or sheet: selected field or section properties. Edits labels/translations, field type, options, terminology binding, FHIR path, observation extraction, code/unit, cardinality, visibility rules, and notes/help text where CE schema supports them.

The preview uses the same runtime behavior as `FormCapture`. If the current capture page has duplicated field rendering logic, this slice extracts a reusable renderer so preview and capture cannot drift.

## Schema Mapping

Corlix concepts map to CE's existing `FormSchema` where possible:

- sections map to `FormSchema.sections`
- section FHIR resource binding maps to `section.resourceType`
- field type maps to `field.type`
- required/repeat/cardinality map to `field.required`, `field.repeats`, and `field.cardinality`
- FHIR mapping maps to `field.fhirPath`
- observation extraction maps to `field.observationExtract`, `field.code`, and `field.unit`
- inline terminology choices map to `field.options`
- labels/translations map to `TranslatableText`

Where CE is too narrow, schema changes must be backward-compatible:

- Visibility may grow from single `whenField/equals` to Corlix-style `all/any` condition rules while normalizing old rules on load.
- ValueSet binding may need an optional field-level binding object or extension so bound ValueSets can be distinguished from manually-entered inline options.
- Enabled/disabled may be represented as an editor-visible flag if excluding disabled fields from the schema would make compare/versioning less faithful.
- Section-level visibility may be added if the builder supports section rules.

Any schema growth must preserve existing imported forms, current tests, and Questionnaire round-trip behavior.

## Rich Features

The slice includes:

- Drag/drop reorder for fields and sections using `@dnd-kit/core` and `@dnd-kit/sortable`.
- Search/filter across field label, id, type, section, FHIR path, and terminology code.
- Multi-select using shift/cmd-click.
- Bulk actions: move to section, toggle enabled, duplicate, delete.
- Keyboard shortcuts: search focus, next/previous field, open editor, toggle, duplicate, delete, select all, undo, redo, and clear selection.
- Undo/redo history with coarse snapshots for structural changes and debounced snapshots for property edits.
- Field and section visibility rule editor.
- Repeats and repeated-group authoring, with capture runtime upgraded where needed.
- i18n label editing for `en`, `fr`, and `pt`.
- FHIR-aware editing: section resource type, FHIR path suggestions when available, observation extraction, code, and unit.
- Terminology binding: pick a ValueSet, expand/load choices, pull terms into options, preserve code/system/display, and warn when choices are stale or empty.
- Template linting and publish gating.
- Live preview/test mode.
- Lifecycle controls and version compare.

## Linting

Builder linting should be pure and tested. It reports:

- duplicate section or field ids
- invalid or empty ids
- duplicate FHIR paths where duplicates would cause extraction ambiguity
- choice/open-choice fields without options or binding
- observation extraction fields without codes
- invalid cardinality
- visibility rules referencing missing or disabled controllers
- target page requirements missing required fields
- invalid schema normalization output
- empty bound ValueSets

Lint errors block save or publish depending on severity. Publish is stricter than draft save: drafts can preserve incomplete work, but publish must produce a runnable, exportable, valid schema.

## Preview And Runtime

The builder preview renders the current draft without requiring a server round trip. It supports:

- required field validation
- choice/open-choice rendering
- repeats
- section and field visibility
- quantity units
- terminology-derived options
- response dry-run output

Preview must reuse runtime rendering and validation logic from capture through shared field-rendering and validation modules. If builder output supports repeated sections or richer visibility before capture does, capture must be upgraded in the same slice so published forms are actually runnable.

## Diff And Compare

Diff/compare is the endpoint of this slice.

The compare dialog loads a selected published version and compares it to the current working draft. It shows:

- metadata changes
- target page changes
- section added/removed/renamed/reordered
- field added/removed/renamed/reordered
- type, required, repeat, cardinality changes
- FHIR path/resource binding changes
- observation extraction code/unit changes
- visibility rule changes
- terminology binding and option changes
- translation changes

Diff helpers should be pure and deterministic. The UI can present grouped changes rather than a raw JSON diff.

## Audit

Forms routes should record audit events for:

- create
- update/save
- publish
- archive/status change
- duplicate
- delete
- import
- Questionnaire export
- response submission if not already covered elsewhere

Events include before/after snapshots for update, publish, archive/status, duplicate, and delete, using existing audit store conventions. Actor resolution may remain simple if the broader audit sprint has not yet introduced authenticated actor extraction, but the route calls must be in place.

## Testing

Use TDD for implementation.

Backend tests:

- migration creates `form_versions`
- store create/update/publish/duplicate/listVersions/getVersion
- publishing snapshots Questionnaire JSON and increments version
- editing published content returns to draft
- route tests for new endpoints and failure cases

Pure helper tests:

- lifecycle helpers
- schema normalization
- lint rules
- diff output
- visibility evaluator and old-rule normalization
- undo/redo history

Web API tests:

- update, publish, duplicate, version list, version detail

Component tests:

- Forms list enables new/edit/duplicate/publish/compare actions
- builder loads a new and existing form
- add/edit/delete fields
- section add/reorder/delete
- properties sheet edits schema values
- lint blocks publish
- value set binding with mocked API
- compare dialog renders grouped changes

E2E or browser verification:

- create a form from the list
- add sections and fields
- bind terminology choices
- add visibility and test preview
- save draft
- publish
- edit draft
- compare against published version
- export Questionnaire
- run/capture published form

Final gates should include focused package tests first, then broader `pnpm --filter` typecheck/test/build commands, and a browser verification of the builder UI.

## Risks And Controls

Risk: the big slice is large.  
Control: keep code modular and make pure helpers own complicated logic.

Risk: CE schema may diverge from existing Questionnaire round-trip behavior.  
Control: preserve and extend forms package round-trip tests before UI work.

Risk: builder preview and capture runtime drift.  
Control: extract shared renderer/validation pieces and test both paths.

Risk: adding versioning changes existing form semantics.  
Control: preserve old list/get/create/status/delete behavior and add version tests.

Risk: accidentally copying Corlix source.  
Control: use Corlix for behavior inspection only; write original CE code and CE-specific tests.

Risk: marketplace expectations creep into diff.  
Control: compare only current draft versus published snapshots in CE.

## Acceptance Criteria

- Forms list can create and edit forms through the builder.
- Builder supports the Corlix-like layout and rich power-user features named in this spec.
- Operators can save drafts, publish versions, duplicate, archive, export, preview, and run published forms.
- Published versions are snapshotted and retrievable.
- Compare shows grouped differences between the current draft and a selected published snapshot.
- Existing imported JSON forms continue to load.
- Questionnaire export and forms package round-trip tests remain valid.
- Mutating form operations emit audit events.
- Focused unit/component/route tests pass.
- Browser verification confirms the full create-to-compare flow.
