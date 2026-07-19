# FHIR Validation Strictness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable FHIR validation strictness (low/medium/high, default high) with an extensible clinical-rule framework whose first rule requires a lab result to be linked to an order, gating the front-door persist path with atomic batch rejection.

**Architecture:** A small rule registry beside the existing structural validator in `@openldr/fhir` exposes `validateBatch(resources, {level, resolveServiceRequest})`. `persistResources` (`@openldr/db`) runs it before saving anything and throws a coded `AppError` carrying an `OperationOutcome` on failure. The level is a DB-backed `validation.strictness` app-setting, read by bootstrap and injected into the persist wrappers; sync push is untouched. Operators change the level from the Danger Zone behind a type-to-confirm dialog, or via `openldr settings validation`.

**Tech Stack:** TypeScript (pnpm workspaces, vitest), Zod, Fastify, React + Vite (studio), Rust→WASM (WHONET plugin, `cargo` + `wasm32`).

**Spec:** `docs/superpowers/specs/2026-07-18-fhir-validation-strictness-design.md`

---

## File Structure

**Create**
- `packages/fhir/src/rules/types.ts` — `StrictnessLevel`, `RuleContext`, `ClinicalRule`, `LEVEL_RANK`.
- `packages/fhir/src/rules/result-requires-request.ts` — rule #1.
- `packages/fhir/src/rules/index.ts` — `CLINICAL_RULES` registry.
- `packages/fhir/src/validate-batch.ts` — `validateBatch`.
- `packages/fhir/src/rules/result-requires-request.test.ts`, `packages/fhir/src/validate-batch.test.ts`.
- `packages/bootstrap/src/validation-settings.ts` — `createValidationStrictness` accessor.
- `packages/bootstrap/src/validation-settings.test.ts`.
- `scripts/validation-strictness-live-acceptance.ts` — live acceptance.
- `apps/studio/src/components/ui/type-to-confirm-dialog.tsx` — reusable dialog.
- `apps/studio/src/components/ui/type-to-confirm-dialog.test.tsx`.

**Modify**
- `packages/fhir/src/index.ts` — export the new surface.
- `packages/core/src/error-catalog.ts` — add `VA0002` (+ `VA` domain).
- `packages/db/src/fhir-store.ts` — add `exists(resourceType, id)`.
- `packages/db/src/persist.ts` — `validateBatch` gate + `PersistOpts`.
- `packages/bootstrap/src/index.ts` — wire level + resolver into `workflowPersist`; export accessor.
- `packages/bootstrap/src/ingest-context.ts` — wire level + resolver into the ingest persist.
- `apps/server/src/settings-routes.ts` — `GET/PUT /api/settings/validation` + audit.
- `apps/studio/src/api.ts` — client fns `getValidation` / `setValidation`.
- `apps/studio/src/pages/settings/General.tsx` — Danger Zone "Data validation" row.
- `apps/studio/src/i18n/{en,fr,pt}.ts` — strings.
- `packages/cli/src/index.ts` + `packages/cli/src/settings.ts` — `settings validation show|set`.
- `wasm/openldr-plugin-sdk/src/fhir.rs` — `based_on` on observation helpers.
- `wasm/whonet-sqlite/src/mapping.rs` — emit `ServiceRequest` + link `basedOn`.
- `apps/web/src/docs/0.1.0/load-data.md` — clinically-complete Bundle example + verified webhook recipe.

---

## Task 1: Rules framework types (`@openldr/fhir`)

**Files:**
- Create: `packages/fhir/src/rules/types.ts`
- Test: (covered by Task 2/3 tests)

- [ ] **Step 1: Write the types**

```ts
// packages/fhir/src/rules/types.ts
import type { OperationOutcomeIssue } from '../operation-outcome';
import type { FhirResource } from '../validate';

export type StrictnessLevel = 'low' | 'medium' | 'high';

export const LEVEL_RANK: Record<StrictnessLevel, number> = { low: 0, medium: 1, high: 2 };

/** True when `level` is at least as strict as `min`. */
export function levelAtLeast(level: StrictnessLevel, min: StrictnessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

export interface RuleContext {
  level: StrictnessLevel;
  /** Every resource in the current persist batch (already structurally valid). */
  batch: FhirResource[];
  /** Does a ServiceRequest with this id already exist in the store? Injected by the caller. */
  resolveServiceRequest(id: string): Promise<boolean>;
}

export interface ClinicalRule {
  id: string;
  description: string;
  /** Lowest level at which this rule runs. */
  minLevel: StrictnessLevel;
  appliesTo(resource: FhirResource): boolean;
  check(resource: FhirResource, ctx: RuleContext): Promise<OperationOutcomeIssue[]> | OperationOutcomeIssue[];
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/fhir typecheck`
Expected: PASS (no emit). If `OperationOutcomeIssue`/`FhirResource` import paths differ, fix to match `operation-outcome.ts` / `validate.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/fhir/src/rules/types.ts
git commit -m "feat(fhir): validation rule framework types"
```

---

## Task 2: Rule #1 — result-requires-request

**Files:**
- Create: `packages/fhir/src/rules/result-requires-request.ts`
- Test: `packages/fhir/src/rules/result-requires-request.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/fhir/src/rules/result-requires-request.test.ts
import { describe, it, expect } from 'vitest';
import { resultRequiresRequest } from './result-requires-request';
import type { RuleContext } from './types';
import type { FhirResource } from '../validate';

const labObs = (extra: Record<string, unknown> = {}): FhirResource => ({
  resourceType: 'Observation', id: 'o1', status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text: 'Hb' }, subject: { reference: 'Patient/p1' }, ...extra,
});
const ctx = (level: RuleContext['level'], batch: FhirResource[] = [], exists = false): RuleContext => ({
  level, batch, resolveServiceRequest: async () => exists,
});

describe('resultRequiresRequest', () => {
  it('applies to laboratory Observation and LAB DiagnosticReport only', () => {
    expect(resultRequiresRequest.appliesTo(labObs())).toBe(true);
    expect(resultRequiresRequest.appliesTo({ resourceType: 'QuestionnaireResponse', id: 'q' } as FhirResource)).toBe(false);
    expect(resultRequiresRequest.appliesTo({ resourceType: 'Observation', id: 'v', status: 'final',
      category: [{ coding: [{ code: 'vital-signs' }] }], code: {} } as FhirResource)).toBe(false);
    expect(resultRequiresRequest.appliesTo({ resourceType: 'DiagnosticReport', id: 'd', status: 'final',
      category: [{ coding: [{ code: 'LAB' }] }], code: {} } as FhirResource)).toBe(true);
  });

  it('medium: flags a missing basedOn', async () => {
    expect(await resultRequiresRequest.check(labObs(), ctx('medium'))).toHaveLength(1);
    expect(await resultRequiresRequest.check(labObs({ basedOn: [{ reference: 'ServiceRequest/sr1' }] }), ctx('medium'))).toHaveLength(0);
  });

  it('high: a basedOn that resolves nowhere is flagged; in-batch or in-store resolves', async () => {
    const obs = labObs({ basedOn: [{ reference: 'ServiceRequest/sr1' }] });
    expect(await resultRequiresRequest.check(obs, ctx('high'))).toHaveLength(1);            // dangling
    const sr: FhirResource = { resourceType: 'ServiceRequest', id: 'sr1', status: 'active' } as FhirResource;
    expect(await resultRequiresRequest.check(obs, ctx('high', [sr]))).toHaveLength(0);       // in batch
    expect(await resultRequiresRequest.check(obs, ctx('high', [], true))).toHaveLength(0);    // in store
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/fhir exec vitest run src/rules/result-requires-request.test.ts`
Expected: FAIL — cannot import `resultRequiresRequest`.

- [ ] **Step 3: Implement rule #1**

```ts
// packages/fhir/src/rules/result-requires-request.ts
import type { OperationOutcomeIssue } from '../operation-outcome';
import type { FhirResource } from '../validate';
import { levelAtLeast, type ClinicalRule, type RuleContext } from './types';

interface Coding { system?: string; code?: string }
interface CodeableConcept { coding?: Coding[] }
interface Reference { reference?: string; type?: string }

function hasCategoryCode(resource: FhirResource, code: string): boolean {
  const cats = (resource as { category?: CodeableConcept[] }).category ?? [];
  return cats.some((c) => (c.coding ?? []).some((cd) => cd.code === code));
}

function isLabResult(resource: FhirResource): boolean {
  if (resource.resourceType === 'Observation') return hasCategoryCode(resource, 'laboratory');
  if (resource.resourceType === 'DiagnosticReport') return hasCategoryCode(resource, 'LAB');
  return false;
}

/** Extract ServiceRequest ids referenced by basedOn (reference "ServiceRequest/<id>" or type). */
function serviceRequestRefs(resource: FhirResource): string[] {
  const based = (resource as { basedOn?: Reference[] }).basedOn ?? [];
  return based
    .map((r) => {
      const ref = r.reference ?? '';
      if (ref.startsWith('ServiceRequest/')) return ref.slice('ServiceRequest/'.length);
      if (r.type === 'ServiceRequest' && ref) return ref;
      return null;
    })
    .filter((x): x is string => x != null);
}

export const resultRequiresRequest: ClinicalRule = {
  id: 'result-requires-request',
  description: 'A laboratory result (Observation category=laboratory, or DiagnosticReport category=LAB) must be linked to a ServiceRequest via basedOn.',
  minLevel: 'medium',
  appliesTo: isLabResult,
  async check(resource, ctx: RuleContext) {
    const expr = [`${resource.resourceType}/${(resource as { id?: string }).id ?? '?'}.basedOn`];
    const refs = serviceRequestRefs(resource);
    if (refs.length === 0) {
      return [{ severity: 'error', code: 'required',
        diagnostics: 'laboratory result must reference a ServiceRequest (basedOn)', expression: expr }];
    }
    if (!levelAtLeast(ctx.level, 'high')) return []; // medium: presence is enough
    const inBatch = new Set(
      ctx.batch.filter((r) => r.resourceType === 'ServiceRequest').map((r) => (r as { id?: string }).id),
    );
    for (const id of refs) {
      if (inBatch.has(id)) return [];
      if (await ctx.resolveServiceRequest(id)) return [];
    }
    return [{ severity: 'error', code: 'not-found',
      diagnostics: `basedOn ServiceRequest not found in batch or store: ${refs.join(', ')}`, expression: expr }];
  },
};
```

> Note: match `OperationOutcomeIssue`'s real fields — the tests only assert issue *count*, but confirm `diagnostics` is the correct message field in `operation-outcome.ts` (adjust if it is named differently, e.g. `details`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/fhir exec vitest run src/rules/result-requires-request.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/fhir/src/rules/result-requires-request.ts packages/fhir/src/rules/result-requires-request.test.ts
git commit -m "feat(fhir): rule #1 result-requires-request"
```

---

## Task 3: `validateBatch` + registry + exports

**Files:**
- Create: `packages/fhir/src/rules/index.ts`, `packages/fhir/src/validate-batch.ts`, `packages/fhir/src/validate-batch.test.ts`
- Modify: `packages/fhir/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/fhir/src/validate-batch.test.ts
import { describe, it, expect } from 'vitest';
import { validateBatch } from './validate-batch';
import type { StrictnessLevel } from './rules/types';

const patient = { resourceType: 'Patient', id: 'p1' };
const sr = { resourceType: 'ServiceRequest', id: 'sr1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' } };
const labObs = (basedOn?: unknown) => ({
  resourceType: 'Observation', id: 'o1', status: 'final',
  category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Hb' }, subject: { reference: 'Patient/p1' },
  ...(basedOn ? { basedOn } : {}),
});
const run = (resources: unknown[], level: StrictnessLevel, exists = false) =>
  validateBatch(resources, { level, resolveServiceRequest: async () => exists });

describe('validateBatch', () => {
  it('low: structural only — a lab result with no order passes', async () => {
    const r = await run([patient, labObs()], 'low');
    expect(r.ok).toBe(true);
  });
  it('high: a lab result with no order fails with an OperationOutcome', async () => {
    const r = await run([patient, labObs()], 'high');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue.length).toBeGreaterThan(0);
  });
  it('high: result + its order in the same batch passes', async () => {
    const r = await run([patient, sr, labObs([{ reference: 'ServiceRequest/sr1' }])], 'high');
    expect(r.ok).toBe(true);
  });
  it('still rejects structurally invalid resources at any level', async () => {
    const r = await run([{ resourceType: 'Observation' /* missing required fields */ }], 'low');
    expect(r.ok).toBe(false);
  });
  it('aggregates multiple issues into one outcome', async () => {
    const r = await run([labObs(), labObs()], 'medium');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/fhir exec vitest run src/validate-batch.test.ts`
Expected: FAIL — cannot import `validateBatch`.

- [ ] **Step 3: Implement the registry + validateBatch**

```ts
// packages/fhir/src/rules/index.ts
import type { ClinicalRule } from './types';
import { resultRequiresRequest } from './result-requires-request';

export const CLINICAL_RULES: ClinicalRule[] = [resultRequiresRequest];
export * from './types';
```

```ts
// packages/fhir/src/validate-batch.ts
import { validateResource, type FhirResource } from './validate';
import { outcomeFromIssues, type OperationOutcome, type OperationOutcomeIssue } from './operation-outcome';
import { CLINICAL_RULES, levelAtLeast, type StrictnessLevel } from './rules';

export interface ValidateBatchOpts {
  level: StrictnessLevel;
  resolveServiceRequest(id: string): Promise<boolean>;
}

export type ValidateBatchResult =
  | { ok: true; resources: FhirResource[] }
  | { ok: false; outcome: OperationOutcome };

export async function validateBatch(resources: unknown[], opts: ValidateBatchOpts): Promise<ValidateBatchResult> {
  const issues: OperationOutcomeIssue[] = [];
  const valid: FhirResource[] = [];

  // 1) Structural — always.
  for (const r of resources) {
    const res = validateResource(r);
    if (res.ok) valid.push(res.resource);
    else issues.push(...res.outcome.issue);
  }
  if (issues.length > 0) return { ok: false, outcome: outcomeFromIssues(issues) };

  // 2) Clinical rules at/below the active level.
  const rules = CLINICAL_RULES.filter((rule) => levelAtLeast(opts.level, rule.minLevel));
  const ctx = { level: opts.level, batch: valid, resolveServiceRequest: opts.resolveServiceRequest };
  for (const resource of valid) {
    for (const rule of rules) {
      if (!rule.appliesTo(resource)) continue;
      issues.push(...(await rule.check(resource, ctx)));
    }
  }
  if (issues.length > 0) return { ok: false, outcome: outcomeFromIssues(issues) };
  return { ok: true, resources: valid };
}
```

- [ ] **Step 4: Export the surface**

Modify `packages/fhir/src/index.ts` — add:

```ts
export { validateBatch, type ValidateBatchOpts, type ValidateBatchResult } from './validate-batch';
export { CLINICAL_RULES, LEVEL_RANK, levelAtLeast, type StrictnessLevel, type ClinicalRule, type RuleContext } from './rules';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @openldr/fhir exec vitest run` then `pnpm --filter @openldr/fhir typecheck`
Expected: PASS (all fhir tests, including the two new files).

- [ ] **Step 6: Commit**

```bash
git add packages/fhir/src/rules/index.ts packages/fhir/src/validate-batch.ts packages/fhir/src/validate-batch.test.ts packages/fhir/src/index.ts
git commit -m "feat(fhir): validateBatch + clinical rule registry"
```

---

## Task 4: `VA0002` error code (`@openldr/core`)

**Files:**
- Modify: `packages/core/src/error-catalog.ts`

- [ ] **Step 1: Add the catalog entry**

Find the array of `CatalogEntry` objects (near the `FM` forms entries) and add:

```ts
// Validation (VA)
{ code: 'VA0002', domain: 'validation', httpStatus: 422, message: 'clinical validation failed' },
```

- [ ] **Step 2: Verify the error handler surfaces `details`**

Read `apps/server/src/error-handler*.ts` (the central Fastify handler). Confirm an `AppError`'s `details` is serialized in the response body. If it is not, add: when `err instanceof AppError && err.details` has an `outcome`, include `{ code, message, outcome }` in the 422 body. (Add/adjust the existing test in `apps/server/src/error-handler.integration.test.ts`.)

- [ ] **Step 3: Typecheck + build core**

Run: `pnpm --filter @openldr/core build && pnpm --filter @openldr/core typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/error-catalog.ts apps/server/src/error-handler*.ts
git commit -m "feat(core): VA0002 clinical validation error (422)"
```

---

## Task 5: `fhirStore.exists`

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Test: `packages/db/src/fhir-store.test.ts` (add a case, or the existing acceptance covers it)

- [ ] **Step 1: Add to the `FhirStore` interface** (near `get`):

```ts
/** Cheap existence check for the latest version of a resource. */
exists(resourceType: string, id: string): Promise<boolean>;
```

- [ ] **Step 2: Implement it** in the returned object (mirror `get`'s table/columns, but select a literal):

```ts
async exists(resourceType, id) {
  const row = await internal
    .selectFrom('fhir.fhir_resources')
    .select((eb) => eb.lit(1).as('one'))
    .where('resource_type', '=', resourceType)
    .where('id', '=', id)
    .executeTakeFirst();
  return !!row;
},
```

> Match `get`'s actual table/db handle names in this file (e.g. `db`/`internal`, `fhir.fhir_resources`); copy them from the adjacent `get` implementation.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/fhir-store.ts
git commit -m "feat(db): fhirStore.exists"
```

---

## Task 6: Gate `persistResources` with `validateBatch`

**Files:**
- Modify: `packages/db/src/persist.ts`
- Test: `packages/db/src/persist.test.ts` (create if absent, using a stub FhirStore)

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/persist.test.ts
import { describe, it, expect, vi } from 'vitest';
import { persistResources } from './persist';
import { AppError } from '@openldr/core';

function stubStore() {
  const saved: unknown[] = [];
  return {
    saved,
    store: {
      save: vi.fn(async (r: unknown) => { saved.push(r); return { resourceType: (r as any).resourceType, id: (r as any).id, version: 1 }; }),
      exists: vi.fn(async () => false),
      get: vi.fn(), getWithProvenance: vi.fn(), applyRemote: vi.fn(),
    } as any,
  };
}
const logger = { info() {}, warn() {}, error() {}, debug() {} } as any;
const labObs = { resourceType: 'Observation', id: 'o1', status: 'final',
  category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Hb' }, subject: { reference: 'Patient/p1' } };
const opts = (level: any) => ({ level, resolveServiceRequest: async () => false });

describe('persistResources strictness gate', () => {
  it('high: rejects a lab result with no order and saves NOTHING', async () => {
    const { store, saved } = stubStore();
    await expect(persistResources({ fhirStore: store, logger }, [labObs], {}, opts('high')))
      .rejects.toBeInstanceOf(AppError);
    expect(saved).toHaveLength(0);
  });
  it('low: persists it', async () => {
    const { store, saved } = stubStore();
    await persistResources({ fhirStore: store, logger }, [labObs], {}, opts('low'));
    expect(saved).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/persist.test.ts`
Expected: FAIL — `persistResources` ignores the 4th arg / does not throw AppError.

- [ ] **Step 3: Implement the gate**

Edit `packages/db/src/persist.ts`:

```ts
import { type Logger, OpenLdrError, appError } from '@openldr/core';
import { validateResource, validateBatch, type StrictnessLevel } from '@openldr/fhir';
// ...
export interface PersistOpts {
  level: StrictnessLevel;
  resolveServiceRequest(id: string): Promise<boolean>;
}

export async function persistResources(
  deps: PersistDeps,
  resources: unknown[],
  provenance: Provenance = {},
  opts?: PersistOpts,
): Promise<PersistResult[]> {
  if (opts) {
    const v = await validateBatch(resources, opts);
    if (!v.ok) throw appError('VA0002', { details: { outcome: v.outcome } });
    const results: PersistResult[] = [];
    for (const resource of v.resources) {           // already validated + structurally sound
      await deps.fhirStore.save(resource, provenance);
      results.push({ saved: true, flattened: 'deferred' });
    }
    return results;
  }
  // Back-compat path (no opts): per-resource structural validation, as before.
  const results: PersistResult[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    await deps.fhirStore.save(validation.resource, provenance);
    results.push({ saved: true, flattened: 'deferred' });
  }
  return results;
}
```

Also update `persistResource` (single) to delegate: `return (await persistResources(deps, [resource], provenance, opts))[0]` and add an optional `opts?: PersistOpts` param to its signature.

> Every caller that should be gated MUST pass `opts`. Callers without `opts` keep today's structural-only behaviour (this preserves any internal/system persists that should not be gated).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/db exec vitest run src/persist.test.ts && pnpm --filter @openldr/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/persist.ts packages/db/src/persist.test.ts
git commit -m "feat(db): persistResources strictness gate (atomic reject)"
```

---

## Task 7: `validation.strictness` accessor (`@openldr/bootstrap`)

**Files:**
- Create: `packages/bootstrap/src/validation-settings.ts`, `packages/bootstrap/src/validation-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/bootstrap/src/validation-settings.test.ts
import { describe, it, expect } from 'vitest';
import { createValidationStrictness, VALIDATION_STRICTNESS_KEY } from './validation-settings';

function fakeStore() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k: string) => (data.has(k) ? { key: k, value: data.get(k)!, updatedBy: null, updatedAt: '' } : null),
    getAll: async () => [...data].map(([key, value]) => ({ key, value, updatedBy: null, updatedAt: '' })),
    set: async (k: string, v: string) => { data.set(k, v); },
  } as any;
}

describe('createValidationStrictness', () => {
  it('defaults to high', async () => {
    expect(await createValidationStrictness(fakeStore()).get()).toBe('high');
  });
  it('round-trips a valid level and rejects an invalid one', async () => {
    const store = fakeStore();
    const s = createValidationStrictness(store);
    await s.set('medium', 'admin');
    expect(store.data.get(VALIDATION_STRICTNESS_KEY)).toBe('medium');
    expect(await s.get()).toBe('medium');
    await expect(s.set('bogus' as any, 'admin')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/validation-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (mirrors `createNumberSettings`, single enum key)**

```ts
// packages/bootstrap/src/validation-settings.ts
import type { AppSettingStore } from '@openldr/db';
import type { StrictnessLevel } from '@openldr/fhir';

export const VALIDATION_STRICTNESS_KEY = 'validation.strictness';
const LEVELS: StrictnessLevel[] = ['low', 'medium', 'high'];
const DEFAULT: StrictnessLevel = 'high';

export interface ValidationStrictness {
  get(): Promise<StrictnessLevel>;
  set(level: StrictnessLevel, actor: string | null): Promise<void>;
}

export function createValidationStrictness(store: AppSettingStore): ValidationStrictness {
  return {
    async get() {
      const row = await store.get(VALIDATION_STRICTNESS_KEY);
      const v = row?.value as StrictnessLevel | undefined;
      return v && LEVELS.includes(v) ? v : DEFAULT;
    },
    async set(level, actor) {
      if (!LEVELS.includes(level)) throw new Error(`invalid strictness "${level}"`);
      await store.set(VALIDATION_STRICTNESS_KEY, level, actor);
    },
  };
}
```

- [ ] **Step 4: Run tests + export**

Add `export { createValidationStrictness, VALIDATION_STRICTNESS_KEY, type ValidationStrictness } from './validation-settings';` to `packages/bootstrap/src/index.ts` exports.
Run: `pnpm --filter @openldr/bootstrap exec vitest run src/validation-settings.test.ts && pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/validation-settings.ts packages/bootstrap/src/validation-settings.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): validation.strictness setting accessor"
```

---

## Task 8: Wire level + resolver into the persist wrappers

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (workflow persist), `packages/bootstrap/src/ingest-context.ts` (ingest persist)

- [ ] **Step 1: In `index.ts`**, where `workflowPersist` is defined (`persistResources({ fhirStore: canonicalFhirStore, logger }, resources, prov)`), thread strictness:

```ts
const validation = createValidationStrictness(appSettingsStore); // reuse the store already created for flags/numbers
const persistOpts = async () => ({
  level: await validation.get(),
  resolveServiceRequest: (id: string) => canonicalFhirStore.exists('ServiceRequest', id),
});
const workflowPersist = async (resources: unknown[], prov: Provenance) =>
  persistResources({ fhirStore: canonicalFhirStore, logger }, resources, prov, await persistOpts());
```

- [ ] **Step 2: In `ingest-context.ts`**, find the `persist` dep passed to `createIngestContext`/`handle` (the `persistResources(...)` wrapper) and thread the same `opts` (build a `createValidationStrictness` over the ingest context's app-settings store + `fhirStore.exists`).

- [ ] **Step 3: Typecheck + build bootstrap**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/bootstrap build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/ingest-context.ts
git commit -m "feat(bootstrap): apply validation strictness on ingest + webhook persist"
```

---

## Task 9: Settings API (`GET/PUT /api/settings/validation`)

**Files:**
- Modify: `apps/server/src/settings-routes.ts`
- Test: `apps/server/src/settings-sync-routes.test.ts` sibling, or add to `apps/server/src/settings-routes.test.ts`

- [ ] **Step 1: Write the failing test** (mirror an existing settings route test — inject the app, assert 200 + shape + `lab_admin` gate + audit called). Assert `GET` returns `{ strictness: 'high' }` on a fresh store and `PUT { strictness: 'medium' }` persists + records `settings.validation_strictness`.

- [ ] **Step 2: Implement the routes** (follow the numbers/flags handlers in this file):

```ts
app.get('/api/settings/validation', { preHandler: requireRole('lab_admin') }, async () =>
  ({ strictness: await ctx.validationStrictness.get() }));

app.put('/api/settings/validation', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
  const body = req.body as { strictness?: string };
  const levels = ['low', 'medium', 'high'];
  if (!body?.strictness || !levels.includes(body.strictness)) { reply.code(400); return { error: 'invalid strictness' }; }
  const before = await ctx.validationStrictness.get();
  await ctx.validationStrictness.set(body.strictness as any, actorName(req));
  await ctx.audit.record({ actorType: 'user', actorName: actorName(req), action: 'settings.validation_strictness',
    entityType: 'setting', entityId: 'validation.strictness', before: { strictness: before }, after: { strictness: body.strictness } });
  return { strictness: body.strictness };
});
```

> Add `validationStrictness: createValidationStrictness(appSettingsStore)` to the AppContext (`packages/bootstrap`) so `ctx.validationStrictness` exists here; match `actorName`/`ctx.audit.record` to their real signatures in this file.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-routes.test.ts packages/bootstrap/src/*.ts
git commit -m "feat(server): GET/PUT /api/settings/validation (audited, lab_admin)"
```

---

## Task 10: CLI parity (`openldr settings validation`)

**Files:**
- Modify: `packages/cli/src/index.ts`, `packages/cli/src/settings.ts`
- Test: `packages/cli/src/settings.test.ts` (add cases mirroring `settings numbers`)

- [ ] **Step 1: Write the failing test** — `runValidationShow` prints the level; `runValidationSet('medium')` persists it; an invalid level exits non-zero. Mirror the existing `settings numbers` test.

- [ ] **Step 2: Implement `runValidationShow` / `runValidationSet`** in `settings.ts` using `createValidationStrictness(appSettingsStore)` over a CLI app context (mirror `runNumbersShow`/`runNumbersSet`).

- [ ] **Step 3: Register the commands** in `index.ts` under the `settings` group:

```ts
const validation = settings.command('validation').description('FHIR validation strictness (low|medium|high)');
validation.command('show').option('--json', 'emit JSON', false)
  .action(async (o) => { process.exitCode = await runValidationShow(o); });
validation.command('set <level>').option('--json', 'emit JSON', false)
  .action(async (level, o) => { process.exitCode = await runValidationSet(level, o); });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/cli exec vitest run src/settings.test.ts && pnpm --filter @openldr/cli typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/settings.ts packages/cli/src/settings.test.ts
git commit -m "feat(cli): openldr settings validation show|set"
```

---

## Task 11: UI — type-to-confirm dialog + Danger Zone row

**Files:**
- Create: `apps/studio/src/components/ui/type-to-confirm-dialog.tsx` (+ `.test.tsx`)
- Modify: `apps/studio/src/api.ts`, `apps/studio/src/pages/settings/General.tsx`, `apps/studio/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: Write the failing dialog test**

```tsx
// apps/studio/src/components/ui/type-to-confirm-dialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TypeToConfirmDialog } from './type-to-confirm-dialog';

describe('TypeToConfirmDialog', () => {
  it('enables confirm only when the typed phrase matches', () => {
    const onConfirm = vi.fn();
    render(<TypeToConfirmDialog open title="Change" body="type it" confirmPhrase="medium"
      confirmLabel="Apply" onConfirm={onConfirm} onOpenChange={() => {}} />);
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'medium' } });
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**, then **Step 3: implement** `TypeToConfirmDialog` (a shadcn `Dialog` with a controlled `Input`; `Apply` disabled until `value === confirmPhrase`; props `{open,title,body,confirmPhrase,confirmLabel,onConfirm,onOpenChange,destructive?}`). Follow existing dialogs in `apps/studio/src/components/ui`.

- [ ] **Step 4: API client** — add to `apps/studio/src/api.ts`:

```ts
export const getValidation = () => api<{ strictness: 'low'|'medium'|'high' }>('/api/settings/validation');
export const setValidation = (strictness: string) =>
  api('/api/settings/validation', { method: 'PUT', body: JSON.stringify({ strictness }) });
```

- [ ] **Step 5: Danger Zone row** — in `General.tsx`, load the current level (`getValidation`), render a "Data validation" row inside the Danger Zone `Card` (side-by-side pattern: label+description left, current level + **Change** button right). Clicking **Change** opens a level `Select`; picking a level opens `TypeToConfirmDialog` with `confirmPhrase = <chosen level>` and a body warning when below `high`; on confirm call `setValidation` + toast + reload. Add i18n keys (`settings.general.danger.validation.*`) to `en/fr/pt` with the same keys (parity test).

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/components/ui/type-to-confirm-dialog.test.tsx src/i18n/parity.test.ts && pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/components/ui/type-to-confirm-dialog.tsx apps/studio/src/components/ui/type-to-confirm-dialog.test.tsx apps/studio/src/api.ts apps/studio/src/pages/settings/General.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Danger Zone validation strictness with type-to-confirm"
```

---

## Task 12: WHONET fixture fix (emit ServiceRequest + basedOn)

**Files:**
- Modify: `wasm/openldr-plugin-sdk/src/fhir.rs`, `wasm/whonet-sqlite/src/mapping.rs`

- [ ] **Step 1: Add `based_on` to the SDK observation helpers**

In `wasm/openldr-plugin-sdk/src/fhir.rs`, add an optional `based_on: Option<&str>` param (a `ServiceRequest/<id>` reference) to `observation_organism` and `observation_ast`; when `Some`, add `"basedOn": [{ "reference": based_on }]` to the JSON. Update the SDK's own tests (`lib.rs`) to pass `None`/`Some(...)`.

- [ ] **Step 2: Emit a ServiceRequest per isolate + link results** — in `wasm/whonet-sqlite/src/mapping.rs` `map_isolates`, after building the patient/specimen, create one order:

```rust
let sr_id = format!("whonet-sr-{patient_id}-{idx}");
let sr_ref = format!("ServiceRequest/{sr_id}");
out.push(fhir::service_request(&sr_id, &patient_ref, None, Some("AST panel"), "active"));
// pass Some(&sr_ref) into observation_organism / observation_ast calls
```

Thread `Some(&sr_ref)` into every `observation_organism` / `observation_ast` call in this function.

- [ ] **Step 3: Rust unit test** — extend the existing `map_isolates` test in `mapping.rs`: assert the output contains a `ServiceRequest`, and that each `Observation` has a `basedOn[0].reference` starting `ServiceRequest/`.

Run: `cargo test -p whonet-sqlite -p openldr-plugin-sdk` (from `wasm/`)
Expected: PASS.

- [ ] **Step 4: Rebuild the plugin wasm**

Run: `pnpm build:plugins`
Expected: builds `reference-plugins/whonet-sqlite/plugin.wasm` (new sha256).

- [ ] **Step 5: Commit**

```bash
git add wasm/openldr-plugin-sdk/src/fhir.rs wasm/whonet-sqlite/src/mapping.rs wasm/openldr-plugin-sdk/src/lib.rs reference-plugins/whonet-sqlite/
git commit -m "fix(whonet): emit a ServiceRequest per isolate and link results (basedOn)"
```

---

## Task 13: End-to-end verification at default-high (seed + live acceptance)

**Files:**
- Create: `scripts/validation-strictness-live-acceptance.ts`
- Add script to root `package.json` (e.g. `"sync:validate": "tsx scripts/validation-strictness-live-acceptance.ts"` — name per convention)

- [ ] **Step 1: Re-seed at default-high and confirm 0 rejects**

Recreate the DBs, migrate, seed, install plugins, ingest WHONET (per `docs-screenshot-regen` memory recipe), then:
Run: `pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json`
Expected: `status: done`, `resourceCount > 0`, `error: null` — the WHONET ingest now passes at high because it emits linked ServiceRequests. If it rejects with `VA0002`, the Task 12 linkage is incomplete — fix before proceeding.

- [ ] **Step 2: Write the live-acceptance script** (mirror `scripts/sync-*-live-acceptance.ts` skip-guard style): build an in-process app, POST a lab Bundle **without** the order through the webhook/ingest path → assert 422 `OperationOutcome`; add the `ServiceRequest` to the Bundle → assert success; set strictness `low` → the order-less Bundle now persists.

Run: `pnpm tsx scripts/validation-strictness-live-acceptance.ts`
Expected: `PASS`.

- [ ] **Step 3: Full gate**

Run: `pnpm turbo typecheck test build --filter=...[HEAD^]` (or the repo's standard `pnpm turbo typecheck lint test build`).
Expected: PASS across affected packages.

- [ ] **Step 4: Commit**

```bash
git add scripts/validation-strictness-live-acceptance.ts package.json
git commit -m "test(validation): live acceptance + default-high seed verification"
```

---

## Task 14: Docs — clinically-complete example + verified webhook recipe

**Files:**
- Modify: `apps/web/src/docs/0.1.0/load-data.md`

- [ ] **Step 1: Build + verify the raw-FHIR webhook** (paused item #7): on a running instance (`AUTH_DEV_BYPASS`, non-3000 port), create a workflow `Webhook → Split Out(field `body.entry`, map to `resource`) → Persist Store` via `POST /api/workflows`, POST a Bundle to `/api/workflows/hooks/<path>` with `X-Webhook-Token`, and confirm the resources persist. Capture the exact node config from the working workflow.

- [ ] **Step 2: Fix the Bundle example** — the minimal example currently has Patient + Observation (a lab result with no order), which **now fails at default-high**. Add a `ServiceRequest` and set the Observation's `basedOn` to it, so the example is clinically complete and passes:

```json
{ "resourceType": "Bundle", "type": "collection", "entry": [
  { "resource": { "resourceType": "Patient", "id": "p1", "identifier": [{ "system": "urn:lab:mrn", "value": "MRN-001" }] } },
  { "resource": { "resourceType": "ServiceRequest", "id": "sr1", "status": "active", "intent": "order",
      "subject": { "reference": "Patient/p1" }, "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7" }] } } },
  { "resource": { "resourceType": "Observation", "id": "o1", "status": "final",
      "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
      "basedOn": [{ "reference": "ServiceRequest/sr1" }],
      "subject": { "reference": "Patient/p1" },
      "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] },
      "valueQuantity": { "value": 13.5, "unit": "g/dL" } } }
] }
```

- [ ] **Step 3: Add a "Validation strictness" note** to load-data.md: front-door pushes are validated at the configured level (default High); a lab result must reference an order or the whole submission is rejected with an `OperationOutcome`; the level is set in Settings → Danger Zone / `openldr settings validation`.

- [ ] **Step 4: Replace the webhook section** with the verified `Webhook → Split Out → Persist Store` recipe from Step 1 (exact node names/fields), keeping the `X-Webhook-Token` curl.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/docs/0.1.0/load-data.md
git commit -m "docs(web): clinically-complete Bundle example + verified webhook ingest recipe"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** framework (T1–T3), rule #1 both Observation+DiagnosticReport (T2), levels tiered (T2/T3), front-door gate + atomic reject + OperationOutcome (T6), sync exempt (unchanged — no task touches `applyRemote`), setting + default high (T7), API + audit (T9), CLI parity (T10), Danger-Zone type-to-confirm (T11), VA 422 (T4), WHONET fixture fix (T12), doc example fix + webhook (T14), rollout verification (T13). ✓
- **Types:** `StrictnessLevel`, `ValidateBatchOpts`, `PersistOpts`, `ValidationStrictness`, `resolveServiceRequest`, `appError('VA0002', {details:{outcome}})`, `OperationOutcomeIssue` — consistent across tasks. ✓
- **Confirm-on-execute:** the message field on `OperationOutcomeIssue` (`diagnostics` vs other) and the `appError`/audit/`actorName` signatures are the two spots to verify against source at implementation time (flagged inline in T2/T4/T9).
