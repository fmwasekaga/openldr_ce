# Forms Corlix-Model Parity — SP-A (Engine + Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@openldr/forms`'s nested form model with a faithful port of Corlix's flat `FormSchema`/`FormField` model and its headless `fhir-forms` engine, keeping db/server/web compiling, building, and green — without the rich builder UI.

**Architecture:** Port Corlix's `packages/fhir-forms` engine + the form types from `packages/shared-types` into `@openldr/forms`, expressed as zod schemas. Converters emit/consume FHIR R4 objects typed against the `fhir` npm types package (types-only); the store persists the schema + Questionnaire as JSON, and `@openldr/fhir` validates the produced resources. `forms-runtime` is rewritten for the new model so `/forms` capture still works; the current builder is trimmed to a buildable minimal editor (rich Corlix builder is SP-B–F).

**Tech Stack:** TypeScript, zod, `fhir` (R4 types), Vitest, Kysely migrations, React/Vite, Fastify inject tests.

**Reference (read-only, do not import):**
- Model: `D:/Projects/Repositories/corlix/packages/shared-types/src/index.ts` (~L841–1010).
- Engine: `D:/Projects/Repositories/corlix/packages/fhir-forms/src/*` (modules + `*.test.ts`).
- Page targets: `D:/Projects/Repositories/corlix/apps/desktop/src/shared/page-targets.ts`.
- Spec: `docs/superpowers/specs/2026-06-19-forms-corlix-model-sp-a-design.md`.

**Porting convention (applies to every "port" task):** open the named Corlix source file, copy its logic into the target file, and apply these adaptations: (a) replace `@corlix/shared-types` imports with `@openldr/forms` schema types; (b) keep `from 'fhir/r4'` type imports as-is; (c) replace `@corlix/fhir`/Corlix-internal helpers with the sibling module ported in an earlier task; (d) keep exported function names identical to Corlix unless this plan says otherwise. Port the matching Corlix `*.test.ts` first (TDD), adapting import paths only.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/forms/package.json` | Add `fhir` (R4 types) dependency |
| `packages/forms/src/schema/form-schema.ts` | New zod model (Corlix `FormSchema`/`FormField`/…) |
| `packages/forms/src/extensions.ts` | Corlix extension URL constants |
| `packages/forms/src/scalar-types.ts` | fieldType ↔ Questionnaire item.type + status |
| `packages/forms/src/coding.ts` | `FormFieldCoding` ↔ FHIR `Coding` helpers |
| `packages/forms/src/binding-strength.ts` | `BindingStrength` ↔ extension helpers |
| `packages/forms/src/translations.ts` | base + locale `translations` ↔ FHIR translation extension |
| `packages/forms/src/derive-languages.ts` | derive `languages[]` from field translations |
| `packages/forms/src/visibility.ts` | evaluate `VisibilityRule`; `toEnableWhen` |
| `packages/forms/src/answer-value.ts` | per-type answer value ↔ `QuestionnaireResponseItemAnswer` |
| `packages/forms/src/to-questionnaire.ts` | model → FHIR R4 Questionnaire |
| `packages/forms/src/from-questionnaire.ts` | Questionnaire → model |
| `packages/forms/src/response.ts` | answers → QuestionnaireResponse |
| `packages/forms/src/from-response.ts` | QuestionnaireResponse → answers |
| `packages/forms/src/extract/extract.ts` | extraction + `to-transaction-bundle` |
| `packages/forms/src/routing.ts` | resource routing (extractor selection) |
| `packages/forms/src/page-targets.ts` | OpenLDR page-target registry + contract validation |
| `packages/forms/src/samples/forms.ts` | re-authored sample forms (Facility, Users) |
| `packages/forms/src/lint.ts` | lint on new model (incl. target contract) |
| `packages/forms/src/diff.ts` | diff on new model |
| `packages/forms/src/lifecycle.ts` | publish/version/content-change on new model |
| `packages/forms/src/normalize.ts` | normalize raw → new model defaults |
| `packages/forms/src/store.ts` | version-aware store mapping new fields |
| `packages/forms/src/index.ts` / `pure.ts` | exports (server + browser-safe) |
| `packages/db/src/migrations/internal/020_form_fhir_metadata.ts` (+ `.test.ts`, `index.ts`) | add `fhir_version`/`fhir_profile_url`/`facility_id` |
| `packages/db/src/schema/internal.ts` | column types for new fields |
| `apps/server/src/forms-routes.ts` (+ test) | input/mapping for new form-level fields |
| `apps/web/src/api.ts` (+ `api.forms.test.ts`) | client form types |
| `apps/web/src/forms-runtime/{types,runtime,FormRuntime}.tsx` (+ tests) | render/validate new model |
| `apps/web/src/pages/FormCapture.tsx` (+ test) | capture on new runtime |
| `apps/web/src/forms-builder/*` (+ tests) | trimmed buildable minimal editor |

---

## Task 1: FHIR R4 Types Dependency

**Files:** Modify `packages/forms/package.json`.

- [ ] **Step 1: Add the `fhir` types package**

Run: `pnpm --filter @openldr/forms add fhir`

Expected: `packages/forms/package.json` `dependencies` gains `"fhir": "^<resolved>"` and `pnpm-lock.yaml` updates. (The `fhir` package provides `fhir/r4` TypeScript types used by every converter; it has negligible runtime.)

- [ ] **Step 2: Verify the type import resolves**

Create `packages/forms/src/fhir-r4.smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Questionnaire } from 'fhir/r4';

describe('fhir/r4 types', () => {
  it('is importable as a plain object shape', () => {
    const q: Questionnaire = { resourceType: 'Questionnaire', status: 'active' };
    expect(q.resourceType).toBe('Questionnaire');
  });
});
```

Run: `pnpm --filter @openldr/forms test fhir-r4.smoke && pnpm --filter @openldr/forms typecheck`
Expected: PASS and clean typecheck.

- [ ] **Step 3: Commit**

```bash
git add packages/forms/package.json pnpm-lock.yaml packages/forms/src/fhir-r4.smoke.test.ts
git -c commit.gpgsign=false commit -m "build(forms): add fhir r4 types dependency"
```

---

## Task 2: New Form Model (zod schema)

**Files:** Replace `packages/forms/src/schema/form-schema.ts`; Test `packages/forms/src/schema/form-schema.test.ts`.

This is the foundational breaking change. Mirror Corlix `shared-types` (spec §1) as zod. Old exported names (`FormField`, `FormSection`, `FormSchema`, `FieldType`) are reused with the NEW shape.

- [ ] **Step 1: Write the failing schema test**

Create `packages/forms/src/schema/form-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FormSchema, FormField, FieldType } from './form-schema';

const field = {
  id: 'name', fhirPath: 'name', displayLabel: 'Name', description: null,
  fieldType: 'text', required: true, enabled: true, order: 0,
  cardinality: { min: 0, max: '1' },
};

describe('form-schema (corlix model)', () => {
  it('accepts the full 17-type union', () => {
    for (const t of ['text','number','date','datetime','boolean','select','multiselect','phone','email','address','identifier','attachment','organism','antibiogram','reference','facility','group']) {
      expect(FieldType.parse(t)).toBe(t);
    }
  });

  it('parses a flat field with corlix props', () => {
    const parsed = FormField.parse({ ...field, code: [{ system: 'http://loinc.org', code: '1234-5' }], translations: { fr: { label: 'Nom' } }, visibility: { combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] } });
    expect(parsed.fieldType).toBe('text');
    expect(parsed.code?.[0].code).toBe('1234-5');
    expect(parsed.translations?.fr.label).toBe('Nom');
    expect(parsed.visibility?.conditions[0].operator).toBe('isNotEmpty');
  });

  it('parses a flat FormSchema with form-level FHIR metadata', () => {
    const schema = FormSchema.parse({
      id: 'facility', name: 'Facility', versionLabel: '1.0.0',
      fhirVersion: 'R4', fhirResourceType: 'Location', fhirProfileUrl: null, facilityId: null,
      fields: [field], sections: [], targetPages: ['facilities'], languages: ['fr'],
      version: 1, active: true, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(schema.fhirResourceType).toBe('Location');
    expect(schema.fields[0].id).toBe('name');
  });

  it('rejects an unknown field type', () => {
    expect(() => FormField.parse({ ...field, fieldType: 'bogus' })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/forms test form-schema`
Expected: FAIL (new exports/shape absent).

- [ ] **Step 3: Implement the zod model**

Replace `packages/forms/src/schema/form-schema.ts` with zod schemas for every type in spec §1: `FieldType` (17-member `z.enum`), `FormFieldConstraints`, `FormFieldOption`, `FormFieldCoding`, `VisibilityOperator`, `VisibilityCondition`, `VisibilityRule`, `BindingStrength`, `FormField` (all props from spec §1; `fhirPath: z.string().nullable()`, `cardinality: z.object({min:z.number(), max:z.string()})`, `translations: z.record(z.object({label:z.string().optional(), description:z.string().optional()})).optional()`, etc.), `FormSection`, `FormStatus`, `FormSchema`. Export both the zod object and `z.infer` type under each name (e.g. `export const FormField = z.object({...}); export type FormField = z.infer<typeof FormField>;`).

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `pnpm --filter @openldr/forms test form-schema && pnpm --filter @openldr/forms typecheck`
Expected: schema test PASS. Typecheck will FAIL in other modules (they use the old shape) — that is expected; later tasks fix them. Confirm only `form-schema.test.ts` passes for now.

- [ ] **Step 5: Commit**

```bash
git add packages/forms/src/schema/form-schema.ts packages/forms/src/schema/form-schema.test.ts
git -c commit.gpgsign=false commit -m "feat(forms): adopt corlix flat form model schema"
```

---

## Task 3: Extension Constants

**Files:** Create `packages/forms/src/extensions.ts` (replacing the old one); Test `packages/forms/src/extensions.test.ts`.

- [ ] **Step 1: Port test** — port Corlix usages: assert the constant URLs (`EXT_TRANSLATION`, `EXT_CORLIX_SECTION`, `EXT_CORLIX_FHIR_PATH`, `EXT_QUESTIONNAIRE_UNIT`, `EXT_SDC_OBSERVATION_EXTRACT`, binding-strength + valueset-options extension URLs) equal the exact strings in Corlix `packages/fhir-forms/src/extensions.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { EXT_SDC_OBSERVATION_EXTRACT, EXT_QUESTIONNAIRE_UNIT } from './extensions';
describe('extensions', () => {
  it('uses the SDC observation-extract url', () => {
    expect(EXT_SDC_OBSERVATION_EXTRACT).toBe('http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationExtract');
  });
  it('uses the standard questionnaire unit url', () => {
    expect(EXT_QUESTIONNAIRE_UNIT).toBe('http://hl7.org/fhir/StructureDefinition/questionnaire-unit');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @openldr/forms test extensions` → FAIL.
- [ ] **Step 3: Port `extensions.ts`** verbatim from Corlix `packages/fhir-forms/src/extensions.ts` (constants only; no adaptation needed).
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test extensions` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/extensions.ts packages/forms/src/extensions.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port form extension constants"`

---

## Task 4: Scalar Types (fieldType ↔ Questionnaire item.type)

**Files:** Create `packages/forms/src/scalar-types.ts`; Test `packages/forms/src/scalar-types.test.ts`.

- [ ] **Step 1: Port `scalarTypes.test.ts`** from Corlix (adapt import path to `./scalar-types`). It asserts `nativeItemType`, `fieldTypeNeedsHint`, `toQStatus`/`fromQStatus`, `reverseFieldType` for each of the 17 types (per spec §7 mapping).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `scalar-types.ts`** from Corlix `scalarTypes.ts` (apply porting convention; types from `./form-schema`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/scalar-types.ts packages/forms/src/scalar-types.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port field-type to questionnaire mapping"`

---

## Task 5: Coding + Binding Strength

**Files:** Create `packages/forms/src/coding.ts`, `packages/forms/src/binding-strength.ts`; Tests alongside.

- [ ] **Step 1: Port `coding.test.ts` and `bindingStrength.test.ts`** (adapt paths to `./coding`, `./binding-strength`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `coding.ts` and `bindingStrength.ts`** from Corlix (both have no external deps beyond fhir types/constants).
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test coding binding-strength` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/coding.ts packages/forms/src/coding.test.ts packages/forms/src/binding-strength.ts packages/forms/src/binding-strength.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port coding and binding-strength helpers"`

---

## Task 6: Translations + Derive Languages

**Files:** Create `packages/forms/src/translations.ts`, `packages/forms/src/derive-languages.ts`; Tests alongside.

- [ ] **Step 1: Port `i18n.test.ts` (→ translations) and `deriveLanguages.test.ts`** (adapt paths). They cover `translationElement`/`parseTranslations`/`hasKeys` and `deriveLanguagesFromTranslations`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `translations.ts` and `deriveLanguages.ts`** (translations depends on `./extensions`; derive-languages on `./form-schema`).
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test translations derive-languages` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/translations.ts packages/forms/src/translations.test.ts packages/forms/src/derive-languages.ts packages/forms/src/derive-languages.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port translations and language derivation"`

---

## Task 7: Visibility (evaluator + enableWhen)

**Files:** Replace `packages/forms/src/visibility.ts`; Test `packages/forms/src/visibility.test.ts`.

- [ ] **Step 1: Port `visibility.test.ts`** from Corlix `visibility.test.ts` — covers all operators (`equals/notEquals/oneOf/isEmpty/isNotEmpty/gt/lt/gte/lte`) and `combinator: all|any`. Add one test asserting `toEnableWhen(rule)` produces FHIR `QuestionnaireItemEnableWhen[]` + the enable-behavior.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `visibilityMap.ts` → `visibility.ts`.** Export the runtime evaluator (e.g. `evaluateVisibility(rule, answers): boolean` and a `visibleFieldIds(schema, answers): Set<string>` helper used by the runtime) plus `toEnableWhen`/`fromEnableWhen`. (Corlix splits map vs evaluate; keep both, named per Corlix.)
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test visibility` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/visibility.ts packages/forms/src/visibility.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port visibility rule engine"`

---

## Task 8: Answer Value Mapping

**Files:** Replace `packages/forms/src/answer-value.ts`; Test `packages/forms/src/answer-value.test.ts`.

- [ ] **Step 1: Write a focused test** for `toAnswer`/`fromAnswer` round-tripping a value per scalar group (string, integer, decimal, boolean, date, dateTime, coding/choice, reference, quantity) → `QuestionnaireResponseItemAnswer` and back. (Corlix exercises these inside `capture.test.ts`; create `answer-value.test.ts` with one assertion per group, mirroring those cases.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `answerValue.ts` → `answer-value.ts`** (types from `./form-schema`; `AnswerState` type preserved).
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test answer-value` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/answer-value.ts packages/forms/src/answer-value.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port answer-value mapping"`

---

## Task 9: to-Questionnaire

**Files:** Replace `packages/forms/src/to-questionnaire.ts`; Test `packages/forms/src/to-questionnaire.test.ts`.

- [ ] **Step 1: Port `toQuestionnaire.test.ts`** (adapt paths). Covers group nesting, `item.code`, `answerValueSet` + strength, `enableWhen`, repeats/cardinality, unit + translation extensions.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `toQuestionnaire.ts`** — deps: `./scalar-types`, `./visibility` (`toEnableWhen`), `./translations`, `./coding`, `./binding-strength`, `./extensions`, types `./form-schema`. Output typed `Questionnaire` from `fhir/r4`.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test to-questionnaire` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/to-questionnaire.ts packages/forms/src/to-questionnaire.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port model to FHIR Questionnaire"`

---

## Task 10: from-Questionnaire + Round-Trip

**Files:** Replace `packages/forms/src/from-questionnaire.ts`; Tests `from-questionnaire.test.ts`, `round-trip.test.ts`.

- [ ] **Step 1: Port `fromQuestionnaire.test.ts` and `roundTrip.test.ts`** (adapt paths). Round-trip asserts `fromQuestionnaire(toQuestionnaire(form))` deep-equals the normalized form for representative templates.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `fromQuestionnaire.ts`** — deps `./scalar-types`, `./translations`, `./derive-languages`, `./extensions`, types.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test from-questionnaire round-trip` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/from-questionnaire.ts packages/forms/src/from-questionnaire.test.ts packages/forms/src/round-trip.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port FHIR Questionnaire to model + round-trip"`

---

## Task 11: Response Converters

**Files:** Create `packages/forms/src/response.ts` (replace old), `packages/forms/src/from-response.ts`; Test `packages/forms/src/capture.test.ts`.

- [ ] **Step 1: Port `capture.test.ts`** (adapt paths) — answers → `QuestionnaireResponse` → answers.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `toQuestionnaireResponse.ts` → `response.ts` and `fromQuestionnaireResponse.ts` → `from-response.ts`** (deps `./answer-value`, `./extensions`).
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test capture` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/response.ts packages/forms/src/from-response.ts packages/forms/src/capture.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port questionnaire-response converters"`

---

## Task 12: Extraction + Routing

**Files:** Replace `packages/forms/src/extract/extract.ts`; Create `packages/forms/src/to-transaction-bundle.ts`, `packages/forms/src/routing.ts`; Tests `extraction.test.ts`, `routing.test.ts`, `group-repeat.test.ts`.

- [ ] **Step 1: Port `extraction.test.ts`, `routing.test.ts`, `groupRepeat.test.ts`** (adapt paths).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port `extractors.ts` → `extract/extract.ts`, `toTransactionBundle.ts` → `to-transaction-bundle.ts`, `routing.ts`** (deps `./answer-value`, `./extensions`, `./form-schema`). Keep `ObservationExtractor`/`ServiceRequestExtractor`/`ResourceExtractor` names.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test extraction routing group-repeat` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/extract packages/forms/src/to-transaction-bundle.ts packages/forms/src/routing.ts packages/forms/src/extraction.test.ts packages/forms/src/routing.test.ts packages/forms/src/group-repeat.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): port extraction and resource routing"`

---

## Task 13: OpenLDR Page-Target Registry

**Files:** Create `packages/forms/src/page-targets.ts`; Test `packages/forms/src/page-targets.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { PAGE_TARGETS, getPageTarget, validateTemplateTargets } from './page-targets';
import type { FormField } from './schema/form-schema';

const field = (over: Partial<FormField>): FormField => ({ id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text', required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over });

describe('page targets', () => {
  it('exposes forms/users/facilities', () => {
    expect(PAGE_TARGETS.map((p) => p.id)).toEqual(['forms', 'users', 'facilities']);
    expect(getPageTarget('users')?.requiredKeys).toContain('email');
  });
  it('reports missing required keys for a target page', () => {
    const violations = validateTemplateTargets(['facilities'], [field({ apiProperty: undefined })]);
    expect(violations[0]).toMatchObject({ pageId: 'facilities', missing: ['name'] });
  });
  it('passes when an enabled field supplies the key', () => {
    expect(validateTemplateTargets(['facilities'], [field({ apiProperty: 'name' })])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — port the `PageTarget`/`PageMatch`/`TargetContractViolation` types + `getPageTarget`/`validateTemplateTargets` from Corlix `page-targets.ts`, but set `PAGE_TARGETS` to the OpenLDR registry (spec §3): `forms` (match `fieldId`, requiredKeys `[]`), `users` (match `apiProperty`, `['firstName','lastName','email','roles']`), `facilities` (match `apiProperty`, `['name']`). Import `FormField` from `./schema/form-schema`.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test page-targets` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/page-targets.ts packages/forms/src/page-targets.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): add openldr page-target registry"`

---

## Task 14: Sample Forms

**Files:** Replace `packages/forms/src/samples/forms.ts`; Test `packages/forms/src/samples/forms.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { sampleForms } from './forms';
import { FormSchema } from '../schema/form-schema';
import { toQuestionnaire } from '../to-questionnaire';

describe('sample forms', () => {
  it('parse against the schema and export to Questionnaire', () => {
    expect(sampleForms.length).toBeGreaterThanOrEqual(2);
    for (const form of sampleForms) {
      const parsed = FormSchema.parse(form);
      const q = toQuestionnaire(parsed);
      expect(q.resourceType).toBe('Questionnaire');
    }
  });
  it('includes a Facility (Location) form targeting facilities', () => {
    const facility = sampleForms.find((f) => f.fhirResourceType === 'Location');
    expect(facility?.targetPages).toContain('facilities');
    expect(facility?.fields.some((x) => x.apiProperty === 'name')).toBe(true);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — author `sampleForms: FormSchema[]` on the new model: (1) a **Facility** form (Location resource, targetPages `['facilities']`, fields Name/Local ID/MFL ID/Level(select)/Country/District/Region/Phone with `apiProperty`/`fhirPath` per the Corlix screenshot), (2) a **Users** form (targetPages `['users']`, fields firstName/lastName/email/roles with matching `apiProperty`). Use Corlix `packages/fhir-forms/src/samples/forms.ts` as the reference for field shapes.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test samples/forms` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): re-author sample forms on new model"`

---

## Task 15: Rewrite lint / diff / lifecycle / normalize

**Files:** Replace `packages/forms/src/{lint,diff,lifecycle,normalize}.ts`; update their `.test.ts`.

- [ ] **Step 1: Update tests** — rewrite each test for the new model:
  - `normalize.test.ts`: `normalizeFormSchema(raw)` fills defaults (`order`, `cardinality`, `enabled:true`, `targetPages:[]`, derives `languages` from translations) and parses via `FormSchema`.
  - `lint.test.ts`: duplicate field id, dangling visibility (`condition.fieldId` missing), `select`/`multiselect` without `valueSetOptions`/`valueSetUrl`, `group` child whose `groupId` has no group field, and a target-contract violation (via `validateTemplateTargets`) each surface a `FormLintIssue`.
  - `diff.test.ts`: metadata/section/field add/remove/change on the flat model.
  - `lifecycle.test.ts`: `computeNextFormVersion`, `makeDuplicateName`, `formContentChanged` over the new `FormSchema` (compare `fields`/`sections`/form-level fields).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — rewrite the four modules for the flat model. `lint` imports `validateTemplateTargets` from `./page-targets`. Keep public names (`lintFormSchema`, `FormLintIssue`, `diffFormSchemas`, `FormSchemaDiff`, `computeNextFormVersion`, `makeDuplicateName`, `formContentChanged`, `normalizeFormSchema`).
- [ ] **Step 4: Run** — `pnpm --filter @openldr/forms test lint diff lifecycle normalize` → PASS.
- [ ] **Step 5: Commit** — `git add packages/forms/src/lint.ts packages/forms/src/lint.test.ts packages/forms/src/diff.ts packages/forms/src/diff.test.ts packages/forms/src/lifecycle.ts packages/forms/src/lifecycle.test.ts packages/forms/src/normalize.ts packages/forms/src/normalize.test.ts && git -c commit.gpgsign=false commit -m "feat(forms): rewrite lint/diff/lifecycle/normalize for new model"`

---

## Task 16: Store + Migration 020 + Exports

**Files:** Modify `packages/forms/src/store.ts` (+ test); create `packages/db/src/migrations/internal/020_form_fhir_metadata.ts` (+ `.test.ts`); modify `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/forms/src/index.ts`, `packages/forms/src/pure.ts`.

- [ ] **Step 1: Write the failing migration test**

Create `020_form_fhir_metadata.test.ts` (mirror `019_form_versions.test.ts`): after migrating, insert a `form_definitions` row with `fhir_version`, `fhir_profile_url`, `facility_id` and read them back.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement migration** — `020_form_fhir_metadata.ts` adds nullable `fhir_version`, `fhir_profile_url`, `facility_id` columns to `form_definitions` and `form_versions` (`up`: `addColumn` ×3 on each; `down`: `dropColumn`). Register `'020_form_fhir_metadata'` after `019_form_versions` in `index.ts`. Add the columns to `FormDefinitionsTable` and `FormVersionsTable` in `schema/internal.ts`.
- [ ] **Step 4: Update store + exports + delete superseded modules** — extend `store.ts` create/update/map to read/write `fhirVersion`/`fhirProfileUrl`/`facilityId` and the new schema JSON; update `store.test.ts` for the new `FormDefinition` shape. **Delete the old-model modules now replaced** (and their tests, and their `index.ts` exports): old `to-bundle.ts`, `validate-answers.ts` (+ `.test.ts`), `conversion.test.ts`, old `i18n.ts` (+ `i18n.test.ts`) — superseded by `translations.ts`/`derive-languages.ts`, old `response.test.ts` — superseded by `capture.test.ts`, and any old `extensions`/`answer-value`/`to-questionnaire`/`from-questionnaire`/`visibility`/`response` files not already overwritten by Tasks 3–12. Update `index.ts` to export only the new modules (`scalar-types`, `coding`, `binding-strength`, `translations`, `derive-languages`, `page-targets`, `to-questionnaire`, `from-questionnaire`, `response`, `from-response`, `routing`, `extract`, plus schema/visibility/lint/diff/lifecycle/normalize/store/samples) and `pure.ts` (browser-safe: schema, visibility, lint, diff, lifecycle, normalize, translations, page-targets, derive-languages, answer-value — NOT store/extract/to-questionnaire/routing which pull node/fhir-extraction).
- [ ] **Step 5: Run** — `pnpm --filter @openldr/db test 020_form_fhir_metadata && pnpm --filter @openldr/forms test store && pnpm --filter @openldr/forms typecheck && pnpm --filter @openldr/db typecheck` → PASS + clean.
- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/020_form_fhir_metadata.ts packages/db/src/migrations/internal/020_form_fhir_metadata.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/forms/src/store.ts packages/forms/src/store.test.ts packages/forms/src/index.ts packages/forms/src/pure.ts
git -c commit.gpgsign=false commit -m "feat(forms): version-aware store + form fhir metadata migration"
```

---

## Task 17: Server Wiring

**Files:** Modify `apps/server/src/forms-routes.ts` (+ test).

- [ ] **Step 1: Update route test** — extend `forms-routes.test.ts` create/update cases to send and expect `fhirVersion`, `fhirProfileUrl`, `facilityId`, and a new-model `schema`; assert `/questionnaire` returns a `Questionnaire` for a new-model form.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — extend the `zod` create/update input + the store mapping with the three fields; ensure `/questionnaire` uses the new `toQuestionnaire` and `/responses` uses the new `response` converter. Audit calls unchanged.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/server test forms-routes && pnpm --filter @openldr/server typecheck` → PASS + clean.
- [ ] **Step 5: Commit** — `git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts && git -c commit.gpgsign=false commit -m "feat(server): wire new form-level fhir fields"`

---

## Task 18: Web Forms Runtime Rewrite

**Files:** Replace `apps/web/src/forms-runtime/{types.ts,runtime.ts,FormRuntime.tsx}` (+ `FormRuntime.test.tsx`); modify `apps/web/src/pages/FormCapture.tsx` (+ test); modify `apps/web/src/api.ts` (+ `api.forms.test.ts`).

- [ ] **Step 1: Update tests** — `FormRuntime.test.tsx`: render a new-model `FormSchema` with a required `text` field, a `boolean`, and a `select` whose `visibility` reveals a `text` field; assert visibility + required validation + cleaned submit (values keyed by field id). `api.forms.test.ts`: form-level fields present on create/update payloads. Keep `FormCapture.test.tsx` behavior (loads a new-model form, validates, submits) updating the inline schema to the new shape.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — rewrite `forms-runtime/types.ts` to re-export/mirror the new `FormSchema`/`FormField` (import types from `@openldr/forms/pure`); `runtime.ts` for visibility (`evaluateVisibility`), client validation (required, `constraints`, cardinality, binding), and answer cleanup; `FormRuntime.tsx` to render the 17 types with basic controls (text/number/date/datetime/boolean/select/multiselect/phone/email/identifier→inputs+select; reference/facility/organism/antibiogram→a basic searchable select stub; attachment→file input stub; group→repeatable fieldset). Resolve labels via base `displayLabel` + `translations`. Update `api.ts` form types with `fhirVersion`/`fhirProfileUrl`/`facilityId`.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/web test FormRuntime FormCapture api.forms && pnpm --filter @openldr/web typecheck` → PASS + clean (typecheck of the builder may still fail; Task 19 fixes it).
- [ ] **Step 5: Commit** — `git add apps/web/src/forms-runtime apps/web/src/pages/FormCapture.tsx apps/web/src/pages/FormCapture.test.tsx apps/web/src/api.ts apps/web/src/api.forms.test.ts && git -c commit.gpgsign=false commit -m "feat(web): rewrite forms runtime for new model"`

---

## Task 19: Trim Builder to a Buildable Minimal Editor

**Files:** Modify `apps/web/src/forms-builder/*` (+ tests). Remove/replace components that hard-depend on the old nested model.

- [ ] **Step 1: Update the page test** — rewrite `FormBuilderPage.test.tsx` to the trimmed scope: create a draft (Form name → kebab Save draft → `createForm` called); add a field (Add field → a new field row appears); edit its `displayLabel` in an inline panel; delete it. Remove tests for old-model-only widgets (visibility/value-set editors return in SP-C).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — reduce `FormBuilderPage.tsx` to: header (Form name/version inputs + kebab Save/Publish/Compare/Back), a flat field list (add field, select, delete, reorder), and a minimal inline properties panel (Display Label, Field Type select over the 17 types, Required, Enabled) writing the flat `FormField`. Keep `builderModel.ts` (`createDefaultFormSchema`/`newField` on the new model), `useTemplateHistory`, `useBuilderKeyboard`, `LintSummary`, `CompareDialog` (diff over new model). **Delete** `PropertiesSheet.tsx`, `VisibilityRuleEditor.tsx`, `ValueSetBindingEditor.tsx`, `FieldPalette.tsx`, `BuilderCanvas.tsx`, `FieldRow.tsx`, `SectionRow.tsx`, `BulkActionBar.tsx` only if they block compilation — otherwise adapt their types; SP-B–F rebuild the rich UI. Update `builderModel.test.ts`.
- [ ] **Step 4: Run** — `pnpm --filter @openldr/web test forms-builder builderModel FormBuilderPage && pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web build` → PASS + clean + build succeeds.
- [ ] **Step 5: Commit** — `git add apps/web/src/forms-builder && git -c commit.gpgsign=false commit -m "refactor(web): trim builder to buildable minimal editor for new model"`

---

## Task 20: Full Gates

**Files:** none (verification) — fix any fallout inline.

- [ ] **Step 0: Fix external consumers of removed exports** — grep the repo for imports of `@openldr/forms` symbols deleted in Task 16 (notably `TranslatableText` and the old `{en,fr,pt}` helpers, old `validateAnswers`, old `toBundle`): `grep -rn "TranslatableText\|validateAnswers\|toBundle" packages apps --include=*.ts --include=*.tsx | grep -v node_modules`. Update each consumer (e.g. terminology/forms UI, CLI) to the new model's base-string + `translations` shape. This makes the cross-package typecheck/build in Steps 1–2 achievable.
- [ ] **Step 1: Run focused package tests** — `pnpm --filter @openldr/forms test && pnpm --filter @openldr/db test && pnpm --filter @openldr/server test && pnpm --filter @openldr/web test`. Expected: all green.
- [ ] **Step 2: Run typecheck + build across the stack** — `pnpm turbo typecheck build --filter=@openldr/forms --filter=@openldr/db --filter=@openldr/server --filter=@openldr/web`. Expected: clean + builds succeed.
- [ ] **Step 3: Run depcruise** — `pnpm depcruise`. Expected: no violations (confirm `apps/web` only imports `@openldr/forms/pure`, never the server barrel).
- [ ] **Step 4: Apply migration to dev DB** — `pnpm openldr db migrate`. Expected: `020_form_fhir_metadata` applied.
- [ ] **Step 5: Commit any fixups** — `git add -A && git -c commit.gpgsign=false commit -m "chore(forms): SP-A final gate fixups"` (skip if nothing changed).

---

## Done Criteria (SP-A)

- [ ] New zod model matches Corlix `FormSchema`/`FormField` (17 types, flat fields, locale translations, rich visibility, form-level FHIR metadata).
- [ ] Ported engine green: to/from Questionnaire round-trip, response converters, extraction, visibility, coding/binding-strength, translations, group-repeat, routing.
- [ ] `page-targets` registry (forms/users/facilities) + `validateTemplateTargets` tested.
- [ ] Migration 020 applied; store + server round-trip new form-level fields.
- [ ] `forms-runtime` renders/validates the 17 types; `/forms` capture works; builder trimmed and buildable.
- [ ] `pnpm turbo typecheck lint test build` + `pnpm depcruise` green.
