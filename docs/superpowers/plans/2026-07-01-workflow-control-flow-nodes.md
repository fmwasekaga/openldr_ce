# Workflow Engine Control-Flow Nodes (wait + execute-workflow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `wait` and `execute-workflow` builder nodes' engine behavior so both become real, runnable workflow nodes (the `loop` node is deferred to its own future slice).

**Architecture:** `wait` is a pure-engine handler (clamped sleep + passthrough). `execute-workflow` is a service-backed handler that calls a new host `runSubWorkflow` capability, which re-enters the existing single-pass runner on another saved workflow, with a recursion/cycle/depth guard and leaf-node terminal-item extraction. No runner topology change; no canvas/handle/form change.

**Tech Stack:** TypeScript, `@openldr/workflows` (engine), `@openldr/bootstrap` (host service wiring), Vitest. Monorepo via pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-07-01-workflow-control-flow-nodes-design.md`

---

## Background the implementer needs

- **Handler dispatch:** `packages/workflows/src/engine/node-handlers/index.ts` → `pickHandler`. For `type: 'action'` nodes it looks up `ACTION_HANDLERS[node.data.action]`. The palette's `node()` helper sets `data.action = id`, so `wait` and `execute-workflow` nodes already carry `action: 'wait'` / `action: 'execute-workflow'`; they currently fall through to `defaultHandler`.
- **Palette enablement:** a node id must be in `IMPLEMENTED_TEMPLATE_IDS` (`apps/web/src/workflows/constants.ts`) to be draggable. The builder forms already exist (`node-forms/wait-form.tsx`, `node-forms/execute-workflow-form.tsx`) and are wired in `pickForm` — **do not touch the forms.**
- **Service seam:** host capabilities live on `WorkflowServices` (`packages/workflows/src/engine/services.ts`), are injected in `packages/bootstrap/src/index.ts`, and handlers guard with a `'… requires server services'` throw when absent. The runner is re-entered in bootstrap/server via `runWorkflow(def.nodes, def.edges, opts)`.
- **Item contract:** the sub-workflow's `triggerHandler` (`node-handlers/trigger.ts`) calls `toItems(ctx.input)` when `ctx.input !== undefined`. `toItems` (`engine/items.ts`) passes a genuine `WorkflowItem[]` through unchanged (`isItemArray`). So passing the parent's `WorkflowItem[]` as the sub-run's `input` makes the sub-flow's trigger emit exactly those items. **No special wrapping needed** — but Task 5 includes a smoke assertion to confirm.
- **createContext signature** (`engine/execution-context.ts`):
  `createContext(input, emit, edges=[], codeLimits=…, services?, workflowId?, logger?, files?)`. Task 2 appends one optional trailing `callStack` param, keeping every existing call valid.

### File map

- Create `packages/workflows/src/engine/node-handlers/wait.ts` — wait handler + `resolveWaitMs` pure helper.
- Create `packages/workflows/src/engine/node-handlers/wait.test.ts`.
- Modify `packages/workflows/src/engine/run-workflow.ts` — `RunWorkflowOptions.callStack` + forward to `createContext`.
- Modify `packages/workflows/src/engine/execution-context.ts` — `ExecutionContext.callStack` + trailing param.
- Create `packages/workflows/src/engine/execution-context.test.ts` — callStack default/threading.
- Create `packages/workflows/src/engine/sub-workflow.ts` — `MAX_SUBWORKFLOW_DEPTH`, `assertSubWorkflowAllowed`, `extractTerminalItems`.
- Create `packages/workflows/src/engine/sub-workflow.test.ts`.
- Modify `packages/workflows/src/engine/services.ts` — `runSubWorkflow?` on `WorkflowServices`.
- Create `packages/workflows/src/engine/node-handlers/execute-workflow.ts` — handler.
- Create `packages/workflows/src/engine/node-handlers/execute-workflow.test.ts`.
- Modify `packages/workflows/src/engine/node-handlers/index.ts` — register both handlers.
- Modify `packages/workflows/src/index.ts` — barrel-export the sub-workflow helpers.
- Modify `apps/web/src/workflows/constants.ts` — add `'wait'` + `'execute-workflow'` to `IMPLEMENTED_TEMPLATE_IDS`.
- Modify `packages/bootstrap/src/index.ts` — implement `workflowServices.runSubWorkflow`.

---

## Task 1: `wait` handler (pure engine)

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/wait.ts`
- Test: `packages/workflows/src/engine/node-handlers/wait.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Modify: `apps/web/src/workflows/constants.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/wait.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { waitHandler, resolveWaitMs } from './wait';
import { createContext } from '../execution-context';

describe('resolveWaitMs', () => {
  it('converts units to ms', () => {
    expect(resolveWaitMs({ duration: 250, unit: 'ms' })).toBe(250);
    expect(resolveWaitMs({ duration: 2, unit: 's' })).toBe(2000);
    expect(resolveWaitMs({ duration: 0.5, unit: 'm' })).toBe(30000);
  });

  it('defaults missing unit to seconds', () => {
    expect(resolveWaitMs({ duration: 1 })).toBe(1000);
  });

  it('clamps to 30s', () => {
    expect(resolveWaitMs({ duration: 40, unit: 's' })).toBe(30000);
    expect(resolveWaitMs({ duration: 10, unit: 'm' })).toBe(30000);
  });

  it('treats NaN / negative / missing as 0', () => {
    expect(resolveWaitMs({ duration: -5, unit: 's' })).toBe(0);
    expect(resolveWaitMs({ duration: 'oops' as unknown as number })).toBe(0);
    expect(resolveWaitMs({})).toBe(0);
  });
});

describe('waitHandler', () => {
  it('passes input items through unchanged (0ms = no sleep)', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { a: 1 } }, { json: { b: 2 } }];
    const out = await waitHandler(
      { id: 'w', type: 'action', data: { action: 'wait', config: { duration: 0, unit: 's' } } },
      ctx,
      input,
    );
    expect(out).toBe(input);
  });

  it('actually waits for a small positive duration then returns input', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { a: 1 } }];
    const start = Date.now();
    const out = await waitHandler(
      { id: 'w', type: 'action', data: { action: 'wait', config: { duration: 5, unit: 'ms' } } },
      ctx,
      input,
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
    expect(out).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/wait.test.ts`
Expected: FAIL — cannot find module `./wait`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/workflows/src/engine/node-handlers/wait.ts`:

```ts
import type { NodeHandler } from './types';

const MAX_WAIT_MS = 30_000;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000 };

/**
 * Resolve a wait config to a bounded millisecond duration. Unit defaults to
 * seconds; NaN / negative / non-numeric → 0; the result is clamped to
 * [0, 30_000] ms (matches the builder form's "max 30s" hint).
 */
export function resolveWaitMs(config: Record<string, unknown>): number {
  const factor = UNIT_MS[(config.unit as string) ?? 's'] ?? 1000;
  const raw = Number(config.duration);
  let ms = Number.isFinite(raw) ? raw * factor : 0;
  if (Number.isNaN(ms) || ms < 0) ms = 0;
  return Math.min(ms, MAX_WAIT_MS);
}

/**
 * Pause the workflow for a bounded duration, then pass items through unchanged.
 */
export const waitHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const ms = resolveWaitMs(config);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  return input;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/wait.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Register the handler**

In `packages/workflows/src/engine/node-handlers/index.ts`, add the import next to the other handler imports:

```ts
import { waitHandler } from './wait';
```

And add the entry to `ACTION_HANDLERS` (place it near `'no-op'` / `'stop-error'`):

```ts
  'wait': waitHandler,
```

- [ ] **Step 6: Enable the palette node**

In `apps/web/src/workflows/constants.ts`, inside the `IMPLEMENTED_TEMPLATE_IDS` set, add a control-flow line after the `'load-dataset'` action entry:

```ts
  // engine control-flow
  'wait',
```

- [ ] **Step 7: Verify workflows typecheck + full suite**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: 0 errors.

Run: `pnpm -C packages/workflows exec vitest run`
Expected: PASS (existing count + the new wait tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/wait.ts \
        packages/workflows/src/engine/node-handlers/wait.test.ts \
        packages/workflows/src/engine/node-handlers/index.ts \
        apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): wait node — clamped sleep + passthrough"
```

---

## Task 2: Thread `callStack` through the runner + context

This adds a recursion chain that `execute-workflow` (Task 4/5) reads. No behavior change on its own.

**Files:**
- Modify: `packages/workflows/src/engine/execution-context.ts`
- Modify: `packages/workflows/src/engine/run-workflow.ts`
- Test: `packages/workflows/src/engine/execution-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/execution-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createContext } from './execution-context';

describe('createContext callStack', () => {
  it('defaults callStack to an empty array', () => {
    const ctx = createContext(undefined, () => {});
    expect(ctx.callStack).toEqual([]);
  });

  it('stores a provided callStack', () => {
    const ctx = createContext(
      undefined, () => {}, [], undefined, undefined, undefined, undefined, undefined, ['wf-a', 'wf-b'],
    );
    expect(ctx.callStack).toEqual(['wf-a', 'wf-b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/execution-context.test.ts`
Expected: FAIL — `ctx.callStack` is `undefined` / arity mismatch.

- [ ] **Step 3: Implement in `execution-context.ts`**

Add the field to the `ExecutionContext` interface (after `files`):

```ts
  /** Workflow-id recursion chain for the execute-workflow node (empty at the top level). */
  callStack: string[];
```

Update `createContext` to accept and store it. Replace the signature + return:

```ts
export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
  codeLimits: CodeLimits = { timeoutMs: 5000, memoryMb: 128, enabled: false },
  services?: WorkflowServices,
  workflowId?: string,
  logger?: ExecutionContext['logger'],
  files?: Record<string, BinaryRef>,
  callStack: string[] = [],
): ExecutionContext {
  return { input, nodeOutputs: {}, nodeMeta: {}, branches: {}, logs: {}, emit, edges, codeLimits, services, workflowId, logger, files, callStack };
}
```

- [ ] **Step 4: Forward the option in `run-workflow.ts`**

Add to the `RunWorkflowOptions` interface (after `files`):

```ts
  /** Workflow-id recursion chain forwarded to the execution context (execute-workflow guard). Defaults to []. */
  callStack?: string[];
```

Update the `createContext` call inside `runWorkflow` to pass it as the trailing arg:

```ts
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges, opts.codeLimits, opts.services, opts.workflowId, opts.logger, opts.files, opts.callStack ?? []);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -C packages/workflows exec vitest run src/engine/execution-context.test.ts`
Expected: PASS.

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/execution-context.ts \
        packages/workflows/src/engine/execution-context.test.ts \
        packages/workflows/src/engine/run-workflow.ts
git commit -m "feat(workflows): thread callStack through runner + execution context"
```

---

## Task 3: Sub-workflow pure helpers

`MAX_SUBWORKFLOW_DEPTH`, the recursion guard, and leaf-node terminal-item extraction live in one focused, unit-tested module so the bootstrap glue (Task 5) stays thin.

**Files:**
- Create: `packages/workflows/src/engine/sub-workflow.ts`
- Test: `packages/workflows/src/engine/sub-workflow.test.ts`
- Modify: `packages/workflows/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/sub-workflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertSubWorkflowAllowed, extractTerminalItems, MAX_SUBWORKFLOW_DEPTH } from './sub-workflow';
import type { NodeRunResult } from './run-workflow';
import type { WorkflowEdge } from '../types';

describe('assertSubWorkflowAllowed', () => {
  it('allows a fresh workflow id', () => {
    expect(() => assertSubWorkflowAllowed('wf-b', ['wf-a'])).not.toThrow();
  });

  it('rejects a cycle', () => {
    expect(() => assertSubWorkflowAllowed('wf-a', ['wf-a'])).toThrow(/cycle detected: wf-a/);
  });

  it('rejects exceeding the max depth', () => {
    const stack = Array.from({ length: MAX_SUBWORKFLOW_DEPTH }, (_, i) => `wf-${i}`);
    expect(() => assertSubWorkflowAllowed('wf-new', stack)).toThrow(/max nesting depth \(5\) exceeded/);
  });
});

describe('extractTerminalItems', () => {
  const edges: WorkflowEdge[] = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
  ] as WorkflowEdge[];

  const mk = (nodeId: string, status: NodeRunResult['status'], output: unknown): NodeRunResult => ({
    nodeId, type: 'action', status, output, durationMs: 0,
  });

  it('returns concatenated output of successful leaf nodes only', () => {
    // a and b have outgoing edges → not leaves. c is the only leaf.
    const results = [
      mk('a', 'success', [{ json: { a: 1 } }]),
      mk('b', 'success', [{ json: { b: 1 } }]),
      mk('c', 'success', [{ json: { c: 1 } }, { json: { c: 2 } }]),
    ];
    expect(extractTerminalItems(edges, results)).toEqual([{ json: { c: 1 } }, { json: { c: 2 } }]);
  });

  it('concatenates multiple leaves and skips failed / non-array outputs', () => {
    const twoLeafEdges: WorkflowEdge[] = [{ id: 'e1', source: 'a', target: 'b' }] as WorkflowEdge[];
    // leaves: b and c (neither is an edge source).
    const results = [
      mk('a', 'success', [{ json: { a: 1 } }]),
      mk('b', 'success', [{ json: { b: 1 } }]),
      mk('c', 'success', [{ json: { c: 1 } }]),
      mk('d', 'error', undefined),
    ];
    expect(extractTerminalItems(twoLeafEdges, results)).toEqual([{ json: { b: 1 } }, { json: { c: 1 } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/sub-workflow.test.ts`
Expected: FAIL — cannot find module `./sub-workflow`.

- [ ] **Step 3: Write the implementation**

Create `packages/workflows/src/engine/sub-workflow.ts`:

```ts
import type { WorkflowEdge } from '../types';
import type { WorkflowItem } from './items';
import type { NodeRunResult } from './run-workflow';

/** Hard cap on execute-workflow nesting depth. */
export const MAX_SUBWORKFLOW_DEPTH = 5;

/**
 * Throw if invoking `workflowId` from the current `callStack` would recurse
 * illegally — either re-entering a workflow already on the stack (cycle) or
 * exceeding MAX_SUBWORKFLOW_DEPTH.
 */
export function assertSubWorkflowAllowed(workflowId: string, callStack: string[]): void {
  if (callStack.includes(workflowId)) {
    throw new Error(`Execute Workflow: cycle detected: ${workflowId}`);
  }
  if (callStack.length >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`Execute Workflow: max nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`);
  }
}

/**
 * Terminal items of a finished sub-run = the concatenated `output` of every leaf
 * node (a node that is not the `source` of any edge) that ran successfully.
 */
export function extractTerminalItems(
  edges: WorkflowEdge[],
  results: NodeRunResult[],
): WorkflowItem[] {
  const hasOutgoing = new Set(edges.map((e) => e.source));
  const out: WorkflowItem[] = [];
  for (const r of results) {
    if (r.status !== 'success') continue;
    if (hasOutgoing.has(r.nodeId)) continue;
    if (Array.isArray(r.output)) out.push(...(r.output as WorkflowItem[]));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/sub-workflow.test.ts`
Expected: PASS.

- [ ] **Step 5: Barrel-export the helpers**

In `packages/workflows/src/index.ts`, add (near the `runWorkflow` export on line 3):

```ts
export { MAX_SUBWORKFLOW_DEPTH, assertSubWorkflowAllowed, extractTerminalItems } from './engine/sub-workflow';
```

- [ ] **Step 6: Typecheck**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/engine/sub-workflow.ts \
        packages/workflows/src/engine/sub-workflow.test.ts \
        packages/workflows/src/index.ts
git commit -m "feat(workflows): sub-workflow guard + terminal-item helpers"
```

---

## Task 4: `runSubWorkflow` service contract + `execute-workflow` handler

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`
- Create: `packages/workflows/src/engine/node-handlers/execute-workflow.ts`
- Test: `packages/workflows/src/engine/node-handlers/execute-workflow.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Modify: `apps/web/src/workflows/constants.ts`

- [ ] **Step 1: Add the service method to the interface**

In `packages/workflows/src/engine/services.ts`, inside the `WorkflowServices` interface (next to the other optional host-injected methods, e.g. after `runConnectorSftp?`):

```ts
  /** Run another saved workflow as a sub-workflow → its terminal items. Host-injected (execute-workflow node). */
  runSubWorkflow?(input: { workflowId: string; input: WorkflowItem[]; callStack: string[] }): Promise<{ items: WorkflowItem[]; status: 'completed' | 'failed' }>;
```

(`WorkflowItem` is already imported at the top of `services.ts`.)

- [ ] **Step 2: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/execute-workflow.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { executeWorkflowHandler } from './execute-workflow';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { RunEvent } from '../../types';

const node = (config: Record<string, unknown>) => ({
  id: 'x', type: 'action', data: { action: 'execute-workflow', config },
});

describe('executeWorkflowHandler', () => {
  it('delegates to runSubWorkflow and returns its items', async () => {
    const runSubWorkflow = vi.fn(async () => ({
      items: [{ json: { ok: true } }], status: 'completed' as const,
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    const input = [{ json: { seed: 1 } }];
    const out = await executeWorkflowHandler(node({ workflowId: 'wf-1', waitForCompletion: true }), ctx, input);
    expect(runSubWorkflow).toHaveBeenCalledWith({ workflowId: 'wf-1', input, callStack: [] });
    expect(out).toEqual([{ json: { ok: true } }]);
  });

  it('forwards the current callStack', async () => {
    const runSubWorkflow = vi.fn(async () => ({ items: [], status: 'completed' as const }));
    const ctx = createContext(
      undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices,
      undefined, undefined, undefined, ['parent-wf'],
    );
    await executeWorkflowHandler(node({ workflowId: 'wf-2' }), ctx, []);
    expect(runSubWorkflow).toHaveBeenCalledWith({ workflowId: 'wf-2', input: [], callStack: ['parent-wf'] });
  });

  it('throws when workflowId is missing', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow: vi.fn() } as unknown as WorkflowServices);
    await expect(executeWorkflowHandler(node({ workflowId: '  ' }), ctx, [])).rejects.toThrow(/workflowId is required/);
  });

  it('throws when the service is absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(executeWorkflowHandler(node({ workflowId: 'wf-1' }), ctx, [])).rejects.toThrow(/requires server services/);
  });

  it('logs a note and still runs when waitForCompletion is false', async () => {
    const runSubWorkflow = vi.fn(async () => ({ items: [], status: 'completed' as const }));
    const events: RunEvent[] = [];
    const ctx = createContext(undefined, (e) => events.push(e), [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    await executeWorkflowHandler(node({ workflowId: 'wf-1', waitForCompletion: false }), ctx, []);
    expect(runSubWorkflow).toHaveBeenCalledTimes(1);
    expect(ctx.logs['x']?.[0].message).toMatch(/fire-and-forget is not supported/);
    expect(events.some((e) => e.type === 'node:log')).toBe(true);
  });

  it('propagates service errors', async () => {
    const runSubWorkflow = vi.fn(async () => { throw new Error('Execute Workflow: cycle detected: wf-1'); });
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    await expect(executeWorkflowHandler(node({ workflowId: 'wf-1' }), ctx, [])).rejects.toThrow(/cycle detected/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/execute-workflow.test.ts`
Expected: FAIL — cannot find module `./execute-workflow`.

- [ ] **Step 4: Write the handler**

Create `packages/workflows/src/engine/node-handlers/execute-workflow.ts`:

```ts
import type { NodeHandler } from './types';
import type { LogLevel } from '../../types';

/**
 * Run another saved workflow as a sub-workflow. The upstream items are passed as
 * the sub-workflow's trigger input; the sub-workflow's terminal (leaf-node) items
 * are returned downstream. Requires the host `runSubWorkflow` service.
 *
 * `waitForCompletion: false` (fire-and-forget) is not supported yet — there is no
 * durable detached-job queue — so the sub-run is executed synchronously and a note
 * is logged.
 */
export const executeWorkflowHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const workflowId = ((config.workflowId as string | undefined) ?? '').trim();
  if (!workflowId) throw new Error('Execute Workflow: workflowId is required');
  if (!ctx.services?.runSubWorkflow) {
    throw new Error('Execute Workflow requires server services');
  }

  if (config.waitForCompletion === false) {
    const entry = {
      nodeId: node.id,
      level: 'warn' as LogLevel,
      message: 'Execute Workflow: fire-and-forget is not supported yet — ran synchronously.',
      ts: Date.now(),
    };
    (ctx.logs[node.id] ??= []).push(entry);
    ctx.emit({ type: 'node:log', entry });
  }

  const result = await ctx.services.runSubWorkflow({ workflowId, input, callStack: ctx.callStack });
  return result.items;
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/execute-workflow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Register the handler + enable the palette node**

In `packages/workflows/src/engine/node-handlers/index.ts`, add the import:

```ts
import { executeWorkflowHandler } from './execute-workflow';
```

And the `ACTION_HANDLERS` entry (next to the `'wait'` entry from Task 1):

```ts
  'execute-workflow': executeWorkflowHandler,
```

In `apps/web/src/workflows/constants.ts`, extend the control-flow line in `IMPLEMENTED_TEMPLATE_IDS`:

```ts
  // engine control-flow
  'wait', 'execute-workflow',
```

- [ ] **Step 7: Typecheck + full workflows suite**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: 0 errors.

Run: `pnpm -C packages/workflows exec vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/services.ts \
        packages/workflows/src/engine/node-handlers/execute-workflow.ts \
        packages/workflows/src/engine/node-handlers/execute-workflow.test.ts \
        packages/workflows/src/engine/node-handlers/index.ts \
        apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): execute-workflow node + runSubWorkflow service contract"
```

---

## Task 5: Bootstrap `runSubWorkflow` implementation

Wire the host capability that loads a workflow record, re-enters the runner with the recursion guard, and returns terminal items. Mirrors the existing post-construction mutation pattern used for `runPluginNode` / `validateForm` / `persistStore`.

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Confirm the imports available in bootstrap**

`packages/bootstrap/src/index.ts` already imports `runWorkflow` from `@openldr/workflows` (line ~24) and constructs `workflowStore` (line ~266), `workflowServices` (line ~340), `logger`, and `cfg`. Add the new symbols to the existing `@openldr/workflows` import: `WorkflowDefinitionSchema`, `assertSubWorkflowAllowed`, `extractTerminalItems`.

Find the existing import block that pulls from `@openldr/workflows` and add these names to it. If `runWorkflow` is imported on its own line, add alongside it:

```ts
import {
  runWorkflow,
  WorkflowDefinitionSchema,
  assertSubWorkflowAllowed,
  extractTerminalItems,
  // …existing names…
} from '@openldr/workflows';
```

(Confirm `WorkflowDefinitionSchema`, `assertSubWorkflowAllowed`, `extractTerminalItems`, and `runWorkflow` are all exported from `@openldr/workflows` — they are: see `packages/workflows/src/index.ts`. Do not duplicate a name already imported.)

- [ ] **Step 2: Implement the service (post-construction mutation)**

In `packages/bootstrap/src/index.ts`, immediately after the block that sets `workflowServices.persistStore = createPersistStoreService({ … })` (around line ~454), add:

```ts
  // Execute Workflow node: run another saved workflow as a sub-workflow. Re-enters the
  // runner with the recursion chain extended (cycle + depth guard) and returns the
  // sub-run's terminal (leaf-node) items so the parent flow can chain onward.
  workflowServices.runSubWorkflow = async ({ workflowId, input, callStack }) => {
    assertSubWorkflowAllowed(workflowId, callStack);
    const rec = await workflowStore.get(workflowId);
    if (!rec) throw new Error(`Execute Workflow: unknown workflow: ${workflowId}`);
    const def = WorkflowDefinitionSchema.parse(rec.definition);
    const result = await runWorkflow(def.nodes, def.edges, {
      input,
      services: workflowServices,
      codeLimits: { timeoutMs: cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: cfg.WORKFLOW_CODE_MEMORY_MB, enabled: cfg.WORKFLOW_CODE_ENABLED },
      workflowId,
      logger: { warn: (msg: string) => logger.warn(msg) },
      callStack: [...callStack, workflowId],
    });
    if (result.status === 'failed') {
      const failed = result.results.find((r) => r.status === 'error');
      throw new Error(`Execute Workflow: sub-workflow ${workflowId} failed: ${failed?.error ?? 'unknown error'}`);
    }
    return { items: extractTerminalItems(def.edges, result.results), status: result.status };
  };
```

Notes for the implementer:
- `input` is typed `WorkflowItem[]` by the `WorkflowServices` interface; `runWorkflow`'s `opts.input` is `unknown`, so passing `input` through is fine and the sub-flow's `triggerHandler` → `toItems` passes the items straight through.
- `runWorkflow(def.nodes, def.edges, …)` — `def.nodes`/`def.edges` come from `WorkflowDefinitionSchema.parse`. If `runWorkflow`'s node param type (`WorkflowNode[]`/`RunnerNode[]`) does not structurally accept `def.nodes`, mirror the existing cast used at the `/execute-stream` call site in `apps/server/src/workflows-routes.ts` (it passes `def.nodes, def.edges` directly — match that). Do not invent a new cast if the server site compiles without one.

- [ ] **Step 3: Typecheck bootstrap + server (the cross-package gate)**

Run: `pnpm -C packages/bootstrap exec tsc --noEmit`
Expected: 0 errors.

Run: `pnpm -C apps/server exec tsc --noEmit`
Expected: 0 errors.

(The `WorkflowServices` interface gained an optional method — optional, so consumers stay valid — but per the recurring Slice C/D/F lesson, **always** run bootstrap + server tsc when `services.ts` changes.)

- [ ] **Step 4: Run the bootstrap test suite**

Run: `pnpm -C packages/bootstrap exec vitest run`
Expected: PASS (no regressions; the new code is thin glue over already-unit-tested helpers).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): wire runSubWorkflow for the execute-workflow node"
```

---

## Task 6: Holistic gate + memory update

- [ ] **Step 1: Run the full per-package gate**

Run each and confirm 0 tsc errors + green tests:

```
pnpm -C packages/workflows exec tsc --noEmit
pnpm -C packages/workflows exec vitest run
pnpm -C packages/bootstrap exec tsc --noEmit
pnpm -C apps/server exec tsc --noEmit
pnpm -C apps/web exec tsc --noEmit
```

Expected: all green. (`@openldr/web#test` has a known parallel flake — if web tests are run, run them isolated via `pnpm -C apps/web test`; never trust a turbo `web#test` red.)

- [ ] **Step 2: Manual sanity check (optional but recommended)**

In the running app's Workflow Builder, confirm `Wait` and `Execute Workflow` now appear as draggable (no "Coming soon"). Build a tiny flow: Manual Trigger → Set (a=1) → Wait (1s) → Execute Workflow (pointing at a second saved workflow that has a leaf node emitting items) and run it; confirm the wait delays, the sub-flow's items appear downstream, and a self-referencing Execute Workflow errors with "cycle detected".

- [ ] **Step 3: Update project memory**

Update `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\workflow-node-palette.md`: add a "Slice G" paragraph recording wait + execute-workflow done (handlers + `runSubWorkflow` service + callStack plumbing + `MAX_SUBWORKFLOW_DEPTH=5`), the leaf-node terminal-items decision, that `loop` remains the sole deferred control-flow node, and move `wait`/`execute-workflow` out of the "Still disabled" list. Refresh the `MEMORY.md` one-line pointer if the hook text changes.

- [ ] **Step 4: Final commit (if memory or stray files changed in-repo)**

```bash
git add -A
git commit -m "docs(workflows): record Slice G (wait + execute-workflow) complete"
```

(Per repo convention: merge to local `main` is the operator's call; do **not** push.)

---

## Self-review notes (for the implementer)

- **Spec coverage:** wait (Task 1), execute-workflow handler (Task 4), runSubWorkflow service + recursion/cycle/depth guard + leaf terminal-items (Tasks 3+5), callStack plumbing (Task 2), `waitForCompletion:false` note (Task 4), palette enablement (Tasks 1+4), cross-package gate (Tasks 5+6). `loop` is explicitly out of scope.
- **Type consistency:** `runSubWorkflow({ workflowId, input, callStack })` signature is identical in the interface (Task 4 Step 1), the handler call (Task 4 Step 4), the tests (Task 4 Step 2), and the bootstrap impl (Task 5 Step 2). `extractTerminalItems(edges, results)` and `assertSubWorkflowAllowed(workflowId, callStack)` signatures match across Task 3 and Task 5. `resolveWaitMs(config)` is consistent across Task 1.
- **No real long sleeps in tests:** the 30s clamp is verified through the pure `resolveWaitMs` (Task 1), never by sleeping; the handler test uses `duration: 0` (no sleep) and a 5ms case.
