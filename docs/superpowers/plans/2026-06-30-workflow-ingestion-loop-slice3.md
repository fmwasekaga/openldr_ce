# Workflow Ingestion Loop — Slice 3 (batch-id targeting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Persist Store stamp a per-run `batchId` into provenance (every persisted row gets `batch_id`) and into the `data.persisted` event + node meta, so an event-triggered workflow can query exactly the rows that run produced (`where batch_id = '{{ $json.batchId }}'`).

**Architecture:** A ~8-line change to the Persist Store service plus one type field. No new nodes/UI — the outbound workflow composes the existing Event Trigger / sql-query / dhis2-sink nodes. The batch id is an injected `newId()` for deterministic tests; bootstrap wires `randomUUID`.

**Tech Stack:** TypeScript, Vitest. Packages: `@openldr/bootstrap`, `@openldr/workflows`.

**Conventions:** Workspace gate via `pnpm exec turbo typecheck --force`. Work on a worktree branch, merge to local `main`, not pushed. Frequent commits.

---

## File Structure

**Modify:**
- `packages/bootstrap/src/persist-store-service.ts` — generate `batchId`, stamp provenance, add it to the event payload + meta; new `newId` dep.
- `packages/bootstrap/src/persist-store-service.test.ts` — inject `newId`, assert `batchId` flows to provenance/payload/meta.
- `packages/workflows/src/engine/services.ts` — add `batchId: string` to `RunPersistStoreOutput['meta']`.
- `packages/bootstrap/src/index.ts` — pass `newId: () => randomUUID()` into `createPersistStoreService`.

---

## Task 1: Persist Store stamps a batch id

**Files:**
- Modify: `packages/bootstrap/src/persist-store-service.ts`, `packages/bootstrap/src/persist-store-service.test.ts`, `packages/workflows/src/engine/services.ts`, `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Update the test (failing)**

Replace the entire contents of `packages/bootstrap/src/persist-store-service.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPersistStoreService } from './persist-store-service';
import type { PersistResult } from '@openldr/db';

describe('createPersistStoreService', () => {
  it('stamps a batchId into provenance, the event, and meta; reports counts and types', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => [
      { saved: true, flattened: 'written' },
      { saved: true, flattened: 'skipped' },
    ]);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish, newId: () => 'batch-1' });

    const out = await svc({
      items: [{ json: { resourceType: 'Observation' } }, { json: { resourceType: 'Bundle' } }],
      source: 'amr',
    });

    expect(persist).toHaveBeenCalledWith(
      [{ resourceType: 'Observation' }, { resourceType: 'Bundle' }],
      { batchId: 'batch-1', sourceSystem: 'amr' },
    );
    expect(out.meta.persisted).toBe(2);
    expect(out.meta.batchId).toBe('batch-1');
    expect(out.meta.flattened).toEqual({ written: 1, skipped: 1, degraded: 0 });
    expect(out.meta.resourceTypes.sort()).toEqual(['Bundle', 'Observation']);
    expect(publish).toHaveBeenCalledWith({
      type: 'data.persisted',
      payload: { source: 'amr', batchId: 'batch-1', resourceTypes: ['Observation', 'Bundle'], count: 2 },
    });
    expect(out.items).toHaveLength(2);
  });

  it('stamps batchId even when no source is given', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => [{ saved: true, flattened: 'written' }]);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish, newId: () => 'batch-2' });
    await svc({ items: [{ json: { resourceType: 'Patient' } }], source: undefined });
    expect(persist).toHaveBeenCalledWith([{ resourceType: 'Patient' }], { batchId: 'batch-2' });
    expect(publish).toHaveBeenCalledWith({
      type: 'data.persisted',
      payload: { source: null, batchId: 'batch-2', resourceTypes: ['Patient'], count: 1 },
    });
  });

  it('does not publish when nothing was persisted', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => []);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish, newId: () => 'batch-3' });
    await svc({ items: [], source: undefined });
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/bootstrap test persist-store-service.test.ts`
Expected: FAIL — provenance/payload lack `batchId`, `meta.batchId` is undefined.

- [ ] **Step 3: Add `batchId` to the output meta type**

In `packages/workflows/src/engine/services.ts`, change `RunPersistStoreOutput` to add `batchId`:

```typescript
export interface RunPersistStoreOutput {
  items: WorkflowItem[];
  meta: {
    persisted: number;
    batchId: string;
    flattened: { written: number; skipped: number; degraded: number };
    resourceTypes: string[];
  };
}
```

- [ ] **Step 4: Implement the service change**

Replace the entire contents of `packages/bootstrap/src/persist-store-service.ts` with:

```typescript
import type { Provenance, PersistResult } from '@openldr/db';
import type { RunPersistStoreInput, RunPersistStoreOutput } from '@openldr/workflows';

export interface PersistStoreServiceDeps {
  persist(resources: unknown[], provenance: Provenance): Promise<PersistResult[]>;
  publish(event: { type: string; payload: unknown }): Promise<void>;
  /** Generate a fresh per-run correlation id, stamped on every persisted row + the event. */
  newId(): string;
}

/**
 * Persist FHIR resource items (each item's `json` is one resource) via the shared
 * persist path, then announce success as a `data.persisted` event so downstream
 * (event-triggered) workflows can react. A per-run `batchId` is stamped into the
 * provenance of every row (fhir_resources + flat tables get `batch_id`) and carried
 * in the event payload, so an outbound workflow can query exactly this run's rows.
 * Items pass through unchanged.
 */
export function createPersistStoreService(
  deps: PersistStoreServiceDeps,
): (input: RunPersistStoreInput) => Promise<RunPersistStoreOutput> {
  return async ({ items, source }) => {
    const resources = items.map((i) => i.json);
    const batchId = deps.newId();
    const provenance: Provenance = source ? { batchId, sourceSystem: source } : { batchId };
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
      await deps.publish({
        type: 'data.persisted',
        payload: { source: source ?? null, batchId, resourceTypes: [...resourceTypes], count: persisted },
      });
    }

    return { items, meta: { persisted, batchId, flattened, resourceTypes } };
  };
}
```

- [ ] **Step 5: Wire `newId` in bootstrap**

In `packages/bootstrap/src/index.ts`:
(a) Ensure `randomUUID` is imported. If there is no `import { randomUUID } from 'node:crypto';` near the top, add it.
(b) Find the `workflowServices.persistStore = createPersistStoreService({ … })` assignment and add the `newId` dep:

```typescript
  workflowServices.persistStore = createPersistStoreService({
    persist: workflowPersist,
    publish: (event) => eventing.publish(event),
    newId: () => randomUUID(),
  });
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm -C packages/bootstrap test persist-store-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck both packages**

Run: `pnpm -C packages/workflows typecheck` then `pnpm -C packages/bootstrap typecheck`
Expected: PASS for both.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/persist-store-service.ts packages/bootstrap/src/persist-store-service.test.ts packages/workflows/src/engine/services.ts packages/bootstrap/src/index.ts
git commit -m "feat(workflows): stamp a per-run batchId on persist for event-targeted queries"
```

---

## Task 2: Gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm exec turbo typecheck --force`
Expected: PASS (all packages — the `RunPersistStoreOutput` field change is additive and consumed only by bootstrap).

- [ ] **Step 2: Run the affected suites**

Run: `pnpm -C packages/bootstrap test` then `pnpm -C packages/workflows test`
Expected: PASS for each. (Web/server are unaffected by this change; the full suite runs in the merge verification.)

- [ ] **Step 3: Commit if any incidental fixes were needed**
```bash
git add -A
git commit -m "chore(workflows): slice 3 batch-id targeting — gate green"
```
(Skip if nothing changed.)

---

## Demo / manual verification (controller runs post-merge; not a subagent task)

Prove the loop targets exactly the just-persisted rows:
1. Extend `scripts/seed-form-ingestion-demo.ts` with an outbound **"Demo: On Persist → Push"** workflow:
   - Event Trigger (`config: { event: 'data.persisted', source: 'demo-lab' }`)
   - → `sql-query` node (`config.sql = "select * from observations where batch_id = '{{ $json.batchId }}'"`)
   - → `log` node (so the queried rows are captured in the run record).
   - If the `dhis2-sink` plugin is installed, optionally append a `dhis2-sink` node with `config.dryRun = true` + a minimal aggregate mapping so the run output shows the built DHIS2 dataValues.
2. Verify (live DB): `createAppContext(cfg)` → `registerRunner(ctx.eventing)` → `setEventWorkflowIds([<outbound id>])` → run the inbound workflow (`runAndRecord(inboundId, 'manual', {})`) → `await ctx.eventing.drain()` → read the outbound workflow's latest run record and assert its `sql-query` node output contains only rows whose `batch_id` equals the batch id the inbound run stamped (read from the inbound run's Persist Store `meta.batchId`). PASS = precise targeting.

---

## Done criteria for Slice 3

- Persist Store stamps a per-run `batchId` into provenance (rows get `batch_id`), the `data.persisted` payload, and `meta.batchId`.
- `pnpm exec turbo typecheck --force` and the bootstrap + workflows suites are green.
- (Demo) an event-triggered `sql-query` filtered on `batch_id = '{{ $json.batchId }}'` returns exactly the inbound run's rows.
