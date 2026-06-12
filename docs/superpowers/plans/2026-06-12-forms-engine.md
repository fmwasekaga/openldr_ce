# Forms-from-Templates Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@openldr/forms` — a headless forms engine: `FormSchema` authoring model, lossless `FormSchema ↔ FHIR Questionnaire` conversion, `QuestionnaireResponse` capture/validation, visibility (enableWhen), i18n (en/fr/pt), SDC extraction → FHIR resources → transaction Bundle; plus `Questionnaire`/`QuestionnaireResponse` schemas in `@openldr/fhir` and `openldr forms extract` / `fhir validate <form>` CLI.

**Architecture:** A friendly `FormSchema` converts to a canonical FHIR `Questionnaire` whose items carry the full CE metadata in consolidated `@openldr`-namespaced JSON extensions (`EXT_OPENLDR_FORM`/`SECTION`/`FIELD`) — so the Questionnaire is natively renderable AND round-trips losslessly (`fromQuestionnaire(toQuestionnaire(form))` deep-equals `form`). Extraction parses a filled `QuestionnaireResponse` against the form, builds FHIR resources via a dotted-path setter (no FHIRPath engine), validates each via `@openldr/fhir`, and bundles them. Pure/headless — no `@openldr/db`, no React.

**Tech Stack:** TypeScript (ESM, Bundler resolution), zod (via `@openldr/fhir`), Vitest, commander (CLI).

**Reference:** `docs/superpowers/specs/2026-06-12-forms-engine-design.md`

**Conventions:** All commits `git -c commit.gpgsign=false commit`, **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions. `import type` for type-only.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/fhir/src/resources/questionnaire.ts` | `Questionnaire` zod schema (recursive items) |
| `packages/fhir/src/resources/questionnaire-response.ts` | `QuestionnaireResponse` zod schema |
| `packages/forms/src/schema/form-schema.ts` | `FormSchema`/`FormSection`/`FormField` zod + types |
| `packages/forms/src/extensions.ts` | `EXT_OPENLDR_*` URLs + ext read helpers |
| `packages/forms/src/i18n.ts` | `resolveText`, `deriveLanguages` |
| `packages/forms/src/answer-value.ts` | `toAnswer`/`fromAnswer`/`readAnswer` |
| `packages/forms/src/response.ts` | `buildResponse`/`parseResponse` |
| `packages/forms/src/visibility.ts` | `computeVisibility` |
| `packages/forms/src/validate-answers.ts` | `validateAnswers` |
| `packages/forms/src/to-questionnaire.ts` / `from-questionnaire.ts` | lossless conversion |
| `packages/forms/src/extract/{set-path,context,extract,index}.ts` | extraction |
| `packages/forms/src/to-bundle.ts` | `toTransactionBundle` |
| `packages/forms/src/samples/forms.ts` | sample forms |
| `packages/forms/src/index.ts` | public surface |
| `packages/cli/src/forms.ts` + `index.ts` | `forms extract` command |

---

## Task 1: `@openldr/fhir` — Questionnaire + QuestionnaireResponse schemas

**Files:**
- Create: `packages/fhir/src/resources/questionnaire.ts`, `packages/fhir/src/resources/questionnaire-response.ts`, `packages/fhir/src/resources/forms.test.ts`
- Modify: `packages/fhir/src/resources/index.ts` (add the two exports)

- [ ] **Step 1: Create `packages/fhir/src/resources/questionnaire.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirUri } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const QuestionnaireItem: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      linkId: z.string(),
      text: z.string().optional(),
      type: z.enum([
        'group', 'display', 'boolean', 'decimal', 'integer', 'date', 'dateTime', 'time',
        'string', 'text', 'url', 'choice', 'open-choice', 'attachment', 'reference', 'quantity',
      ]),
      required: z.boolean().optional(),
      repeats: z.boolean().optional(),
      answerOption: z.array(z.unknown()).optional(),
      enableWhen: z.array(z.unknown()).optional(),
      extension: z.array(z.unknown()).optional(),
      item: z.array(QuestionnaireItem).optional(),
    })
    .passthrough(),
);

export const Questionnaire = z
  .object({
    resourceType: z.literal('Questionnaire'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: fhirUri.optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    status: z.enum(['draft', 'active', 'retired', 'unknown']),
    item: z.array(QuestionnaireItem).optional(),
  })
  .passthrough();
export type Questionnaire = z.infer<typeof Questionnaire>;

registerResource('Questionnaire', Questionnaire);
```

- [ ] **Step 2: Create `packages/fhir/src/resources/questionnaire-response.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

const QuestionnaireResponseItem: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      linkId: z.string(),
      text: z.string().optional(),
      answer: z.array(z.unknown()).optional(),
      item: z.array(QuestionnaireResponseItem).optional(),
    })
    .passthrough(),
);

export const QuestionnaireResponse = z
  .object({
    resourceType: z.literal('QuestionnaireResponse'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    questionnaire: z.string().optional(),
    status: z.enum(['in-progress', 'completed', 'amended', 'entered-in-error', 'stopped']),
    subject: Reference.optional(),
    authored: fhirDateTime.optional(),
    item: z.array(QuestionnaireResponseItem).optional(),
  })
  .passthrough();
export type QuestionnaireResponse = z.infer<typeof QuestionnaireResponse>;

registerResource('QuestionnaireResponse', QuestionnaireResponse);
```

- [ ] **Step 3: Add to `packages/fhir/src/resources/index.ts`** — append these two lines:

```ts
export * from './questionnaire';
export * from './questionnaire-response';
```

- [ ] **Step 4: Write the test `packages/fhir/src/resources/forms.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';
import { listResourceTypes } from '../registry';

describe('Questionnaire / QuestionnaireResponse', () => {
  it('validates a Questionnaire with nested items', () => {
    const r = validateResource({
      resourceType: 'Questionnaire',
      status: 'active',
      item: [{ linkId: 's1', type: 'group', item: [{ linkId: 'f1', type: 'string', text: 'Name' }] }],
    });
    expect(r.ok).toBe(true);
  });
  it('rejects a Questionnaire missing status', () => {
    const r = validateResource({ resourceType: 'Questionnaire' });
    expect(r.ok).toBe(false);
  });
  it('validates a QuestionnaireResponse', () => {
    const r = validateResource({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{ linkId: 'f1', answer: [{ valueString: 'Jane' }] }],
    });
    expect(r.ok).toBe(true);
  });
  it('registers both resource types', () => {
    const types = listResourceTypes();
    expect(types).toContain('Questionnaire');
    expect(types).toContain('QuestionnaireResponse');
  });
});
```

- [ ] **Step 5: Run + typecheck**

Run: `pnpm --filter @openldr/fhir test forms && pnpm --filter @openldr/fhir typecheck`
Expected: 4 tests pass; typecheck clean. (If the recursive `z.lazy` with `z.ZodType<any>` triggers a typecheck error, report it.)

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fhir): Questionnaire + QuestionnaireResponse schemas (P1-FORM-1)"
```

---

## Task 2: `@openldr/forms` scaffold + FormSchema model + i18n + extensions

**Files:**
- Modify: `packages/forms/package.json` (replace placeholder)
- Create: `packages/forms/tsconfig.json`, `packages/forms/src/schema/form-schema.ts`, `packages/forms/src/schema/form-schema.test.ts`, `packages/forms/src/extensions.ts`, `packages/forms/src/i18n.ts`, `packages/forms/src/i18n.test.ts`

- [ ] **Step 1: Replace `packages/forms/package.json`**

```json
{
  "name": "@openldr/forms",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/fhir": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/forms/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/forms/src/schema/form-schema.ts`**

```ts
import { z } from 'zod';

export const TranslatableText = z.object({
  en: z.string(),
  fr: z.string().optional(),
  pt: z.string().optional(),
});
export type TranslatableText = z.infer<typeof TranslatableText>;

export const FieldOption = z.object({
  code: z.string(),
  display: TranslatableText,
  system: z.string().optional(),
});

export const VisibilityRule = z.object({
  whenField: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});

export const FieldType = z.enum([
  'string', 'text', 'integer', 'decimal', 'boolean',
  'date', 'dateTime', 'choice', 'open-choice', 'reference', 'quantity',
]);
export type FieldType = z.infer<typeof FieldType>;

const FieldCode = z.object({ system: z.string().optional(), code: z.string(), display: z.string().optional() });
const Cardinality = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
});

export const FormField = z
  .object({
    id: z.string(),
    type: FieldType,
    label: TranslatableText,
    required: z.boolean().optional(),
    repeats: z.boolean().optional(),
    cardinality: Cardinality.optional(),
    options: z.array(FieldOption).optional(),
    visibility: VisibilityRule.optional(),
    fhirPath: z.string().optional(),
    observationExtract: z.boolean().optional(),
    code: FieldCode.optional(),
    unit: z.string().optional(),
  })
  .superRefine((f, ctx) => {
    if ((f.type === 'choice' || f.type === 'open-choice') && !f.options) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'choice field requires options', path: ['options'] });
    }
    if (f.observationExtract && !f.code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'observationExtract field requires code', path: ['code'] });
    }
  });
export type FormField = z.infer<typeof FormField>;

export const ResourceType = z.enum([
  'Patient', 'ServiceRequest', 'Specimen', 'Organization', 'Location', 'DiagnosticReport',
]);

export const FormSection = z.object({
  id: z.string(),
  title: TranslatableText,
  resourceType: ResourceType.optional(),
  repeats: z.boolean().optional(),
  fields: z.array(FormField),
});
export type FormSection = z.infer<typeof FormSection>;

export const FormSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: TranslatableText,
  status: z.enum(['draft', 'active', 'retired']),
  languages: z.array(z.enum(['en', 'fr', 'pt'])),
  sections: z.array(FormSection),
});
export type FormSchema = z.infer<typeof FormSchema>;
```

- [ ] **Step 4: Write the test `packages/forms/src/schema/form-schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { FormField, FormSchema } from './form-schema';

describe('FormSchema model', () => {
  it('accepts a minimal valid form', () => {
    const r = FormSchema.safeParse({
      id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
      sections: [{ id: 's', title: { en: 'S' }, fields: [{ id: 'q', type: 'string', label: { en: 'Q' } }] }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects a choice field without options', () => {
    const r = FormField.safeParse({ id: 'q', type: 'choice', label: { en: 'Q' } });
    expect(r.success).toBe(false);
  });
  it('rejects an observationExtract field without code', () => {
    const r = FormField.safeParse({ id: 'q', type: 'integer', label: { en: 'Q' }, observationExtract: true });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 5: Create `packages/forms/src/extensions.ts`**

```ts
export const EXT_OPENLDR_FORM = 'https://openldr.org/fhir/StructureDefinition/form';
export const EXT_OPENLDR_SECTION = 'https://openldr.org/fhir/StructureDefinition/form-section';
export const EXT_OPENLDR_FIELD = 'https://openldr.org/fhir/StructureDefinition/form-field';

interface Ext {
  url: string;
  valueString?: string;
}

/** Read a valueString from an extension array by url. */
export function extString(extensions: unknown, url: string): string | undefined {
  if (!Array.isArray(extensions)) return undefined;
  const found = (extensions as Ext[]).find((e) => e?.url === url);
  return found?.valueString;
}
```

- [ ] **Step 6: Create `packages/forms/src/i18n.ts`**

```ts
import type { TranslatableText, FormSchema } from './schema/form-schema';

export type Lang = 'en' | 'fr' | 'pt';

/** Resolve text in the requested language, falling back to English. */
export function resolveText(text: TranslatableText, lang: Lang): string {
  return text[lang] ?? text.en;
}

/** The set of languages any text in the form provides. */
export function deriveLanguages(form: FormSchema): Lang[] {
  const langs = new Set<Lang>(['en']);
  const visit = (t: TranslatableText) => {
    if (t.fr) langs.add('fr');
    if (t.pt) langs.add('pt');
  };
  visit(form.title);
  for (const s of form.sections) {
    visit(s.title);
    for (const f of s.fields) {
      visit(f.label);
      for (const o of f.options ?? []) visit(o.display);
    }
  }
  return [...langs];
}
```

- [ ] **Step 7: Write the test `packages/forms/src/i18n.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveText, deriveLanguages } from './i18n';

describe('i18n', () => {
  it('resolves the requested language, falls back to en', () => {
    expect(resolveText({ en: 'Hello', fr: 'Bonjour' }, 'fr')).toBe('Bonjour');
    expect(resolveText({ en: 'Hello' }, 'pt')).toBe('Hello');
  });
  it('derives languages present anywhere in the form', () => {
    const langs = deriveLanguages({
      id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
      sections: [{ id: 's', title: { en: 'S', pt: 'S-pt' }, fields: [{ id: 'q', type: 'string', label: { en: 'Q' } }] }],
    });
    expect(langs.sort()).toEqual(['en', 'pt']);
  });
});
```

- [ ] **Step 8: Install, run, typecheck**

Run: `pnpm install && pnpm --filter @openldr/forms test && pnpm --filter @openldr/forms typecheck`
Expected: form-schema 3 + i18n 2 tests pass; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(forms): FormSchema model, extensions, i18n (P1-FORM-1/3, P1-NFR-4)"
```

---

## Task 3: answer-value + QuestionnaireResponse build/parse

**Files:**
- Create: `packages/forms/src/answer-value.ts`, `packages/forms/src/response.ts`, `packages/forms/src/response.test.ts`

- [ ] **Step 1: Create `packages/forms/src/answer-value.ts`**

```ts
import type { FieldType } from './schema/form-schema';

/** Normalized JS answer values per field type. */
export type AnswerValue =
  | string
  | number
  | boolean
  | { code: string; display?: string; system?: string }
  | { value?: number; unit?: string };

/** All answers for a form, keyed by field id. */
export type Answers = Record<string, AnswerValue | AnswerValue[]>;

/** Build a FHIR QuestionnaireResponse answer object for a field value. */
export function toAnswer(type: FieldType, value: AnswerValue): Record<string, unknown> {
  switch (type) {
    case 'string':
    case 'text':
      return { valueString: value };
    case 'integer':
      return { valueInteger: value };
    case 'decimal':
      return { valueDecimal: value };
    case 'boolean':
      return { valueBoolean: value };
    case 'date':
      return { valueDate: value };
    case 'dateTime':
      return { valueDateTime: value };
    case 'choice':
    case 'open-choice': {
      const c = value as { code: string; display?: string; system?: string };
      return { valueCoding: { system: c.system, code: c.code, display: c.display } };
    }
    case 'reference':
      return { valueReference: { reference: value } };
    case 'quantity': {
      const q = value as { value?: number; unit?: string };
      return { valueQuantity: { value: q.value, unit: q.unit } };
    }
  }
}

/** Read a normalized JS value out of a FHIR answer object (type-agnostic). */
export function readAnswer(answer: Record<string, unknown>): AnswerValue | undefined {
  if ('valueString' in answer) return answer.valueString as string;
  if ('valueInteger' in answer) return answer.valueInteger as number;
  if ('valueDecimal' in answer) return answer.valueDecimal as number;
  if ('valueBoolean' in answer) return answer.valueBoolean as boolean;
  if ('valueDate' in answer) return answer.valueDate as string;
  if ('valueDateTime' in answer) return answer.valueDateTime as string;
  if ('valueCoding' in answer) {
    const c = answer.valueCoding as { code: string; display?: string; system?: string };
    return { code: c.code, display: c.display, system: c.system };
  }
  if ('valueReference' in answer) return (answer.valueReference as { reference: string }).reference;
  if ('valueQuantity' in answer) {
    const q = answer.valueQuantity as { value?: number; unit?: string };
    return { value: q.value, unit: q.unit };
  }
  return undefined;
}
```

- [ ] **Step 2: Write the failing test `packages/forms/src/response.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildResponse, parseResponse } from './response';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
  sections: [
    {
      id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
      fields: [
        { id: 'given', type: 'string', label: { en: 'Given' }, fhirPath: 'name.0.given.0' },
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female' } }] },
      ],
    },
  ],
};

describe('build/parse QuestionnaireResponse', () => {
  it('round-trips answers', () => {
    const answers = { given: 'Jane', sex: { code: 'female' } };
    const qr = buildResponse(form, answers, { status: 'completed' });
    expect(qr.resourceType).toBe('QuestionnaireResponse');
    const parsed = parseResponse(qr);
    expect(parsed.given).toBe('Jane');
    expect(parsed.sex).toMatchObject({ code: 'female' });
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `pnpm --filter @openldr/forms test response`
Expected: FAIL — cannot find module `./response`.

- [ ] **Step 4: Create `packages/forms/src/response.ts`**

```ts
import type { QuestionnaireResponse } from '@openldr/fhir';
import type { FormSchema } from './schema/form-schema';
import { toAnswer, readAnswer, type AnswerValue, type Answers } from './answer-value';

export type { Answers };

export interface ResponseMeta {
  status?: 'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';
  subject?: { reference: string };
  authored?: string;
  questionnaire?: string;
}

export function buildResponse(form: FormSchema, answers: Answers, meta: ResponseMeta = {}): QuestionnaireResponse {
  const item = form.sections.map((section) => ({
    linkId: section.id,
    text: section.title.en,
    item: section.fields
      .filter((f) => answers[f.id] !== undefined)
      .map((f) => {
        const raw = answers[f.id];
        const values = Array.isArray(raw) ? raw : [raw];
        return { linkId: f.id, text: f.label.en, answer: values.map((v) => toAnswer(f.type, v)) };
      }),
  }));
  return {
    resourceType: 'QuestionnaireResponse',
    status: meta.status ?? 'completed',
    ...(meta.questionnaire ? { questionnaire: meta.questionnaire } : {}),
    ...(meta.subject ? { subject: meta.subject } : {}),
    ...(meta.authored ? { authored: meta.authored } : {}),
    item,
  } as QuestionnaireResponse;
}

export function parseResponse(qr: QuestionnaireResponse): Answers {
  const out: Answers = {};
  const walk = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const it of items as Array<Record<string, unknown>>) {
      const answers = it.answer as Array<Record<string, unknown>> | undefined;
      if (answers && answers.length > 0) {
        const values = answers.map(readAnswer).filter((v): v is AnswerValue => v !== undefined);
        out[it.linkId as string] = values.length === 1 ? (values[0] as AnswerValue) : values;
      }
      if (it.item) walk(it.item);
    }
  };
  walk(qr.item);
  return out;
}
```

- [ ] **Step 5: Run it to verify pass**

Run: `pnpm --filter @openldr/forms test response`
Expected: PASS (1 test).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openldr/forms typecheck`
Expected: clean.
```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(forms): answer-value + QuestionnaireResponse build/parse"
```

---

## Task 4: Lossless FormSchema ↔ Questionnaire

**Files:**
- Create: `packages/forms/src/to-questionnaire.ts`, `packages/forms/src/from-questionnaire.ts`, `packages/forms/src/conversion.test.ts`

- [ ] **Step 1: Write the failing test `packages/forms/src/conversion.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toQuestionnaire } from './to-questionnaire';
import { fromQuestionnaire } from './from-questionnaire';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'intake', name: 'intake', title: { en: 'Intake', fr: 'Admission' }, status: 'active', languages: ['en', 'fr'],
  sections: [
    {
      id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
      fields: [
        { id: 'given', type: 'string', label: { en: 'Given name' }, required: true, fhirPath: 'name.0.given.0' },
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female' } }, { code: 'male', display: { en: 'Male' } }] },
        { id: 'pregnant', type: 'boolean', label: { en: 'Pregnant?' }, visibility: { whenField: 'sex', equals: 'female' }, observationExtract: true, code: { code: '82810-3', system: 'http://loinc.org' } },
      ],
    },
  ],
};

describe('FormSchema <-> Questionnaire', () => {
  it('produces a valid Questionnaire shape', () => {
    const q = toQuestionnaire(form);
    expect(q.resourceType).toBe('Questionnaire');
    expect(q.item?.length).toBe(1);
    expect((q.item?.[0] as { type: string }).type).toBe('group');
  });
  it('round-trips losslessly', () => {
    expect(fromQuestionnaire(toQuestionnaire(form))).toEqual(form);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @openldr/forms test conversion`
Expected: FAIL — cannot find module `./to-questionnaire`.

- [ ] **Step 3: Create `packages/forms/src/to-questionnaire.ts`**

```ts
import type { Questionnaire } from '@openldr/fhir';
import type { FormSchema, FormSection, FormField, VisibilityRule } from './schema/form-schema';
import { EXT_OPENLDR_FORM, EXT_OPENLDR_SECTION, EXT_OPENLDR_FIELD } from './extensions';

function enableWhenOf(v: VisibilityRule): Record<string, unknown> {
  const base = { question: v.whenField, operator: '=' };
  if (typeof v.equals === 'boolean') return { ...base, answerBoolean: v.equals };
  if (typeof v.equals === 'number') return { ...base, answerDecimal: v.equals };
  return { ...base, answerString: v.equals };
}

function fieldItem(field: FormField): Record<string, unknown> {
  const item: Record<string, unknown> = {
    linkId: field.id,
    type: field.type,
    text: field.label.en,
    required: field.required ?? false,
    repeats: field.repeats ?? false,
    extension: [{ url: EXT_OPENLDR_FIELD, valueString: JSON.stringify(field) }],
  };
  if (field.options) {
    item.answerOption = field.options.map((o) => ({ valueCoding: { system: o.system, code: o.code, display: o.display.en } }));
  }
  if (field.visibility) item.enableWhen = [enableWhenOf(field.visibility)];
  return item;
}

function sectionItem(section: FormSection): Record<string, unknown> {
  const { fields, ...meta } = section;
  return {
    linkId: section.id,
    type: 'group',
    text: section.title.en,
    repeats: section.repeats ?? false,
    extension: [{ url: EXT_OPENLDR_SECTION, valueString: JSON.stringify(meta) }],
    item: fields.map(fieldItem),
  };
}

export function toQuestionnaire(form: FormSchema): Questionnaire {
  const { sections, ...formMeta } = form;
  return {
    resourceType: 'Questionnaire',
    name: form.name,
    title: form.title.en,
    status: form.status,
    extension: [{ url: EXT_OPENLDR_FORM, valueString: JSON.stringify(formMeta) }],
    item: sections.map(sectionItem),
  } as Questionnaire;
}
```

- [ ] **Step 4: Create `packages/forms/src/from-questionnaire.ts`**

```ts
import type { Questionnaire } from '@openldr/fhir';
import type { FormSchema, FormField, FormSection } from './schema/form-schema';
import { EXT_OPENLDR_FORM, EXT_OPENLDR_SECTION, EXT_OPENLDR_FIELD, extString } from './extensions';

export function fromQuestionnaire(q: Questionnaire): FormSchema {
  const formMeta = JSON.parse(extString((q as { extension?: unknown }).extension, EXT_OPENLDR_FORM) ?? '{}') as Omit<FormSchema, 'sections'>;
  const groups = (q as { item?: Array<Record<string, unknown>> }).item ?? [];
  const sections: FormSection[] = groups.map((g) => {
    const meta = JSON.parse(extString(g.extension, EXT_OPENLDR_SECTION) ?? '{}') as Omit<FormSection, 'fields'>;
    const leaves = (g.item as Array<Record<string, unknown>> | undefined) ?? [];
    const fields: FormField[] = leaves.map((leaf) => JSON.parse(extString(leaf.extension, EXT_OPENLDR_FIELD) ?? '{}') as FormField);
    return { ...meta, fields };
  });
  return { ...formMeta, sections };
}
```

- [ ] **Step 5: Run it to verify pass**

Run: `pnpm --filter @openldr/forms test conversion`
Expected: PASS (2 tests). The round-trip must deep-equal.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openldr/forms typecheck`
Expected: clean.
```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(forms): lossless FormSchema <-> Questionnaire conversion"
```

---

## Task 5: Visibility + answer validation

**Files:**
- Create: `packages/forms/src/visibility.ts`, `packages/forms/src/validate-answers.ts`, `packages/forms/src/validate-answers.test.ts`

- [ ] **Step 1: Create `packages/forms/src/visibility.ts`**

```ts
import type { FormSchema } from './schema/form-schema';
import type { Answers } from './answer-value';

/** fieldId -> visible? A field with a VisibilityRule shows only when its controller's answer matches. */
export function computeVisibility(form: FormSchema, answers: Answers): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!field.visibility) {
        map.set(field.id, true);
        continue;
      }
      const ctrl = answers[field.visibility.whenField];
      const value = typeof ctrl === 'object' && ctrl !== null && 'code' in ctrl ? (ctrl as { code: string }).code : ctrl;
      map.set(field.id, value === field.visibility.equals);
    }
  }
  return map;
}
```

- [ ] **Step 2: Write the failing test `packages/forms/src/validate-answers.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateAnswers } from './validate-answers';
import { computeVisibility } from './visibility';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
  sections: [
    {
      id: 's', title: { en: 'S' },
      fields: [
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, options: [{ code: 'female', display: { en: 'F' } }, { code: 'male', display: { en: 'M' } }] },
        { id: 'pregnant', type: 'boolean', label: { en: 'Pregnant' }, required: true, visibility: { whenField: 'sex', equals: 'female' } },
        { id: 'age', type: 'integer', label: { en: 'Age' }, required: true },
      ],
    },
  ],
};

describe('computeVisibility', () => {
  it('hides the dependent field until the controller matches', () => {
    expect(computeVisibility(form, { sex: { code: 'male' } }).get('pregnant')).toBe(false);
    expect(computeVisibility(form, { sex: { code: 'female' } }).get('pregnant')).toBe(true);
  });
});

describe('validateAnswers', () => {
  it('flags a missing required visible field', () => {
    const r = validateAnswers(form, { sex: { code: 'female' } }); // pregnant visible+missing, age missing
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const exprs = r.outcome.issue.flatMap((i) => i.expression ?? []);
      expect(exprs).toContain('pregnant');
      expect(exprs).toContain('age');
    }
  });
  it('does not flag a hidden required field', () => {
    const r = validateAnswers(form, { sex: { code: 'male' }, age: 30 }); // pregnant hidden
    expect(r.ok).toBe(true);
  });
  it('flags a bad choice value', () => {
    const r = validateAnswers(form, { sex: { code: 'other' }, age: 30 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `pnpm --filter @openldr/forms test validate-answers`
Expected: FAIL — cannot find module `./validate-answers`.

- [ ] **Step 4: Create `packages/forms/src/validate-answers.ts`**

```ts
import { type OperationOutcome, outcomeFromIssues, type OperationOutcomeIssue } from '@openldr/fhir';
import type { FormSchema, FormField } from './schema/form-schema';
import type { Answers, AnswerValue } from './answer-value';
import { computeVisibility } from './visibility';

export type ValidateResult = { ok: true } | { ok: false; outcome: OperationOutcome };

function typeOk(field: FormField, v: AnswerValue): boolean {
  switch (field.type) {
    case 'string': case 'text': case 'date': case 'dateTime': case 'reference':
      return typeof v === 'string';
    case 'integer': case 'decimal':
      return typeof v === 'number';
    case 'boolean':
      return typeof v === 'boolean';
    case 'choice': case 'open-choice':
      return typeof v === 'object' && v !== null && 'code' in v;
    case 'quantity':
      return typeof v === 'object' && v !== null && 'value' in v;
  }
}

export function validateAnswers(form: FormSchema, answers: Answers): ValidateResult {
  const visible = computeVisibility(form, answers);
  const issues: OperationOutcomeIssue[] = [];
  const add = (code: string, msg: string, fieldId: string) =>
    issues.push({ severity: 'error', code, diagnostics: msg, expression: [fieldId] });

  for (const section of form.sections) {
    for (const field of section.fields) {
      if (visible.get(field.id) === false) continue;
      const raw = answers[field.id];
      const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

      if (field.required && values.length === 0) {
        add('required', `field ${field.id} is required`, field.id);
        continue;
      }
      for (const v of values) {
        if (!typeOk(field, v)) {
          add('value', `field ${field.id} has the wrong type`, field.id);
          continue;
        }
        if (field.type === 'choice' && field.options) {
          const code = (v as { code: string }).code;
          if (!field.options.some((o) => o.code === code)) {
            add('value', `field ${field.id} value '${code}' not in options`, field.id);
          }
        }
      }
      if (field.cardinality) {
        if (field.cardinality.min !== undefined && values.length < field.cardinality.min) add('value', `field ${field.id} below min cardinality`, field.id);
        if (field.cardinality.max !== undefined && values.length > field.cardinality.max) add('value', `field ${field.id} above max cardinality`, field.id);
      }
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, outcome: outcomeFromIssues(issues) };
}
```

- [ ] **Step 5: Run + typecheck**

Run: `pnpm --filter @openldr/forms test validate-answers && pnpm --filter @openldr/forms typecheck`
Expected: visibility 1 + validate 3 pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(forms): visibility (enableWhen) + answer validation"
```

---

## Task 6: SDC extraction → resources → transaction Bundle

**Files:**
- Create: `packages/forms/src/extract/set-path.ts`, `packages/forms/src/extract/set-path.test.ts`, `packages/forms/src/extract/context.ts`, `packages/forms/src/extract/extract.ts`, `packages/forms/src/extract/index.ts`, `packages/forms/src/to-bundle.ts`, `packages/forms/src/extract/extract.test.ts`

- [ ] **Step 1: Write the failing test `packages/forms/src/extract/set-path.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { setPath } from './set-path';

describe('setPath', () => {
  it('sets a simple property', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'gender', 'female');
    expect(o).toEqual({ gender: 'female' });
  });
  it('creates nested objects and array indices', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'name.0.given.0', 'Jane');
    expect(o).toEqual({ name: [{ given: ['Jane'] }] });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @openldr/forms test set-path`
Expected: FAIL — cannot find module `./set-path`.

- [ ] **Step 3: Create `packages/forms/src/extract/set-path.ts`**

```ts
/** Write `value` at a dotted path (numeric segments become array indices), creating intermediates. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string | number, unknown> = target as Record<string | number, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[key] === undefined) cur[key] = nextIsIndex ? [] : {};
    cur = cur[key] as Record<string | number, unknown>;
  }
  const last = parts[parts.length - 1];
  cur[/^\d+$/.test(last) ? Number(last) : last] = value;
}
```

- [ ] **Step 4: Run it to verify pass**

Run: `pnpm --filter @openldr/forms test set-path`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `packages/forms/src/extract/context.ts`**

```ts
import type { FhirResource } from '@openldr/fhir';

export interface ExtractionContext {
  subject?: { reference: string };
  authored?: string;
}

export interface ExtractionResult {
  resources: FhirResource[];
  invalid: { resource: FhirResource; outcome: unknown }[];
}
```

- [ ] **Step 6: Create `packages/forms/src/to-bundle.ts`**

```ts
import type { Bundle, FhirResource } from '@openldr/fhir';

export function toTransactionBundle(resources: FhirResource[]): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: resources.map((r) => ({ resource: r, request: { method: 'POST', url: r.resourceType } })),
  } as Bundle;
}
```

- [ ] **Step 7: Create `packages/forms/src/extract/extract.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { validateResource, type FhirResource, type Questionnaire, type QuestionnaireResponse } from '@openldr/fhir';
import type { FormField } from '../schema/form-schema';
import { fromQuestionnaire } from '../from-questionnaire';
import { parseResponse } from '../response';
import type { Answers, AnswerValue } from '../answer-value';
import { setPath } from './set-path';
import type { ExtractionContext, ExtractionResult } from './context';

const SUBJECT_TYPES = new Set(['ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport']);

/** Convert a normalized answer into the FHIR value to place at a fhirPath. */
function extractValue(field: FormField, v: AnswerValue): unknown {
  switch (field.type) {
    case 'choice':
    case 'open-choice':
      return (v as { code: string }).code;
    case 'reference':
      return { reference: v as string };
    case 'quantity':
      return { value: (v as { value?: number }).value, unit: (v as { unit?: string }).unit };
    default:
      return v;
  }
}

function observationOf(field: FormField, v: AnswerValue, ctx: ExtractionContext): FhirResource {
  const obs: Record<string, unknown> = {
    resourceType: 'Observation',
    id: randomUUID(),
    status: 'final',
    code: { coding: [{ system: field.code?.system, code: field.code?.code, display: field.code?.display }] },
  };
  if (ctx.subject) obs.subject = ctx.subject;
  if (ctx.authored) obs.effectiveDateTime = ctx.authored;
  switch (field.type) {
    case 'choice':
    case 'open-choice':
      obs.valueCodeableConcept = { coding: [{ code: (v as { code: string }).code, display: (v as { display?: string }).display }] };
      break;
    case 'quantity':
      obs.valueQuantity = { value: (v as { value?: number }).value, unit: (v as { unit?: string }).unit };
      break;
    case 'integer':
    case 'decimal':
      obs.valueQuantity = { value: v as number, unit: field.unit };
      break;
    case 'boolean':
      obs.valueBoolean = v as boolean;
      break;
    default:
      obs.valueString = String(v);
  }
  return obs as FhirResource;
}

export function extractResources(
  qr: QuestionnaireResponse,
  questionnaire: Questionnaire,
  ctx: ExtractionContext = {},
): ExtractionResult {
  const form = fromQuestionnaire(questionnaire);
  const answers: Answers = parseResponse(qr);
  const resources: FhirResource[] = [];

  for (const section of form.sections) {
    if (section.resourceType) {
      const resource: Record<string, unknown> = { resourceType: section.resourceType, id: randomUUID() };
      if (ctx.subject && SUBJECT_TYPES.has(section.resourceType)) resource.subject = ctx.subject;
      for (const field of section.fields) {
        if (field.observationExtract) continue;
        const raw = answers[field.id];
        if (raw !== undefined && field.fhirPath) {
          const v = Array.isArray(raw) ? raw[0] : raw;
          setPath(resource, field.fhirPath, extractValue(field, v));
        }
      }
      resources.push(resource as FhirResource);
    }
    for (const field of section.fields) {
      if (field.observationExtract) {
        const raw = answers[field.id];
        if (raw !== undefined) {
          const v = Array.isArray(raw) ? raw[0] : raw;
          resources.push(observationOf(field, v, ctx));
        }
      }
    }
  }

  const invalid: ExtractionResult['invalid'] = [];
  for (const r of resources) {
    const res = validateResource(r);
    if (!res.ok) invalid.push({ resource: r, outcome: res.outcome });
  }
  return { resources, invalid };
}
```

- [ ] **Step 8: Create `packages/forms/src/extract/index.ts`**

```ts
export * from './context';
export * from './set-path';
export * from './extract';
```

- [ ] **Step 9: Write the test `packages/forms/src/extract/extract.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toQuestionnaire } from '../to-questionnaire';
import { buildResponse } from '../response';
import { extractResources } from './extract';
import type { FormSchema } from '../schema/form-schema';

const form: FormSchema = {
  id: 'intake', name: 'intake', title: { en: 'Intake' }, status: 'active', languages: ['en'],
  sections: [
    {
      id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
      fields: [
        { id: 'given', type: 'string', label: { en: 'Given' }, fhirPath: 'name.0.given.0' },
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female' } }] },
        { id: 'temp', type: 'decimal', label: { en: 'Temp' }, observationExtract: true, code: { code: '8310-5', system: 'http://loinc.org' }, unit: 'Cel' },
      ],
    },
  ],
};

describe('extractResources', () => {
  it('extracts a valid Patient and an Observation', () => {
    const q = toQuestionnaire(form);
    const qr = buildResponse(form, { given: 'Jane', sex: { code: 'female' }, temp: 38.5 }, { status: 'completed' });
    const { resources, invalid } = extractResources(qr, q, { subject: { reference: 'Patient/1' } });
    expect(invalid).toHaveLength(0);
    const patient = resources.find((r) => r.resourceType === 'Patient') as Record<string, unknown>;
    expect(patient).toBeDefined();
    expect(patient.gender).toBe('female');
    expect((patient.name as Array<{ given: string[] }>)[0].given[0]).toBe('Jane');
    const obs = resources.find((r) => r.resourceType === 'Observation') as Record<string, unknown>;
    expect(obs).toBeDefined();
    expect((obs.valueQuantity as { value: number }).value).toBe(38.5);
  });
});
```

- [ ] **Step 10: Run + typecheck**

Run: `pnpm --filter @openldr/forms test extract && pnpm --filter @openldr/forms test set-path && pnpm --filter @openldr/forms typecheck`
Expected: set-path 2 + extract 1 pass; typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(forms): SDC extraction (dotted-path) + transaction Bundle"
```

---

## Task 7: Sample forms + public surface

**Files:**
- Create: `packages/forms/src/samples/forms.ts`, `packages/forms/src/samples/forms.test.ts`, `packages/forms/src/index.ts`

- [ ] **Step 1: Create `packages/forms/src/samples/forms.ts`**

```ts
import type { FormSchema } from '../schema/form-schema';

export function patientIntakeForm(): FormSchema {
  return {
    id: 'patient-intake', name: 'PatientIntake', title: { en: 'Patient Intake', fr: 'Admission patient' },
    status: 'active', languages: ['en', 'fr'],
    sections: [
      {
        id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
        fields: [
          { id: 'family', type: 'string', label: { en: 'Family name', fr: 'Nom' }, required: true, fhirPath: 'name.0.family' },
          { id: 'given', type: 'string', label: { en: 'Given name', fr: 'Prénom' }, required: true, fhirPath: 'name.0.given.0' },
          { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female', fr: 'Féminin' } }, { code: 'male', display: { en: 'Male', fr: 'Masculin' } }] },
          { id: 'birthDate', type: 'date', label: { en: 'Date of birth' }, fhirPath: 'birthDate' },
        ],
      },
    ],
  };
}

export function requisitionForm(): FormSchema {
  return {
    id: 'requisition', name: 'Requisition', title: { en: 'Test Requisition' },
    status: 'active', languages: ['en'],
    sections: [
      {
        id: 'order', title: { en: 'Order' }, resourceType: 'ServiceRequest',
        fields: [
          { id: 'status', type: 'string', label: { en: 'Status' }, fhirPath: 'status' },
          { id: 'intent', type: 'string', label: { en: 'Intent' }, fhirPath: 'intent' },
          { id: 'patientRef', type: 'reference', label: { en: 'Patient' }, required: true, fhirPath: 'subject' },
        ],
      },
    ],
  };
}

export function sampleForms(): FormSchema[] {
  return [patientIntakeForm(), requisitionForm()];
}
```

- [ ] **Step 2: Create `packages/forms/src/index.ts`**

```ts
export * from './schema/form-schema';
export * from './extensions';
export * from './i18n';
export * from './answer-value';
export * from './response';
export * from './visibility';
export * from './validate-answers';
export * from './to-questionnaire';
export * from './from-questionnaire';
export * from './to-bundle';
export * from './extract/index';
export * from './samples/forms';
```

- [ ] **Step 3: Write the test `packages/forms/src/samples/forms.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { sampleForms } from './forms';
import { toQuestionnaire } from '../to-questionnaire';
import { fromQuestionnaire } from '../from-questionnaire';
import { FormSchema } from '../schema/form-schema';

describe('sample forms', () => {
  it('every sample passes FormSchema validation', () => {
    for (const f of sampleForms()) {
      expect(FormSchema.safeParse(f).success).toBe(true);
    }
  });
  it('every sample round-trips losslessly through a Questionnaire', () => {
    for (const f of sampleForms()) {
      expect(fromQuestionnaire(toQuestionnaire(f))).toEqual(f);
    }
  });
});
```

- [ ] **Step 4: Run full package test + typecheck**

Run: `pnpm --filter @openldr/forms test && pnpm --filter @openldr/forms typecheck`
Expected: all forms tests pass (form-schema, i18n, response, conversion, validate-answers, set-path, extract, samples); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(forms): sample forms + public surface"
```

---

## Task 8: CLI — `openldr forms extract` + `fhir validate <form>`

**Files:**
- Modify: `packages/cli/package.json` (add `@openldr/forms` dep)
- Create: `packages/cli/src/forms.ts`, `packages/cli/src/forms.test.ts`, `packages/cli/src/__fixtures__/sample-questionnaire.json`, `packages/cli/src/__fixtures__/sample-response.json`
- Modify: `packages/cli/src/index.ts` (register the `forms` group)

- [ ] **Step 1: Add the dependency in `packages/cli/package.json`** — inside `"dependencies"`, add `"@openldr/forms": "workspace:*",` (keep `@openldr/*` alphabetical). Then run `pnpm install`.

- [ ] **Step 2: Create `packages/cli/src/forms.ts`**

```ts
import { readFileSync } from 'node:fs';
import { extractResources, toTransactionBundle, type ExtractionContext } from '@openldr/forms';
import type { Questionnaire, QuestionnaireResponse } from '@openldr/fhir';

export interface FormsExtractOutput {
  resourceTypes: string[];
  invalidCount: number;
  bundle: unknown;
}

export function runFormsExtract(questionnairePath: string, responsePath: string, ctx: ExtractionContext = {}): FormsExtractOutput {
  const questionnaire = JSON.parse(readFileSync(questionnairePath, 'utf8')) as Questionnaire;
  const response = JSON.parse(readFileSync(responsePath, 'utf8')) as QuestionnaireResponse;
  const { resources, invalid } = extractResources(response, questionnaire, ctx);
  return {
    resourceTypes: resources.map((r) => r.resourceType),
    invalidCount: invalid.length,
    bundle: toTransactionBundle(resources),
  };
}
```

- [ ] **Step 3: Generate the questionnaire fixture deterministically.** Rather than hand-author escaped JSON, write a throwaway script and capture its output:

Run (from repo root — import the forms source by relative path so `tsx` resolves it without relying on a root-level workspace symlink):
```bash
pnpm exec tsx -e "import { patientIntakeForm } from './packages/forms/src/samples/forms'; import { toQuestionnaire } from './packages/forms/src/to-questionnaire'; process.stdout.write(JSON.stringify(toQuestionnaire(patientIntakeForm()), null, 2));" > packages/cli/src/__fixtures__/sample-questionnaire.json
```
(PowerShell: same command; redirection `>` works.)
Confirm the file is valid Questionnaire JSON beginning with `{ "resourceType": "Questionnaire"`. If `tsx` cannot resolve the relative import, instead add a one-off `samples/forms.test.ts`-style snippet or run the command via `pnpm --filter @openldr/forms exec`.

Then create `packages/cli/src/__fixtures__/sample-response.json` (a filled response for that form; note the patient-intake form requires `family`+`given`, has `sex` choice, `birthDate`):
```json
{
  "resourceType": "QuestionnaireResponse",
  "status": "completed",
  "item": [
    {
      "linkId": "demographics",
      "item": [
        { "linkId": "family", "answer": [{ "valueString": "Doe" }] },
        { "linkId": "given", "answer": [{ "valueString": "Jane" }] },
        { "linkId": "sex", "answer": [{ "valueCoding": { "code": "female" } }] },
        { "linkId": "birthDate", "answer": [{ "valueDate": "1990-05-01" }] }
      ]
    }
  ]
}
```

- [ ] **Step 4: Create the test `packages/cli/src/forms.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runFormsExtract } from './forms';

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('runFormsExtract', () => {
  it('extracts a valid Patient from the sample form + response', () => {
    const out = runFormsExtract(fixture('sample-questionnaire.json'), fixture('sample-response.json'), { subject: { reference: 'Patient/1' } });
    expect(out.invalidCount).toBe(0);
    expect(out.resourceTypes).toContain('Patient');
    expect((out.bundle as { type: string }).type).toBe('transaction');
  });
});
```

- [ ] **Step 5: Run it to verify pass**

Run: `pnpm install && pnpm --filter @openldr/cli test forms`
Expected: PASS (1 test). If `invalidCount > 0`, inspect the extracted Patient (e.g. a `gender` value outside the administrative-gender set, or a malformed `birthDate`) and fix the response fixture — do not weaken validation.

- [ ] **Step 6: Register the `forms` command in `packages/cli/src/index.ts`** — add the import near the others:

```ts
import { runFormsExtract } from './forms';
```

and add this group immediately before `program.parseAsync(process.argv);`:

```ts
const forms = program.command('forms').description('FHIR forms (Questionnaire) utilities');
forms
  .command('extract <questionnaire> <response>')
  .description('Extract FHIR resources from a filled QuestionnaireResponse')
  .option('--json', 'emit the full transaction Bundle JSON', false)
  .option('--subject <ref>', 'subject reference, e.g. Patient/123')
  .action((questionnaire: string, response: string, opts: { json: boolean; subject?: string }) => {
    try {
      const ctx = opts.subject ? { subject: { reference: opts.subject } } : {};
      const out = runFormsExtract(questionnaire, response, ctx);
      if (opts.json) {
        process.stdout.write(JSON.stringify(out.bundle, null, 2) + '\n');
      } else {
        process.stdout.write(`extracted [${out.resourceTypes.join(', ')}]; invalid: ${out.invalidCount}\n`);
      }
      process.exitCode = out.invalidCount === 0 ? 0 : 1;
    } catch (err) {
      process.stderr.write(`forms extract failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });
```
(The existing `errorMessage` import already covers the use above — do not add a duplicate.)

- [ ] **Step 7: Typecheck + build + manual acceptance**

Run: `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build && pnpm --filter @openldr/cli test`
Expected: typecheck clean; `dist/index.js` produced; cli tests pass (format, fhir, db, forms).
Manual:
Run: `pnpm openldr fhir validate packages/cli/src/__fixtures__/sample-questionnaire.json`
Expected: valid; exit 0.
Run: `pnpm openldr forms extract packages/cli/src/__fixtures__/sample-questionnaire.json packages/cli/src/__fixtures__/sample-response.json --subject Patient/1`
Expected: `extracted [Patient]; invalid: 0`; exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): openldr forms extract + fhir validate <form> (P1-CLI-1, DP-4)"
```

---

## Task 9: Final gate

- [ ] **Step 1: Full workspace gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build`
Expected: typecheck clean; all tests pass; `depcruise` no violations (confirms `@openldr/forms` imports only `@openldr/fhir`/`@openldr/core` — no adapter/app/db); builds succeed.

- [ ] **Step 2: Confirm working tree clean**

Run: `git status --short`
Expected: clean (or commit any final lockfile delta with `chore: finalize forms dependency lockfile`).

---

## Done criteria (maps to spec §12)

- [ ] `@openldr/forms` headless; imports only `fhir`/`core` (depcruise-verified).
- [ ] `FormSchema` model with groups + repetition.
- [ ] Lossless `FormSchema ↔ Questionnaire` round-trip (sample test).
- [ ] `QuestionnaireResponse` build/parse + `validateAnswers` (required/type/option/cardinality); hidden fields excluded.
- [ ] Visibility/enableWhen.
- [ ] i18n en/fr/pt with English fallback.
- [ ] Extraction → valid FHIR resources (via `validateResource`) → transaction Bundle.
- [ ] `Questionnaire`+`QuestionnaireResponse` in `@openldr/fhir`; `fhir validate <form>` works.
- [ ] `openldr forms extract` produces a valid transaction Bundle.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green.
