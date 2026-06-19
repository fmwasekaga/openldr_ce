# Forms Corlix-Parity — SP-C: Edit Field Slide-Out Sheet (Design)

**Date:** 2026-06-19
**Status:** Approved-in-principle (decomposition approved during SP-A brainstorming) — confirm before plan.
**Builds on:** SP-A (model+engine) + SP-B (builder shell), branch `feat/forms-corlix-sp-a`.

## Context

SP-B rebuilt the three-pane shell but the right pane is still SP-A's minimal inline properties. SP-C replaces it with the Corlix **"Edit Field" slide-out sheet** — the per-field editor in its own sheet (not hardcoded). Reference (copy exactly): Corlix `FieldEditor` in `D:/Projects/Repositories/corlix/apps/desktop/src/renderer/pages/FormBuilderPage.tsx` (~L541–1374) + `corlix/apps/desktop/src/renderer/components/VisibilityRuleEditor.tsx`.

## Goal

A `FieldEditorSheet` (shadcn `Sheet`, header "Edit Field" + field label subtitle + X close) editing the selected `FormField`, opened when a field is selected in the field-list pane. Sections (each a labelled block in the sheet):

- **General** — Display Label, Field Type (17-type `Select`), Section (`Select` over existing sections + "No section"), Group (`Select` over `group`-type fields + "No group" → sets `groupId`), Placeholder, Unit, Required (checkbox), Enabled (checkbox).
- **Options** (only for `select`/`multiselect`) — edit `valueSetOptions[] {code, display}`: add/edit/remove rows + "pull from terminology" via `TermPicker`.
- **Codes** — terminology anchors `code[]: FormFieldCoding[]` — search to add (reuse `TermPicker`), list with remove.
- **Translations** — for each language in `schema.languages`, a label (and placeholder) input writing `field.translations[locale]`.
- **Mapping** — `fhirPath`, `apiProperty`, `observationExtract` (checkbox), `valueSetUrl` + `bindingStrength` (Select); **Advanced** (collapsible): `constraints` (min/max/maxLength/decimalPlaces), reference config (`referenceTarget`/`referenceDisplayField`/`referenceValueField`/`referenceMultiple`/`referenceSearchable`) for `reference`/`facility` types, repetition (`repeatable`/`minItems`/`maxItems`), `adminNote` (Notes).
- **Visibility** — `VisibilityRuleEditor`: `combinator` (all/any) + `conditions[] {fieldId (Select over other fields), operator (Select), value}`.

Every edit calls `onUpdate(patch: Partial<FormField>)`; the page applies it to the selected field in the `FormSchema` (with history).

## Components

| File | Responsibility |
| --- | --- |
| `apps/web/src/forms-builder/FieldEditorSheet.tsx` (+ test) | Sheet shell + General section + section composition |
| `apps/web/src/forms-builder/field-editor/OptionsEditor.tsx` (+ test) | `valueSetOptions` rows + TermPicker pull |
| `apps/web/src/forms-builder/field-editor/CodesEditor.tsx` (+ test) | `code[]` terminology anchors |
| `apps/web/src/forms-builder/field-editor/TranslationsEditor.tsx` (+ test) | per-language label/placeholder |
| `apps/web/src/forms-builder/field-editor/MappingEditor.tsx` (+ test) | fhirPath/apiProperty/observationExtract/valueSet/binding + Advanced |
| `apps/web/src/forms-builder/field-editor/VisibilityRuleEditor.tsx` (+ test) | combinator + conditions (port Corlix's) |
| modify `FormBuilderPage.tsx` | open `FieldEditorSheet` on select; remove the minimal inline properties |

## Scope

In: the sheet + all sections above, wired to `Partial<FormField>` updates with history. Out (later SPs): live Preview pane (SP-D), section/group **create/manage** UX + language-tab niceties (SP-E — SP-C edits existing sections/groups/languages via selects), lifecycle gating (SP-F).

## Testing

Per-section component tests (edit each control → asserts `onUpdate` patch). Sheet test: opens for a selected field, General edits, switching field type reveals Options. Page test: selecting a field opens the sheet; editing Display Label updates the card. Keep `@openldr/web` typecheck+build+tests green; depcruise clean.

## Open questions (defaults)

1. Terminology Codes/Options "pull": reuse `TermPicker` (lean: yes). 2. Advanced Mapping fields (constraints/reference/repetition): include as plain inputs in SP-C (lean: yes, thin), rich UX deferred. 3. Sheet vs right-pane: use shadcn `Sheet` slide-out like Corlix (lean: yes).
