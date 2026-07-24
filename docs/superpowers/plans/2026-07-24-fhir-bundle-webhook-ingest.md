# FHIR Bundle ingestion through the webhook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ingestion webhook accept a FHIR `transaction` Bundle: a new `unwrap-bundle` workflow node unwraps `entry[].resource`, resolves references (real-id + `urn:uuid`), and feeds the existing `persist-store`; the cdr-toolchain emits a Bundle instead of a bare array.

**Architecture:** One new pure-logic-plus-handler node in `@openldr/workflows`. The pure resolver (Bundle/array → resource list with references rewritten) is unit-tested with plain objects; the handler is a thin `NodeHandler` wrapper mirroring `split-out`. The seeded `Ingest-raw` swaps `split-out → unwrap-bundle`. cdr-toolchain adds a `toTransactionBundle` wrapper. All validation/persistence is unchanged (`validateBatch` + `persistResources`).

**Tech Stack:** TypeScript. CE tests: **vitest** (`pnpm --filter @openldr/workflows test`). cdr-toolchain tests: **node:test + tsx** (`node --import tsx --test <file>`, from `apps/cli`) — NOT vitest.

## Global Constraints

- `NodeHandler` shape: `async (node, ctx, input: WorkflowItem[]) => WorkflowItem[]`. `WorkflowItem = { json: Record<string, unknown>; … }` (`packages/workflows/src/engine/items.ts`). Mirror `split-out.ts`.
- FHIR ids must satisfy CE `ID_RE` (`[A-Za-z0-9.\-]`, no underscore) — minted ids use `randomUUID()` (hex+hyphens, valid).
- Reference rewrite is generic: recurse every resource; for any object `{ reference: <string>, … }`, replace `<string>` with the mapped `Type/id` when it matches a `fullUrl`/`Type/id` map key; leave unmatched refs untouched.
- Accept `Bundle.type` ∈ {`transaction`,`batch`,`collection`}; reject others. Accept `request.method` ∈ {`POST`,`PUT`,absent}; reject `DELETE`/`PATCH`/other by failing the Bundle.
- Bare array input → passthrough (parity with `split-out(body)`), so `Ingest-raw` stays backward-compatible.
- Commit after each task. **No `Co-Authored-By` trailer.**

---

### Task 1: `unwrap-bundle` — pure resolver + handler

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/unwrap-bundle.ts`
- Test: `packages/workflows/src/engine/node-handlers/unwrap-bundle.test.ts`

**Interfaces:**
- Consumes: `type NodeHandler` from `./types`; `type WorkflowItem` from `../items`; `randomUUID` from `node:crypto`.
- Produces:
  - `bundleToResources(payload: unknown): Record<string, unknown>[]` — pure; Bundle or array → resolved resource list; throws `Error` on invalid input.
  - `unwrapBundleHandler: NodeHandler` — reads `config.sourcePath` (default `'body'`) from each input item's `json`, calls `bundleToResources`, emits one `WorkflowItem` per resource.

- [ ] **Step 1: Write the failing test**

Create `unwrap-bundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bundleToResources, unwrapBundleHandler } from './unwrap-bundle';

const sr = { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' };
const obs = (ref: string) => ({ resourceType: 'Observation', id: 'obs1', status: 'final', basedOn: [{ reference: ref }] });

describe('bundleToResources', () => {
  it('transaction Bundle with real ids + relative refs → resources unchanged', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'ServiceRequest/obr1', resource: sr, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'Observation/obs1', resource: obs('ServiceRequest/obr1'), request: { method: 'PUT', url: 'Observation/obs1' } },
    ] };
    const out = bundleToResources(bundle);
    expect(out.map((r) => r.resourceType)).toEqual(['ServiceRequest', 'Observation']);
    expect((out[1] as any).basedOn[0].reference).toBe('ServiceRequest/obr1');
  });

  it('urn:uuid Bundle → intra-bundle references rewritten to Type/id', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:sr', resource: sr, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'urn:uuid:o', resource: obs('urn:uuid:sr'), request: { method: 'PUT', url: 'Observation/obs1' } },
    ] };
    const out = bundleToResources(bundle);
    expect((out[1] as any).basedOn[0].reference).toBe('ServiceRequest/obr1');
  });

  it('mints an id for a urn:uuid create entry with no resource.id', () => {
    const noId = { resourceType: 'Patient' };
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:p', resource: noId, request: { method: 'POST', url: 'Patient' } },
    ] };
    const out = bundleToResources(bundle);
    expect(typeof (out[0] as any).id).toBe('string');
    expect((out[0] as any).id.length).toBeGreaterThan(0);
  });

  it('bare array → passthrough', () => {
    expect(bundleToResources([sr, obs('ServiceRequest/obr1')])).toEqual([sr, obs('ServiceRequest/obr1')]);
  });

  it('rejects a non-Bundle non-array payload', () => {
    expect(() => bundleToResources({ resourceType: 'Patient' })).toThrow(/Bundle or an array/);
  });

  it('rejects an unsupported Bundle.type', () => {
    expect(() => bundleToResources({ resourceType: 'Bundle', type: 'document', entry: [] })).toThrow(/type/);
  });

  it('rejects a DELETE entry', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { resource: sr, request: { method: 'DELETE', url: 'ServiceRequest/obr1' } },
    ] };
    expect(() => bundleToResources(bundle)).toThrow(/DELETE|method/);
  });
});

describe('unwrapBundleHandler', () => {
  it('reads config.sourcePath (default body) and emits one item per resource', async () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ fullUrl: 'ServiceRequest/obr1', resource: sr }] };
    const node = { id: 'n1', type: 'action', data: { action: 'unwrap-bundle', config: { sourcePath: 'body' } } } as any;
    const out = await unwrapBundleHandler(node, {} as any, [{ json: { body: bundle } }] as any);
    expect(out.map((i) => (i.json as any).resourceType)).toEqual(['ServiceRequest']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/workflows test unwrap-bundle`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `packages/workflows/src/engine/node-handlers/unwrap-bundle.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

const BUNDLE_TYPES = new Set(['transaction', 'batch', 'collection']);
const ALLOWED_METHODS = new Set(['POST', 'PUT']);

type Res = Record<string, unknown>;

/** Recursively rewrite every { reference } string that matches a map key. */
function rewriteRefs(value: unknown, map: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const v of value) rewriteRefs(v, map);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  const ref = obj['reference'];
  if (typeof ref === 'string' && map.has(ref)) obj['reference'] = map.get(ref);
  for (const k of Object.keys(obj)) if (k !== 'reference') rewriteRefs(obj[k], map);
}

/** Bundle or bare array → flat resource list with references resolved. Throws on invalid input. */
export function bundleToResources(payload: unknown): Res[] {
  if (Array.isArray(payload)) return payload as Res[]; // bare-array passthrough (today's contract)

  if (payload === null || typeof payload !== 'object' || (payload as Res).resourceType !== 'Bundle') {
    throw new Error('unwrap-bundle: expected a FHIR Bundle or an array of resources');
  }
  const bundle = payload as Res;
  const type = String(bundle['type'] ?? '');
  if (!BUNDLE_TYPES.has(type)) {
    throw new Error(`unwrap-bundle: unsupported Bundle.type "${type}" (expected transaction/batch/collection)`);
  }

  const entries = (bundle['entry'] as Res[] | undefined) ?? [];
  const resources: Res[] = [];
  const map = new Map<string, string>();

  // Pass 1: collect resources, assign ids, build fullUrl/Type-id → Type/id map.
  for (const entry of entries) {
    const method = String((entry['request'] as Res | undefined)?.['method'] ?? '').toUpperCase();
    if (method && !ALLOWED_METHODS.has(method)) {
      throw new Error(`unwrap-bundle: unsupported request.method "${method}" (v1 accepts POST/PUT)`);
    }
    const resource = entry['resource'] as Res | undefined;
    if (!resource || typeof resource !== 'object') continue;
    if (typeof resource['id'] !== 'string' || (resource['id'] as string).length === 0) {
      resource['id'] = randomUUID(); // urn:uuid create with no id
    }
    const typeId = `${String(resource['resourceType'])}/${String(resource['id'])}`;
    const fullUrl = entry['fullUrl'];
    if (typeof fullUrl === 'string' && fullUrl.length > 0) map.set(fullUrl, typeId);
    map.set(typeId, typeId); // relative refs resolve to themselves
    resources.push(resource);
  }

  // Pass 2: rewrite references now that all ids are known.
  for (const r of resources) rewriteRefs(r, map);
  return resources;
}

export const unwrapBundleHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourcePath = (config['sourcePath'] as string) || 'body';
  const out: WorkflowItem[] = [];
  for (const item of input) {
    for (const resource of bundleToResources(item.json[sourcePath])) {
      out.push({ json: resource });
    }
  }
  return out;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/workflows test unwrap-bundle`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/workflows typecheck` → Done.
```bash
git add packages/workflows/src/engine/node-handlers/unwrap-bundle.ts packages/workflows/src/engine/node-handlers/unwrap-bundle.test.ts
git commit -m "feat(workflows): unwrap-bundle node — FHIR Bundle → resources with reference resolution"
```

---

### Task 2: Register the `unwrap-bundle` handler

**Files:**
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Test: `packages/workflows/src/engine/node-handlers/index.test.ts` (create if absent, else extend)

**Interfaces:**
- Consumes: `unwrapBundleHandler` (Task 1).
- Produces: the handler registry maps `'unwrap-bundle'` → `unwrapBundleHandler`.

- [ ] **Step 1: Write the failing test**

Create/extend `index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nodeHandlers } from './index'; // adjust to the actual exported registry name

describe('node handler registry', () => {
  it('registers unwrap-bundle', () => {
    expect(typeof nodeHandlers['unwrap-bundle']).toBe('function');
  });
});
```

(First open `index.ts` and confirm the exported registry's name — the map keyed by action strings, e.g. `'split-out': splitOutHandler`. Use that exact export name in the test.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/workflows test node-handlers/index`
Expected: FAIL (`unwrap-bundle` undefined).

- [ ] **Step 3: Register the handler**

In `packages/workflows/src/engine/node-handlers/index.ts`: add the import beside `splitOutHandler`:
```ts
import { unwrapBundleHandler } from './unwrap-bundle';
```
and add the entry beside `'split-out': splitOutHandler`:
```ts
  'unwrap-bundle': unwrapBundleHandler,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/workflows test node-handlers/index`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/engine/node-handlers/index.test.ts
git commit -m "feat(workflows): register unwrap-bundle handler"
```

---

### Task 3: Seed `Ingest-raw` with `unwrap-bundle`

**Files:**
- Modify: `packages/workflows/src/sample-workflow.ts` (the `ingestRaw` workflow's middle node)
- Test: `packages/workflows/src/sample-workflow.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Ingest-raw` pipeline is `webhook → unwrap-bundle(sourcePath=body) → persist-store → log`.

- [ ] **Step 1: Update the failing test**

In `sample-workflow.test.ts`, replace the split-out assertion in the `Ingest-form validates … Ingest-raw splits the body` test with an unwrap-bundle assertion:

```ts
  it('Ingest-form validates against the form; Ingest-raw unwraps a Bundle', () => {
    const fv = form.definition.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config).toMatchObject({ formId: 'form-xyz', sourcePath: 'body' });
    const unwrap = raw.definition.nodes.find((n) => n.data.action === 'unwrap-bundle');
    expect(unwrap?.data.config).toMatchObject({ sourcePath: 'body' });
    expect(raw.definition.nodes.some((n) => n.data.action === 'form-validate')).toBe(false);
  });
```

And in the edges test, update the raw chain to `trigger-1->unwrap-1`:
```ts
    expect(raw.definition.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'trigger-1->unwrap-1',
      'unwrap-1->persist-1',
      'persist-1->log-1',
    ]);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/workflows test sample-workflow`
Expected: FAIL (still `split-out`).

- [ ] **Step 3: Update the workflow**

In `packages/workflows/src/sample-workflow.ts`, in the `ingestRaw` definition, replace the `split-1` node and its edges:

```ts
        {
          id: 'unwrap-1',
          type: 'action',
          position: { x: 360, y: 220 },
          data: {
            label: 'Unwrap FHIR Bundle',
            action: 'unwrap-bundle',
            config: { sourcePath: 'body' },
            templateId: 'unwrap-bundle',
            iconName: 'PackageOpen',
          },
        },
```
and the edges:
```ts
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'unwrap-1' },
        { id: 'e2', source: 'unwrap-1', target: 'persist-1' },
        { id: 'e3', source: 'persist-1', target: 'log-1' },
      ],
```
Also update the `Ingest-raw` description comment/string: it now accepts a FHIR transaction Bundle (still tolerates a bare array). Keep path `cdr-ingest`, secret, persist source, disabled state unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/workflows test sample-workflow`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/workflows typecheck` → Done.
```bash
git add packages/workflows/src/sample-workflow.ts packages/workflows/src/sample-workflow.test.ts
git commit -m "feat(seed): Ingest-raw unwraps a FHIR Bundle (split-out -> unwrap-bundle)"
```

---

### Task 4: Confirm atomic persistence (verification, wrap only if needed)

Confirm the persist path is all-or-nothing. The validation layer already is (`validateBatch` rejects the whole set if any resource fails — nothing persists). This task verifies the *save* is also atomic and wraps it in a transaction only if it isn't.

**Files:**
- Read: `packages/bootstrap/src/persist-store-service.ts`, `packages/db/src/persist.ts` (`persistResources`).
- Modify (only if needed): the persist path to wrap writes in one DB transaction.

- [ ] **Step 1: Inspect `persistResources`**

Read `packages/db/src/persist.ts`. Determine whether, after `validateBatch` passes, the resources are written inside a single DB transaction or one-by-one.

- [ ] **Step 2: Decide + act**

- If already transactional (or validate-all-then-write with a single batched write) → **no change**; record the finding in the task report and skip to commit-less completion (nothing to commit).
- If writes are per-resource without a transaction → wrap the write loop in the store's transaction primitive (follow the existing `store.transaction(...)` usage elsewhere in the codebase, e.g. `packages/bootstrap/src/index.ts`'s `materializeDataset`), add a test that a mid-batch write failure persists nothing, then commit:
  ```bash
  git add packages/db/src/persist.ts packages/db/src/persist.test.ts
  git commit -m "fix(db): persist a validated resource batch atomically"
  ```

- [ ] **Step 3: Report**

State in the task report whether a change was needed and why. (v1 acceptance: validation-level atomicity is sufficient; a save-transaction is a bonus.)

---

### Task 5: cdr-toolchain — emit a transaction Bundle

**Files:**
- Create: `cdr-toolchain/apps/cli/src/export/fhir-bundle.ts`
- Test: `cdr-toolchain/apps/cli/src/export/fhir-bundle.test.ts`
- Modify: `cdr-toolchain/apps/cli/src/commands/export-batch.ts` (CE branch) + `cdr-toolchain/apps/cli/src/api/ce-client.ts` (`postFhirResources` body type)

**Repo:** work in `/d/Projects/Repositories/cdr-toolchain` (branch of its own). Tests use **node:test**, not vitest.

**Interfaces:**
- Consumes: the `buildCeResources` output (`Record<string, unknown>[]`).
- Produces: `toTransactionBundle(resources): { resourceType: 'Bundle'; type: 'transaction'; entry: … }`.

- [ ] **Step 1: Write the failing test** (node:test idiom — mirror `apps/cli/src/api/ce-client.test.ts`)

Create `apps/cli/src/export/fhir-bundle.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTransactionBundle } from './fhir-bundle.js';

test('wraps resources into a transaction Bundle with PUT + relative refs', () => {
  const resources = [
    { resourceType: 'ServiceRequest', id: 'obr1' },
    { resourceType: 'Observation', id: 'obs1', basedOn: [{ reference: 'ServiceRequest/obr1' }] },
  ];
  const bundle = toTransactionBundle(resources);
  assert.equal(bundle.resourceType, 'Bundle');
  assert.equal(bundle.type, 'transaction');
  assert.equal(bundle.entry.length, 2);
  assert.deepEqual(bundle.entry[0].request, { method: 'PUT', url: 'ServiceRequest/obr1' });
  assert.equal(bundle.entry[0].fullUrl, 'ServiceRequest/obr1');
  assert.equal(bundle.entry[0].resource, resources[0]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (cwd `apps/cli`): `node --import tsx --test src/export/fhir-bundle.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `apps/cli/src/export/fhir-bundle.ts`:

```ts
export interface TransactionBundle {
  resourceType: 'Bundle';
  type: 'transaction';
  entry: { fullUrl: string; resource: Record<string, unknown>; request: { method: 'PUT'; url: string } }[];
}

/** Wrap pre-built FHIR resources (with real deterministic ids) into a FHIR transaction Bundle
 *  using PUT + relative references — idempotent upsert on the CE side. */
export function toTransactionBundle(resources: Record<string, unknown>[]): TransactionBundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: resources.map((resource) => {
      const url = `${String(resource.resourceType)}/${String(resource.id)}`;
      return { fullUrl: url, resource, request: { method: 'PUT' as const, url } };
    }),
  };
}
```

- [ ] **Step 4: Post the Bundle from the CE branch**

In `apps/cli/src/api/ce-client.ts`, widen `postFhirResources`'s first parameter from `resources: unknown[]` to `body: unknown` (it already `JSON.stringify`s the value; no other change).

In `apps/cli/src/commands/export-batch.ts`, the CE branch (inside `buildCeResources`'s caller / the `ceConfig` block): wrap the resources before posting:
```ts
import { toTransactionBundle } from '../export/fhir-bundle.js';
// …
const resources = buildCeResources(specimen, payload, { … });
const post = await postFhirResources(toTransactionBundle(resources), { baseUrl: ceConfig.baseUrl, path: ceConfig.path, token: ceConfig.token });
```
(Confirm the exact local names against the current CE branch.)

- [ ] **Step 5: Run tests + typecheck**

Run (cwd `apps/cli`): `node --import tsx --test src/export/fhir-bundle.test.ts` → PASS.
Run: `npx tsc --noEmit` (cwd `apps/cli`) → clean.
Also run the existing `export-batch` / `ce-client` tests: `node --import tsx --test src/commands/export-batch.ce.test.ts src/api/ce-client.test.ts` — update any assertion that expected a bare array to expect the Bundle wrapper.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/export/fhir-bundle.ts apps/cli/src/export/fhir-bundle.test.ts apps/cli/src/api/ce-client.ts apps/cli/src/commands/export-batch.ts
git commit -m "feat(export): emit a FHIR transaction Bundle to the CE webhook"
```

---

### Task 6: End-to-end acceptance (manual, live)

- [ ] **Step 1: Live run** (dev CE from `main` with this branch merged; `Ingest-raw` enabled)

Build a `TDS0052366` Bundle and POST it to `cdr-ingest`; verify the `QuestionnaireResponse` + test leg land (`questionnaire_responses`, `lab_results`), same as the bare-array acceptance already proven. Confirm a **Bundle** now persists where it previously 200'd-and-dropped.

---

## Self-Review

- **Spec coverage:** `unwrap-bundle` node + resolver (Task 1) ✓; registration (Task 2) ✓; seeded `Ingest-raw` swap (Task 3) ✓; atomic persistence (Task 4) ✓; cdr transaction-Bundle emit (Task 5) ✓; live acceptance (Task 6) ✓. Bare-array backward-compat (Task 1 passthrough) ✓; DELETE/unsupported-type rejection (Task 1 tests) ✓; both ref styles (Task 1 tests) ✓.
- **Placeholder scan:** Task 2/5 flag "confirm the exact exported registry name / local names" — real lookups against existing files, not silent TODOs. Task 4 is a genuine verify-then-maybe-fix (its branch is explicit).
- **Type consistency:** `bundleToResources`/`unwrapBundleHandler` (Task 1) match the registration (Task 2) and the seeded node's `action: 'unwrap-bundle'` + `config.sourcePath` (Task 3); `toTransactionBundle` (Task 5) produces the `entry[].resource` shape `bundleToResources` consumes.
