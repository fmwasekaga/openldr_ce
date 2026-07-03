# Payload Lifecycle / Activity view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a payload's lifecycle (received → validated → persisted → pushed) as one Studio "Activity" view, by promoting the existing Persist Store `batchId` to a queryable correlation id and assembling runs + ingest batches + `data.persisted` events at read time.

**Architecture:** Approach A from the spec. One new write: a nullable, indexed `correlation_id` on `workflow_runs`, stamped in the single `runAndRecord` choke-point. Everything else is read-time assembly (a pure stage-builder + a bootstrap service), exposed via `/api/activity` and a Studio page.

**Tech Stack:** TypeScript, Kysely (Postgres), Fastify, Zod, React + Vite (studio), Vitest.

Spec: `docs/superpowers/specs/2026-07-03-payload-lifecycle-activity-design.md`.

Gate reminder: after each slice run `pnpm -C <pkg> exec tsc --noEmit` and the package tests; before finishing run `pnpm turbo typecheck test --force` (turbo cache masks cross-package tsc breaks — memory `openldr-ce-build-plan`).

---

## Slice S1 — Correlation field on workflow_runs

### Task 1: Migration + schema type for `correlation_id`

**Files:**
- Create: `packages/db/src/migrations/internal/039_workflow_runs_correlation.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (register 039)
- Modify: `packages/db/src/schema/internal.ts` (add `correlation_id` to the `workflow_runs` row type)

- [ ] **Step 1: Write the migration**

Create `packages/db/src/migrations/internal/039_workflow_runs_correlation.ts`:
```ts
import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflow_runs')
    .addColumn('correlation_id', 'text')
    .execute();
  await db.schema.createIndex('idx_workflow_runs_correlation').ifNotExists()
    .on('workflow_runs').columns(['correlation_id', 'started_at']).execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_workflow_runs_correlation').ifExists().execute();
  await db.schema.alterTable('workflow_runs').dropColumn('correlation_id').execute();
}
```

- [ ] **Step 2: Register it in the migration index**

In `packages/db/src/migrations/internal/index.ts`, add the import next to the others and the record entry (follow the exact existing pattern):
```ts
import * as m039 from './039_workflow_runs_correlation';
// ... in the migrations record object:
'039_workflow_runs_correlation': { up: m039.up, down: m039.down },
```

- [ ] **Step 3: Add the column to the schema type**

In `packages/db/src/schema/internal.ts`, find the `workflow_runs` table interface and add:
```ts
correlation_id: string | null;
```

- [ ] **Step 4: Verify migrations still run**

Run: `pnpm -C packages/db exec vitest run src/migrations/migrations.test.ts`
Expected: PASS (the migration test applies all migrations up/down).

- [ ] **Step 5: Commit**
```bash
git add packages/db/src/migrations/internal/039_workflow_runs_correlation.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): add correlation_id to workflow_runs"
```

### Task 2: WorkflowRun type + run-store mapping + query methods

**Files:**
- Modify: `packages/workflows/src/types.ts` (WorkflowRunSchema)
- Modify: `packages/workflows/src/run-store.ts` (mapping + new methods)
- Test: `packages/workflows/src/run-store.test.ts` (create if absent; else extend)

- [ ] **Step 1: Write the failing test**

In `packages/workflows/src/run-store.test.ts` add (uses the existing migrated-db test helper `makeMigratedDb` from `@openldr/db/testing` — see `packages/workflows` existing store tests for the import):
```ts
it('records and queries runs by correlation id', async () => {
  const db = await makeMigratedDb();
  const store = createWorkflowRunStore(db);
  const base = { workflowId: 'w1', triggerSource: 'webhook' as const, status: 'completed' as const,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result: {}, error: null };
  await store.record({ ...base, id: 'r1', correlationId: 'batch-A' });
  await store.record({ ...base, id: 'r2', correlationId: 'batch-A' });
  await store.record({ ...base, id: 'r3', correlationId: null });
  const byId = await store.listByCorrelation('batch-A');
  expect(byId.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  const recent = await store.listCorrelations({ limit: 10, offset: 0 });
  expect(recent.map((c) => c.correlationId)).toContain('batch-A');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/run-store.test.ts -t "correlation"`
Expected: FAIL (`correlationId` not on type / `listByCorrelation` undefined).

- [ ] **Step 3: Add `correlationId` to the schema**

In `packages/workflows/src/types.ts`, inside `WorkflowRunSchema` (after `error`):
```ts
  correlationId: z.string().nullable().optional(),
```

- [ ] **Step 4: Persist + read the column + add query methods**

In `packages/workflows/src/run-store.ts`:
- In `toRow`, add: `correlation_id: r.correlationId ?? null,`
- In `fromRow`, add to the parsed object: `correlationId: (r.correlation_id as string | null) ?? null,`
- Extend the `WorkflowRunStore` interface and implementation with:
```ts
  listByCorrelation(correlationId: string): Promise<WorkflowRun[]>;
  listCorrelations(opts?: { limit?: number; offset?: number }): Promise<Array<{ correlationId: string; latestAt: string; latestStatus: string; workflowId: string }>>;
```
Implementations:
```ts
    async listByCorrelation(correlationId) {
      const rows = await db.selectFrom('workflow_runs').selectAll()
        .where('correlation_id', '=', correlationId)
        .orderBy('started_at', 'asc').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async listCorrelations(opts = {}) {
      // Most-recent distinct correlation ids with their latest run's status.
      const rows = await db.selectFrom('workflow_runs')
        .select(['correlation_id', 'workflow_id', 'status', 'started_at'])
        .where('correlation_id', 'is not', null)
        .orderBy('started_at', 'desc')
        .limit((opts.limit ?? 50) * 8).offset(0).execute();
      const seen = new Map<string, { correlationId: string; latestAt: string; latestStatus: string; workflowId: string }>();
      for (const r of rows) {
        const id = r.correlation_id as string;
        if (!seen.has(id)) seen.set(id, { correlationId: id, latestAt: String(r.started_at), latestStatus: String(r.status), workflowId: String(r.workflow_id) });
      }
      return [...seen.values()].slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50));
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/run-store.test.ts -t "correlation"`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/workflows/src/types.ts packages/workflows/src/run-store.ts packages/workflows/src/run-store.test.ts
git commit -m "feat(workflows): correlationId on WorkflowRun + correlation queries"
```

### Task 3: Stamp correlationId in runAndRecord + return the run id

**Files:**
- Create: `packages/workflows/src/correlation.ts`
- Test: `packages/workflows/src/correlation.test.ts`
- Modify: `packages/workflows/src/trigger-runner.ts`
- Modify: `apps/server/src/workflows-routes.ts:392-416` (webhook ack)

- [ ] **Step 1: Write the failing test for the extractor**

Create `packages/workflows/src/correlation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractCorrelationId } from './correlation';

describe('extractCorrelationId', () => {
  it('prefers the trigger input batchId (reactive/ingest run)', () => {
    expect(extractCorrelationId({ batchId: 'from-event' }, { results: [] })).toBe('from-event');
  });
  it('falls back to a persist node meta.batchId (originating run)', () => {
    const result = { results: [{ meta: { persisted: 2, batchId: 'from-persist' } }] };
    expect(extractCorrelationId({ body: {} }, result)).toBe('from-persist');
  });
  it('returns null when neither is present', () => {
    expect(extractCorrelationId({ body: {} }, { results: [{ meta: undefined }] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/correlation.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the extractor**

Create `packages/workflows/src/correlation.ts`:
```ts
/** Derive a payload correlation id (the Persist Store batchId) for a run.
 *  1. Reactive/ingest/event runs carry batchId in the trigger input payload.
 *  2. An originating run stamps it via a Persist Store node's meta.batchId. */
export function extractCorrelationId(
  input: unknown,
  result: { results?: Array<{ meta?: unknown }> },
): string | null {
  const fromInput = (input as { batchId?: unknown } | null)?.batchId;
  if (typeof fromInput === 'string' && fromInput) return fromInput;
  for (const r of result.results ?? []) {
    const b = (r.meta as { batchId?: unknown } | null | undefined)?.batchId;
    if (typeof b === 'string' && b) return b;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/correlation.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into runAndRecord and return the run id**

In `packages/workflows/src/trigger-runner.ts`:
- Add import: `import { extractCorrelationId } from './correlation';`
- Change the interface method signature:
```ts
  runAndRecord(workflowId: string, source: TriggerSource, input: unknown, files?: Record<string, BinaryRef>): Promise<{ runId: string; correlationId: string | null } | null>;
```
- In the `runAndRecord` function, replace the run construction + record (lines ~67-78) with:
```ts
    const correlationId = extractCorrelationId(input, result);
    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId,
      triggerSource: source,
      status: result.status,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      result,
      error,
      correlationId,
    };
    await deps.runs.record(run);
    return { runId: run.id, correlationId };
```
- The early guard `if (!wf || !wf.enabled) return;` must become `return null;`.
- The internal subscribers call `await runAndRecord(...)` and ignore the return — no change needed (Promise result is discarded).

- [ ] **Step 6: Return runId + correlationId from the webhook ack**

In `apps/server/src/workflows-routes.ts`, change the webhook handler tail (line ~411-415) from:
```ts
    await ctx.workflows.runner.runAndRecord(entry.workflowId, 'webhook', {
      method: req.method, body: webhookBody,
      headers: stripAuthHeaders(req.headers as Record<string, unknown>), query: req.query,
    }, files);
    return { ok: true };
```
to:
```ts
    const outcome = await ctx.workflows.runner.runAndRecord(entry.workflowId, 'webhook', {
      method: req.method, body: webhookBody,
      headers: stripAuthHeaders(req.headers as Record<string, unknown>), query: req.query,
    }, files);
    return { ok: true, runId: outcome?.runId ?? null, correlationId: outcome?.correlationId ?? null };
```

- [ ] **Step 7: Typecheck the changed packages**

Run: `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C apps/server exec tsc --noEmit`
Expected: no output (clean). If `runAndRecord` callers in `packages/bootstrap` break, they only ignore the return — no change; re-run `pnpm -C packages/bootstrap exec tsc --noEmit` to confirm.

- [ ] **Step 8: Commit**
```bash
git add packages/workflows/src/correlation.ts packages/workflows/src/correlation.test.ts packages/workflows/src/trigger-runner.ts apps/server/src/workflows-routes.ts
git commit -m "feat(workflows): stamp correlationId in runAndRecord; webhook ack returns runId"
```

---

## Slice S2 — Lifecycle assembler (read model)

### Task 4: Pure stage-builder

**Files:**
- Create: `packages/workflows/src/lifecycle.ts`
- Test: `packages/workflows/src/lifecycle.test.ts`

Node matchers (pinned per spec open question): a run **validated** if any node result has `nodeId`/`nodeType` containing `validate` (Form Validate node) with `status === 'success'`; a run **pushed** if any node result has `nodeType` containing `sink` or `push` (plugin sink / dhis2-sink) with `status === 'success'`. A run **persisted** if any node result `meta.batchId` is set (it did a persist). These string matchers live in one place so they are easy to adjust.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/lifecycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildLifecycle, type LifecycleInputs } from './lifecycle';

const run = (over: Partial<any>) => ({ id: 'r', workflowId: 'w', triggerSource: 'webhook', status: 'completed',
  startedAt: '2026-07-03T10:00:00Z', finishedAt: '2026-07-03T10:00:01Z', error: null, correlationId: 'A',
  result: { results: [] }, ...over });

it('assembles received -> validated -> persisted -> pushed', () => {
  const inputs: LifecycleInputs = {
    correlationId: 'A',
    runs: [
      run({ id: 'r1', triggerSource: 'webhook', result: { results: [
        { nodeId: 'validate', nodeType: 'form-validate', status: 'success' },
        { nodeId: 'persist', nodeType: 'persist-store', status: 'success', meta: { batchId: 'A', persisted: 2, resourceTypes: ['ServiceRequest'] } },
      ] } }),
      run({ id: 'r2', triggerSource: 'event', startedAt: '2026-07-03T10:00:05Z', result: { results: [
        { nodeId: 'push', nodeType: 'dhis2-sink', status: 'success' },
      ] } }),
    ],
    persistedEvent: { at: '2026-07-03T10:00:02Z', count: 2, resourceTypes: ['ServiceRequest'] },
    ingestBatch: null,
  };
  const lc = buildLifecycle(inputs);
  expect(lc.stages.map((s) => s.stage)).toEqual(['received', 'validated', 'persisted', 'pushed']);
  expect(lc.status).toBe('complete');
});

it('marks a payload stuck when never persisted', () => {
  const lc = buildLifecycle({ correlationId: 'A', ingestBatch: null, persistedEvent: null,
    runs: [run({ result: { results: [{ nodeId: 'validate', nodeType: 'form-validate', status: 'success' }] } })] });
  expect(lc.status).toBe('stuck');
  expect(lc.stages.map((s) => s.stage)).toEqual(['received', 'validated']);
});

it('marks failed when a run failed', () => {
  const lc = buildLifecycle({ correlationId: 'A', ingestBatch: null, persistedEvent: null,
    runs: [run({ status: 'failed', error: 'boom', result: { results: [] } })] });
  expect(lc.status).toBe('failed');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/lifecycle.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the builder**

Create `packages/workflows/src/lifecycle.ts`:
```ts
export type Stage = 'received' | 'validated' | 'persisted' | 'pushed';
export type LifecycleStatus = 'complete' | 'stuck' | 'failed';

export interface LifecycleRun {
  id: string; workflowId: string; triggerSource: string; status: string;
  startedAt: string; finishedAt: string; error: string | null;
  result: { results?: Array<{ nodeId?: string; nodeType?: string; status?: string; meta?: unknown }> };
  correlationId?: string | null;
}
export interface LifecycleInputs {
  correlationId: string;
  runs: LifecycleRun[];
  persistedEvent: { at: string; count: number; resourceTypes: string[] } | null;
  ingestBatch: { receivedAt: string; source: string | null; status: string } | null;
}
export interface LifecycleStageEntry { stage: Stage; status: 'ok' | 'failed'; at: string; runId?: string; detail?: string; }
export interface Lifecycle { correlationId: string; status: LifecycleStatus; stages: LifecycleStageEntry[]; runIds: string[]; }

const has = (n: { nodeId?: string; nodeType?: string }, needle: string) =>
  (n.nodeType ?? '').toLowerCase().includes(needle) || (n.nodeId ?? '').toLowerCase().includes(needle);

export function buildLifecycle(input: LifecycleInputs): Lifecycle {
  const runs = [...input.runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const stages: LifecycleStageEntry[] = [];
  const anyFailed = runs.some((r) => r.status === 'failed');

  const receivedAt = input.ingestBatch?.receivedAt ?? runs[0]?.startedAt;
  if (receivedAt) stages.push({ stage: 'received', status: 'ok', at: receivedAt, runId: runs[0]?.id,
    detail: input.ingestBatch?.source ?? runs[0]?.triggerSource });

  for (const r of runs) {
    const v = (r.result.results ?? []).find((n) => has(n, 'validate') && n.status === 'success');
    if (v) { stages.push({ stage: 'validated', status: 'ok', at: r.startedAt, runId: r.id }); break; }
  }

  if (input.persistedEvent) {
    stages.push({ stage: 'persisted', status: 'ok', at: input.persistedEvent.at,
      detail: `${input.persistedEvent.count} × ${input.persistedEvent.resourceTypes.join(', ') || 'resource'}` });
  }

  for (const r of runs) {
    for (const n of r.result.results ?? []) {
      if ((has(n, 'sink') || has(n, 'push')) && n.status === 'success') {
        stages.push({ stage: 'pushed', status: 'ok', at: r.finishedAt, runId: r.id, detail: n.nodeType });
      }
    }
  }

  const status: LifecycleStatus = anyFailed ? 'failed' : input.persistedEvent ? 'complete' : 'stuck';
  return { correlationId: input.correlationId, status, stages, runIds: runs.map((r) => r.id) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the package index**

In `packages/workflows/src/index.ts`, add: `export * from './lifecycle';` and `export { extractCorrelationId } from './correlation';`

- [ ] **Step 6: Commit**
```bash
git add packages/workflows/src/lifecycle.ts packages/workflows/src/lifecycle.test.ts packages/workflows/src/index.ts
git commit -m "feat(workflows): pure payload-lifecycle stage builder"
```

### Task 5: Bootstrap assembler service (gathers rows → buildLifecycle)

**Files:**
- Create: `packages/bootstrap/src/activity-service.ts`
- Test: `packages/bootstrap/src/activity-service.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (construct + expose on AppContext)

- [ ] **Step 1: Write the failing test (fake stores)**

Create `packages/bootstrap/src/activity-service.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createActivityService } from './activity-service';

const runs = [
  { id: 'r1', workflowId: 'w', triggerSource: 'webhook', status: 'completed', startedAt: '2026-07-03T10:00:00Z',
    finishedAt: '2026-07-03T10:00:01Z', error: null, correlationId: 'A',
    result: { results: [{ nodeId: 'persist', nodeType: 'persist-store', status: 'success', meta: { batchId: 'A' } }] } },
];
const deps = {
  runs: { listByCorrelation: async (id: string) => runs.filter((r) => r.correlationId === id),
          listCorrelations: async () => [{ correlationId: 'A', latestAt: '2026-07-03T10:00:00Z', latestStatus: 'completed', workflowId: 'w' }] },
  batches: { get: async () => null },
  persistedEvent: async (_id: string) => ({ at: '2026-07-03T10:00:02Z', count: 1, resourceTypes: ['ServiceRequest'] }),
};

it('assembles a lifecycle for a correlation id', async () => {
  const svc = createActivityService(deps as any);
  const lc = await svc.getLifecycle('A');
  expect(lc?.status).toBe('complete');
  expect(lc?.stages.some((s) => s.stage === 'persisted')).toBe(true);
});

it('lists recent payloads', async () => {
  const svc = createActivityService(deps as any);
  const list = await svc.listRecent({ limit: 10, offset: 0 });
  expect(list[0].correlationId).toBe('A');
  expect(list[0].currentStage).toBe('persisted');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/bootstrap exec vitest run src/activity-service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Create `packages/bootstrap/src/activity-service.ts`:
```ts
import { buildLifecycle, type Lifecycle, type LifecycleRun } from '@openldr/workflows';

export interface ActivityDeps {
  runs: {
    listByCorrelation(id: string): Promise<LifecycleRun[]>;
    listCorrelations(opts?: { limit?: number; offset?: number }): Promise<Array<{ correlationId: string; latestAt: string; latestStatus: string; workflowId: string }>>;
  };
  batches: { get(batchId: string): Promise<{ received_at?: unknown; source?: unknown; status?: unknown } | null> };
  /** Reads the data.persisted event for a batch from outbox_events (null if not yet persisted). */
  persistedEvent(correlationId: string): Promise<{ at: string; count: number; resourceTypes: string[] } | null>;
}

export interface RecentPayload { correlationId: string; workflowId: string; source: string | null; startedAt: string; currentStage: string; status: string; }

export interface ActivityService {
  getLifecycle(correlationId: string): Promise<Lifecycle | null>;
  listRecent(opts?: { limit?: number; offset?: number }): Promise<RecentPayload[]>;
}

export function createActivityService(deps: ActivityDeps): ActivityService {
  async function assemble(correlationId: string): Promise<Lifecycle | null> {
    const runs = await deps.runs.listByCorrelation(correlationId);
    const batchRow = await deps.batches.get(correlationId);
    const persistedEvent = await deps.persistedEvent(correlationId);
    if (runs.length === 0 && !batchRow) return null;
    const ingestBatch = batchRow
      ? { receivedAt: String(batchRow.received_at ?? runs[0]?.startedAt ?? ''), source: (batchRow.source as string) ?? null, status: String(batchRow.status ?? '') }
      : null;
    return buildLifecycle({ correlationId, runs, persistedEvent, ingestBatch });
  }
  return {
    getLifecycle: assemble,
    async listRecent(opts) {
      const heads = await deps.runs.listCorrelations(opts);
      const out: RecentPayload[] = [];
      for (const h of heads) {
        const lc = await assemble(h.correlationId);
        const last = lc?.stages[lc.stages.length - 1];
        out.push({ correlationId: h.correlationId, workflowId: h.workflowId,
          source: last?.detail ?? null, startedAt: h.latestAt,
          currentStage: last?.stage ?? 'received', status: lc?.status ?? 'stuck' });
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/bootstrap exec vitest run src/activity-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into AppContext**

In `packages/bootstrap/src/index.ts`:
- Add the `data.persisted` reader. The event bus stores events in `outbox_events(type, payload jsonb, batch_id)`. Add a helper near the other store constructions:
```ts
const persistedEvent = async (correlationId: string) => {
  const row = await internal.db.selectFrom('outbox_events' as never)
    .select(['payload', 'created_at'] as never)
    .where('batch_id' as never, '=', correlationId as never)
    .where('type' as never, '=', 'data.persisted' as never)
    .orderBy('created_at' as never, 'asc').executeTakeFirst() as { payload: unknown; created_at: unknown } | undefined;
  if (!row) return null;
  const p = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { count?: number; resourceTypes?: string[] };
  return { at: String(row.created_at), count: p.count ?? 0, resourceTypes: p.resourceTypes ?? [] };
};
```
(If `outbox_events` has no `created_at`, order by `id`; confirm the column names against `packages/db/src/migrations/internal/002_outbox.ts` while implementing — pick the timestamp column that exists.)
- Construct: `const activity = createActivityService({ runs: workflowRunStore, batches: ingestBatchStore, persistedEvent });` using the existing run store + the ingest batch store already built in `ingest-context.ts` / available on the context (reuse the existing `batches` handle — confirm its variable name in this file).
- Add `activity: ActivityService` to the `AppContext` interface (near `featureFlags`/`numberSettings`) and to the returned context object.
- Export: `export { createActivityService } from './activity-service'; export type { ActivityService, RecentPayload } from './activity-service';`

- [ ] **Step 6: Typecheck**

Run: `pnpm -C packages/bootstrap exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**
```bash
git add packages/bootstrap/src/activity-service.ts packages/bootstrap/src/activity-service.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): activity service assembling payload lifecycles"
```

---

## Slice S3 — API routes

### Task 6: `/api/activity` routes

**Files:**
- Create: `apps/server/src/activity-routes.ts`
- Modify: `apps/server/src/app.ts` (register the routes — follow how `registerSettingsRoutes`/`registerReportsRoutes` are registered)
- Test: `apps/server/src/activity-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/activity-routes.test.ts` following the shape of `apps/server/src/settings-routes.test.ts` (build a Fastify app with a fake ctx exposing `activity`):
```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerActivityRoutes } from './activity-routes';

function appWith(activity: unknown) {
  const app = Fastify();
  // Minimal auth shim: the real app sets req.user; these routes only require a signed-in role.
  registerActivityRoutes(app as never, { activity } as never);
  return app;
}

it('GET /api/activity lists recent payloads', async () => {
  const app = appWith({ listRecent: async () => [{ correlationId: 'A', workflowId: 'w', source: 'webhook', startedAt: 't', currentStage: 'persisted', status: 'complete' }], getLifecycle: async () => null });
  const res = await app.inject({ method: 'GET', url: '/api/activity' });
  expect(res.statusCode).toBe(200);
  expect(res.json()[0].correlationId).toBe('A');
});

it('GET /api/activity/:id returns a lifecycle or 404', async () => {
  const app = appWith({ listRecent: async () => [], getLifecycle: async (id: string) => id === 'A' ? { correlationId: 'A', status: 'complete', stages: [], runIds: [] } : null });
  expect((await app.inject({ method: 'GET', url: '/api/activity/A' })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/api/activity/none' })).statusCode).toBe(404);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/server exec vitest run src/activity-routes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the routes**

Create `apps/server/src/activity-routes.ts` (mirror the role-gating in `reports-routes.ts` — use `requireRole` with the analyst/manager/admin roles; import from `./rbac`):
```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { requireAnyRole } from './rbac';

const VIEW_ROLES = ['lab_admin', 'lab_manager', 'data_analyst', 'system_auditor'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerActivityRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/activity', { preHandler: requireAnyRole(VIEW_ROLES) }, async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    return ctx.activity.listRecent({ limit: q.limit ? Number(q.limit) : 50, offset: q.offset ? Number(q.offset) : 0 });
  });
  app.get('/api/activity/:correlationId', { preHandler: requireAnyRole(VIEW_ROLES) }, async (req, reply) => {
    const { correlationId } = req.params as { correlationId: string };
    const lc = await ctx.activity.getLifecycle(correlationId);
    if (!lc) { reply.code(404); return { error: 'unknown payload' }; }
    return lc;
  });
}
```
Note: confirm the exact rbac helper name in `apps/server/src/rbac.ts` (`requireRole` takes one role; if there is no `requireAnyRole`, add a small one there that passes if the user has any of the roles, mirroring `requireRole`). If the test's Fastify app has no auth decorator, guard the preHandler import so the unit test can pass a no-op — simplest: in the test, register with a wrapper that stubs `req.user`; or export the handlers as plain functions and test those directly. Keep the route file thin.

- [ ] **Step 4: Register in app.ts**

In `apps/server/src/app.ts`, add `import { registerActivityRoutes } from './activity-routes';` and call `registerActivityRoutes(app, ctx);` alongside the other `register*Routes(app, ctx)` calls.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -C apps/server exec vitest run src/activity-routes.test.ts && pnpm -C apps/server exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**
```bash
git add apps/server/src/activity-routes.ts apps/server/src/activity-routes.test.ts apps/server/src/app.ts apps/server/src/rbac.ts
git commit -m "feat(server): /api/activity routes for payload lifecycles"
```

---

## Slice S4 — Studio Activity page

### Task 7: API client + types

**Files:**
- Modify: `apps/studio/src/api.ts`

- [ ] **Step 1: Add client functions (follow the existing `fetch*`/`okJson`/`authFetch` pattern in the file)**
```ts
export interface LifecycleStageEntry { stage: string; status: string; at: string; runId?: string; detail?: string }
export interface Lifecycle { correlationId: string; status: string; stages: LifecycleStageEntry[]; runIds: string[] }
export interface RecentPayload { correlationId: string; workflowId: string; source: string | null; startedAt: string; currentStage: string; status: string }

export const fetchActivity = (): Promise<RecentPayload[]> =>
  authFetch('/api/activity').then((r) => okJson<RecentPayload[]>(r, 'list activity'));
export const fetchLifecycle = (id: string): Promise<Lifecycle> =>
  authFetch(`/api/activity/${encodeURIComponent(id)}`).then((r) => okJson<Lifecycle>(r, 'load lifecycle'));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/studio exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**
```bash
git add apps/studio/src/api.ts
git commit -m "feat(studio): activity api client"
```

### Task 8: Activity page + route + nav

**Files:**
- Create: `apps/studio/src/pages/Activity.tsx`
- Test: `apps/studio/src/pages/Activity.test.tsx`
- Modify: `apps/studio/src/App.tsx` (route), `apps/studio/src/shell/AppShell.tsx` (`NAV` entry), i18n `en.ts`/`fr.ts`/`pt.ts` (nav label + page strings)

- [ ] **Step 1: Write a failing render test**

Create `apps/studio/src/pages/Activity.test.tsx` (mock `@/api` like other page tests, e.g. `Reports.test.tsx`):
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Activity } from './Activity';

vi.mock('@/api', () => ({
  fetchActivity: async () => [{ correlationId: 'A', workflowId: 'w', source: 'webhook', startedAt: '2026-07-03T10:00:00Z', currentStage: 'persisted', status: 'complete' }],
  fetchLifecycle: async () => ({ correlationId: 'A', status: 'complete', stages: [], runIds: [] }),
}));

it('lists recent payloads with their stage', async () => {
  render(<MemoryRouter><Activity /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('persisted')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/studio exec vitest run src/pages/Activity.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the page**

Create `apps/studio/src/pages/Activity.tsx` — a table over `fetchActivity()` with a stage indicator (received → validated → persisted → pushed) highlighting `currentStage` and a status badge; clicking a row loads `fetchLifecycle(id)` into a detail panel showing the stage timeline with `at`/`detail` and links to each run. Wrap in `AppShell title="Activity"`. Follow the structure/imports of an existing list page (`apps/studio/src/pages/Reports.tsx` or the audit page) for the shell, table, `useState`/`useEffect` load, and edge-to-edge conventions (memory `ui-edge-to-edge-dividers`, `use-shadcn-components`). Keep the stage indicator a small presentational sub-component.

- [ ] **Step 4: Route + nav + i18n**

- `apps/studio/src/App.tsx`: add `<Route path="/activity" element={<Activity />} />` (import `Activity`).
- `apps/studio/src/shell/AppShell.tsx`: add a `NAV` entry `{ to: '/activity', labelKey: 'nav.activity', end: false, icon: Activity /* lucide */, roles: ['lab_admin','lab_manager','data_analyst','system_auditor'] }` (import an icon like `Activity` from `lucide-react`).
- Add `nav.activity` and the page strings to `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (all three — the i18n type enforces key parity across locales; memory `i18n-workstream`). English: `activity: 'Activity'`; translate for fr/pt.

- [ ] **Step 5: Run the page test + typecheck**

Run: `pnpm -C apps/studio exec vitest run src/pages/Activity.test.tsx && pnpm -C apps/studio exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**
```bash
git add apps/studio/src/pages/Activity.tsx apps/studio/src/pages/Activity.test.tsx apps/studio/src/App.tsx apps/studio/src/shell/AppShell.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Activity page — payload lifecycle view"
```

---

## Slice S5 — End-to-end verification

### Task 9: Integration test + full gate

**Files:**
- Create: `packages/bootstrap/src/activity-integration.test.ts` (or reuse the workflow ingestion test harness pattern in `packages/bootstrap`)

- [ ] **Step 1: Write an integration test**

Drive a real migrated internal DB: record an originating run (webhook, with a persist node meta.batchId='X') via the run store, insert a `data.persisted` outbox event with `batch_id='X'`, record a reactive run (event, with a sink node) correlationId='X'. Then call `createActivityService(...)` wired to the real stores and assert `getLifecycle('X').stages` = `received, validated?, persisted, pushed` and `status='complete'`, and `listRecent()` includes 'X'. Use `makeMigratedDb` from `@openldr/db/testing`.

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createWorkflowRunStore } from '@openldr/workflows';
import { createActivityService } from './activity-service';
// build stores over db, insert the rows described above, then:
// const lc = await svc.getLifecycle('X'); expect(lc?.status).toBe('complete');
```
Fill in the concrete inserts using the run store's `record` and a raw `insertInto('outbox_events')` for the event (columns per `002_outbox.ts`).

- [ ] **Step 2: Run it**

Run: `pnpm -C packages/bootstrap exec vitest run src/activity-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Full gate (turbo cache masks cross-package tsc — use --force)**

Run: `pnpm turbo typecheck test --force`
Expected: all typecheck green; workflows / bootstrap / server / studio tests green. Re-run any `@openldr/studio#test` red in isolation (`pnpm -C apps/studio test`) — known parallel flake (memory).

- [ ] **Step 4: Commit**
```bash
git add packages/bootstrap/src/activity-integration.test.ts
git commit -m "test(bootstrap): end-to-end payload lifecycle assembly"
```

---

## Self-review notes (author)

- **Spec coverage:** correlation field (S1 T1-3), webhook ack (S1 T3 S6), assembler + stages (S2), API (S3), Studio page (S4), integration + gate (S5). All spec sections mapped.
- **Type consistency:** `correlationId` (camel, app types) ↔ `correlation_id` (snake, DB) mapping in run-store; `LifecycleRun.result.results[].meta.batchId` matches the persist service's `meta.batchId`; `buildLifecycle` inputs match the assembler's outputs.
- **Deferred-to-implementation (flagged, not placeholders):** exact `outbox_events` timestamp column (confirm vs `002_outbox.ts`), the ingest batch store handle's variable name in `index.ts`, and whether `rbac.ts` needs a `requireAnyRole` helper. Each names the file to check and the fallback.
