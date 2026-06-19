# Forms Corlix-Parity — SP-F: Lifecycle Parity (Design)

**Date:** 2026-06-19
**Builds on:** SP-A–E, branch `feat/forms-corlix-sp-a`. Final builder sub-project before merge.

## Context
The builder header's ⋯ "Builder actions" menu (SP-B) has Save draft / Publish / Compare / Add field wired, but Archive / Export / Disable / Delete are stubs. SP-F wires the full Corlix lifecycle and enforces the per-target-page publish contract. Reference Corlix's lifecycle ⋯ menu in `FormBuilderPage.tsx`.

## Goal
1. **Wire ⋯ menu actions:** Archive (`setFormStatus(id,'archived')`), Disable (toggle `active` / status), Delete (`deleteForm(id)` → confirm → navigate `/forms`), Export (download the FHIR Questionnaire via `formQuestionnaireUrl(id)`; + a "Form JSON" option exporting the raw `FormSchema`). These require a saved form (`formId`); disabled when unsaved.
2. **Publish-contract gating:** `lintFormSchema` already emits `target-contract-violation` (from `validateTemplateTargets`). Ensure those are **errors** that disable Publish, and the lint banner explains which target page is missing which keys. Publish is blocked while any lint error exists.

## Components / changes
| File | Responsibility |
| --- | --- |
| `apps/web/src/forms-builder/BuilderHeader.tsx` (+ test) | add `onArchive`/`onDisable`/`onDelete`/`onExport` props; wire the menu items (disabled when `!formId`); keep Publish disabled when `!canPublish` |
| `apps/web/src/forms-builder/FormBuilderPage.tsx` (+ test) | implement archive/disable/delete (with a confirm)/export handlers via the API client; pass `formId`/`canPublish`; ensure `canPublish` is false when lint has a target-contract (or any) error |
| (verify) `packages/forms/src/lint.ts` | confirm `target-contract-violation` severity is `error` (adjust if needed, with a forms test) |

## Scope
In: the four menu actions + publish gating + export. Out: nothing further — after SP-F the builder is at parity for this slice. The field-list **drag-all bug** is the remaining end-of-run fix, after which the branch is ready to merge to `main`.

## Testing
`BuilderHeader.test.tsx`: Archive/Disable/Delete/Export menu items call their callbacks; disabled when `formId` absent; Publish disabled when `canPublish` false. `FormBuilderPage.test.tsx`: archiving calls `setFormStatus(...,'archived')`; delete confirms then calls `deleteForm` + navigates; export triggers the questionnaire download; publish is blocked when a target-contract error exists. If `lint.ts` needs a severity tweak, add/adjust a `@openldr/forms` lint test. Keep web + forms typecheck/build/test green; depcruise clean.
