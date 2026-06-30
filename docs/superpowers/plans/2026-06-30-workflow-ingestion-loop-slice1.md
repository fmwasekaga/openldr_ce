# Workflow Ingestion Loop — Slice 1 (Inbound Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inbound half of the ingestion loop as runnable, tested backend: two new host workflow nodes — **Form Validate** (validate items against a form → FHIR resources) and **Persist Store** (write to `fhir_resources` + flat tables, emit `data.persisted`) — plus a `forms` node-options resolver.

**Architecture:** Both nodes are **host** pieces (the wasm sandbox can't reach the DB or forms package). Each node is a thin handler in the workflow engine that delegates to a server-side service injected via `ctx.services` (mirroring the existing `runPluginNode` pattern). A new pure `validateAnswers` helper lives in `@openldr/forms`. The Persist Store service reuses `persistResources()` and the event bus exactly as `ingest-context.ts` already wires them.

**Tech Stack:** TypeScript, pnpm workspaces, Turbo, Vitest, Fastify, Kysely. Packages touched: `@openldr/forms`, `@openldr/workflows`, `@openldr/bootstrap`, `apps/server`.

**Scope note:** This slice is backend only. The builder-UI config panels for the two nodes are a separate web follow-on (Slice 1b). Slices 2 (Event Trigger) and 3 (close the loop) are separate plans.

**Conventions (from project memory):** No repo-wide gate command — run `pnpm typecheck` and `pnpm test` (turbo). Run single files with `pnpm -C <pkg> test <file>`. Work stays on local `main`, committed, **not pushed**. Frequent commits.

---

## File Structure

**Create:**
- `packages/forms/src/validate-answers.ts` — pure `validateAnswers(model, answers)` → `AnswerError[]`
- `packages/forms/src/validate-answers.test.ts`
- `packages/workflows/src/engine/node-handlers/form-validate.ts` — thin handler → `ctx.services.validateForm`
- `packages/workflows/src/engine/node-handlers/persist-store.ts` — thin handler → `ctx.services.persistStore`
- `packages/workflows/src/engine/node-handlers/form-persist-handlers.test.ts` — both handlers
- `packages/bootstrap/src/form-validate-service.ts` — `createFormValidateService(deps)`
- `packages/bootstrap/src/form-validate-service.test.ts`
- `packages/bootstrap/src/persist-store-service.ts` — `createPersistStoreService(deps)`
- `packages/bootstrap/src/persist-store-service.test.ts`

**Modify:**
- `packages/forms/src/pure.ts` and `packages/forms/src/index.ts` — export `validate-answers`
- `packages/workflows/src/engine/services.ts` — add service input/output types + `validateForm?`/`persistStore?`
- `packages/workflows/src/index.ts` — export the new types
- `packages/workflows/src/host-nodes.ts` — add `form-validate` + `persist-store` descriptors
- `packages/workflows/src/engine/node-handlers/index.ts` — register both handlers
- `apps/server/src/workflows-node-options.ts` — add `forms` to deps + `case 'forms'`
- `apps/server/src/workflows-node-options.test.ts` — resolver test (create if absent)
- `apps/server/src/workflows-routes.ts` — inject `forms` resolver into the node-options route
- `packages/bootstrap/src/index.ts` — wire both services into `workflowServices`

---

## Task 1: `validateAnswers` pure helper (forms)

**Files:**
- Create: `packages/forms/src/validate-answers.ts`
- Test: `packages/forms/src/validate-answers.test.ts`
- Modify: `packages/forms/src/pure.ts`, `packages/forms/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/forms/src/validate-answers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateAnswers } from './validate-answers';
import type { FormSchema, FormField } from './schema/form-schema';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
}) as FormField;

const model = (fields: FormField[]): FormSchema => ({
  id: 'form-1', name: 'T', versionLabel: null, fhirVersion: null, fhirResourceType: null,
  fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
  version: 1, active: true, status: 'published', createdAt: '', updatedAt: '',
}) as FormSchema;

describe('validateAnswers', () => {
  it('flags a missing required field', () => {
    const errs = validateAnswers(model([field({ id: 'name', displayLabel: 'Name', required: true })]), {});
    expect(errs).toEqual([{ fieldId: 'name', label: 'Name', reason: 'required' }]);
  });

  it('passes when a required field is present', () => {
    const errs = validateAnswers(model([field({ id: 'name', required: true })]), { name: 'Ada' });
    expect(errs).toEqual([]);
  });

  it('rejects a select value outside the option set', () => {
    const f = field({ id: 'sex', fieldType: 'select', valueSetOptions: [{ code: 'M', display: 'Male' }, { code: 'F', display: 'Female' }] });
    const errs = validateAnswers(model([f]), { sex: 'X' });
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldId).toBe('sex');
  });

  it('allows a custom select value when allowCustomValue is set', () => {
    const f = field({ id: 'sex', fieldType: 'select', allowCustomValue: true, valueSetOptions: [{ code: 'M', display: 'Male' }] });
    expect(validateAnswers(model([f]), { sex: 'X' })).toEqual([]);
  });

  it('enforces numeric min/max', () => {
    const f = field({ id: 'age', fieldType: 'number', constraints: { min: 0, max: 120 } });
    expect(validateAnswers(model([f]), { age: 200 })).toHaveLength(1);
    expect(validateAnswers(model([f]), { age: 30 })).toEqual([]);
  });

  it('enforces text maxLength', () => {
    const f = field({ id: 'note', fieldType: 'text', constraints: { maxLength: 3 } });
    expect(validateAnswers(model([f]), { note: 'abcd' })).toHaveLength(1);
  });

  it('skips disabled and group fields', () => {
    const disabled = field({ id: 'a', required: true, enabled: false });
    const group = field({ id: 'g', required: true, fieldType: 'group' });
    expect(validateAnswers(model([disabled, group]), {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/forms test validate-answers.test.ts`
Expected: FAIL — `validateAnswers` is not exported / module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/forms/src/validate-answers.ts`:

```typescript
import type { FormSchema } from './schema/form-schema';
import type { AnswerState } from './answer-value';

export interface AnswerError {
  fieldId: string;
  label: string;
  reason: string;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Validate filled answers against a form's field contract. Pure; never throws.
 * Checks required presence, select/multiselect option membership (unless
 * allowCustomValue), numeric min/max, and text maxLength. Disabled and group
 * container fields are skipped. Returns a flat list of errors ([] = valid).
 */
export function validateAnswers(model: FormSchema, answers: AnswerState): AnswerError[] {
  const errors: AnswerError[] = [];
  for (const f of model.fields) {
    if (f.enabled === false) continue;
    if (f.fieldType === 'group') continue;

    const value = answers[f.id];
    const push = (reason: string) => errors.push({ fieldId: f.id, label: f.displayLabel, reason });

    if (isEmpty(value)) {
      if (f.required) push('required');
      continue;
    }

    if (f.fieldType === 'select' || f.fieldType === 'multiselect') {
      const options = f.valueSetOptions ?? [];
      if (!f.allowCustomValue && options.length > 0) {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          if (!options.some((o) => o.code === String(v))) push(`'${String(v)}' is not an allowed option`);
        }
      }
    } else if (f.fieldType === 'number') {
      const n = Number(value);
      if (Number.isNaN(n)) {
        push(`'${String(value)}' is not a number`);
      } else {
        if (f.constraints?.min !== undefined && n < f.constraints.min) push(`must be >= ${f.constraints.min}`);
        if (f.constraints?.max !== undefined && n > f.constraints.max) push(`must be <= ${f.constraints.max}`);
      }
    } else if (f.constraints?.maxLength !== undefined && String(value).length > f.constraints.maxLength) {
      push(`exceeds max length ${f.constraints.maxLength}`);
    }
  }
  return errors;
}
```

- [ ] **Step 4: Export from the package barrels**

In `packages/forms/src/pure.ts`, add after the existing `export *` lines:

```typescript
export * from './validate-answers';
```

In `packages/forms/src/index.ts`, add alongside the other `export *` lines (e.g. after `export * from './response';`):

```typescript
export * from './validate-answers';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C packages/forms test validate-answers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/validate-answers.ts packages/forms/src/validate-answers.test.ts packages/forms/src/pure.ts packages/forms/src/index.ts
git commit -m "feat(forms): pure validateAnswers helper for form-contract validation"
```

---

## Task 2: Service types on `WorkflowServices`

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`
- Modify: `packages/workflows/src/index.ts`

This is a types-only task; verification is a typecheck.

- [ ] **Step 1: Add the input/output types and optional methods**

In `packages/workflows/src/engine/services.ts`, ensure `WorkflowItem` is imported (add if missing):

```typescript
import type { WorkflowItem } from './items';
```

Add these exported interfaces near the existing `RunPluginNodeInput`/`RunPluginNodeOutput` definitions:

```typescript
export interface RunFormValidateInput {
  formId: string;
  items: WorkflowItem[];
}
export interface FormValidateInvalid {
  index: number;
  errors: Array<{ fieldId: string; reason: string }>;
}
export interface RunFormValidateOutput {
  items: WorkflowItem[];
  meta: { formId: string; validated: number; invalid: FormValidateInvalid[] };
}

export interface RunPersistStoreInput {
  items: WorkflowItem[];
  source?: string;
}
export interface RunPersistStoreOutput {
  items: WorkflowItem[];
  meta: {
    persisted: number;
    flattened: { written: number; skipped: number; degraded: number };
    resourceTypes: string[];
  };
}
```

In the `WorkflowServices` interface, add these two optional methods next to `runPluginNode?`:

```typescript
  /** Validate items against a form definition → FHIR resource items. Host-injected. */
  validateForm?(input: RunFormValidateInput): Promise<RunFormValidateOutput>;
  /** Persist FHIR resource items + emit data.persisted. Host-injected. */
  persistStore?(input: RunPersistStoreInput): Promise<RunPersistStoreOutput>;
```

- [ ] **Step 2: Export the new types from the package index**

In `packages/workflows/src/index.ts`, extend the existing services export (currently `export { type RunPluginNodeInput, type RunPluginNodeOutput } from './engine/services';`) to:

```typescript
export {
  type RunPluginNodeInput,
  type RunPluginNodeOutput,
  type RunFormValidateInput,
  type RunFormValidateOutput,
  type FormValidateInvalid,
  type RunPersistStoreInput,
  type RunPersistStoreOutput,
} from './engine/services';
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -C packages/workflows typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/workflows/src/engine/services.ts packages/workflows/src/index.ts
git commit -m "feat(workflows): service types for validateForm and persistStore"
```

---

## Task 3: Form Validate + Persist Store handlers and descriptors

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/form-validate.ts`
- Create: `packages/workflows/src/engine/node-handlers/persist-store.ts`
- Test: `packages/workflows/src/engine/node-handlers/form-persist-handlers.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Modify: `packages/workflows/src/host-nodes.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/form-persist-handlers.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { formValidateHandler } from './form-validate';
import { persistStoreHandler } from './persist-store';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

describe('formValidateHandler', () => {
  it('delegates to services.validateForm and stores meta', async () => {
    const validateForm = vi.fn(async ({ formId, items }: { formId: string; items: WorkflowItem[] }) => ({
      items: [{ json: { resourceType: 'Observation' } }],
      meta: { formId, validated: items.length, invalid: [] },
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { validateForm } as unknown as WorkflowServices);
    const out = await formValidateHandler(
      { id: 'fv', type: 'action', data: { action: 'form-validate', config: { formId: 'form-1' } } },
      ctx,
      [{ json: { name: 'Ada' } }],
    );
    expect(validateForm).toHaveBeenCalledWith({ formId: 'form-1', items: [{ json: { name: 'Ada' } }] });
    expect(out).toEqual([{ json: { resourceType: 'Observation' } }]);
    expect(ctx.nodeMeta['fv']).toEqual({ formId: 'form-1', validated: 1, invalid: [] });
  });

  it('throws when formId is missing', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, { validateForm: vi.fn() } as unknown as WorkflowServices);
    await expect(
      formValidateHandler({ id: 'fv', type: 'action', data: { action: 'form-validate', config: {} } }, ctx, []),
    ).rejects.toThrow(/formId is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, undefined);
    await expect(
      formValidateHandler({ id: 'fv', type: 'action', data: { action: 'form-validate', config: { formId: 'x' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});

describe('persistStoreHandler', () => {
  it('delegates to services.persistStore, returns input, stores meta', async () => {
    const persistStore = vi.fn(async ({ items, source }: { items: WorkflowItem[]; source?: string }) => ({
      items,
      meta: { persisted: items.length, flattened: { written: items.length, skipped: 0, degraded: 0 }, resourceTypes: ['Observation'], source },
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { persistStore } as unknown as WorkflowServices);
    const input: WorkflowItem[] = [{ json: { resourceType: 'Observation' } }];
    const out = await persistStoreHandler(
      { id: 'ps', type: 'action', data: { action: 'persist-store', config: { source: 'amr' } } },
      ctx,
      input,
    );
    expect(persistStore).toHaveBeenCalledWith({ items: input, source: 'amr' });
    expect(out).toBe(input);
    expect((ctx.nodeMeta['ps'] as { persisted: number }).persisted).toBe(1);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, undefined);
    await expect(
      persistStoreHandler({ id: 'ps', type: 'action', data: { action: 'persist-store', config: {} } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/workflows test form-persist-handlers.test.ts`
Expected: FAIL — handler modules not found.

- [ ] **Step 3: Write the handlers**

Create `packages/workflows/src/engine/node-handlers/form-validate.ts`:

```typescript
import type { NodeHandler } from './types';

export const formValidateHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.validateForm) throw new Error('Form Validate node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const formId = String(config.formId ?? '').trim();
  if (!formId) throw new Error('Form Validate node: formId is required');
  const result = await ctx.services.validateForm({ formId, items: input });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
```

Create `packages/workflows/src/engine/node-handlers/persist-store.ts`:

```typescript
import type { NodeHandler } from './types';

export const persistStoreHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.persistStore) throw new Error('Persist Store node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const source = String(config.source ?? '').trim() || undefined;
  const result = await ctx.services.persistStore({ items: input, source });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
```

- [ ] **Step 4: Register the handlers**

In `packages/workflows/src/engine/node-handlers/index.ts`, add the imports near the other handler imports:

```typescript
import { formValidateHandler } from './form-validate';
import { persistStoreHandler } from './persist-store';
```

Add two entries to the `ACTION_HANDLERS` map:

```typescript
  'form-validate': formValidateHandler,
  'persist-store': persistStoreHandler,
```

- [ ] **Step 5: Add the node descriptors**

In `packages/workflows/src/host-nodes.ts`, add to the `HOST_NODE_DESCRIPTORS` array — `form-validate` in the Transforms group, `persist-store` in the Sinks group:

```typescript
  { id: 'form-validate', source: 'host', label: 'Form Validate', kind: 'transform', description: 'Validate items against a form and emit FHIR resources.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'formId', label: 'Form', type: 'select', required: true, optionsSource: 'forms' }] },
```

```typescript
  { id: 'persist-store', source: 'host', label: 'Persist Store', kind: 'sink', description: 'Persist FHIR resources and emit a data.persisted event.', ports: { inputs: [port('in')], outputs: [] }, capabilities: [], config: [{ key: 'source', label: 'Source system', type: 'text', required: false }] },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm -C packages/workflows test form-persist-handlers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Verify typecheck (descriptor field validity)**

Run: `pnpm -C packages/workflows typecheck`
Expected: PASS. If `optionsSource`/`required` are rejected on `WorkflowConfigField`, open `packages/workflows/src/host-nodes.ts` imports, find the `WorkflowConfigField` type, and confirm those optional fields exist (they are used by plugin node descriptors). Do not widen the type unless a field is genuinely absent.

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/form-validate.ts packages/workflows/src/engine/node-handlers/persist-store.ts packages/workflows/src/engine/node-handlers/form-persist-handlers.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts
git commit -m "feat(workflows): Form Validate + Persist Store host nodes"
```

---

## Task 4: Form Validate service (bootstrap)

**Files:**
- Create: `packages/bootstrap/src/form-validate-service.ts`
- Test: `packages/bootstrap/src/form-validate-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/form-validate-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createFormValidateService } from './form-validate-service';
import type { FormSchema, FormField } from '@openldr/forms';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
}) as FormField;

const schema = (fields: FormField[]): FormSchema => ({
  id: 'form-1', name: 'T', versionLabel: null, fhirVersion: null, fhirResourceType: null,
  fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
  version: 1, active: true, status: 'published', createdAt: '', updatedAt: '',
}) as FormSchema;

describe('createFormValidateService', () => {
  it('throws when the form is not found', async () => {
    const svc = createFormValidateService({ forms: { get: vi.fn(async () => null) } });
    await expect(svc({ formId: 'missing', items: [] })).rejects.toThrow(/Form not found/);
  });

  it('collects invalid items into meta and excludes them from output', async () => {
    const forms = { get: vi.fn(async () => ({ schema: schema([field({ id: 'name', displayLabel: 'Name', required: true })]) })) };
    const svc = createFormValidateService({ forms });
    const out = await svc({ formId: 'form-1', items: [{ json: {} }] });
    expect(out.meta.validated).toBe(0);
    expect(out.meta.invalid).toEqual([{ index: 0, errors: [{ fieldId: 'name', reason: 'required' }] }]);
    expect(out.items).toEqual([]);
  });

  it('counts a valid item as validated', async () => {
    const forms = { get: vi.fn(async () => ({ schema: schema([field({ id: 'name', required: true })]) })) };
    const svc = createFormValidateService({ forms });
    const out = await svc({ formId: 'form-1', items: [{ json: { name: 'Ada' } }] });
    expect(out.meta.validated).toBe(1);
    expect(out.meta.invalid).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/bootstrap test form-validate-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `packages/bootstrap/src/form-validate-service.ts`:

```typescript
import {
  validateAnswers,
  toQuestionnaire,
  toQuestionnaireResponse,
  ObservationExtractor,
  ServiceRequestExtractor,
  type FormSchema,
} from '@openldr/forms';
import type { RunFormValidateInput, RunFormValidateOutput, WorkflowItem } from '@openldr/workflows';

export interface FormValidateServiceDeps {
  forms: { get(id: string): Promise<{ schema: FormSchema } | null> };
}

/**
 * Validate each input item's `json` (treated as form answers) against the chosen
 * form. Valid items become extracted FHIR resource items (Observation/ServiceRequest);
 * invalid items are dropped and recorded in `meta.invalid` with per-field reasons.
 */
export function createFormValidateService(
  deps: FormValidateServiceDeps,
): (input: RunFormValidateInput) => Promise<RunFormValidateOutput> {
  return async ({ formId, items }) => {
    const def = await deps.forms.get(formId);
    if (!def) throw new Error(`Form not found: ${formId}`);
    const model = def.schema;
    const questionnaire = toQuestionnaire(model);

    const out: WorkflowItem[] = [];
    const invalid: RunFormValidateOutput['meta']['invalid'] = [];
    let validated = 0;

    items.forEach((item, index) => {
      const answers = item.json;
      const errs = validateAnswers(model, answers);
      if (errs.length > 0) {
        invalid.push({ index, errors: errs.map((e) => ({ fieldId: e.fieldId, reason: e.reason })) });
        return;
      }
      validated += 1;
      const response = toQuestionnaireResponse(model, answers);
      const resources = [
        ...ObservationExtractor.extract(response, questionnaire, {}),
        ...ServiceRequestExtractor.extract(response, questionnaire, {}),
      ];
      for (const r of resources) out.push({ json: r as unknown as Record<string, unknown> });
    });

    return { items: out, meta: { formId, validated, invalid } };
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/bootstrap test form-validate-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/form-validate-service.ts packages/bootstrap/src/form-validate-service.test.ts
git commit -m "feat(bootstrap): form-validate service (validate answers + extract FHIR)"
```

---

## Task 5: Persist Store service (bootstrap)

**Files:**
- Create: `packages/bootstrap/src/persist-store-service.ts`
- Test: `packages/bootstrap/src/persist-store-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/persist-store-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPersistStoreService } from './persist-store-service';
import type { PersistResult } from '@openldr/db';

describe('createPersistStoreService', () => {
  it('persists resources and publishes data.persisted with counts and types', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => [
      { saved: true, flattened: 'written' },
      { saved: true, flattened: 'skipped' },
    ]);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish });

    const out = await svc({
      items: [{ json: { resourceType: 'Observation' } }, { json: { resourceType: 'Bundle' } }],
      source: 'amr',
    });

    expect(persist).toHaveBeenCalledWith(
      [{ resourceType: 'Observation' }, { resourceType: 'Bundle' }],
      { sourceSystem: 'amr' },
    );
    expect(out.meta.persisted).toBe(2);
    expect(out.meta.flattened).toEqual({ written: 1, skipped: 1, degraded: 0 });
    expect(out.meta.resourceTypes.sort()).toEqual(['Bundle', 'Observation']);
    expect(publish).toHaveBeenCalledWith({
      type: 'data.persisted',
      payload: { source: 'amr', resourceTypes: ['Observation', 'Bundle'], count: 2 },
    });
    expect(out.items).toHaveLength(2);
  });

  it('does not publish when nothing was persisted', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => []);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish });
    await svc({ items: [], source: undefined });
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/bootstrap test persist-store-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `packages/bootstrap/src/persist-store-service.ts`:

```typescript
import type { Provenance, PersistResult } from '@openldr/db';
import type { RunPersistStoreInput, RunPersistStoreOutput } from '@openldr/workflows';

export interface PersistStoreServiceDeps {
  persist(resources: unknown[], provenance: Provenance): Promise<PersistResult[]>;
  publish(event: { type: string; payload: unknown }): Promise<void>;
}

/**
 * Persist FHIR resource items (each item's `json` is one resource) via the shared
 * persist path, then announce success as a `data.persisted` event so downstream
 * (event-triggered) workflows can react. Items pass through unchanged.
 */
export function createPersistStoreService(
  deps: PersistStoreServiceDeps,
): (input: RunPersistStoreInput) => Promise<RunPersistStoreOutput> {
  return async ({ items, source }) => {
    const resources = items.map((i) => i.json);
    const provenance: Provenance = source ? { sourceSystem: source } : {};
    const results = await deps.persist(resources, provenance);

    const flattened = { written: 0, skipped: 0, degraded: 0 };
    for (const r of results) flattened[r.flattened] += 1;

    const resourceTypes = Array.from(
      new Set(
        resources
          .map((r) => (r as { resourceType?: string }).resourceType)
          .filter((t): t is string => Boolean(t)),
      ),
    );
    const persisted = results.filter((r) => r.saved).length;

    if (persisted > 0) {
      await deps.publish({ type: 'data.persisted', payload: { source: source ?? null, resourceTypes, count: persisted } });
    }

    return { items, meta: { persisted, flattened, resourceTypes } };
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/bootstrap test persist-store-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/persist-store-service.ts packages/bootstrap/src/persist-store-service.test.ts
git commit -m "feat(bootstrap): persist-store service (persist + data.persisted emit)"
```

---

## Task 6: `forms` node-options resolver (apps/server)

**Files:**
- Modify: `apps/server/src/workflows-node-options.ts`
- Test: `apps/server/src/workflows-node-options.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create (or append to) `apps/server/src/workflows-node-options.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveNodeOptions, type NodeOptionsDeps } from './workflows-node-options';

const deps = (): NodeOptionsDeps => ({
  connectors: { list: async () => [] },
  datasets: { list: async () => [] },
  dhis2Mappings: async () => [],
  forms: { listPublished: async () => [{ id: 'form-1', name: 'AMR Result' }, { id: 'form-2', name: 'TB Result' }] },
});

describe('resolveNodeOptions forms', () => {
  it('maps published forms to {value,label}', async () => {
    const out = await resolveNodeOptions('forms', deps());
    expect(out).toEqual([
      { value: 'form-1', label: 'AMR Result' },
      { value: 'form-2', label: 'TB Result' },
    ]);
  });

  it('returns [] for an unknown source', async () => {
    expect(await resolveNodeOptions('nope', deps())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/server test workflows-node-options.test.ts`
Expected: FAIL — `forms` not on `NodeOptionsDeps` (type error) and/or `case 'forms'` missing.

- [ ] **Step 3: Add `forms` to deps and the resolver switch**

In `apps/server/src/workflows-node-options.ts`, extend `NodeOptionsDeps`:

```typescript
export interface NodeOptionsDeps {
  connectors: { list(): Promise<Array<{ id: string; name: string; pluginId: string }>> };
  datasets: { list(): Promise<Array<{ name: string }>> };
  /** dhis2-sink mappings from plugin_data (id/name). */
  dhis2Mappings(): Promise<Array<{ id: string; name: string }>>;
  /** Published forms for the Form Validate node picker. */
  forms: { listPublished(): Promise<Array<{ id: string; name: string }>> };
}
```

Add a `case` inside the `switch (source)` in `resolveNodeOptions`, before `default`:

```typescript
      case 'forms':
        return (await deps.forms.listPublished()).map((f) => ({ value: f.id, label: f.name }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C apps/server test workflows-node-options.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/workflows-node-options.ts apps/server/src/workflows-node-options.test.ts
git commit -m "feat(server): forms node-options resolver for Form Validate picker"
```

---

## Task 7: Inject the `forms` resolver into the route

**Files:**
- Modify: `apps/server/src/workflows-routes.ts`

The `NodeOptionsDeps` type now requires a `forms` field, so the existing route's deps object will fail typecheck until updated. (`ctx.forms` is the form store on `AppContext`; `listPublished()` returns summaries with `id` and `name`.)

- [ ] **Step 1: Add the `forms` resolver to the node-options route deps**

In `apps/server/src/workflows-routes.ts`, inside the `GET /api/workflows/node-options/:source` handler, add a `forms` entry to the object passed to `resolveNodeOptions` (alongside `connectors`, `datasets`, `dhis2Mappings`):

```typescript
    forms: { listPublished: () => ctx.forms.listPublished() },
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm -C apps/server typecheck`
Expected: PASS. If `ctx.forms.listPublished` is not found, confirm the form store is exposed on `AppContext` as `forms` (it is — see `packages/bootstrap/src/index.ts` AppContext return) and that `listPublished` is in its returned method set.

- [ ] **Step 3: Run the existing route tests to confirm no regression**

Run: `pnpm -C apps/server test workflows-routes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/workflows-routes.ts
git commit -m "feat(server): wire forms resolver into node-options route"
```

---

## Task 8: Bootstrap wiring — inject both services

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

Reuse the exact persist assembly proven in `packages/bootstrap/src/ingest-context.ts:50-64`: a canonical `fhirStore` on `internal.db`, a `flatWriter` from the external store, and `persistResources({ fhirStore, flatWriter, logger }, …)`. The Persist Store service publishes via the AppContext `eventing` bus (created at `index.ts:163`).

- [ ] **Step 1: Add imports**

In `packages/bootstrap/src/index.ts`, extend the `@openldr/db` import (line 9) to also bring in `createFlatWriter`, `persistResources`, and the `Provenance`/`ExternalSchema` types:

```typescript
import { createInternalDb, createFhirStore, createFlatWriter, persistResources, createTerminologyStore, createTerminologyAdminStore, createOntologyStore, createReportRunStore, createReportScheduleStore, createMarketplaceInstallStore, createRegistryStore, deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore, type OntologyStore, type FhirStore, type ReportRunStore, type ReportScheduleStore, type ExternalSchema, type Provenance } from '@openldr/db';
```

Add the two service factory imports near the other local bootstrap imports:

```typescript
import { createFormValidateService } from './form-validate-service';
import { createPersistStoreService } from './persist-store-service';
```

Ensure `Kysely` is imported (it is used to cast the external db). If not already present, add:

```typescript
import { Kysely } from 'kysely';
```

- [ ] **Step 2: Expose the target-store engine + external db handle**

Find the `selectTargetStore` call (around `index.ts:164`, currently `const { store } = selectTargetStore(cfg);`) and change it to also capture `engine`, then derive the external db handle (mirroring `ingest-context.ts:50-51`):

```typescript
  const { store, engine } = selectTargetStore(cfg);
  const externalDb = store.db as unknown as Kysely<ExternalSchema>;
```

- [ ] **Step 3: Build the canonical persist function**

Immediately after the `eventing` creation (around `index.ts:163`), add (this uses `internal` from `createInternalDb` and `logger`, both already in scope):

```typescript
  // Canonical persist for the Persist Store workflow node — same wiring as ingest-context.
  const canonicalFhirStore = createFhirStore(internal.db);
  const workflowFlatWriter = createFlatWriter(externalDb, engine);
  const workflowPersist = (resources: unknown[], prov: Provenance) =>
    persistResources({ fhirStore: canonicalFhirStore, flatWriter: workflowFlatWriter, logger }, resources, prov);
```

- [ ] **Step 4: Attach the services to `workflowServices`**

Find where `workflowServices.runPluginNode = createPluginNodeService({…})` is assigned (around `index.ts:406`). Add directly after it:

```typescript
  workflowServices.validateForm = createFormValidateService({ forms });
  workflowServices.persistStore = createPersistStoreService({
    persist: workflowPersist,
    publish: (event) => eventing.publish(event),
  });
```

(`forms` is the form store created earlier at `index.ts:172` via `createFormStore`.)

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm -C packages/bootstrap typecheck`
Expected: PASS. If `forms` is not in scope at the assignment site, search the file for `createFormStore(` to find the variable name and use it.

- [ ] **Step 6: Run the bootstrap tests**

Run: `pnpm -C packages/bootstrap test`
Expected: PASS (existing tests + the two new service tests).

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): wire Form Validate + Persist Store services into the engine"
```

---

## Task 9: Full typecheck + test gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: PASS across all packages. (Turbo may cache; if a cross-package break is suspected, re-run with `pnpm typecheck -- --force` per project convention.)

- [ ] **Step 2: Run the whole test suite**

Run: `pnpm test`
Expected: PASS. The new tests live in `@openldr/forms`, `@openldr/workflows`, `@openldr/bootstrap`, and `apps/server`. (`@openldr/web#test` has a known parallel flake — not touched here; ignore any web red and re-run isolated if it appears.)

- [ ] **Step 3: Confirm the node registry lists the new nodes**

Run: `pnpm -C packages/workflows test`
Expected: PASS. The two descriptors are now part of `HOST_NODE_DESCRIPTORS`, so the registry (`createWorkflowNodeRegistry`) surfaces `form-validate` and `persist-store` to the builder's node list automatically.

- [ ] **Step 4: Final commit (if any lint/format adjustments were needed)**

```bash
git add -A
git commit -m "chore(workflows): slice 1 ingestion-loop backend — gate green"
```

---

## Done criteria for Slice 1

- `validateAnswers` is a pure, exported, tested helper in `@openldr/forms`.
- `form-validate` and `persist-store` appear in `HOST_NODE_DESCRIPTORS` and route to their handlers.
- The handlers delegate to `ctx.services.validateForm` / `ctx.services.persistStore`, which bootstrap injects.
- The Form Validate service validates against a form and emits extracted FHIR; the Persist Store service persists via the shared path and publishes `data.persisted`.
- The `forms` options-source backs the Form Validate node's form picker.
- `pnpm typecheck` and `pnpm test` are green.

## Follow-on (separate plans)

- **Slice 1b (web):** render the Form Validate + Persist Store config panels in the builder (form picker via the `forms` options-source, source text field) and confirm an end-to-end run from the UI persists rows and shows invalid-row meta in the Output tab.
- **Slice 2:** the generic `event` Trigger type + subscriber listening for `data.persisted`.
- **Slice 3:** close the loop — Event Trigger → query new rows → dhis2-sink.
