# Forms Corlix-Parity — SP-D: Live Preview Pane (Design)

**Date:** 2026-06-19
**Builds on:** SP-A/B/C, branch `feat/forms-corlix-sp-a`.

## Context
The builder has a field-list pane (SP-B) + Edit Field slide-out sheet (SP-C). SP-D adds the Corlix **live Preview pane** as the right pane: a running render of the current form with **Fill example** / **Reset** and per-field warning markers. Reuse SP-A's `FormRuntime` (already renders all 17 field types + visibility + validation). Reference Corlix's Preview pane in `FormBuilderPage.tsx` (the "Preview" / "Fill example" / "Reset" region + per-field `!`/`?` markers).

## Goal
A `PreviewPane` (right pane) showing `<FormRuntime>` over the current `FormSchema`, with: a "Preview" header + **Fill example** (populate plausible sample answers per field type) and **Reset** (clear) buttons, and per-field warning indicators driven by `lintFormSchema` (error `!`, warning `?`). The Edit Field sheet (SP-C) slides over this pane when a field is selected.

## Components / changes
| File | Responsibility |
| --- | --- |
| `apps/web/src/forms-runtime/FormRuntime.tsx` | add optional `initialAnswers?: RuntimeAnswers` (seed state) + `fieldWarnings?: Record<string,'error'\|'warning'>` (render a marker next to a field) + allow `submitLabel` optional when `footer` given |
| `apps/web/src/forms-runtime/example.ts` (+ test) | `makeExampleAnswers(schema): RuntimeAnswers` — a sample value per `fieldType` (text→'Example', number→1, boolean→true, date→ISO date, select/multiselect→first option, etc.) for visible/enabled fields |
| `apps/web/src/forms-builder/PreviewPane.tsx` (+ test) | "Preview" header + Fill example / Reset; renders `FormRuntime` (footer={null}, no submit) with `initialAnswers` + `fieldWarnings` from `lintFormSchema`; remount via `key` on fill/reset |
| `apps/web/src/forms-builder/FormBuilderPage.tsx` | two-pane layout: left field-list, right `PreviewPane`; Edit Field sheet overlays |

## Scope
In: PreviewPane + Fill example/Reset + per-field warnings + page wiring. Out: section/group editing (SP-E), lifecycle gating (SP-F). The drag bug (one card drags all) is tracked separately for an end-of-run fix.

## Testing
`example.test.ts`: `makeExampleAnswers` yields a value per type. `PreviewPane.test.tsx`: renders the form; "Fill example" populates inputs; "Reset" clears; a lint error/warning shows a per-field marker. Page test: the right pane shows the Preview. Keep `@openldr/web` typecheck+build+test green; depcruise clean.
