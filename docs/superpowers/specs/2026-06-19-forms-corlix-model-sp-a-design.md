# Forms Corlix-Model Parity — SP-A: Engine + Model Foundation (Design)

**Date:** 2026-06-19
**Status:** Approved design — ready for implementation plan
**Topic:** Replace the OpenLDR CE forms model with Corlix's form data model and port its headless FHIR-forms engine.

## Context

The merged Form Builder MVP ([form-builder-parity plan](../plans/2026-06-18-form-builder-parity.md)) uses a **nested** model — `FormSchema.sections[].fields[]` with `{en,fr,pt}` `TranslatableText` labels and a simple `{whenField,equals}` visibility rule. The user wants **full parity with the Corlix form builder**, whose model is fundamentally different (flat field list, ~30 per-field props, locale-keyed translations, rich visibility, form-level FHIR metadata). Corlix is the design source of truth.

Corlix's relevant source (read-only reference, do not import):
- Model types: `D:/Projects/Repositories/corlix/packages/shared-types/src/index.ts` (lines ~841–1010, `FormFieldType`/`FormField`/`FormSection`/`FormSchema`/`FormVersion` + supporting types).
- Headless engine: `D:/Projects/Repositories/corlix/packages/fhir-forms/src/*` (`toQuestionnaire`, `fromQuestionnaire`, `toQuestionnaireResponse`, `fromQuestionnaireResponse`, `extractors`, `visibilityMap`, `routing`, `scalarTypes`, `answerValue`, `coding`, `bindingStrength`, `translations`, `deriveLanguages`, `extensions`, `toTransactionBundle`, `samples/forms`, plus `*.test.ts`).
- Target-page contracts: `D:/Projects/Repositories/corlix/apps/desktop/src/shared/page-targets.ts`.
- Builder UI (reference for later SPs only): `D:/Projects/Repositories/corlix/apps/desktop/src/renderer/pages/FormBuilderPage.tsx` (~3120 lines).

## Locked Decisions

1. **Clean slate / re-seedable** — no production forms to preserve. The nested model is replaced outright; sample forms are re-authored on the new model. No stored-form migration/dual-read.
2. **Full Corlix field-type set** — all 17 `FormFieldType`s (`text`, `number`, `date`, `datetime`, `boolean`, `select`, `multiselect`, `phone`, `email`, `address`, `identifier`, `attachment`, `organism`, `antibiogram`, `reference`, `facility`, `group`).
3. **Clean replacement in place** — rewrite `@openldr/forms` (not a parallel package). Each sub-project merges to `main` when green.
4. **SP-A first** — this spec. The visible three-pane builder UI lands across SP-B–F.

## Full Decomposition (context; only SP-A is specced here)

- **SP-A — Engine + model foundation** (this spec): port Corlix `fhir-forms` + form types into `@openldr/forms`; rewrite `lint`/`diff`/`lifecycle`/`store`/`normalize`/`samples`; migration 020; server wiring; rewrite `forms-runtime` and trim the current builder so `main` stays green.
- **SP-B** — Builder shell + header controls (FHIR Version, Target pages, Resource Type, language/globe) + field-list pane (cards, badges, Sections dropdown, DnD, history, lifecycle ⋯ menu).
- **SP-C** — "Edit Field" slide-out sheet (General / Reference Config / Options / Codes / Translations / Constraints / Mapping / Visibility / Repetition / Notes).
- **SP-D** — Live Preview pane (all 17 types, Fill example / Reset, per-field warnings).
- **SP-E** — Sections & Groups editor + per-language translation tabs.
- **SP-F** — Lifecycle parity: per-target-page publish contract enforcement, archive, Export submenu, compare.

## SP-A Goal

A headless forms engine and data model that is a faithful port of Corlix's, with the rest of the monorepo (db, server, web app) compiling, building, and green — but **without** the rich builder UI. After SP-A, an operator can still import a form (new-model JSON), run/capture it at `/forms`, and export a FHIR R4 Questionnaire; the builder route renders a minimal model-correct editor.

## 1. Target Data Model (`packages/forms/src/schema/form-schema.ts`)

Adopt Corlix's types verbatim in shape, expressed as zod schemas (the package validates on read). Key types:

- `FormFieldType` — the 17-member union above.
- `FormFieldConstraints` — `{ min?, max?, maxLength?, decimalPlaces? }`.
- `FormFieldOption` — `{ code, display, translations?: Record<locale,string> }`.
- `FormFieldCoding` — `{ system, code, display? }` (FHIR `item.code`).
- `VisibilityOperator` — `equals|notEquals|oneOf|isEmpty|isNotEmpty|gt|lt|gte|lte`.
- `VisibilityCondition` — `{ fieldId, operator, value? }`; `VisibilityRule` — `{ combinator: 'all'|'any', conditions[] }`.
- `BindingStrength` — `required|extensible|preferred|example`.
- `FormField` — flat field with: `id`, `fhirPath: string|null`, `displayLabel`, `description: string|null`, `fieldType`, `required`, `enabled`, `order`, `cardinality: {min:number, max:string}`, `valueSetUrl?`, `bindingStrength?`, `valueSetOptions?`, `code?: FormFieldCoding[]`, `observationExtract?`, `constraints?`, `adminNote?`, `placeholder?`, `section?`, `unit?`, `apiProperty?`, `fhirDiscriminator?`, `fhirValueField?`, `isDisplayName?`, `displayNameOrder?`, `allowCustomValue?`, `referenceTarget?`, `referenceDisplayField?`, `referenceValueField?`, `referenceMultiple?`, `referenceDependsOn?`, `referenceSearchable?`, `translations?: Record<locale,{label?,description?}>`, `repeatable?`, `minItems?`, `maxItems?`, `groupId?`, `visibility?`, `locked?`.
- `FormSection` — `{ id, label, order, fhirResourceType?, visibility? }`.
- `FormSchema` — `{ id, name, versionLabel: string|null, fhirVersion: string|null, fhirResourceType: string|null, fhirProfileUrl: string|null, facilityId: string|null, fields: FormField[], sections: FormSection[], targetPages: string[], languages?: string[], version: number, active: boolean, status: 'draft'|'published'|'archived', createdAt, updatedAt }`.

**Breaking changes from the old model (intended):** labels become a base string + `translations` map (no `{en,fr,pt}` objects); fields are flat with `section`/`groupId`/`order` refs (no nesting); field-type vocabulary changes; visibility becomes `VisibilityRule`. All old-model code is rewritten, not bridged.

## 2. Engine Modules (port `fhir-forms` → `packages/forms/src`)

Port each Corlix module, swapping `@corlix/fhir` usage for our `@openldr/fhir` resource builders/validators and our `@openldr/forms` types:

| New module | Ported from | Responsibility |
| --- | --- | --- |
| `to-questionnaire.ts` | `toQuestionnaire.ts` + `scalarTypes.ts` + `coding.ts` + `bindingStrength.ts` + `extensions.ts` | model → FHIR R4 Questionnaire (group items, `item.code`, `answerValueSet` + strength extension, `enableWhen` from `VisibilityRule`, cardinality/repeats) |
| `from-questionnaire.ts` | `fromQuestionnaire.ts` | Questionnaire → model |
| `response.ts` | `toQuestionnaireResponse.ts` | answers → QuestionnaireResponse |
| `from-response.ts` | `fromQuestionnaireResponse.ts` | QuestionnaireResponse → answers |
| `extract/extract.ts` | `extractors.ts` | SDC-style extraction (`observationExtract`, `fhirPath` mapping, `toTransactionBundle`) |
| `visibility.ts` | `visibilityMap.ts` | evaluate `VisibilityRule` → visible field-id set |
| `routing.ts` + `page-targets.ts` | `routing.ts` + `page-targets.ts` | target-page registry + contract validation (adapted, see §3) |
| `answer-value.ts` | `answerValue.ts` | per-type answer value shapes |
| `i18n.ts` / `translations.ts` | `translations.ts` + `deriveLanguages.ts` | resolve base + locale translations; derive `languages[]` |
| `samples/forms.ts` | `samples/forms.ts` | re-authored sample forms (Facility, Users, …) |

Rewritten (our additions, onto the new model): `lint.ts` (publish contract + duplicate id + dangling visibility + choice/options + group integrity), `diff.ts`, `lifecycle.ts`, `normalize.ts`, `store.ts`, `pure.ts` (browser-safe re-exports), `index.ts`.

## 3. Page Targets (our adaptation of Corlix `page-targets.ts`)

Corlix targets `patients|orders|facilities|users`; we adopt the **mechanism** (`PageTarget` + `validateTemplateTargets`) with **our** app's page registry:

```
forms      — generic capture at /forms; match 'fieldId'; requiredKeys: []  (any published form runnable)
users      — match 'apiProperty'; requiredKeys: ['firstName','lastName','email','roles']
facilities — match 'apiProperty'; requiredKeys: ['name']  (Facilities page is future; registry entry exists now)
```

`validateTemplateTargets(targetPages, fields)` returns per-page missing `requiredKeys` (only ENABLED fields, matched by `apiProperty` or `id`). Consumed by `lint`/`lifecycle` to gate publish (full enforcement is SP-F; SP-A ships the function + tests).

## 4. Persistence (migration 020)

Schema JSON already lives in `form_definitions.schema` / `form_versions.schema`; `target_pages` and `fhir_resource_type` columns exist. Add **`020_form_fhir_metadata`** adding nullable columns to both tables: `fhir_version`, `fhir_profile_url`, `facility_id`. Store maps these to/from the model. Everything else stays in the JSON blob.

## 5. Server (`apps/server/src/forms-routes.ts`)

Extend `CreateFormInput`/`UpdateFormInput` zod + mappers with `fhirVersion`, `fhirProfileUrl`, `facilityId` (and pass-through `targetPages`, `fhirResourceType`, `languages`). `questionnaire`/`responses` routes call the new converters. Audit actions unchanged.

## 6. Web "Stays Green" Boundary

Because the model is replaced in place, the merged builder/runtime won't compile. SP-A includes:
- **Rewrite `apps/web/src/forms-runtime/` (`types.ts`, `runtime.ts`, `FormRuntime.tsx`)** to the new model: render + client-validate the 17 field types (basic controls; rich widgets are SP-D), evaluate `VisibilityRule`, resolve base-language labels via `translations`. `FormCapture` keeps working.
- **Trim the current builder** (`apps/web/src/forms-builder/*`) to a **buildable, model-correct minimal editor** (list fields, add/edit label+type, save) — NOT the rich UI. Update/relax its tests. The full three-pane Corlix builder is SP-B–F. (Alternative considered and rejected by the user: replace with a bare placeholder.)
- Web API client form types (`apps/web/src/api.ts`) gain the new form-level fields.

## 7. FHIR Mapping Notes (per type → Questionnaire `item.type`)

`text|phone|email|identifier|address` → `string`; `number` → `integer` or `decimal` (by `constraints.decimalPlaces`); `date` → `date`; `datetime` → `dateTime`; `boolean` → `boolean`; `select` → `choice`; `multiselect` → `choice` + `repeats`; `reference|facility` → `reference` (with `referenceTarget`); `organism|antibiogram` → `choice`/`coding` bound to the AMR ValueSets; `attachment` → `attachment`; `group` → `group` (nested items via `groupId`). `code[]` → `item.code`; `valueSetUrl`+`bindingStrength` → `answerValueSet` + Corlix strength extension; `visibility` → `enableWhen` (+ `enableBehavior` from combinator). Port Corlix's exact extension URLs from `extensions.ts`.

## 8. Testing (TDD)

Port Corlix `fhir-forms` tests to Vitest, adapted to our `@openldr/fhir`: `roundTrip`, `toQuestionnaire`, `fromQuestionnaire`, `extraction`, `visibility`, `bindingStrength`, `coding`, `i18n`, `languagesRoundTrip`, `groupRepeat`, `routing`, `deriveLanguages`. Keep/adjust our `store`, `forms-routes`, migration, and web `FormRuntime`/`FormCapture` tests. New sample-forms tests (parse + Questionnaire export). Gate: `pnpm turbo typecheck lint test build` + `pnpm depcruise` green.

## Out of Scope (SP-A)

Three-pane builder, Edit Field sheet, live Preview rich widgets, sections/groups editing UX, language-tab UX, lifecycle ⋯ parity, AMR capture widgets' UI (the model + ValueSet binding exist; the rich capture widget is SP-D), Facilities page itself.

## Risks

| Risk | Mitigation |
| --- | --- |
| Engine port drift from Corlix semantics | Port test suite first; round-trip tests pin behavior |
| `@openldr/fhir` lacks builders Corlix relies on | Inventory gaps during plan; add minimal builders in `@openldr/fhir` |
| Browser bundle pulls server code (node:crypto) | Keep `pure.ts` browser-safe subpath + `sideEffects:false` (already established) |
| Field-type breadth (organism/antibiogram/facility/attachment) | SP-A only needs model + converter + basic runtime control; rich widgets deferred to SP-D |
| Web tests churn | Expect to rewrite forms-runtime + builder tests; that's in scope |

## Done Criteria

- New zod model matches Corlix's `FormSchema`/`FormField` shape (17 types, flat fields, locale translations, rich visibility, form-level FHIR metadata).
- `toQuestionnaire`/`fromQuestionnaire` round-trip the sample forms; extraction, visibility, binding-strength, i18n, group-repeat, routing tests pass (ported).
- Migration 020 applied; store + server round-trip the new form-level fields.
- `forms-runtime` renders + validates the 17 types (basic) and `FormCapture` works; builder trimmed to a buildable minimal editor.
- `pnpm turbo typecheck lint test build` + `pnpm depcruise` green.
