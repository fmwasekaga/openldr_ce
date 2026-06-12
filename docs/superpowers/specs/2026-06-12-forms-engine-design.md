# Sub-project 3 — Forms-from-Templates Engine (headless)

**Date:** 2026-06-12
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase1.md` — P1-FORM-1/2/3 (the engine; capture *screens* deferred to the UI sub-project), the `fhir validate <form>` slice of P1-CLI-1, P1-NFR-4 (i18n)
**Build-sequence step:** §8 step 3

---

## 1. Purpose & scope

Deliver `@openldr/forms` — a pure, **headless** forms engine that reimplements the proven Corlix `fhir-forms` design (§10: reimplement, never copy). It lets a form be authored as a friendly `FormSchema`, converted losslessly to/from a canonical **FHIR Questionnaire**, filled into a **QuestionnaireResponse**, validated, and **extracted** (SDC-style) into discrete FHIR R4 resources bundled as a transaction.

CE forms are FHIR-native: the canonical template is a FHIR `Questionnaire`; a filled form is a `QuestionnaireResponse`; submitting a form yields FHIR domain resources (Patient, ServiceRequest, Observation, …) — the same resources the ingest pipeline and the storage/flattening layer (2b) already handle. This is why a form authored here can run in Corlix and a `QuestionnaireResponse` captured at a Corlix edge can be submitted to CE (§1 Relationship to Corlix).

**In scope (3):**
- `@openldr/forms` package: `FormSchema` model; `FormSchema ↔ Questionnaire` lossless conversion; `QuestionnaireResponse` build/parse; answer validation; visibility (enableWhen); i18n (en/fr/pt form text); SDC extraction → FHIR resources; transaction Bundle; sample forms.
- Add `Questionnaire` + `QuestionnaireResponse` zod schemas to `@openldr/fhir` (registered).
- CLI: `openldr fhir validate <form>` (Questionnaire/QR) + `openldr forms extract <questionnaire> <response> [--json]`.

**Out of scope (deferred):**
- React capture *screens* (P1-FORM-2 UI — Facilities/Patients/Orders/Users) → the SPA-shell / UI sub-project (`apps/web` was deferred in sub-project 1). This engine is their prerequisite.
- Persisting extracted resources → the ingest pipeline (§8 step 4) calls `@openldr/db` `persistResource`; `@openldr/forms` stays pure and does not import `@openldr/db`.
- A full FHIRPath evaluator (a simple dotted-path setter is used instead — see §9).
- Terminology/ValueSet binding beyond `options` lists; LOINC/SNOMED expansion (later terminology sub-project).

---

## 2. Cross-cutting principles this sub-project demonstrates

- **DP-6 FHIR R4 native** — canonical template is FHIR Questionnaire; capture is QuestionnaireResponse; extraction yields FHIR resources.
- **DP-4 Agent-operability** — `openldr forms extract --json` and `fhir validate <form>` are agent-inspectable.
- **DP-5 Lean** — hand-written zod; dotted-path extraction instead of a FHIRPath engine.
- **P1-NFR-4 i18n** — form text is multilingual (en/fr/pt) with English fallback.

---

## 3. Package `@openldr/forms`

Domain module package. Depends on `@openldr/fhir` (Questionnaire/QR/resource types + `validateResource`) and `@openldr/core` (errors). Pure/headless: **no** `@openldr/db`, no adapters, no React. dependency-cruiser already forbids domain modules from importing `adapter-*`/`apps/*`; `forms → db` is also disallowed by the design (kept out by not declaring the dependency).

```
packages/forms/src/
├─ schema/form-schema.ts     # FormSchema, FormSection, FormField, types, VisibilityRule, FieldOption (zod + z.infer)
├─ extensions.ts             # EXT_OPENLDR_* extension URL constants
├─ to-questionnaire.ts       # FormSchema → Questionnaire
├─ from-questionnaire.ts     # Questionnaire → FormSchema (lossless inverse)
├─ answer-value.ts           # answer ↔ typed value per field type
├─ response.ts               # buildResponse(form, answers) ; parseResponse(qr)
├─ validate-answers.ts       # validateAnswers(form, answers) → OperationOutcome | ok
├─ visibility.ts             # computeVisibility(form, answers) → Map<fieldId, boolean>
├─ i18n.ts                   # resolveText(node, lang) ; deriveLanguages(form)
├─ extract/
│  ├─ context.ts             # ExtractionContext, ResourceExtractor
│  ├─ set-path.ts            # setPath(obj, dottedPath, value) pure helper
│  ├─ extract.ts             # extractResources(qr, questionnaire, ctx) → FhirResource[]
│  └─ index.ts
├─ to-bundle.ts              # toTransactionBundle(resources) → Bundle
├─ samples/forms.ts          # patientIntakeForm(), requisitionForm()
└─ index.ts
```

---

## 4. FormSchema model

zod schemas with `z.infer` types.

```ts
type FieldType =
  | 'string' | 'text' | 'integer' | 'decimal' | 'boolean'
  | 'date' | 'dateTime' | 'choice' | 'open-choice' | 'reference' | 'quantity';

interface TranslatableText { en: string; fr?: string; pt?: string; }

interface FieldOption { code: string; display: TranslatableText; system?: string; }

interface VisibilityRule { whenField: string; equals: string | number | boolean; } // field shown only when whenField's answer matches

interface FormField {
  id: string;
  type: FieldType;
  label: TranslatableText;
  required?: boolean;
  repeats?: boolean;
  cardinality?: { min?: number; max?: number };   // P1-FORM-3 repetition
  options?: FieldOption[];                          // choice/open-choice
  visibility?: VisibilityRule;                      // enableWhen
  fhirPath?: string;                                // dotted path into the section's resource (extraction)
  observationExtract?: boolean;                     // field becomes a standalone Observation
  code?: { system?: string; code: string; display?: string }; // Observation.code / answer coding
  unit?: string;                                    // quantity unit
}

interface FormSection {
  id: string;
  title: TranslatableText;
  resourceType?: 'Patient' | 'ServiceRequest' | 'Specimen' | 'Organization' | 'Location' | 'DiagnosticReport';
  repeats?: boolean;
  fields: FormField[];
}

interface FormSchema {
  id: string;
  name: string;
  title: TranslatableText;
  status: 'draft' | 'active' | 'retired';
  languages: ('en' | 'fr' | 'pt')[];
  sections: FormSection[];
}
```

`FormSchemaSchema` (zod) validates structure: unique `id`s, choice fields require `options`, observation-extract fields require `code`, etc.

---

## 5. FormSchema ↔ FHIR Questionnaire (lossless)

The CE metadata that doesn't map to a standard Questionnaire field rides in **consolidated `@openldr`-namespaced JSON extensions** (`extensions.ts`): `EXT_OPENLDR_FORM` (on the Questionnaire — form-level meta: id, name, title, status, languages), `EXT_OPENLDR_SECTION` (on each group item — the section minus its fields), `EXT_OPENLDR_FIELD` (on each leaf item — the full `FormField` as JSON). This makes the round-trip lossless by construction while keeping the Questionnaire natively renderable.

`toQuestionnaire(form): Questionnaire`:
- `status`, `name`, `title` (English) → Questionnaire fields; form-level meta → `EXT_OPENLDR_FORM` (valueString JSON).
- each `FormSection` → a `group` `QuestionnaireItem` (`linkId = section.id`, `text` = English title, `repeats`); the section meta → `EXT_OPENLDR_SECTION` (valueString JSON).
- each `FormField` → a leaf `QuestionnaireItem` (`linkId = field.id`, native `type`, English `text`, `required`, `repeats`, `answerOption` from `options` with English displays, `enableWhen` from `visibility`); the full field → `EXT_OPENLDR_FIELD` (valueString JSON), which also carries `fhirPath`/`observationExtract`/`code`/`unit`/`cardinality`/translations.

`fromQuestionnaire(q): FormSchema` is the exact inverse: it reconstructs the `FormSchema` from the `EXT_OPENLDR_FORM`/`SECTION`/`FIELD` JSON (the native item fields are for FHIR renderers, not reconstruction). Extraction (§9) reads the same `EXT_OPENLDR_FIELD`/`SECTION` JSON for `resourceType`/`fhirPath`/`observationExtract`.

**Lossless guarantee** (property): `fromQuestionnaire(toQuestionnaire(form))` deep-equals `form` for every sample form.

Field-type ↔ Questionnaire-item-type map (e.g. `string→string`, `text→text`, `integer→integer`, `decimal→decimal`, `boolean→boolean`, `date→date`, `dateTime→dateTime`, `choice→choice`, `open-choice→open-choice`, `reference→reference`, `quantity→quantity`) lives in `answer-value.ts`/`to-questionnaire.ts`.

---

## 6. QuestionnaireResponse capture + answer validation

- `Answers = Record<fieldId, AnswerValue | AnswerValue[]>` where `AnswerValue` is a typed union (`{ string }`, `{ integer }`, `{ coding }`, `{ quantity }`, …).
- `buildResponse(form, answers, meta?): QuestionnaireResponse` — mirrors the Questionnaire item tree, writing each answer as the correct `value[x]` (`answer-value.ts` `toAnswer`). `meta` supplies `status`, `subject`, `authored`.
- `parseResponse(qr): Answers` — inverse (`fromAnswer`).
- `validateAnswers(form, answers): { ok: true } | { ok: false; outcome: OperationOutcome }`:
  - required field missing (and visible) → issue;
  - value type mismatch for the field type → issue;
  - choice value not in `options` → issue;
  - cardinality (`min`/`max`) violated for a repeating field → issue.
  Reuses `@openldr/fhir`'s `OperationOutcome` builders.

---

## 7. Visibility / enableWhen

`computeVisibility(form, answers): Map<fieldId, boolean>` — a field with a `VisibilityRule` is visible only when `answers[whenField]` equals `rule.equals`; fields without a rule are always visible. Hidden fields are excluded from `validateAnswers` (no required-error on a hidden field) and from extraction. On conversion, a `VisibilityRule` becomes Questionnaire `enableWhen` (single-condition, operator `=`).

---

## 8. i18n (multilingual form text)

`TranslatableText { en, fr?, pt? }`. `resolveText(node, lang)` returns the requested language or falls back to `en`. `deriveLanguages(form)` returns the set of languages any text provides. On conversion, non-English text is carried in `EXT_OPENLDR_TRANSLATIONS` so the Questionnaire round-trips multilingually; the Questionnaire's primary `text` is always English.

---

## 9. SDC extraction → resources → transaction Bundle

No FHIRPath engine. `set-path.ts` `setPath(obj, 'name.0.family', value)` writes a value at a dotted path, creating intermediate objects/arrays (pure, unit-tested).

`extract/context.ts`:
```ts
interface ExtractionContext { subject?: Reference; authored?: string; }
interface ResourceExtractor { extract(qr, questionnaire, ctx): FhirResource[]; }
```

`extractResources(qr, questionnaire, ctx): FhirResource[]`:
- index the Questionnaire items (linkId → metadata: section `resourceType`, field `fhirPath`/`observationExtract`/`code`/`unit`).
- for each **section group** with a `resourceType`: build one resource `{ resourceType, id: <generated> }`; for each answered, non-observation field with a `fhirPath`, `setPath(resource, fhirPath, value)`; attach `ctx.subject` to `subject` where the resource supports it.
- for each `observationExtract` field with an answer: emit an `Observation` `{ status:'final', code, subject: ctx.subject, value[x], effectiveDateTime: ctx.authored }`.
- collect all resources; **validate each** via `@openldr/fhir.validateResource` (drop/flag invalid with an `OperationOutcome` — surfaced, not silently dropped).

`to-bundle.ts` `toTransactionBundle(resources): Bundle` — `{ resourceType:'Bundle', type:'transaction', entry: resources.map(r => ({ resource: r, request: { method:'POST', url: r.resourceType } })) }`.

`@openldr/forms` produces these; the **CLI/ingest** persists them (forms stays pure).

---

## 10. `@openldr/fhir` additions + CLI

- **`@openldr/fhir`** gains `resources/questionnaire.ts` and `resources/questionnaire-response.ts` — zod schemas (recursive `item` via `z.lazy`), `.passthrough()`, required cardinality (`Questionnaire.status`; `QuestionnaireResponse.status`; item `linkId`+`type` / `linkId`), registered into the resource registry. This makes `openldr fhir validate <questionnaire.json>` work (P1-CLI-1 `<resource|form>`).
- **CLI** (`@openldr/cli`) gains a `forms` group: `openldr forms extract <questionnaire.json> <response.json> [--json]` — loads the Questionnaire + QuestionnaireResponse, runs `extractResources`, and prints either a summary of extracted resource types (human) or, with `--json`, the full transaction Bundle + any validation outcomes. Pure (no infra/config needed).

---

## 11. Testing & acceptance

**Unit (no infra)**
- `FormSchemaSchema` validation: rejects a choice field without options, an observation-extract field without `code`, duplicate ids.
- **Lossless round-trip**: for each sample form, `fromQuestionnaire(toQuestionnaire(form))` deep-equals `form`; `toQuestionnaire(form).resourceType === 'Questionnaire'` with items.
- `buildResponse`/`parseResponse` round-trip a set of answers.
- `validateAnswers`: missing-required, wrong-type, bad-choice, cardinality cases each yield the right issue; a hidden (visibility-false) required field does **not** error.
- `computeVisibility`: a dependent field toggles with its controller's answer.
- `resolveText`: returns fr/pt when present, falls back to en; `deriveLanguages`.
- `setPath`: nested object + array index paths.
- Extraction: a filled patient-intake QR → a valid `Patient`; a requisition QR → a valid `ServiceRequest` (+ Observations for observation-extract fields); every extracted resource passes `validateResource`; `toTransactionBundle` shape correct.
- `@openldr/fhir`: `Questionnaire`/`QuestionnaireResponse` validate (valid sample passes; missing `status` fails); registered in the registry.

**Integration / CLI**
- `openldr fhir validate <sample-questionnaire.json>` → exit 0; a malformed one → exit 1 naming the issue.
- `openldr forms extract <questionnaire.json> <response.json> --json` → emits a transaction Bundle whose entries are valid Patient/ServiceRequest/Observation; exit 0.

**Gate**
- `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green; `depcruise` confirms `@openldr/forms` imports only `@openldr/fhir`/`@openldr/core` (no adapter/app/db).

---

## 12. Acceptance criteria checklist

- [ ] `@openldr/forms` headless engine; imports only `fhir`/`core` (P1-FORM-1).
- [ ] `FormSchema` model with group types + repetition (P1-FORM-3).
- [ ] Lossless `FormSchema ↔ Questionnaire` round-trip via `@openldr` extensions.
- [ ] `QuestionnaireResponse` build/parse + `validateAnswers` (required/type/option/cardinality).
- [ ] Visibility/enableWhen excludes hidden fields from validation + extraction.
- [ ] i18n: en/fr/pt form text with English fallback (P1-NFR-4).
- [ ] SDC extraction → valid FHIR resources (via `validateResource`) → transaction Bundle.
- [ ] `Questionnaire` + `QuestionnaireResponse` added to `@openldr/fhir` + `fhir validate <form>` works.
- [ ] `openldr forms extract` produces a valid transaction Bundle (DP-4).
- [ ] Full gate green; dependency-cruiser clean.

---

## 13. Open items carried forward (not blocking 3)

- React template-driven capture screens (P1-FORM-2 UI) → UI/SPA-shell sub-project, consuming this engine.
- Persist-on-submit (extracted resources → `persistResource`) → ingest pipeline (§8 step 4).
- Full FHIRPath evaluation, calculated/derived fields, complex multi-condition enableWhen → later if a form needs them.
- Terminology binding (LOINC/SNOMED ValueSet expansion) for `options` → terminology sub-project.
- License headers pending company/legal sign-off (§9).
