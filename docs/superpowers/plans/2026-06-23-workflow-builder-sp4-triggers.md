# Workflow Builder — SP-4 Triggers + Run History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenLDR workflows run themselves — on a cron schedule, via an authenticated webhook, or when new lab data is ingested — and persist every run (manual + background) with a Run History UI to inspect them.

**Architecture:** Trigger config lives in the workflow's trigger nodes; on save the server syncs *derived registries* — schedule nodes → a `workflow_schedules` arming table, webhook nodes → an in-memory path→{workflowId,secret} registry, ingest nodes → an in-memory id set. A `workflowTriggerRunner` subscribes to the durable event-bus (`workflow.schedule.due`, `ingest.batch.done`) and runs workflows, mirroring `report-scheduler`'s outbox-arming + `reconcile` exactly; cron next-times come from `cron-parser`. Every run is recorded in `workflow_runs` and surfaced via a history drawer.

**Tech Stack:** TypeScript, Kysely + Postgres, Zod, Fastify, `cron-parser`, the in-process event-bus (`@openldr/ports` `EventingPort`), Vitest + pg-mem, React 18 + Zustand.

**Reference spec:** `docs/superpowers/specs/2026-06-23-workflow-builder-sp4-triggers-design.md`
**Builds on:** the unmerged SP-1 work in this same worktree/branch `feat/workflow-builder-sp1`.

---

## Conventions

- CWD is the worktree `D:/Projects/Repositories/openldr_ce/.claude/worktrees/feat-workflow-builder-sp1`. Deps already installed.
- Commit after each task with the shown message. Package gate after package tasks; full `turbo` gate at the end.
- **Migration numbers:** this plan uses **`028_workflow_runs`** and **`029_workflow_schedules`**. Before Task 2, run `ls packages/db/src/migrations/internal/` and use the next two free integers if those are taken (a parallel branch may have claimed them); keep filename + registry key + the `migrations.test.ts` expected-keys list consistent.
- Patterns to imitate (read before writing): `packages/bootstrap/src/report-scheduler.ts` (arming/runner/reconcile), `D:/Projects/Repositories/workflow-builder/apps/api/src/lib/webhook-registry.ts` (registry), `packages/dashboards/src/store.ts` + `packages/workflows/src/store.ts` (store shape), `apps/web/src/reports/ReportHistoryDrawer.tsx` (history UI), `apps/server/src/index.ts:63-70` (startup register/reconcile).

---

## Phase A — Run + schedule persistence (`packages/workflows`)

### Task 1: Run & schedule types + stores

**Files:**
- Create: `packages/workflows/src/run-store.ts`, `packages/workflows/src/run-store.test.ts`
- Create: `packages/workflows/src/schedule-store.ts`, `packages/workflows/src/schedule-store.test.ts`
- Modify: `packages/workflows/src/types.ts` (append run/schedule Zod types)
- Modify: `packages/workflows/src/index.ts` (export the new stores/types)

- [ ] **Step 1: Append types to `types.ts`**

```ts
export const TRIGGER_SOURCES = ['manual', 'schedule', 'webhook', 'ingest'] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  triggerSource: z.enum(TRIGGER_SOURCES),
  status: z.enum(['completed', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string(),
  result: z.unknown(),          // the full WorkflowRunResult
  error: z.string().nullable().default(null),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowScheduleSchema = z.object({
  workflowId: z.string(),
  nodeId: z.string(),
  cron: z.string(),
  tz: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  nextDueAt: z.string().nullable().default(null),
});
export type WorkflowSchedule = z.infer<typeof WorkflowScheduleSchema>;
```

- [ ] **Step 2: Write the failing run-store test** (`run-store.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowRunStore } from './run-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_runs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workflow_id', 'text')
    .addColumn('trigger_source', 'text')
    .addColumn('status', 'text')
    .addColumn('started_at', 'text')
    .addColumn('finished_at', 'text')
    .addColumn('result', 'jsonb')
    .addColumn('error', 'text')
    .execute();
});

describe('WorkflowRunStore', () => {
  it('records, lists by workflow, gets by id', async () => {
    const store = createWorkflowRunStore(db);
    await store.record({
      id: 'r1', workflowId: 'w1', triggerSource: 'manual', status: 'completed',
      startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z',
      result: { status: 'completed', results: [] }, error: null,
    });
    const list = await store.list('w1', { limit: 10, offset: 0 });
    expect(list.length).toBe(1);
    expect(list[0].triggerSource).toBe('manual');
    expect((await store.get('r1'))?.id).toBe('r1');
    expect(await store.get('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test run-store`
Expected: FAIL — no `./run-store`.

- [ ] **Step 4: Write `run-store.ts`** (mirrors `store.ts`)

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowRun, WorkflowRunSchema } from './types';

function toRow(r: WorkflowRun) {
  return {
    id: r.id, workflow_id: r.workflowId, trigger_source: r.triggerSource, status: r.status,
    started_at: r.startedAt, finished_at: r.finishedAt,
    result: JSON.stringify(r.result ?? null), error: r.error ?? null,
  };
}
function fromRow(r: Record<string, unknown>): WorkflowRun {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));
  return WorkflowRunSchema.parse({
    id: r.id, workflowId: r.workflow_id, triggerSource: r.trigger_source, status: r.status,
    startedAt: String(r.started_at), finishedAt: String(r.finished_at),
    result: parse(r.result), error: r.error ?? null,
  });
}

export interface WorkflowRunStore {
  record(run: WorkflowRun): Promise<void>;
  list(workflowId: string, opts?: { limit?: number; offset?: number }): Promise<WorkflowRun[]>;
  get(id: string): Promise<WorkflowRun | undefined>;
}

export function createWorkflowRunStore(db: Kysely<InternalSchema>): WorkflowRunStore {
  return {
    async record(run) {
      await db.insertInto('workflow_runs').values(toRow(WorkflowRunSchema.parse(run)) as never).execute();
    },
    async list(workflowId, opts = {}) {
      const rows = await db.selectFrom('workflow_runs').selectAll()
        .where('workflow_id', '=', workflowId)
        .orderBy('started_at', 'desc')
        .limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await db.selectFrom('workflow_runs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test run-store`
Expected: PASS.

- [ ] **Step 6: Write the failing schedule-store test** (`schedule-store.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowScheduleStore } from './schedule-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_schedules')
    .addColumn('workflow_id', 'text')
    .addColumn('node_id', 'text')
    .addColumn('cron', 'text')
    .addColumn('tz', 'text')
    .addColumn('enabled', 'boolean')
    .addColumn('next_due_at', 'text')
    .execute();
});

describe('WorkflowScheduleStore', () => {
  it('upserts, lists enabled, sets next due, removes per workflow', async () => {
    const store = createWorkflowScheduleStore(db);
    await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: null });
    await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 10 * * *', tz: 'UTC', enabled: true, nextDueAt: null }); // update
    expect((await store.list({ enabledOnly: true })).length).toBe(1);
    await store.setNextDue('w1', 'n1', '2026-01-01T10:00:00Z');
    expect((await store.get('w1', 'n1'))?.nextDueAt).toBe('2026-01-01T10:00:00Z');
    await store.removeForWorkflow('w1');
    expect((await store.list({})).length).toBe(0);
  });
});
```

- [ ] **Step 7: Run to verify it fails, then write `schedule-store.ts`**

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowSchedule, WorkflowScheduleSchema } from './types';

function fromRow(r: Record<string, unknown>): WorkflowSchedule {
  return WorkflowScheduleSchema.parse({
    workflowId: r.workflow_id, nodeId: r.node_id, cron: r.cron,
    tz: r.tz ?? null, enabled: r.enabled == null ? true : Boolean(r.enabled),
    nextDueAt: r.next_due_at ? String(r.next_due_at) : null,
  });
}

export interface WorkflowScheduleStore {
  upsert(s: WorkflowSchedule): Promise<void>;
  removeForWorkflow(workflowId: string): Promise<void>;
  list(opts: { enabledOnly?: boolean }): Promise<WorkflowSchedule[]>;
  get(workflowId: string, nodeId: string): Promise<WorkflowSchedule | undefined>;
  setNextDue(workflowId: string, nodeId: string, nextDueAt: string): Promise<void>;
}

export function createWorkflowScheduleStore(db: Kysely<InternalSchema>): WorkflowScheduleStore {
  const T = 'workflow_schedules' as const;
  return {
    async upsert(s) {
      const v = WorkflowScheduleSchema.parse(s);
      await db.deleteFrom(T).where('workflow_id', '=', v.workflowId).where('node_id', '=', v.nodeId).execute();
      await db.insertInto(T).values({
        workflow_id: v.workflowId, node_id: v.nodeId, cron: v.cron, tz: v.tz ?? null,
        enabled: v.enabled, next_due_at: v.nextDueAt ?? null,
      } as never).execute();
    },
    async removeForWorkflow(workflowId) {
      await db.deleteFrom(T).where('workflow_id', '=', workflowId).execute();
    },
    async list(opts) {
      let q = db.selectFrom(T).selectAll();
      if (opts.enabledOnly) q = q.where('enabled', '=', true);
      const rows = await q.execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(workflowId, nodeId) {
      const r = await db.selectFrom(T).selectAll().where('workflow_id', '=', workflowId).where('node_id', '=', nodeId).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async setNextDue(workflowId, nodeId, nextDueAt) {
      await db.updateTable(T).set({ next_due_at: nextDueAt } as never).where('workflow_id', '=', workflowId).where('node_id', '=', nodeId).execute();
    },
  };
}
```

Run: `pnpm --filter @openldr/workflows test schedule-store`
Expected: PASS.

- [ ] **Step 8: Export from `index.ts`** — append:

```ts
export { createWorkflowRunStore, type WorkflowRunStore } from './run-store';
export { createWorkflowScheduleStore, type WorkflowScheduleStore } from './schedule-store';
```

- [ ] **Step 9: Commit** (typecheck will show only the expected `workflow_runs`/`workflow_schedules` "not in InternalSchema" errors until Task 2 — that's fine; tests pass)

```bash
git add packages/workflows/src/types.ts packages/workflows/src/run-store.ts packages/workflows/src/run-store.test.ts packages/workflows/src/schedule-store.ts packages/workflows/src/schedule-store.test.ts packages/workflows/src/index.ts
git commit -m "feat(workflows): WorkflowRunStore + WorkflowScheduleStore"
```

---

### Task 2: Migrations + schema types

**Files:**
- Create: `packages/db/src/migrations/internal/028_workflow_runs.ts`, `029_workflow_schedules.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Confirm free numbers** — `ls packages/db/src/migrations/internal/`. Use 028/029 unless taken.

- [ ] **Step 2: `028_workflow_runs.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_runs').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workflow_id', 'text', (c) => c.notNull())
    .addColumn('trigger_source', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('started_at', 'timestamptz', (c) => c.notNull())
    .addColumn('finished_at', 'timestamptz', (c) => c.notNull())
    .addColumn('result', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('error', 'text')
    .execute();
  await db.schema.createIndex('idx_workflow_runs_wf').ifNotExists()
    .on('workflow_runs').columns(['workflow_id', 'started_at']).execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_runs').ifExists().execute();
}
```

- [ ] **Step 3: `029_workflow_schedules.ts`**

```ts
import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_schedules').ifNotExists()
    .addColumn('workflow_id', 'text', (c) => c.notNull())
    .addColumn('node_id', 'text', (c) => c.notNull())
    .addColumn('cron', 'text', (c) => c.notNull())
    .addColumn('tz', 'text')
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('next_due_at', 'timestamptz')
    .addPrimaryKeyConstraint('workflow_schedules_pk', ['workflow_id', 'node_id'])
    .execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_schedules').ifExists().execute();
}
```

- [ ] **Step 4: Register both in `migrations/internal/index.ts`** (imports after `m027`, entries after `'027_workflows'`):

```ts
import * as m028 from './028_workflow_runs';
import * as m029 from './029_workflow_schedules';
// ...
  '028_workflow_runs': { up: m028.up, down: m028.down },
  '029_workflow_schedules': { up: m029.up, down: m029.down },
```

- [ ] **Step 5: Add schema types to `schema/internal.ts`** (match the `Generated`/`JSONColumnType` convention already used by `WorkflowsTable`):

```ts
export interface WorkflowRunsTable {
  id: string;
  workflow_id: string;
  trigger_source: string;
  status: string;
  started_at: Date;
  finished_at: Date;
  result: JSONColumnType<unknown>;
  error: string | null;
}
export interface WorkflowSchedulesTable {
  workflow_id: string;
  node_id: string;
  cron: string;
  tz: string | null;
  enabled: Generated<boolean>;
  next_due_at: Date | null;
}
```
Register on `InternalSchema`: `workflow_runs: WorkflowRunsTable;` and `workflow_schedules: WorkflowSchedulesTable;`.

- [ ] **Step 6: Update `migrations.test.ts`** — add `'028_workflow_runs'` and `'029_workflow_schedules'` to the expected-keys array.

- [ ] **Step 7: Gates**

Run: `pnpm --filter @openldr/db test` → PASS.
Run: `pnpm --filter @openldr/workflows typecheck` → now GREEN (run/schedule store table errors resolved).
Run: `pnpm --filter @openldr/db typecheck` → GREEN.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/028_workflow_runs.ts packages/db/src/migrations/internal/029_workflow_schedules.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): migrations 028 workflow_runs + 029 workflow_schedules"
```

---

## Phase B — Trigger engine (`packages/workflows`)

### Task 3: cron helper + webhook registry + trigger runner

**Files:**
- Modify: `packages/workflows/package.json` (add `cron-parser`)
- Create: `packages/workflows/src/cron.ts`, `packages/workflows/src/cron.test.ts`
- Create: `packages/workflows/src/webhook-registry.ts`, `packages/workflows/src/webhook-registry.test.ts`
- Create: `packages/workflows/src/trigger-runner.ts`, `packages/workflows/src/trigger-runner.test.ts`
- Modify: `packages/workflows/src/index.ts`

- [ ] **Step 1: Add `cron-parser`** to `packages/workflows/package.json` dependencies (`"cron-parser": "^4.9.0"`), then `pnpm install`.

- [ ] **Step 2: Write `cron.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { nextCronDate } from './cron';

describe('nextCronDate', () => {
  it('computes the next run after a given instant', () => {
    const after = new Date('2026-01-01T08:00:00Z');
    const next = nextCronDate('0 9 * * *', 'UTC', after);
    expect(next.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });
  it('throws on an invalid expression', () => {
    expect(() => nextCronDate('not a cron', 'UTC', new Date())).toThrow();
  });
});
```

- [ ] **Step 3: Write `cron.ts`**

```ts
import parser from 'cron-parser';

/** Next fire time strictly after `after`, interpreting the expression in `tz` (default UTC). */
export function nextCronDate(cron: string, tz: string | null, after: Date): Date {
  const interval = parser.parseExpression(cron, { currentDate: after, tz: tz ?? 'UTC' });
  return interval.next().toDate();
}
```

> Verify the installed `cron-parser` major version's API: v4 exports a default with `parseExpression(expr, { currentDate, tz })`. If the installed version differs (e.g. v5 named exports), adapt the import/call but keep `nextCronDate`'s signature.

Run: `pnpm --filter @openldr/workflows test cron` → PASS.

- [ ] **Step 4: Port the webhook registry with secret.** Write `webhook-registry.ts` based on `D:/Projects/Repositories/workflow-builder/apps/api/src/lib/webhook-registry.ts`, but store `{ workflowId, secret }` per path and add `syncWorkflowWebhooks` that reads `path` + `secret` from webhook trigger node data. Export a factory (not a module singleton — the registry is owned by the app context):

```ts
function normalize(path: string): string { return path.replace(/^\/+/, '').replace(/\/+$/, ''); }

export interface WebhookEntry { workflowId: string; secret: string | null; }

export interface WebhookRegistry {
  register(path: string, entry: WebhookEntry): void;
  resolve(path: string): WebhookEntry | undefined;
  clear(workflowId: string): void;
  sync(workflowId: string, nodes: unknown[]): void;
  list(): Array<{ path: string; workflowId: string }>;
}

interface MaybeNode { type?: string; data?: { triggerType?: string; path?: string; secret?: string } }

export function createWebhookRegistry(): WebhookRegistry {
  const pathToEntry = new Map<string, WebhookEntry>();
  const workflowToPaths = new Map<string, Set<string>>();
  const reg: WebhookRegistry = {
    register(path, entry) {
      const key = normalize(path);
      if (!key) return;
      pathToEntry.set(key, entry);
      (workflowToPaths.get(entry.workflowId) ?? workflowToPaths.set(entry.workflowId, new Set()).get(entry.workflowId)!).add(key);
    },
    resolve(path) { return pathToEntry.get(normalize(path)); },
    clear(workflowId) {
      for (const p of workflowToPaths.get(workflowId) ?? []) pathToEntry.delete(p);
      workflowToPaths.delete(workflowId);
    },
    sync(workflowId, nodes) {
      reg.clear(workflowId);
      for (const raw of nodes) {
        const node = raw as MaybeNode;
        const isWebhook = node?.type === 'webhook' || (node?.type === 'trigger' && node.data?.triggerType === 'webhook');
        if (!isWebhook) continue;
        const path = node.data?.path;
        if (typeof path === 'string' && path.trim()) reg.register(path, { workflowId, secret: node.data?.secret ?? null });
      }
    },
    list() { return Array.from(pathToEntry.entries()).map(([path, e]) => ({ path, workflowId: e.workflowId })); },
  };
  return reg;
}
```

Write `webhook-registry.test.ts`: register/resolve by normalized path; `sync` reads path+secret from a webhook node; `clear` drops a workflow's paths; resolve returns the secret. Run: `pnpm --filter @openldr/workflows test webhook-registry` → PASS.

- [ ] **Step 5: Write the trigger runner test (failing)** `trigger-runner.test.ts` — use a fake `EventingPort` that records `publish` calls and lets the test invoke subscribed handlers:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkflowTriggerRunner } from './trigger-runner';
import { runWorkflow } from './engine/run-workflow';

function fakeEventing() {
  const handlers = new Map<string, (e: { type: string; payload: unknown }) => Promise<void>>();
  const published: Array<{ type: string; payload: unknown; availableAt?: Date }> = [];
  return {
    handlers, published,
    port: {
      healthCheck: async () => ({ ok: true } as never),
      publish: async (e: never, o?: { availableAt?: Date }) => { published.push({ ...(e as object), availableAt: o?.availableAt } as never); },
      subscribe: async (t: string, h: never) => { handlers.set(t, h as never); },
    },
  };
}

const wfWith = (nodes: unknown[], edges: unknown[] = []) => ({
  id: 'w1', name: 'W', description: null, definition: { nodes, edges },
  enabled: true, createdBy: null,
});

describe('workflow trigger runner', () => {
  it('on schedule.due: runs the workflow, records it, and re-arms', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([{ id: 't', type: 'trigger', data: {} }]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        get: async () => ({ workflowId: 'w1', nodeId: 's', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: null }),
        list: async () => [], setNextDue: async () => {},
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({ type: 'workflow.schedule.due', payload: { workflowId: 'w1', nodeId: 's' } });
    expect(recorded.length).toBe(1);
    expect(ev.published.some((p) => p.type === 'workflow.schedule.due' && p.availableAt instanceof Date)).toBe(true);
  });

  it('on ingest.batch.done: runs workflows whose trigger set includes ingest', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([{ id: 'i', type: 'trigger', data: { triggerType: 'ingest' } }]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: { list: async () => [], get: async () => undefined, setNextDue: async () => {} } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });
    runner.setIngestWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('ingest.batch.done')!({ type: 'ingest.batch.done', payload: { source: 'whonet', count: 3 } });
    expect(recorded.length).toBe(1);
  });
});
```

- [ ] **Step 6: Write `trigger-runner.ts`** (mirrors report-scheduler's runner/reconcile; runs + records + re-arms)

```ts
import { randomUUID } from 'node:crypto';
import type { EventingPort } from '@openldr/ports';
import type { WorkflowStore } from './store';
import type { WorkflowRunStore } from './run-store';
import type { WorkflowScheduleStore } from './schedule-store';
import type { WebhookRegistry } from './webhook-registry';
import type { runWorkflow as RunWorkflowFn } from './engine/run-workflow';
import { WorkflowDefinitionSchema, type TriggerSource, type WorkflowRun } from './types';
import { nextCronDate } from './cron';

interface RunnerDeps {
  store: Pick<WorkflowStore, 'get'>;
  runs: WorkflowRunStore;
  schedules: Pick<WorkflowScheduleStore, 'get' | 'list' | 'setNextDue'>;
  webhooks: Pick<WebhookRegistry, 'resolve'>;
  runWorkflow: typeof RunWorkflowFn;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

const SCHEDULE_DUE = 'workflow.schedule.due';
const INGEST_DONE = 'ingest.batch.done';

export interface WorkflowTriggerRunner {
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
  setIngestWorkflowIds(ids: string[]): void;
  runAndRecord(workflowId: string, source: TriggerSource, input: unknown): Promise<void>;
}

export function createWorkflowTriggerRunner(deps: RunnerDeps): WorkflowTriggerRunner {
  let ingestIds = new Set<string>();

  async function runAndRecord(workflowId: string, source: TriggerSource, input: unknown): Promise<void> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    let result; let error: string | null = null;
    try {
      result = await deps.runWorkflow(def.nodes, def.edges, { input });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = { status: 'failed' as const, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), results: [] };
    }
    const run: WorkflowRun = {
      id: randomUUID(), workflowId, triggerSource: source, status: result.status,
      startedAt: result.startedAt, finishedAt: result.finishedAt, result, error,
    };
    await deps.runs.record(run);
  }

  async function arm(eventing: EventingPort, workflowId: string, nodeId: string, cron: string, tz: string | null): Promise<void> {
    const due = nextCronDate(cron, tz, new Date());
    await deps.schedules.setNextDue(workflowId, nodeId, due.toISOString());
    await eventing.publish({ type: SCHEDULE_DUE, payload: { workflowId, nodeId } }, { availableAt: due });
  }

  return {
    setIngestWorkflowIds(ids) { ingestIds = new Set(ids); },
    runAndRecord,
    async registerRunner(eventing) {
      await eventing.subscribe(SCHEDULE_DUE, async (event) => {
        const { workflowId, nodeId } = event.payload as { workflowId: string; nodeId: string };
        const s = await deps.schedules.get(workflowId, nodeId);
        if (!s || !s.enabled) return;
        await runAndRecord(workflowId, 'schedule', { scheduledAt: new Date().toISOString() });
        const after = await deps.schedules.get(workflowId, nodeId);
        if (!after || !after.enabled) return;
        try { await arm(eventing, workflowId, nodeId, after.cron, after.tz); }
        catch (err) { deps.logger.error({ err, workflowId, nodeId }, 'workflow schedule re-arm failed'); }
      });
      await eventing.subscribe(INGEST_DONE, async (event) => {
        for (const workflowId of ingestIds) {
          await runAndRecord(workflowId, 'ingest', event.payload).catch((err) =>
            deps.logger.error({ err, workflowId }, 'ingest-triggered workflow run failed'));
        }
      });
    },
    async reconcile(eventing) {
      const now = Date.now();
      for (const s of await deps.schedules.list({ enabledOnly: true })) {
        if (s.nextDueAt && new Date(s.nextDueAt).getTime() > now) continue; // already armed
        try { await arm(eventing, s.workflowId, s.nodeId, s.cron, s.tz); }
        catch (err) { deps.logger.error({ err, workflowId: s.workflowId, nodeId: s.nodeId }, 'workflow schedule arm failed'); }
      }
    },
  };
}
```

- [ ] **Step 7: Export from `index.ts`** — append:

```ts
export { createWorkflowRunStore as _runStore } from './run-store'; // (already exported above; skip if dup)
export { createWebhookRegistry, type WebhookRegistry, type WebhookEntry } from './webhook-registry';
export { createWorkflowTriggerRunner, type WorkflowTriggerRunner } from './trigger-runner';
export { nextCronDate } from './cron';
```
(Only add lines not already present — do not duplicate the run/schedule store exports from Task 1.)

- [ ] **Step 8: Gate + commit**

Run: `pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/workflows test` → all green.

```bash
git add packages/workflows/package.json pnpm-lock.yaml packages/workflows/src/cron.ts packages/workflows/src/cron.test.ts packages/workflows/src/webhook-registry.ts packages/workflows/src/webhook-registry.test.ts packages/workflows/src/trigger-runner.ts packages/workflows/src/trigger-runner.test.ts packages/workflows/src/index.ts
git commit -m "feat(workflows): cron helper + webhook registry + trigger runner"
```

---

## Phase C — Bootstrap + server wiring

### Task 4: Widen `ctx.workflows` in bootstrap

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Update the import** from `@openldr/workflows`:

```ts
import {
  createWorkflowStore, type WorkflowStore,
  createWorkflowRunStore, type WorkflowRunStore,
  createWorkflowScheduleStore, type WorkflowScheduleStore,
  createWebhookRegistry, type WebhookRegistry,
  createWorkflowTriggerRunner, type WorkflowTriggerRunner,
  runWorkflow,
} from '@openldr/workflows';
```

- [ ] **Step 2: Widen the `AppContext` interface** — replace `workflows: { store: WorkflowStore };` with:

```ts
  workflows: {
    store: WorkflowStore;
    runs: WorkflowRunStore;
    schedules: WorkflowScheduleStore;
    webhooks: WebhookRegistry;
    runner: WorkflowTriggerRunner;
  };
```

- [ ] **Step 3: Construct** (replace the SP-1 `const workflows = { store: ... }`):

```ts
  const workflowStore = createWorkflowStore(internal.db);
  const workflowRuns = createWorkflowRunStore(internal.db);
  const workflowSchedules = createWorkflowScheduleStore(internal.db);
  const workflowWebhooks = createWebhookRegistry();
  const workflowRunner = createWorkflowTriggerRunner({
    store: workflowStore, runs: workflowRuns, schedules: workflowSchedules,
    webhooks: workflowWebhooks, runWorkflow, logger,
  });
  const workflows = { store: workflowStore, runs: workflowRuns, schedules: workflowSchedules, webhooks: workflowWebhooks, runner: workflowRunner };
```

(The returned object already includes `workflows,` from SP-1 — leave it.)

- [ ] **Step 4: Gate + commit**

Run: `pnpm --filter @openldr/bootstrap typecheck` → green.

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): widen ctx.workflows with runs/schedules/webhooks/runner"
```

---

### Task 5: Trigger sync + run-history routes + webhook route + record manual runs

**Files:**
- Modify: `apps/server/src/workflows-routes.ts`
- Modify: `apps/server/src/workflows-routes.test.ts`

- [ ] **Step 1: Add a `syncWorkflowTriggers` helper + run recording to `workflows-routes.ts`.** Imports to add: `createWebhookRegistry` not needed (registry is on ctx); add `randomUUID` from `node:crypto`, and `type WorkflowRun` from `@openldr/workflows`. Add this module-level helper:

```ts
async function syncWorkflowTriggers(ctx: AppContext, workflow: { id: string; definition: unknown }): Promise<void> {
  const def = WorkflowDefinitionSchema.parse(workflow.definition);
  // webhooks (in-memory)
  ctx.workflows.webhooks.sync(workflow.id, def.nodes);
  // schedules (derived table) — replace this workflow's rows with current schedule nodes
  await ctx.workflows.schedules.removeForWorkflow(workflow.id);
  for (const n of def.nodes as Array<{ id: string; type?: string; data?: Record<string, unknown> }>) {
    const isSchedule = n.type === 'trigger' && (n.data?.triggerType === 'schedule');
    const cron = n.data?.cron as string | undefined;
    if (isSchedule && cron && cron.trim()) {
      await ctx.workflows.schedules.upsert({
        workflowId: workflow.id, nodeId: n.id, cron, tz: (n.data?.tz as string) ?? null, enabled: true, nextDueAt: null,
      });
    }
  }
}
```

> The `webhooks.sync` signature is `sync(workflowId, nodes)` (from Task 3). Confirm the schedule node's `data.triggerType === 'schedule'` and that `cron`/`tz` live on `data` — align with the web form field names you set in Task 7; if they differ, use the real keys.

- [ ] **Step 2: Call sync after create/update; clear on delete.** In `POST` after `create(...)`: `await syncWorkflowTriggers(ctx, created);`. In `PUT` after `update(...)`: `await syncWorkflowTriggers(ctx, updated);`. In `DELETE` after `remove(...)`: `ctx.workflows.webhooks.clear(id); await ctx.workflows.schedules.removeForWorkflow(id);`. (Ingest-set rebuild is handled in Task 6's reconcile; for live updates also recompute it — simplest: after any create/update/delete, recompute the ingest id set via `ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx))` where `listIngestWorkflowIds` scans `ctx.workflows.store.list()` for nodes with `triggerType==='ingest'`. Add that small helper.)

```ts
async function listIngestWorkflowIds(ctx: AppContext): Promise<string[]> {
  const all = await ctx.workflows.store.list();
  return all.filter((w) => {
    const def = WorkflowDefinitionSchema.parse(w.definition);
    return (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).some(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'ingest');
  }).map((w) => w.id);
}
```
After each create/update/delete: `ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx));`.

- [ ] **Step 3: Record manual runs** — in `execute-stream`, after the final `done` frame is written, record the run. Refactor the try block:

```ts
    try {
      const result = await runWorkflow(def.nodes, def.edges, { input: body.input, onEvent: send });
      reply.raw.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      await ctx.workflows.runs.record({
        id: randomUUID(), workflowId: id, triggerSource: 'manual', status: result.status,
        startedAt: result.startedAt, finishedAt: result.finishedAt, result, error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      await ctx.workflows.runs.record({
        id: randomUUID(), workflowId: id, triggerSource: 'manual', status: 'failed',
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        result: { status: 'failed', results: [] }, error: message,
      }).catch(() => {});
    } finally {
      reply.raw.end();
    }
```

- [ ] **Step 4: Add run-history routes** (after the execute-stream route, before `mapError`):

```ts
  app.get('/api/workflows/:id/runs', MANAGE, async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    return ctx.workflows.runs.list(id, { limit: q.limit ? Number(q.limit) : 50, offset: q.offset ? Number(q.offset) : 0 });
  });
  app.get('/api/workflows/runs/:runId', MANAGE, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await ctx.workflows.runs.get(runId);
    if (!run) { reply.code(404); return { error: `unknown run: ${runId}` }; }
    return run;
  });
```

- [ ] **Step 5: Add the webhook catch-all route** (secret-gated, NOT `MANAGE`):

```ts
  app.post('/api/workflows/hooks/*', async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)['*'] ?? '';
    const entry = ctx.workflows.webhooks.resolve(wildcard);
    if (!entry) { reply.code(404); return { error: 'unknown webhook' }; }
    const token = (req.headers['x-webhook-token'] as string | undefined) ?? (req.query as { token?: string }).token;
    if (entry.secret && token !== entry.secret) { reply.code(401); return { error: 'invalid webhook token' }; }
    await ctx.workflows.runner.runAndRecord(entry.workflowId, 'webhook', {
      method: req.method, body: req.body, headers: req.headers, query: req.query,
    });
    return { ok: true };
  });
```

> Fastify wildcard param is `req.params['*']`. Confirm the app doesn't already mount a conflicting `/api/workflows/*` route (it doesn't — CRUD uses specific paths). The `:id` routes are more specific than `hooks/*`, but to be safe the literal `hooks` segment avoids collision with `/:id`.

- [ ] **Step 6: Extend `workflows-routes.test.ts`** — add cases (reuse the existing harness + ctx stub; the stub's `ctx.workflows` must now expose `runs`/`schedules`/`webhooks`/`runner` — use in-memory fakes):
  1. After create, `GET /api/workflows/:id/runs` returns `[]` (no runs yet).
  2. `GET /api/workflows/runs/:runId` for unknown id → 404.
  3. `POST /api/workflows/hooks/<path>` with no registered path → 404.
  4. Register a webhook (via the fake registry) with a secret; POST with wrong token → 401; POST with correct token → 200 and `runner.runAndRecord` was called.
  5. After an execute-stream run, `runs.record` was called with `triggerSource:'manual'`.

Run: `pnpm --filter @openldr/server test workflows-routes` → green.

- [ ] **Step 7: Gate + commit**

Run: `pnpm --filter @openldr/server typecheck` → green.

```bash
git add apps/server/src/workflows-routes.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat(server): workflow trigger sync, webhook route, run-history routes, manual run recording"
```

---

### Task 6: Startup register + reconcile

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: After the `reportScheduler` block (around line 70)**, add:

```ts
  await ctx.workflows.runner.registerRunner(ingest.eventing);
  try {
    ctx.workflows.runner.setIngestWorkflowIds(
      (await ctx.workflows.store.list())
        .filter((w) => JSON.stringify(w.definition).includes('"triggerType":"ingest"'))
        .map((w) => w.id),
    );
    // Rebuild the webhook registry from saved workflows.
    for (const w of await ctx.workflows.store.list()) ctx.workflows.webhooks.sync(w.id, (w.definition as { nodes: unknown[] }).nodes ?? []);
    await ctx.workflows.runner.reconcile(ingest.eventing);
  } catch (err) {
    ctx.logger.warn({ err }, 'workflow trigger reconcile failed at startup (continuing)');
  }
```

> The ingest-id filter uses a cheap JSON substring scan to avoid parsing; if you prefer, reuse a parsed scan. Keep the `try/catch`-continue posture so a bad migration/DB hiccup never blocks startup (matches report-scheduler).

- [ ] **Step 2: Gate + commit**

Run: `pnpm --filter @openldr/server typecheck` → green.

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): register + reconcile workflow triggers at startup"
```

---

## Phase D — Web UI

### Task 7: Enable trigger nodes, webhook secret form, ingest node, run-history drawer

**Files:**
- Modify: `apps/web/src/workflows/constants.ts` (enable trigger ids; add ingest trigger template)
- Modify: `apps/web/src/workflows/components/node-forms/webhook-form.tsx`
- Create: `apps/web/src/workflows/components/node-forms/ingest-form.tsx` + register it in the node-forms registry
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx` (register ingest form; confirm schedule form is wired)
- Create: `apps/web/src/workflows/components/panels/run-history-drawer.tsx`
- Modify: `apps/web/src/workflows/page.tsx` (add a History button opening the drawer)
- Modify: `apps/web/src/api.ts` (run-history client)

- [ ] **Step 1: Enable trigger nodes.** In `constants.ts`, add the schedule/webhook/ingest trigger template ids to `IMPLEMENTED_TEMPLATE_IDS`. READ the file to find the real ids (e.g. `schedule`, `webhook`); add a new **ingest trigger** template to the trigger category with id `ingest`, `type: 'trigger'`, `defaultData: { label: 'On Data Ingest', triggerType: 'ingest', config: {} }` (match the shape of the existing manual/schedule trigger templates). Add `'schedule'`, `'webhook'`, `'ingest'` to `IMPLEMENTED_TEMPLATE_IDS`.

- [ ] **Step 2: Webhook secret in the form.** In `webhook-form.tsx`, add a generated `secret` field stored in node data: show the secret (read-only input) + a "Regenerate" button that sets `data.secret = crypto.randomUUID()` (or `Math.random`-based if `crypto` unavailable in the browser bundle — `crypto.randomUUID()` is fine in modern browsers); seed a secret on first render if absent. Update the live URL preview to `/api/workflows/hooks/<path>` and show the header hint `X-Webhook-Token: <secret>`. Keep path + method fields.

- [ ] **Step 3: Ingest form.** Create `ingest-form.tsx`: a short form with an event label (fixed `ingest.batch.done` for now, shown read-only) and an optional "source filter" text input bound to `data.config.sourceFilter`. Register it in `node-forms/index.tsx`'s `pickForm` keyed by templateId `ingest`. Confirm the schedule form (cron + tz) is registered for templateId `schedule`.

- [ ] **Step 4: Run-history API client.** Append to `apps/web/src/api.ts`:

```ts
export interface WorkflowRunSummary {
  id: string; workflowId: string; triggerSource: 'manual' | 'schedule' | 'webhook' | 'ingest';
  status: 'completed' | 'failed'; startedAt: string; finishedAt: string; error: string | null;
  result: unknown;
}
export async function fetchWorkflowRuns(id: string, opts: { limit?: number; offset?: number } = {}): Promise<WorkflowRunSummary[]> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}/runs${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`workflow runs failed: ${res.status}`);
  return res.json() as Promise<WorkflowRunSummary[]>;
}
export async function fetchWorkflowRun(runId: string): Promise<WorkflowRunSummary> {
  const res = await authFetch(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`workflow run failed: ${res.status}`);
  return res.json() as Promise<WorkflowRunSummary>;
}
```

- [ ] **Step 5: Run-history drawer.** Create `run-history-drawer.tsx` mirroring `apps/web/src/reports/ReportHistoryDrawer.tsx` (READ it first for the shadcn Sheet/Drawer + pagination + row layout). It lists `fetchWorkflowRuns(workflowId)` with a trigger-source badge, status, started/finished times, and an error/summary; clicking a row calls `fetchWorkflowRun(runId)` and renders the per-node results/logs (reuse the existing `workflow-log-view` / results table components from the ported panels). Paginate with limit/offset like the reports drawer.

- [ ] **Step 6: Wire a History button** into `page.tsx`'s toolbar (next to Save/Run) that opens the drawer for the current `workflowId` (disabled until the workflow has been saved once).

- [ ] **Step 7: Gates**

Run: `pnpm --filter @openldr/web typecheck` → green.
Run: `pnpm --filter @openldr/web test` → green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/workflows apps/web/src/api.ts
git commit -m "feat(web): enable trigger nodes, webhook secret, ingest node, run-history drawer"
```

---

## Phase E — Verification

### Task 8: Full gate + manual e2e

- [ ] **Step 1: Full monorepo gate**

Run: `pnpm turbo typecheck lint test build`
Expected: all tasks PASS. If `@openldr/web#test` flakes in parallel, re-run isolated: `pnpm --filter @openldr/web test`.

- [ ] **Step 2: Dependency-graph check**

Run: `pnpm depcruise` (use the exact root script)
Expected: clean — `cron-parser` is a workflows-package dep; no new forbidden cross-package edges.

- [ ] **Step 3: Manual e2e** (needs a live stack + Keycloak login as `lab_admin`/`lab_manager`):
  1. **Webhook:** build Webhook(trigger, path `hello`)→Log; save; copy the secret; `curl -XPOST localhost:<port>/api/workflows/hooks/hello -H 'X-Webhook-Token: <secret>' -d '{"name":"a"}'` → 200; wrong/no token → 401; open Run History → the run appears with source `webhook` and the resolved log.
  2. **Schedule:** add a Schedule trigger (cron e.g. `*/1 * * * *`) → Log; save; wait ~1 min; Run History shows a `schedule` run. Disable/delete → no further runs.
  3. **Ingest:** add an On-Data-Ingest trigger → Log; save; trigger an ingest batch (or publish `ingest.batch.done`); Run History shows an `ingest` run.
  4. **Manual:** Run from the toolbar → Run History shows a `manual` run with per-node detail.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "chore(workflows): SP-4 verification fixes"
```

- [ ] **Step 5:** Proceed to `superpowers:finishing-a-development-branch`.

---

## Self-review notes (author)

- **Spec coverage:** §2 run persistence → Tasks 1,2,5(Step 3); §3 scheduled → Tasks 1,2,3,6; §4 webhook → Tasks 3,5(Step 5),7(Step 2); §5 ingest → Tasks 3,5(Step 2),6,7(Steps 1,3); §6 sync-on-save → Task 5(Steps 1-2); §7 web → Task 7; §8 bootstrap/startup → Tasks 4,6; §9 roles/testing → Tasks 5,6,8.
- **Type consistency:** `WorkflowRun`/`WorkflowSchedule`/`TriggerSource`, `createWorkflowRunStore`/`createWorkflowScheduleStore`/`createWebhookRegistry`/`createWorkflowTriggerRunner`, `nextCronDate`, `runAndRecord`, `setIngestWorkflowIds`, `webhooks.sync`/`resolve`/`clear` are used identically across tasks.
- **Soft spots flagged for the implementer to verify against real files:** schema `Generated`/`JSONColumnType` convention (Task 2); the trigger node `data` field names (`triggerType`,`cron`,`tz`,`secret`,`path`,`config.sourceFilter`) must match between the web forms (Task 7) and `syncWorkflowTriggers` (Task 5) — pick the real keys and keep both sides aligned; `cron-parser` version API (Task 3); Fastify wildcard param access (Task 5); the route test harness's `ctx.workflows` stub now needs runs/schedules/webhooks/runner fakes (Task 5); `ReportHistoryDrawer` structure to mirror (Task 7).
- **Placeholder scan:** none — all code blocks are concrete; the "verify against real file" notes are deliberate guardrails, not deferrals.
