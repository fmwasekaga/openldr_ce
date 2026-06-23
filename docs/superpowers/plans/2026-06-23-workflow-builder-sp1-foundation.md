# Workflow Builder — SP-1 Foundation + Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the user's standalone n8n-style Workflow Builder page into OpenLDR CE as an internal, node-based feature — a working vertical slice: a ReactFlow canvas that builds/saves workflows to internal Postgres and runs them in-process with live per-node SSE state, using 6 declarative node handlers.

**Architecture:** New isolated `packages/workflows` engine package (Zod types, in-process streaming runner ported from the standalone `runWorkflow`, node-handler registry, template resolver, `WorkflowStore` over `Kysely<InternalSchema>`). A new internal migration adds a `workflows` table. Thin Fastify routes (`apps/server/src/workflows-routes.ts`) expose CRUD + an SSE `execute-stream` endpoint, gated with `requireRole`. The page is copied verbatim into `apps/web/src/workflows/` with mechanical import swaps and wired into `App.tsx` + `AppShell`. Inngest is dropped; execution is in-process like the existing `ontology` SSE + `report-scheduler`.

**Tech Stack:** TypeScript, Kysely + Postgres, Zod, Fastify, Vitest + pg-mem, React 18, `@xyflow/react@12`, Zustand, Tailwind v4 + shadcn/Radix, lucide-react.

**Reference spec:** `docs/superpowers/specs/2026-06-23-workflow-builder-sp1-foundation-design.md`
**Standalone source (copy from):** `../workflow-builder` (paths below are relative to that repo unless prefixed with `openldr`).

---

## Conventions for this plan

- All OpenLDR paths are relative to the repo root of the **worktree** (`.claude/worktrees/feat-workflow-builder-sp1/`). The agent's CWD is already this worktree.
- "Port verbatim" = copy the file's logic exactly, changing only imports/paths as instructed. These engine files have **no** Express/Inngest/React dependency.
- Commit after every task with the message shown. Run the package-local gate after each engine task; run the full `turbo` gate at phase boundaries.
- Migration number: this plan uses **`027`**. Before Task 8, run `ls packages/db/src/migrations/internal/` — if `027_*` already exists (a parallel branch claimed it), use the next free integer and adjust the filename + registry key consistently.

### Pre-flight (run once, before Task 1)

- [ ] **Install deps in the worktree** (worktrees don't share `node_modules`):

Run: `pnpm install`
Expected: completes; workspace links resolve.

- [ ] **Baseline gate is green** before changing anything:

Run: `pnpm turbo typecheck test --filter=@openldr/db --filter=@openldr/bootstrap`
Expected: PASS (establishes a clean baseline; if it fails, stop and report).

---

## Phase 1 — Engine package `packages/workflows`

### Task 1: Scaffold the package

**Files:**
- Create: `packages/workflows/package.json`
- Create: `packages/workflows/tsconfig.json`
- Create: `packages/workflows/src/index.ts`

- [ ] **Step 1: Create `package.json`** (mirrors `packages/dashboards/package.json`)

```json
{
  "name": "@openldr/workflows",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/db": "workspace:*",
    "kysely": "^0.27.5",
    "zod": "3.24.0"
  },
  "devDependencies": {
    "pg-mem": "^3.0.14",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (match a sibling package; verify the path to the base config by reading `packages/dashboards/tsconfig.json` first and copying it)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create a placeholder `src/index.ts`** so the package resolves

```ts
export {};
```

- [ ] **Step 4: Install so the workspace links the new package**

Run: `pnpm install`
Expected: `@openldr/workflows` is linked (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows pnpm-lock.yaml
git commit -m "feat(workflows): scaffold @openldr/workflows package"
```

---

### Task 2: Engine types (`types.ts`)

**Files:**
- Create: `packages/workflows/src/types.ts`
- Create: `packages/workflows/src/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { WorkflowSchema } from './types';

describe('WorkflowSchema', () => {
  it('parses a minimal workflow and defaults definition', () => {
    const wf = WorkflowSchema.parse({ id: 'w1', name: 'Test' });
    expect(wf.definition).toEqual({ nodes: [], edges: [] });
    expect(wf.enabled).toBe(true);
    expect(wf.createdBy).toBeNull();
  });

  it('rejects a workflow without a name', () => {
    expect(() => WorkflowSchema.parse({ id: 'w1' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/workflows test`
Expected: FAIL — cannot find `./types`.

- [ ] **Step 3: Write `types.ts`**

```ts
import { z } from 'zod';

/** Per-node lifecycle events streamed to the UI over SSE. Mirror of the standalone. */
export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  nodeId: string;
  level: LogLevel;
  message: string;
  /** Unix ms */
  ts: number;
}

export type RunEvent =
  | { type: 'node:start'; nodeId: string; nodeType: string }
  | { type: 'node:log'; entry: LogEntry }
  | { type: 'node:success'; nodeId: string; nodeType: string; input: unknown; output: unknown; durationMs: number }
  | { type: 'node:error'; nodeId: string; nodeType: string; error: string; durationMs: number }
  | { type: 'workflow:done'; status: 'completed' | 'failed' };

/** A ReactFlow node, persisted as JSON. `data` is intentionally open (per-type shape lives in the web layer). */
export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.record(z.unknown()).default({}),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowDefinitionSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  definition: WorkflowDefinitionSchema.default({ nodes: [], edges: [] }),
  enabled: z.boolean().default(true),
  createdBy: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/workflows test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/types.ts packages/workflows/src/types.test.ts
git commit -m "feat(workflows): engine + persistence Zod types"
```

---

### Task 3: Execution context + template resolver

**Files:**
- Create: `packages/workflows/src/engine/execution-context.ts`
- Create: `packages/workflows/src/engine/template.ts`
- Create: `packages/workflows/src/engine/template.test.ts`

- [ ] **Step 1: Port `execution-context.ts` verbatim** from `apps/api/src/lib/execution-context.ts`, but import the shared `LogEntry`/`RunEvent`/`LogLevel` types from `../types` instead of redeclaring them.

```ts
import type { RunEvent } from '../types';

export interface ExecutionContext {
  /** Initial input — e.g. a manual trigger payload. */
  input: unknown;
  /** Output of every node that has run, keyed by node id. */
  nodeOutputs: Record<string, unknown>;
  /** Captured log lines per node. */
  logs: Record<string, import('../types').LogEntry[]>;
  /** Stream an event out to listeners (SSE + buffer). */
  emit: (evt: RunEvent) => void;
  /** All edges — used by the merge handler. */
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
}

export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
): ExecutionContext {
  return { input, nodeOutputs: {}, logs: {}, emit, edges };
}
```

- [ ] **Step 2: Write the failing template test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveTemplate, resolveExpression } from './template';
import { createContext } from './execution-context';

const ctx = () => {
  const c = createContext(undefined, () => {});
  c.nodeOutputs['n1'] = { name: 'alice', nested: { v: 7 } };
  return c;
};

describe('template resolver', () => {
  it('resolves $input dot-paths', () => {
    expect(resolveTemplate('hi {{ $input.name }}', ctx(), { name: 'bob' })).toBe('hi bob');
  });
  it('resolves $node() references', () => {
    expect(resolveExpression("$node('n1').nested.v", ctx(), undefined)).toBe(7);
  });
  it('renders missing paths as empty string', () => {
    expect(resolveTemplate('x{{ $input.nope }}y', ctx(), {})).toBe('xy');
  });
  it('JSON-stringifies non-string values', () => {
    expect(resolveTemplate('{{ $input.o }}', ctx(), { o: { a: 1 } })).toBe('{"a":1}');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test template`
Expected: FAIL — cannot find `./template`.

- [ ] **Step 4: Port `template.ts` verbatim** from `apps/api/src/lib/template.ts` (it imports only `ExecutionContext` from `./execution-context` — no other change needed). Copy the file contents exactly.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test template`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/execution-context.ts packages/workflows/src/engine/template.ts packages/workflows/src/engine/template.test.ts
git commit -m "feat(workflows): execution context + template resolver"
```

---

### Task 4: Node-handler registry (SP-1 subset)

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/types.ts`
- Create: `packages/workflows/src/engine/node-handlers/{trigger,set,log,if,filter,merge,default}.ts`
- Create: `packages/workflows/src/engine/node-handlers/index.ts`

> **Security note (reconciles spec §3):** `if.ts` and `filter.ts` evaluate a user-supplied **boolean expression** inside `vm.runInNewContext(..., { timeout: 1000 })` with only `$input`/`input` exposed. This is a small, bounded surface (1-second wall clock, no `require`, no globals), and all write/execute routes are gated to `lab_admin`/`lab_manager` (Task 10). The fully-isolated `worker_thread` model is for the **Code node in SP-2**, which is not in this slice. Port these two handlers verbatim — do **not** widen the sandbox.

- [ ] **Step 1: Port `node-handlers/types.ts` verbatim** from `apps/api/src/lib/node-handlers/types.ts` — change the import to `../execution-context`:

```ts
import type { ExecutionContext } from '../execution-context';

export interface RunnerNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export type NodeHandler = (
  node: RunnerNode,
  ctx: ExecutionContext,
  upstreamOutput: unknown,
) => Promise<unknown> | unknown;
```

- [ ] **Step 2: Port the 7 handler files verbatim** from `apps/api/src/lib/node-handlers/`:
  - `trigger.ts`, `set.ts`, `log.ts`, `if.ts`, `filter.ts`, `merge.ts`, `default.ts`.
  - `log.ts`/`set.ts`/`if.ts`/`filter.ts` import `resolveTemplate` from `../template` (path unchanged). `log.ts` imports `LogLevel` from `../execution-context` — change that import to `../../types` (where `LogLevel` now lives). No other edits.

- [ ] **Step 3: Write the SP-1 `index.ts`** (a trimmed `pickHandler` — only the handlers that exist in this slice; everything else falls through to `defaultHandler`)

```ts
import type { NodeHandler, RunnerNode } from './types';
import { triggerHandler } from './trigger';
import { logHandler } from './log';
import { setHandler } from './set';
import { mergeHandler } from './merge';
import { ifHandler } from './if';
import { filterHandler } from './filter';
import { defaultHandler } from './default';

/** Action subtype → handler. New actions (http-request, code, …) land in later slices. */
const ACTION_HANDLERS: Record<string, NodeHandler> = {
  log: logHandler,
  set: setHandler,
  merge: mergeHandler,
  'no-op': defaultHandler,
};

const TYPE_HANDLERS: Record<string, NodeHandler> = {
  trigger: triggerHandler,
};

export function pickHandler(node: RunnerNode): NodeHandler {
  if (node.type === 'action') {
    const subtype = (node.data.action as string | undefined) ?? '';
    return ACTION_HANDLERS[subtype] ?? defaultHandler;
  }
  if (node.type === 'condition') {
    const templateId = (node.data.templateId as string | undefined) ?? '';
    if (templateId === 'filter') return filterHandler;
    return ifHandler;
  }
  return TYPE_HANDLERS[node.type] ?? defaultHandler;
}

export type { NodeHandler, RunnerNode };
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openldr/workflows typecheck`
Expected: PASS (no missing imports).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/node-handlers
git commit -m "feat(workflows): SP-1 node handlers (trigger/set/log/if/filter/merge)"
```

---

### Task 5: The streaming runner

**Files:**
- Create: `packages/workflows/src/engine/run-workflow.ts`
- Create: `packages/workflows/src/engine/run-workflow.test.ts`

- [ ] **Step 1: Port `run-workflow.ts` verbatim** from `apps/api/src/lib/workflow-runner.ts`. Change imports:
  - `import { pickHandler, type RunnerNode } from './node-handlers';`
  - `import { createContext, type ExecutionContext } from './execution-context';`
  - `import type { RunEvent, LogEntry, WorkflowEdge } from '../types';`
  - Delete the locally-declared `WorkflowEdge` interface and `LogEntry` reference; use the imported ones. Keep `topologicalSort`, `upstreamOutputFor`, `runWorkflow`, `RunWorkflowOptions`, `WorkflowRunResult`, `NodeRunResult` exactly as written.

- [ ] **Step 2: Write the failing runner test**

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow } from './run-workflow';
import type { RunEvent } from '../types';

const collect = () => {
  const events: RunEvent[] = [];
  return { events, onEvent: (e: RunEvent) => events.push(e) };
};

describe('runWorkflow', () => {
  it('runs nodes in topological order and emits the event protocol', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: { triggerType: 'manual' } },
      { id: 'l', type: 'action', data: { action: 'log', message: 'hi {{ $input.triggered }}' } },
    ];
    const edges = [{ id: 'e1', source: 't', target: 'l' }];
    const sink = collect();
    const res = await runWorkflow(nodes, edges, { onEvent: sink.onEvent });
    expect(res.status).toBe('completed');
    const types = sink.events.map((e) => e.type);
    expect(types).toEqual([
      'node:start', 'node:success',
      'node:start', 'node:log', 'node:success',
      'workflow:done',
    ]);
  });

  it('prunes the untaken condition branch', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'condition', data: { templateId: 'if', condition: 'false' } },
      { id: 'a', type: 'action', data: { action: 'no-op' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'c' },
      { id: 'e2', source: 'c', target: 'a', sourceHandle: 'true' },
    ];
    const res = await runWorkflow(nodes, edges, {});
    const aResult = res.results.find((r) => r.nodeId === 'a');
    expect(aResult?.status).toBe('skipped');
  });

  it('halts on error and reports failed', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'condition', data: { templateId: 'if', condition: 'throw new Error("boom")' } },
    ];
    const edges = [{ id: 'e1', source: 't', target: 'c' }];
    const res = await runWorkflow(nodes, edges, {});
    expect(res.status).toBe('failed');
  });
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `pnpm --filter @openldr/workflows test run-workflow`
Expected: initially FAIL (no `./run-workflow`); after Step 1's port is in place, PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/workflows/src/engine/run-workflow.ts packages/workflows/src/engine/run-workflow.test.ts
git commit -m "feat(workflows): in-process streaming runner + tests"
```

---

### Task 6: `WorkflowStore`

**Files:**
- Create: `packages/workflows/src/store.ts`
- Create: `packages/workflows/src/store.test.ts`

- [ ] **Step 1: Write the failing store test** (pg-mem; mirrors `packages/dashboards/src/store.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowStore } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('workflows')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('description', 'text')
    .addColumn('definition', 'jsonb')
    .addColumn('enabled', 'boolean')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'text')
    .addColumn('updated_at', 'text')
    .execute();
});

describe('WorkflowStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createWorkflowStore(db);
    const created = await store.create({
      id: 'w1', name: 'Main', description: null,
      definition: { nodes: [], edges: [] }, enabled: true, createdBy: null,
    });
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    await store.update('w1', { ...created, name: 'Renamed' });
    expect((await store.get('w1'))?.name).toBe('Renamed');
    await store.remove('w1');
    expect(await store.get('w1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test store`
Expected: FAIL — cannot find `./store`.

- [ ] **Step 3: Write `store.ts`** (mirrors `DashboardStore`)

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type Workflow, WorkflowSchema } from './types';

function toRow(w: Workflow) {
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? null,
    definition: JSON.stringify(w.definition),
    enabled: w.enabled,
    created_by: w.createdBy ?? null,
  };
}

function fromRow(r: Record<string, unknown>): Workflow {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? { nodes: [], edges: [] }));
  return WorkflowSchema.parse({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    definition: parse(r.definition),
    enabled: r.enabled == null ? true : Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface WorkflowStore {
  list(): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | undefined>;
  create(w: Workflow): Promise<Workflow>;
  update(id: string, w: Workflow): Promise<Workflow>;
  remove(id: string): Promise<void>;
}

export function createWorkflowStore(db: Kysely<InternalSchema>): WorkflowStore {
  const t = () => db.selectFrom('workflows');
  const store: WorkflowStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(w) {
      await db.insertInto('workflows').values(toRow(WorkflowSchema.parse(w)) as never).execute();
      return (await store.get(w.id))!;
    },
    async update(id, w) {
      await db.updateTable('workflows').set({ ...toRow(WorkflowSchema.parse({ ...w, id })) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) {
      await db.deleteFrom('workflows').where('id', '=', id).execute();
    },
  };
  return store;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/store.ts packages/workflows/src/store.test.ts
git commit -m "feat(workflows): WorkflowStore over internal Postgres"
```

---

### Task 7: Public exports + package gate

**Files:**
- Modify: `packages/workflows/src/index.ts`

- [ ] **Step 1: Replace `index.ts` with the public surface**

```ts
export * from './types';
export { createWorkflowStore, type WorkflowStore } from './store';
export { runWorkflow, topologicalSort, type WorkflowRunResult, type NodeRunResult, type RunWorkflowOptions } from './engine/run-workflow';
```

- [ ] **Step 2: Run the package gate**

Run: `pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/workflows test`
Expected: PASS (all suites green).

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/src/index.ts
git commit -m "feat(workflows): public package exports"
```

---

## Phase 2 — Database migration

### Task 8: `workflows` table migration + schema type

**Files:**
- Create: `packages/db/src/migrations/internal/027_workflows.ts` (confirm `027` is free first — see Conventions)
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Confirm the migration number**

Run: `ls packages/db/src/migrations/internal/`
Expected: highest existing is `026_report_schedules.ts`. If `027_*` exists, use the next free integer everywhere below.

- [ ] **Step 2: Create the migration** (mirrors `011_dashboards.ts`)

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('workflows')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('definition', 'jsonb', (c) => c.notNull().defaultTo(sql`'{"nodes":[],"edges":[]}'::jsonb`))
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('idx_workflows_created_by').ifNotExists().on('workflows').column('created_by').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflows').ifExists().execute();
}
```

- [ ] **Step 3: Register it in `index.ts`** — add the import after `m026` and the entry after `'026_report_schedules'`:

```ts
import * as m027 from './027_workflows';
// ...
  '027_workflows': { up: m027.up, down: m027.down },
```

- [ ] **Step 4: Add the schema type to `schema/internal.ts`** — read the file first to match the exact `Generated`/`JSONColumnType` import style used by sibling tables (e.g. the `dashboards` table type). Add a `WorkflowsTable` interface and register it on the `InternalSchema` interface as `workflows: WorkflowsTable;`:

```ts
export interface WorkflowsTable {
  id: string;
  name: string;
  description: string | null;
  definition: JSONColumnType<{ nodes: unknown[]; edges: unknown[] }>;
  enabled: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

> If `JSONColumnType` is not the convention used by the `dashboards` table (it may be typed as `unknown`/`string`), match whatever `dashboards`/`report_schedules` use instead — consistency over the snippet above.

- [ ] **Step 5: Run the db migration test**

Run: `pnpm --filter @openldr/db test`
Expected: PASS (the existing `migrations.test.ts` applies all migrations up/down against pg-mem or live PG; the new one must apply cleanly). If it fails on a type mismatch, fix the schema type to match Step 4's note.

- [ ] **Step 6: Typecheck the store against the real schema**

Run: `pnpm --filter @openldr/workflows typecheck`
Expected: PASS — `createWorkflowStore` now resolves `db.selectFrom('workflows')` against `InternalSchema`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/027_workflows.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): migration 027 workflows table + InternalSchema type"
```

---

## Phase 3 — Bootstrap wiring

### Task 9: Attach `ctx.workflows`

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add the import** (next to the dashboards import, ~line 14)

```ts
import { createWorkflowStore, type WorkflowStore } from '@openldr/workflows';
```

- [ ] **Step 2: Add a dependency** to `packages/bootstrap/package.json` — `"@openldr/workflows": "workspace:*"` under dependencies. Then run `pnpm install`.

- [ ] **Step 3: Add to the `AppContext` interface** (after `dashboards: DashboardsApi;`, ~line 101)

```ts
  workflows: { store: WorkflowStore };
```

- [ ] **Step 4: Construct it** (after the `dashboards` const is built, ~line 191)

```ts
  const workflows = { store: createWorkflowStore(internal.db) };
```

- [ ] **Step 5: Add to the returned object** (after `dashboards,`, ~line 272)

```ts
    workflows,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "feat(bootstrap): wire ctx.workflows store"
```

---

## Phase 4 — Server routes

### Task 10: `workflows-routes.ts` (CRUD + SSE execute)

**Files:**
- Create: `apps/server/src/workflows-routes.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write the routes file** (CRUD from `dashboards-routes.ts`; SSE from `ontology-routes.ts`; RBAC from `rbac.ts`)

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { WorkflowSchema, WorkflowDefinitionSchema, runWorkflow, type RunEvent } from '@openldr/workflows';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerWorkflowRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/workflows', async () => ctx.workflows.store.list());

  app.get('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await ctx.workflows.store.get(id);
    if (!w) { reply.code(404); return { error: `unknown workflow: ${id}` }; }
    return w;
  });

  app.post('/api/workflows', MANAGE, async (req, reply) => {
    try {
      const created = await ctx.workflows.store.create(WorkflowSchema.parse(req.body));
      await recordAudit(ctx, req, { action: 'workflow.create', entityType: 'workflow', entityId: created.id, before: null, after: created });
      return created;
    } catch (err) { return mapError(err, reply); }
  });

  app.put('/api/workflows/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const before = await ctx.workflows.store.get(id);
      const updated = await ctx.workflows.store.update(id, WorkflowSchema.parse(req.body));
      await recordAudit(ctx, req, { action: 'workflow.update', entityType: 'workflow', entityId: id, before, after: updated });
      return updated;
    } catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/workflows/:id', MANAGE, async (req) => {
    const { id } = req.params as { id: string };
    const before = await ctx.workflows.store.get(id);
    await ctx.workflows.store.remove(id);
    if (before) {
      await recordAudit(ctx, req, { action: 'workflow.delete', entityType: 'workflow', entityId: id, before, after: null });
    }
    return { ok: true };
  });

  // SSE execution. POST so the client can pass an optional trigger `input` body.
  app.post('/api/workflows/:id/execute-stream', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const workflow = await ctx.workflows.store.get(id);
    if (!workflow) { reply.code(404); return { error: `unknown workflow: ${id}` }; }

    const body = (req.body ?? {}) as { input?: unknown };
    const def = WorkflowDefinitionSchema.parse(workflow.definition);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (evt: RunEvent) => reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
    try {
      const result = await runWorkflow(def.nodes, def.edges, { input: body.input, onEvent: send });
      reply.raw.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
    } catch (err) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
```

- [ ] **Step 2: Register in `app.ts`** — read the file, add the import next to `registerDashboardRoutes`, and call `registerWorkflowRoutes(app, ctx);` alongside the other `register*Routes(app, ctx)` calls.

- [ ] **Step 3: Typecheck the server**

Run: `pnpm --filter @openldr/server typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/workflows-routes.ts apps/server/src/app.ts
git commit -m "feat(server): workflows CRUD + SSE execute routes"
```

---

### Task 11: Route tests

**Files:**
- Create: `apps/server/src/workflows-routes.test.ts`

- [ ] **Step 1: Write the test** — read `apps/server/src/dashboards-routes.test.ts` first to copy the exact app-bootstrapping/auth-stub harness it uses (how it builds the Fastify app with a fake `ctx` and injects a user with roles). Then assert:

```ts
// Pseudostructure — adapt the harness to match dashboards-routes.test.ts exactly.
// 1) POST /api/workflows as lab_manager  -> 200, returns the created workflow
// 2) GET  /api/workflows               -> 200, array length 1
// 3) GET  /api/workflows/:id (missing) -> 404
// 4) POST /api/workflows as a non-manager role -> 403
// 5) POST /api/workflows/:id/execute-stream for a trigger->log graph:
//    read the raw SSE body and assert it contains "node:start" then "workflow:done".
```

Implement each case with the harness's `app.inject(...)` calls. For the SSE case, assert on `res.payload` containing the expected `data:` frames.

- [ ] **Step 2: Run**

Run: `pnpm --filter @openldr/server test workflows-routes`
Expected: PASS (5 cases).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/workflows-routes.test.ts
git commit -m "test(server): workflows routes CRUD/RBAC/SSE"
```

---

## Phase 5 — Web dependencies + API client

### Task 12: Add web dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add to dependencies** (alphabetical): `"@xyflow/react": "^12.10.2"` and `"react-resizable-panels": "^4.9.0"`. (Check the standalone `apps/web/package.json` for the exact versions it shipped and use those.)

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: both resolve; lockfile updates.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add @xyflow/react + react-resizable-panels"
```

---

### Task 13: Workflow API client + SSE reader

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Append the workflow client** to `api.ts` (uses the existing `authFetch`; the SSE reader attaches the bearer token via a manual fetch since `EventSource` can't set headers)

```ts
import { getAccessToken } from './auth/token';

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
  createdBy: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export async function fetchWorkflows(): Promise<Workflow[]> {
  const res = await authFetch('/api/workflows');
  if (!res.ok) throw new Error(`workflows list failed: ${res.status}`);
  return res.json() as Promise<Workflow[]>;
}

export async function fetchWorkflow(id: string): Promise<Workflow> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`workflow ${id} failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function createWorkflow(body: Omit<Workflow, 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await authFetch('/api/workflows', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create workflow failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function updateWorkflow(id: string, body: Omit<Workflow, 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update workflow failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete workflow failed: ${res.status}`);
}

/** Stream execution events. Returns when the stream ends. `onEvent` receives each RunEvent. */
export async function executeWorkflowStream(
  id: string,
  onEvent: (evt: unknown) => void,
  opts: { input?: unknown; signal?: AbortSignal } = {},
): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/execute-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ input: opts.input }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`execute failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore malformed frame */ }
    }
  }
}
```

> The standalone's `apps/web/src/lib/api-client.ts` already has an `executeStream` with a hand-rolled SSE parser — use it as the reference for the exact `RunEvent` shapes the store expects, and keep field names identical.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(web): workflow API client + SSE execution reader"
```

---

## Phase 6 — Port the page (copy exactly)

> This phase copies the standalone Workflow Builder UI **verbatim** into `apps/web/src/workflows/`, then applies a fixed set of mechanical swaps. It is a copy operation, not a redesign — preserve component structure, store fields/actions, canvas behaviour, palette, forms, and panels 1:1.

### Task 14: Copy the page tree + swap imports

**Files (copy `../workflow-builder/apps/web/src/pages/workflow-builder/**` → `apps/web/src/workflows/`):**
- `page.tsx`, `constants.ts`
- `components/` (canvas, sidebar, interaction-mode-toggle, `node-types/`, `edge-types/`, `node-forms/`, `panels/`)
- `hooks/` (`use-workflow-store.ts`, `use-workflow-api.ts`)
- `lib/` (`types.ts`, `serializer.ts`, `validation.ts`, `icons.tsx`)
- Also copy `../workflow-builder/apps/web/public/node-icons/` → `apps/web/public/node-icons/` (brand SVGs).

- [ ] **Step 1: Copy the directory tree** into `apps/web/src/workflows/` (preserve subfolders).

- [ ] **Step 2: Apply the mechanical import swaps** across the copied files (search-and-replace):
  - `@workflow-builder/ui` → `@/components/ui` (shadcn primitives).
  - `@workflow-builder/ui/lib/utils` (or wherever `cn` lives) → `@/lib/cn`.
  - Any `@/...` alias from the standalone that pointed at *its* `src` → the equivalent under `@/workflows/...`. (OpenLDR's `@` = `apps/web/src`.)
  - The API import in `hooks/use-workflow-api.ts` and `lib/api-client.ts` usage → import from `@/api` (the functions added in Task 13). Delete the copied `lib/api-client.ts` if present and re-point to `@/api`.

- [ ] **Step 3: Create any missing shadcn primitives.** For each `@/components/ui/<x>` import that does not resolve, check `apps/web/src/components/ui/`. The standalone builder uses (at least): `button`, `input`, `textarea`, `select`, `tabs`, `dropdown-menu`, `tooltip`, `label`, `dialog`, `card`, `badge`, `scroll-area`, `separator`, `switch`. Most exist. For any missing one, scaffold the standard shadcn component (copy the canonical Radix-based implementation, themed with the existing `tokens.css` variables) — per the project rule "always create the shadcn primitive if missing." Confirm which are missing:

Run: `ls apps/web/src/components/ui/`
Expected: compare against the import list; note gaps to create.

- [ ] **Step 4: Typecheck (expect failures, fix iteratively)**

Run: `pnpm --filter @openldr/web typecheck`
Expected: initially FAIL with unresolved imports / React 18 type nits. Fix each: unresolved `@/components/ui/*` (create primitive or fix path), and any `@xyflow/react` type import. Re-run until PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflows apps/web/public/node-icons
git commit -m "feat(web): port workflow builder page (verbatim copy + import swaps)"
```

---

### Task 15: Disabled-node affordance in the palette

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Modify: `apps/web/src/workflows/components/sidebar.tsx`

- [ ] **Step 1: Define the implemented set** at the top of `constants.ts`:

```ts
/** Template ids whose handlers exist in SP-1. Everything else renders disabled ("coming soon"). */
export const IMPLEMENTED_TEMPLATE_IDS = new Set<string>([
  // trigger
  'manual-trigger',
  // actions
  'set', 'log', 'merge',
  // conditions
  'if', 'filter',
]);
```

> Read the copied `constants.ts` to confirm the exact `id` strings for the manual trigger, set, log, merge, if, and filter templates, and use those literal ids in the set. If the manual trigger template id differs (e.g. `'trigger'`), use the real value.

- [ ] **Step 2: Compute availability where templates are rendered.** In `sidebar.tsx`, for each template tile, derive `const available = IMPLEMENTED_TEMPLATE_IDS.has(template.id);`. When not available:
  - render the tile with `aria-disabled`, reduced opacity (`opacity-50`), `cursor-not-allowed`;
  - set `draggable={false}` and make `onDragStart` a no-op;
  - add a tooltip/title "Coming soon".

```tsx
// inside the tile render:
const available = IMPLEMENTED_TEMPLATE_IDS.has(template.id);
<div
  draggable={available}
  onDragStart={available ? handleDragStart : (e) => e.preventDefault()}
  aria-disabled={!available}
  title={available ? template.description : 'Coming soon'}
  className={cn(tileClass, !available && 'opacity-50 cursor-not-allowed')}
>
  {/* ...existing tile contents... */}
</div>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/sidebar.tsx
git commit -m "feat(web): disable unimplemented palette nodes (coming soon)"
```

---

### Task 16: Wire execution to the API + auto-save on run

**Files:**
- Modify: `apps/web/src/workflows/hooks/use-workflow-api.ts`

- [ ] **Step 1: Re-point the hook** to `@/api`. The hook should:
  - `save()` → `createWorkflow`/`updateWorkflow` with `{ id, name, description: null, definition: { nodes, edges }, enabled: true, createdBy: null }` serialized via the copied `serializer.ts` (`serializeWorkflow` strips ReactFlow metadata).
  - `runStream()` → call `executeWorkflowStream(id, onEvent)`, dispatching each `RunEvent` into the store (`setNodeStatus`, `appendNodeLog`, `setNodeRunData`) exactly as the standalone did. Auto-save the current graph before running (the standalone auto-saves on every run).
  - Keep the SSE→store mapping identical to the standalone's `use-workflow-api.ts` so the canvas animations + Logs tab work unchanged.

> Use the standalone `hooks/use-workflow-api.ts` as the literal reference; only the import source (`@/api`) and function names (`createWorkflow`/`updateWorkflow`/`executeWorkflowStream`) change.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/workflows/hooks/use-workflow-api.ts
git commit -m "feat(web): wire workflow save + SSE run to internal API"
```

---

### Task 17: Route + nav + i18n

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/AppShell.tsx`
- Modify: `apps/web/src/workflows/page.tsx` (wrap in AppShell)
- Modify: `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts`

- [ ] **Step 1: Wrap the page in the app chrome.** The standalone `page.tsx` renders its own toolbar/canvas/panels inside a `ReactFlowProvider`. Wrap the whole thing in `<AppShell title="Workflows" fullBleed>` (the canvas needs full-bleed; `fullBleed` already exists on `AppShell`). Export the component as `Workflows`.

```tsx
// apps/web/src/workflows/page.tsx (outer shape)
import { AppShell } from '@/shell/AppShell';
// ...existing imports...
export function Workflows() {
  return (
    <AppShell title="Workflows" fullBleed>
      {/* existing ReactFlowProvider + toolbar + canvas + panels tree */}
    </AppShell>
  );
}
```

- [ ] **Step 2: Add the route** in `App.tsx` — import and add alongside `/reports`. Gate to manager roles to match the API:

```tsx
import { Workflows } from './workflows/page';
// ...
<Route path="/workflows" element={<RequireRole role="lab_manager"><Workflows /></RequireRole>} />
```

> Check `auth/RequireRole.tsx` — confirm whether it accepts a single `role` or a list, and whether `lab_admin` implicitly satisfies `lab_manager`. If roles are not hierarchical, use whatever multi-role form `RequireRole` supports so both `lab_admin` and `lab_manager` pass (mirror how another manager-gated route does it). If none exists, gate to `lab_admin` and note the follow-up.

- [ ] **Step 3: Add the sidebar nav item** in `AppShell.tsx`:
  - import the `Workflow` icon from `lucide-react`;
  - add `{ to: '/workflows', labelKey: 'nav.workflows', end: false, icon: Workflow }` to `NAV` (after the reports entry);
  - role-gate it: add an optional `roles?: string[]` to the `NAV` item type and filter the rendered list with `hasRole`. Concretely, change the `.map` to `.filter((n) => !n.roles || n.roles.some((r) => hasRole(r))).map(...)` and set `roles: ['lab_admin', 'lab_manager']` on the workflows entry. Confirm `hasRole` accepts a single role string (it does — used as `hasRole('lab_admin')` elsewhere).

- [ ] **Step 4: Add the i18n key** `nav.workflows` to `en.ts` (`'Workflows'`), `fr.ts` (`'Flux de travail'`), `pt.ts` (`'Fluxos de trabalho'`). Match the existing nesting/structure of the `nav.*` keys in each file (read one first).

- [ ] **Step 5: Typecheck + web tests**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test`
Expected: PASS. (If the i18n compile-time key-parity check `EnShape` fails, the three files are out of sync — add the missing key.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/shell/AppShell.tsx apps/web/src/workflows/page.tsx apps/web/src/i18n
git commit -m "feat(web): route + role-gated nav + i18n for Workflows"
```

---

## Phase 7 — Verification

### Task 18: Full gate + manual e2e

- [ ] **Step 1: Full monorepo gate**

Run: `pnpm turbo typecheck lint test build`
Expected: PASS across all packages. If `@openldr/web#test` flakes in parallel (known issue per project memory), re-run it in isolation: `pnpm --filter @openldr/web test`.

- [ ] **Step 2: Dependency-graph check**

Run: `pnpm depcruise` (use the exact script name in root `package.json`; it may be `pnpm run depcruise`)
Expected: clean — no new forbidden cross-package edges (web → workflows is via `@/api` only; server/bootstrap → workflows is allowed).

- [ ] **Step 3: Manual browser e2e** (the standalone left this pending). Start the stack (`pnpm -C apps/server dev` + `pnpm -C apps/web dev`, or the project's combined dev script), log in as a `lab_manager`/`lab_admin`, then:
  1. Open `/workflows` from the sidebar (confirm the nav item is hidden for a `lab_technician`).
  2. Drag a **Manual Trigger** and a **Log** node; connect them.
  3. Set the Log node's message to `ran {{ $input.triggered }}`.
  4. **Save** (toast/confirmation; reload the page and confirm it persisted).
  5. **Run**: observe per-node state animate (pulsing running → emerald success) and the **Logs** tab stream the resolved message.
  6. Confirm a disabled palette node (e.g. an HTTP Request tile) shows "coming soon" and cannot be dragged.

- [ ] **Step 4: Commit any fixes, then finalize**

```bash
git add -A
git commit -m "chore(workflows): SP-1 verification fixes"
```

- [ ] **Step 5:** Proceed to the `superpowers:finishing-a-development-branch` skill to decide merge/PR/cleanup.

---

## Self-review notes (author)

- **Spec coverage:** §2 package → Tasks 1–7; §5 persistence → Tasks 6, 8, 9; §6 routes → Tasks 10–11; §7 page + adaptations → Tasks 12–17; §8 roles → Tasks 10, 17; §9 testing → Tasks 2–11, 18; §10 collision surface → only additive edits in Tasks 8, 9, 10, 12, 17.
- **Spec reconciliation:** the spec's "zero arbitrary-execution surface" is refined in Task 4's security note — `if`/`filter` use a bounded 1s `vm` eval of a boolean expression, RBAC-gated; the worker-thread Code node remains SP-2. Update spec §3 wording to match.
- **Type consistency:** `RunEvent`, `Workflow`, `WorkflowDefinition`, `createWorkflowStore`, `runWorkflow`, `executeWorkflowStream`, `IMPLEMENTED_TEMPLATE_IDS` are used with identical names across tasks.
- **Known soft spots the executor must verify against real files (flagged inline):** exact `tsconfig` base path (Task 1); `JSONColumnType` vs `unknown` in `internal.ts` (Task 8); `RequireRole` single vs multi-role API (Task 17); real template `id` strings (Task 15); which shadcn primitives are missing (Task 14); `depcruise` script name (Task 18).
