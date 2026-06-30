# Workflow `loop` Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `loop` builder node — repeatedly executes an inline body subgraph (count or items mode) and emits the accumulated result, keeping the graph acyclic.

**Architecture:** The loop is driven by the runner (`run-workflow.ts`), not a node-handler. A pre-pass computes each loop node's body region (the subgraph dominated by the loop's `loop` output) and excludes it from the main topological pass. When the main pass reaches the loop node, it runs the body region once per iteration by calling `runWorkflow` recursively on `[syntheticTrigger, ...bodyNodes]` (the synthetic trigger replaces the loop node and emits the iteration's batch), accumulates each iteration's terminal items, and emits the accumulation on the `done` handle. No back-edge → topo sort untouched.

**Tech Stack:** TypeScript, `@openldr/workflows` (engine), `@openldr/config`, `@openldr/bootstrap`, React + `@xyflow/react` (builder), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-workflow-loop-node-design.md`

---

## Background the implementer needs

- **Runner** (`packages/workflows/src/engine/run-workflow.ts`): single-pass topological executor. `topologicalSort(nodes, edges)`; per node it computes `upstreamItemsFor(...)`, calls `pickHandler(node)(node, ctx, input)`, stores `ctx.nodeOutputs[node.id]`, emits lifecycle events, and prunes branches via `ctx.branches[node.id]` (an edge is skipped when its `sourceHandle !== branch`). `runWorkflow(nodes, edges, opts)` is the entry; `RunWorkflowOptions` already has `input`, `onEvent`, `codeLimits`, `services`, `workflowId`, `logger`, `files`, `callStack`.
- **Trigger seeding** (`node-handlers/trigger.ts`): a `type:'trigger'` node returns `toItems(ctx.input)` when `ctx.input !== undefined`. `toItems` (`engine/items.ts`) passes a genuine `WorkflowItem[]` through unchanged. This is why a synthetic trigger fed `input: batch` emits exactly the batch.
- **Leaf extraction** (`engine/sub-workflow.ts`, from Slice G): `extractTerminalItems(edges, results)` = concat `output` of successful nodes that are not the `source` of any edge. Reused for body terminal items.
- **Template resolver** (`engine/template.ts`): `resolveExpression` handles `$node(id)`, `$items`, `$input`, `$json`. No `$index`/`$item` yet.
- **Multi-handle nodes** (`components/node-types/condition-node.tsx`): render `hasOutput={false}` + `extraHandles` with `<Handle id="..." position={Position.Right} style={{ top: '..%' }}/>`. Edges then carry `sourceHandle`.
- **Loop node today**: `type:'loop'`, `pickHandler` falls it through to `defaultHandler` — but the runner will intercept `type==='loop'` BEFORE `pickHandler`, so that fallthrough is never used. Form `loop-form.tsx` has `loopMode` (count/items) + `iterations`. `loop-node.tsx` renders a single output.
- **Config** (`packages/config/src/schema.ts`): `WORKFLOW_*` knobs via `z.coerce.number().int().positive().default(...)`.

### File map
- Modify `packages/workflows/src/engine/execution-context.ts` — `loopVars` + `loopMaxItems` fields (no new params; defaulted in the returned object).
- Modify `packages/workflows/src/engine/run-workflow.ts` — `RunWorkflowOptions.loopVars`/`loopMaxItems`; set them on ctx; pre-pass exclusion; loop-node branch.
- Modify `packages/workflows/src/engine/template.ts` — `$index`/`$item`.
- Create `packages/workflows/src/engine/loop.ts` — `computeLoopBody`, `planIterations`, `buildIterationNodes` (pure).
- Create `packages/workflows/src/engine/loop.test.ts`.
- Modify `packages/workflows/src/engine/run-workflow.test.ts` (or a new `loop-runner.test.ts`) — integration tests.
- Modify `packages/config/src/schema.ts` (+ `schema.test.ts`) — `WORKFLOW_LOOP_MAX_ITEMS`.
- Modify `packages/bootstrap/src/index.ts` + `apps/server/src/workflows-routes.ts` — thread `loopMaxItems`.
- Modify `apps/web/src/workflows/components/node-types/loop-node.tsx` — `loop` + `done` handles.
- Modify `apps/web/src/workflows/components/node-forms/loop-form.tsx` — `batchSize` field.
- Modify `apps/web/src/workflows/constants.ts` — palette default data + `IMPLEMENTED_TEMPLATE_IDS`.

---

## Task 1: Context fields — `loopVars` stack + `loopMaxItems`

**Files:**
- Modify: `packages/workflows/src/engine/execution-context.ts`
- Modify: `packages/workflows/src/engine/run-workflow.ts`
- Test: `packages/workflows/src/engine/execution-context.test.ts` (exists — extend)

- [ ] **Step 1: Write the failing test** — append to `execution-context.test.ts`:

```ts
describe('createContext loop fields', () => {
  it('defaults loopVars to [] and loopMaxItems to 100000', () => {
    const ctx = createContext(undefined, () => {});
    expect(ctx.loopVars).toEqual([]);
    expect(ctx.loopMaxItems).toBe(100_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/execution-context.test.ts`
Expected: FAIL — `ctx.loopVars` / `ctx.loopMaxItems` undefined.

- [ ] **Step 3: Add the fields in `execution-context.ts`**

Add to the `ExecutionContext` interface (after `callStack`):
```ts
  /** Loop iteration stack (innermost loop on top) for $index/$item templating. */
  loopVars: Array<{ index: number; item?: Record<string, unknown> }>;
  /** Hard cap on a loop node's accumulated output items. */
  loopMaxItems: number;
```
Add an exported default constant near the top of the file:
```ts
export const DEFAULT_LOOP_MAX_ITEMS = 100_000;
```
In the returned object of `createContext`, add the two fields with defaults (do NOT add new function params):
```ts
  return { input, nodeOutputs: {}, nodeMeta: {}, branches: {}, logs: {}, emit, edges, codeLimits, services, workflowId, logger, files, callStack, loopVars: [], loopMaxItems: DEFAULT_LOOP_MAX_ITEMS };
```

- [ ] **Step 4: Thread options in `run-workflow.ts`**

Add to `RunWorkflowOptions` (after `callStack`):
```ts
  /** Seed the loop iteration stack (nested-loop recursion forwards this). */
  loopVars?: Array<{ index: number; item?: Record<string, unknown> }>;
  /** Override the loop accumulation cap (from cfg.WORKFLOW_LOOP_MAX_ITEMS). */
  loopMaxItems?: number;
```
In `runWorkflow`, right after `const ctx = createContext(...)`, override from opts:
```ts
  if (opts.loopVars) ctx.loopVars = opts.loopVars;
  if (opts.loopMaxItems != null) ctx.loopMaxItems = opts.loopMaxItems;
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm -C packages/workflows exec vitest run src/engine/execution-context.test.ts` → PASS.
Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/execution-context.ts packages/workflows/src/engine/execution-context.test.ts packages/workflows/src/engine/run-workflow.ts
git commit -m "feat(workflows): loopVars stack + loopMaxItems on execution context"
```

---

## Task 2: Template `$index` / `$item`

**Files:**
- Modify: `packages/workflows/src/engine/template.ts`
- Test: `packages/workflows/src/engine/template.test.ts` (exists — extend)

- [ ] **Step 1: Write the failing test** — append to `template.test.ts`:

```ts
import { createContext } from './execution-context';

describe('loop template vars', () => {
  it('resolves $index and $item from the loopVars stack (innermost on top)', () => {
    const ctx = createContext(undefined, () => {});
    ctx.loopVars = [
      { index: 0, item: { name: 'outer' } },
      { index: 3, item: { name: 'inner' } },
    ];
    expect(resolveExpression('$index', ctx, [])).toBe(3);
    expect(resolveExpression('$item.name', ctx, [])).toBe('inner');
  });

  it('returns empty string for $index/$item with no active loop', () => {
    const ctx = createContext(undefined, () => {});
    expect(resolveTemplate('i={{ $index }}', ctx, [])).toBe('i=');
    expect(resolveTemplate('n={{ $item.name }}', ctx, [])).toBe('n=');
  });
});
```
(Ensure `resolveExpression` and `resolveTemplate` are imported at the top of the test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/template.test.ts`
Expected: FAIL — `$index`/`$item` fall through to the raw-text branch.

- [ ] **Step 3: Implement in `template.ts`** — inside `resolveExpression`, BEFORE the `$items` check (so `$item` is matched before `$input`/`$items` prefix logic; note `$index` and `$item` are distinct prefixes), add:

```ts
  if (trimmed === '$index') {
    const top = ctx.loopVars[ctx.loopVars.length - 1];
    return top ? top.index : undefined;
  }
  if (trimmed.startsWith('$item')) {
    const top = ctx.loopVars[ctx.loopVars.length - 1];
    return readPath(top?.item, trimmed.slice('$item'.length));
  }
```
(Place these two blocks immediately after the `$node(...)` block. `$item` is checked before `$items`/`$input`/`$json`; since none of those start with `$item`, ordering among them is unaffected.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/template.test.ts` → PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/template.ts packages/workflows/src/engine/template.test.ts
git commit -m "feat(workflows): $index / $item loop template vars"
```

---

## Task 3: Loop graph helpers (`loop.ts`, pure)

**Files:**
- Create: `packages/workflows/src/engine/loop.ts`
- Test: `packages/workflows/src/engine/loop.test.ts`

- [ ] **Step 1: Write the failing test** — create `packages/workflows/src/engine/loop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeLoopBody, planIterations, buildIterationNodes } from './loop';
import type { WorkflowEdge } from '../types';
import type { RunnerNode } from './node-handlers';

const N = (id: string, type = 'action'): RunnerNode => ({ id, type, data: {} });
const E = (id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge =>
  ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) }) as WorkflowEdge;

describe('computeLoopBody', () => {
  // trigger -> loop ; loop --loop--> b1 -> b2(leaf) ; loop --done--> cont
  const nodes = [N('t', 'trigger'), N('loop', 'loop'), N('b1'), N('b2'), N('cont')];
  const edges = [
    E('e0', 't', 'loop'),
    E('e1', 'loop', 'b1', 'loop'),
    E('e2', 'b1', 'b2'),
    E('e3', 'loop', 'cont', 'done'),
  ];

  it('returns the dominated body region and its edges', () => {
    const { bodyNodeIds, bodyEdges } = computeLoopBody('loop', nodes, edges);
    expect([...bodyNodeIds].sort()).toEqual(['b1', 'b2']);
    // bodyEdges = edges whose target is in the body (loop->b1 and b1->b2), not done/cont
    expect(bodyEdges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('throws when there is no loop-handle body', () => {
    const bad = [N('t', 'trigger'), N('loop', 'loop'), N('cont')];
    const be = [E('e0', 't', 'loop'), E('e1', 'loop', 'cont', 'done')];
    expect(() => computeLoopBody('loop', bad, be)).toThrow(/no body connected/);
  });

  it('throws when the body escapes back into the main flow', () => {
    // b2 -> cont (cont is NOT in the body) → escape
    const escNodes = [N('t', 'trigger'), N('loop', 'loop'), N('b1'), N('cont')];
    const escEdges = [
      E('e0', 't', 'loop'),
      E('e1', 'loop', 'b1', 'loop'),
      E('e2', 'b1', 'cont'),         // escape: b1 (body) -> cont (main)
      E('e3', 'loop', 'cont', 'done'),
    ];
    expect(() => computeLoopBody('loop', escNodes, escEdges)).toThrow(/must not connect back into the main flow/);
  });
});

describe('planIterations', () => {
  const items = [{ json: { a: 1 } }, { json: { a: 2 } }, { json: { a: 3 } }];

  it('count mode: clamps iterations to [1,1000], item undefined, batch = all input', () => {
    const plan = planIterations({ loopMode: 'count', iterations: 2 }, items);
    expect(plan.map((p) => p.index)).toEqual([0, 1]);
    expect(plan[0].item).toBeUndefined();
    expect(plan[0].batch).toBe(items);
    expect(planIterations({ loopMode: 'count', iterations: 0 }, items)).toHaveLength(1);
    expect(planIterations({ loopMode: 'count', iterations: 5000 }, items)).toHaveLength(1000);
  });

  it('items mode: batches by batchSize, item = first json of the batch', () => {
    const plan = planIterations({ loopMode: 'items', batchSize: 2 }, items);
    expect(plan).toHaveLength(2);
    expect(plan[0].batch).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
    expect(plan[0].item).toEqual({ a: 1 });
    expect(plan[1].batch).toEqual([{ json: { a: 3 } }]);
    expect(plan[1].item).toEqual({ a: 3 });
  });

  it('items mode: zero input items → zero iterations', () => {
    expect(planIterations({ loopMode: 'items', batchSize: 1 }, [])).toEqual([]);
  });

  it('items mode: batchSize defaults to 1 and is floored to >= 1', () => {
    expect(planIterations({ loopMode: 'items' }, items)).toHaveLength(3);
    expect(planIterations({ loopMode: 'items', batchSize: 0 }, items)).toHaveLength(3);
  });
});

describe('buildIterationNodes', () => {
  it('replaces the loop node with a synthetic manual trigger and includes only body nodes', () => {
    const nodes = [N('t', 'trigger'), N('loop', 'loop'), N('b1'), N('b2'), N('cont')];
    const out = buildIterationNodes(nodes.find((n) => n.id === 'loop')!, new Set(['b1', 'b2']), nodes);
    expect(out[0]).toEqual({ id: 'loop', type: 'trigger', data: { triggerType: 'manual', config: {} } });
    expect(out.slice(1).map((n) => n.id).sort()).toEqual(['b1', 'b2']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/loop.test.ts`
Expected: FAIL — cannot find module `./loop`.

- [ ] **Step 3: Implement `loop.ts`**

```ts
import type { WorkflowEdge } from '../types';
import type { WorkflowItem } from './items';
import type { RunnerNode } from './node-handlers';

/** Forward-reachable set from `starts`, following all edges. Optionally treat
 *  `barrier` as a sink (you may reach it but never traverse OUT of it). */
function reachable(starts: string[], edges: WorkflowEdge[], barrier?: string): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === barrier) continue; // cannot pass through the barrier
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

export interface LoopBody {
  bodyNodeIds: Set<string>;
  bodyEdges: WorkflowEdge[];
}

/**
 * Compute the body region of a loop node. Both the body (reachable via the
 * `loop` handle) and the done-continuation (reachable via the `done` handle) are
 * dominated by the loop node, so they must be separated BY HANDLE: the body is
 * what the `loop` handle reaches, MINUS the done-continuation, MINUS the main
 * flow. Throws on a malformed loop.
 */
export function computeLoopBody(loopNodeId: string, nodes: RunnerNode[], edges: WorkflowEdge[]): LoopBody {
  const entry = edges.filter((e) => e.source === loopNodeId && e.sourceHandle === 'loop').map((e) => e.target);
  if (entry.length === 0) throw new Error('Loop: no body connected to the loop output');
  const doneTargets = edges.filter((e) => e.source === loopNodeId && e.sourceHandle === 'done').map((e) => e.target);

  // Reachable sets, never traversing OUT of the loop node itself.
  const fromEntry = reachable(entry, edges, loopNodeId);         // candidate body
  const contReach = reachable(doneTargets, edges, loopNodeId);   // done-continuation
  const sources = nodes.filter((n) => !edges.some((e) => e.target === n.id)).map((n) => n.id);
  const mainFlow = reachable(sources, edges, loopNodeId);        // pre-loop main flow

  const bodyNodeIds = new Set<string>();
  for (const id of fromEntry) {
    if (id === loopNodeId) continue;
    if (contReach.has(id)) continue; // belongs to the continuation, not the body
    if (mainFlow.has(id)) continue;  // belongs to the pre-loop main flow
    bodyNodeIds.add(id);
  }
  if (bodyNodeIds.size === 0) throw new Error('Loop: no body connected to the loop output');

  // Strict: a body node must not have an edge leaving the body (the only bridge
  // back to the main flow is the loop node's `done` output). Edges back to the
  // loop node itself are not part of this acyclic model and are also rejected.
  for (const e of edges) {
    if (bodyNodeIds.has(e.source) && !bodyNodeIds.has(e.target)) {
      throw new Error('Loop: body must not connect back into the main flow except via the done output');
    }
  }

  const bodyEdges = edges.filter((e) => bodyNodeIds.has(e.target));
  return { bodyNodeIds, bodyEdges };
}

export interface LoopIteration { index: number; item?: Record<string, unknown>; batch: WorkflowItem[]; }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Build the per-iteration plan for a loop node. */
export function planIterations(
  data: { loopMode?: string; iterations?: number; batchSize?: number },
  input: WorkflowItem[],
): LoopIteration[] {
  const mode = data.loopMode ?? 'count';
  if (mode === 'items') {
    const size = Math.max(1, Math.floor(Number(data.batchSize) || 1));
    const out: LoopIteration[] = [];
    for (let i = 0, idx = 0; i < input.length; i += size, idx++) {
      const batch = input.slice(i, i + size);
      out.push({ index: idx, item: batch[0]?.json, batch });
    }
    return out;
  }
  const n = clamp(Math.floor(Number(data.iterations) || 0) || 1, 1, 1000);
  return Array.from({ length: n }, (_, index) => ({ index, item: undefined, batch: input }));
}

/** Replace the loop node with a synthetic manual trigger (emits the iteration's
 *  batch) and append the body nodes. */
export function buildIterationNodes(loopNode: RunnerNode, bodyNodeIds: Set<string>, nodes: RunnerNode[]): RunnerNode[] {
  const synthetic: RunnerNode = { id: loopNode.id, type: 'trigger', data: { triggerType: 'manual', config: {} } };
  return [synthetic, ...nodes.filter((n) => bodyNodeIds.has(n.id))];
}
```

Note: `RunnerNode` is exported from `./node-handlers`. `WorkflowEdge` from `../types`. The `data: {}` synthetic shape satisfies `RunnerNode` (`data: Record<string, unknown>`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/loop.test.ts` → PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/workflows exec vitest run` → 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/loop.ts packages/workflows/src/engine/loop.test.ts
git commit -m "feat(workflows): loop graph helpers (body region, iteration plan, synthetic trigger)"
```

---

## Task 4: Runner integration — execute the loop

**Files:**
- Modify: `packages/workflows/src/engine/run-workflow.ts`
- Test: Create `packages/workflows/src/engine/loop-runner.test.ts`

- [ ] **Step 1: Write the failing integration test** — create `packages/workflows/src/engine/loop-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runWorkflow } from './run-workflow';
import type { WorkflowEdge } from '../types';

// Helpers to build small graphs. A 'set' action writes config.fields onto each item.
// We use the existing 'set' handler via node.data.action='set'.
const trigger = (id: string) => ({ id, type: 'trigger', data: { triggerType: 'manual', config: {} } });
const loop = (id: string, data: Record<string, unknown>) => ({ id, type: 'loop', data });
const log = (id: string) => ({ id, type: 'action', data: { action: 'log', message: 'i={{ $index }}' } });
const edge = (id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge =>
  ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) }) as WorkflowEdge;

describe('loop runner', () => {
  it('count mode: runs the body N times and accumulates its output on done', async () => {
    // trigger -> loop(count 3) --loop--> body(log, passthrough) ; loop --done--> end(log)
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 3 }), log('body'), log('end')];
    const edges = [
      edge('e0', 't', 'lp'),
      edge('e1', 'lp', 'body', 'loop'),
      edge('e2', 'lp', 'end', 'done'),
    ];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { x: 1 } }] });
    expect(res.status).toBe('completed');
    const loopResult = res.results.find((r) => r.nodeId === 'lp')!;
    // body (a log) passes its input through unchanged; count=3 accumulates 3 copies.
    expect((loopResult.output as unknown[]).length).toBe(3);
    // body node ran (it executed inside iterations) and end ran after the loop.
    expect(res.results.find((r) => r.nodeId === 'end')!.status).toBe('success');
  });

  it('items mode batchSize 1: one iteration per item, $index available', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'items', batchSize: 1 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { a: 1 } }, { json: { a: 2 } }] });
    expect(res.status).toBe('completed');
    expect((res.results.find((r) => r.nodeId === 'lp')!.output as unknown[]).length).toBe(2);
  });

  it('malformed loop (empty body) fails the loop node', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 2 }), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: {} }] });
    expect(res.status).toBe('failed');
    expect(res.results.find((r) => r.nodeId === 'lp')!.error).toMatch(/no body connected/);
  });

  it('accumulation cap throws', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 5 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    // each iteration passes through 2 items → 10 total; cap at 3 → throws.
    const res = await runWorkflow(nodes, edges, { input: [{ json: { a: 1 } }, { json: { a: 2 } }], loopMaxItems: 3 });
    expect(res.status).toBe('failed');
    expect(res.results.find((r) => r.nodeId === 'lp')!.error).toMatch(/exceeded the limit/);
  });

  it('body nodes do not run in the main pass (no duplicate output)', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 1 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { a: 1 } }] });
    // 'body' must NOT appear as a top-level result (it ran inside the iteration only).
    expect(res.results.some((r) => r.nodeId === 'body')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/loop-runner.test.ts`
Expected: FAIL — loop node currently runs via `defaultHandler` (no body execution); assertions fail.

- [ ] **Step 3: Implement the runner branch in `run-workflow.ts`**

Add imports at the top:
```ts
import { computeLoopBody, planIterations, buildIterationNodes, type LoopBody } from './loop';
import { extractTerminalItems } from './sub-workflow';
```

Inside `runWorkflow`, AFTER `const sorted = topologicalSort(nodes, edges);` and BEFORE the `for (const node of sorted)` loop, add the loop pre-pass:
```ts
  // Loop pre-pass: compute each loop node's body region, exclude body nodes from
  // the main pass. A malformed loop defers its error to when the loop node runs.
  const loopInfo = new Map<string, LoopBody | { error: string }>();
  const excludedBody = new Set<string>();
  for (const n of nodes) {
    if (n.type !== 'loop') continue;
    try {
      const info = computeLoopBody(n.id, nodes, edges);
      loopInfo.set(n.id, info);
      for (const id of info.bodyNodeIds) excludedBody.add(id);
    } catch (err) {
      loopInfo.set(n.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }
```

At the very top of the `for (const node of sorted)` body, skip excluded body nodes:
```ts
    if (excludedBody.has(node.id)) continue;
```

Inside the `try { ... }`, replace the single `const output = await handler(...)` path with a loop branch. Concretely, change:
```ts
      const input = upstreamItemsFor(node, edges, ctx.nodeOutputs, skippedEdges);
      const handler = pickHandler(node);
      const output = await handler(node, ctx, input);
      ctx.nodeOutputs[node.id] = output;
```
to:
```ts
      const input = upstreamItemsFor(node, edges, ctx.nodeOutputs, skippedEdges);
      let output: WorkflowItem[];
      if (node.type === 'loop') {
        output = await executeLoopNode(node, ctx, input, nodes, loopInfo.get(node.id)!);
        ctx.nodeOutputs[node.id] = output;
        ctx.branches[node.id] = 'done'; // prune the loop-handle edges in the main pass
      } else {
        const handler = pickHandler(node);
        output = await handler(node, ctx, input);
        ctx.nodeOutputs[node.id] = output;
      }
```
(`pickHandler` import and the rest of the success/branch/error handling stay as-is. The existing post-success branch-pruning block reads `ctx.branches[node.id]` and will now prune the loop's `loop`-handle edges, leaving only the `done` edges — exactly what we want.)

Add the `executeLoopNode` function at the bottom of the file (module scope):
```ts
async function executeLoopNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
  input: WorkflowItem[],
  nodes: WorkflowNode[],
  info: LoopBody | { error: string },
): Promise<WorkflowItem[]> {
  if ('error' in info) throw new Error(info.error);
  const { bodyNodeIds, bodyEdges } = info;
  const iterNodes = buildIterationNodes(node, bodyNodeIds, nodes);
  const plan = planIterations(node.data as { loopMode?: string; iterations?: number; batchSize?: number }, input);

  const accumulated: WorkflowItem[] = [];
  for (const { index, item, batch } of plan) {
    const result = await runWorkflow(iterNodes, bodyEdges, {
      input: batch,
      services: ctx.services,
      codeLimits: ctx.codeLimits,
      loopMaxItems: ctx.loopMaxItems,
      callStack: ctx.callStack,
      loopVars: [...ctx.loopVars, { index, item }],
      workflowId: ctx.workflowId,
      logger: ctx.logger,
      // Stream body node events to the same sink, but swallow the per-iteration
      // workflow:done so the UI sees one terminal event for the whole run.
      onEvent: (e) => { if (e.type !== 'workflow:done') ctx.emit(e); },
    });
    if (result.status === 'failed') {
      const failed = result.results.find((r) => r.status === 'error');
      throw new Error(`Loop: iteration ${index} failed: ${failed?.error ?? 'unknown error'}`);
    }
    accumulated.push(...extractTerminalItems(bodyEdges, result.results));
    if (accumulated.length > ctx.loopMaxItems) {
      throw new Error(`Loop: accumulated items exceeded the limit (${ctx.loopMaxItems})`);
    }
  }
  return accumulated;
}
```
(`ExecutionContext` is already imported; `WorkflowNode`/`WorkflowItem` types are already in scope in this file. Place `executeLoopNode` below `runWorkflow`.)

- [ ] **Step 4: Run the integration test**

Run: `pnpm -C packages/workflows exec vitest run src/engine/loop-runner.test.ts` → PASS (all cases).

- [ ] **Step 5: Typecheck + FULL workflows suite (regression check — the runner changed)**

Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/workflows exec vitest run` → 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/run-workflow.ts packages/workflows/src/engine/loop-runner.test.ts
git commit -m "feat(workflows): runner executes loop nodes via acyclic body re-execution"
```

---

## Task 5: Config knob + host threading

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/schema.test.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/workflows-routes.ts`

- [ ] **Step 1: Write the failing config test** — append to `packages/config/src/schema.test.ts` a case in the style of the existing tests (find an existing `WORKFLOW_*` default assertion and mirror it):

```ts
  it('defaults WORKFLOW_LOOP_MAX_ITEMS to 100000 and coerces overrides', () => {
    expect(loadConfig({ ...base }).WORKFLOW_LOOP_MAX_ITEMS).toBe(100_000);
    expect(loadConfig({ ...base, WORKFLOW_LOOP_MAX_ITEMS: '250' }).WORKFLOW_LOOP_MAX_ITEMS).toBe(250);
  });
```
(Match the actual test harness in `schema.test.ts` — it likely has a `base` env fixture and a `loadConfig`/parse helper. Use whatever the neighboring `WORKFLOW_FILE_MAX_BYTES`/`WORKFLOW_CODE_*` tests use; if there is no such test, add a minimal one using the same parse entrypoint the file already imports.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/config exec vitest run` → FAIL (unknown key / undefined default).

- [ ] **Step 3: Add the schema field** in `packages/config/src/schema.ts`, next to `WORKFLOW_FILE_MAX_BYTES`:
```ts
    // Max accumulated output items a single loop node may emit on its done handle.
    WORKFLOW_LOOP_MAX_ITEMS: z.coerce.number().int().positive().default(100_000),
```

- [ ] **Step 4: Run config test + typecheck**

Run: `pnpm -C packages/config exec vitest run` → PASS.
Run: `pnpm -C packages/config exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Thread into the runner call sites**

In `apps/server/src/workflows-routes.ts`, the `/execute-stream` `runWorkflow(...)` call (currently passing `codeLimits`, `services`, `workflowId`, `logger`) — add:
```ts
        loopMaxItems: ctx.cfg.WORKFLOW_LOOP_MAX_ITEMS,
```

In `packages/bootstrap/src/index.ts`:
- The `createWorkflowTriggerRunner({...})` call passes `codeLimits` — check whether the trigger runner forwards a `loopMaxItems` to `runWorkflow`. Open `packages/workflows/src/trigger-runner.ts`; wherever it calls `runWorkflow(def.nodes, def.edges, { ... })`, add `loopMaxItems` sourced from a new `loopMaxItems` field threaded through `createWorkflowTriggerRunner`'s deps. Concretely: add `loopMaxItems: number` to the trigger-runner's options interface, pass `loopMaxItems: cfg.WORKFLOW_LOOP_MAX_ITEMS` from bootstrap's `createWorkflowTriggerRunner({...})` call, and include it in the runner's `runWorkflow` options. (If the trigger-runner does not call `runWorkflow` directly, skip this sub-step and note it.)
- The bootstrap `runSubWorkflow` service (Slice G) calls `runWorkflow(...)` — add `loopMaxItems: cfg.WORKFLOW_LOOP_MAX_ITEMS` there too so loops inside sub-workflows are capped.

- [ ] **Step 6: Cross-package gate**

Run: `pnpm -C packages/config exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.
Run: `pnpm -C apps/server exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/bootstrap exec vitest run` → 0 failures.

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts packages/bootstrap/src/index.ts apps/server/src/workflows-routes.ts packages/workflows/src/trigger-runner.ts
git commit -m "feat(config): WORKFLOW_LOOP_MAX_ITEMS knob threaded into the runner"
```

---

## Task 6: Web — loop node handles, batchSize field, palette

**Files:**
- Modify: `apps/web/src/workflows/components/node-types/loop-node.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/loop-form.tsx`
- Modify: `apps/web/src/workflows/constants.ts`
- Test: `apps/web/src/workflows/components/node-types/loop-node.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — create `apps/web/src/workflows/components/node-types/loop-node.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { LoopNode } from './loop-node';

describe('LoopNode', () => {
  it('renders a loop and a done source handle', () => {
    const { container } = render(
      <ReactFlowProvider>
        <LoopNode id="lp" type="loop" data={{ label: 'Loop', iterations: 3 }} selected={false}
          dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} />
      </ReactFlowProvider>,
    );
    // Two source handles with ids 'loop' and 'done'.
    expect(container.querySelector('[data-handleid="loop"]')).not.toBeNull();
    expect(container.querySelector('[data-handleid="done"]')).not.toBeNull();
  });
});
```
(If sibling node tests render handles differently, mirror their setup — check `condition-node` tests if present, or `sidebar.test.tsx` for the render harness. ReactFlow renders handle ids onto `data-handleid`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/workflows/components/node-types/loop-node.test.tsx`
Expected: FAIL — only the default single handle is rendered (no `done`).

- [ ] **Step 3: Render two handles in `loop-node.tsx`**

```tsx
import { type NodeProps, Handle, Position } from '@xyflow/react';
import { Repeat } from 'lucide-react';
import type { LoopNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

export function LoopNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as LoopNodeData;
  const subtitle =
    (nodeData.loopMode ?? 'count') === 'items'
      ? `batch ${nodeData.batchSize ?? 1}`
      : `${nodeData.iterations ?? 0} iterations`;
  return (
    <NodeShell
      id={id}
      variant="loop"
      icon={Repeat}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={subtitle}
      selected={selected}
      hasOutput={false}
      extraHandles={
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="loop"
            style={{ top: '30%' }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-violet-500 transition-all hover:!h-4 hover:!w-4"
            title="Loop (body)"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="done"
            style={{ top: '70%' }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-emerald-500 transition-all hover:!h-4 hover:!w-4"
            title="Done"
          />
        </>
      }
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/workflows/components/node-types/loop-node.test.tsx` → PASS.

- [ ] **Step 5: Add the `batchSize` field + types**

In `apps/web/src/workflows/lib/types.ts`, extend `LoopNodeData`:
```ts
export interface LoopNodeData extends NodeVisualMeta {
  label: string;
  iterations: number;
  loopMode?: 'count' | 'items';
  /** items mode — number of items per iteration (default 1). */
  batchSize?: number;
  [key: string]: unknown;
}
```

In `apps/web/src/workflows/components/node-forms/loop-form.tsx`, replace the `items`-mode hint block with a `batchSize` field plus the existing `$item`/`$index` hint:
```tsx
      {loopMode === 'items' && (
        <>
          <FormField label="Batch size" hint="Items per iteration. Default 1.">
            <TextInput
              type="number"
              value={data.batchSize ?? 1}
              onChange={(e) => update({ batchSize: parseInt(e.target.value) || 1 })}
              min={1}
            />
          </FormField>
          <p className="text-[10px] leading-snug text-muted-foreground/80">
            The body runs once per batch. Access the current item via{' '}
            <code className="rounded bg-secondary px-1 font-mono">$item</code> and the iteration
            index via <code className="rounded bg-secondary px-1 font-mono">$index</code>.
          </p>
        </>
      )}
```

- [ ] **Step 6: Palette enablement + default data** in `apps/web/src/workflows/constants.ts`:

Update the loop palette entry's default data to seed all fields:
```ts
      node('loop', 'loop', 'Loop Over Items', 'Repeat', 'Iterate over items', {
        data: { loopMode: 'count', iterations: 10, batchSize: 1 },
      }),
```
Extend the engine-control-flow line in `IMPLEMENTED_TEMPLATE_IDS`:
```ts
  'wait', 'execute-workflow', 'loop',
```

- [ ] **Step 7: Web gate**

Run: `pnpm -C apps/web exec tsc --noEmit` → 0 errors.
Run: `pnpm -C apps/web exec vitest run src/workflows` → 0 failures (isolated; avoids the known parallel flake).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/workflows/components/node-types/loop-node.tsx apps/web/src/workflows/components/node-types/loop-node.test.tsx apps/web/src/workflows/components/node-forms/loop-form.tsx apps/web/src/workflows/lib/types.ts apps/web/src/workflows/constants.ts
git commit -m "feat(web): loop node — loop/done handles, batchSize field, palette enablement"
```

---

## Task 7: Holistic gate + memory

- [ ] **Step 1: Full per-package gate**

```
pnpm -C packages/config exec tsc --noEmit
pnpm -C packages/config exec vitest run
pnpm -C packages/workflows exec tsc --noEmit
pnpm -C packages/workflows exec vitest run
pnpm -C packages/bootstrap exec tsc --noEmit
pnpm -C packages/bootstrap exec vitest run
pnpm -C apps/server exec tsc --noEmit
pnpm -C apps/web exec tsc --noEmit
pnpm -C apps/web exec vitest run src/workflows
```
Expected: all green. (`@openldr/web#test` has a known parallel flake — run web tests isolated; never trust a turbo `web#test` red.)

- [ ] **Step 2: Manual sanity check (optional)**

In the running builder: drag a `Loop Over Items` node; confirm it shows two right-edge handles (violet `loop`, emerald `done`). Wire trigger → loop; loop `loop` → a Set/Log body; loop `done` → a terminal node. Run with count=3 and confirm the body executes 3× and the `done` output carries the accumulation. Wire a body node back into the main flow (bypassing `done`) and confirm the run fails with the malformed-loop error.

- [ ] **Step 3: Update memory** — `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\workflow-node-palette.md`: add a Slice H paragraph (loop via acyclic body re-execution; two-output node; `computeLoopBody` dominator rule; count/items + batchSize; `$index`/`$item`; `WORKFLOW_LOOP_MAX_ITEMS`; per-iteration nested `runWorkflow` with a synthetic trigger). Move `loop` out of "Still disabled" → the palette is now complete except listener triggers + read-write-file. Refresh the `MEMORY.md` pointer.

- [ ] **Step 4: Commit (if in-repo files changed)**

```bash
git add -A && git commit -m "docs(workflows): record Slice H (loop node) complete"
```
(Per repo convention: merge to local `main` is the operator's call; do NOT push.)

---

## Self-review notes (for the implementer)

- **Spec coverage:** two-output node + body region (Task 3 + Task 6), acyclic re-execution via synthetic-trigger nested run (Task 4), count/items + batchSize (Task 3 + Task 6), `$index`/`$item` (Task 1 + Task 2), `done` accumulation + cap (Task 4 + Task 5), strict malformed-loop error (Task 3 + Task 4), config knob threaded (Task 5), palette enablement (Task 6). Nested loops are covered structurally (the per-iteration `runWorkflow` forwards `loopVars`).
- **Type consistency:** `computeLoopBody(loopNodeId, nodes, edges) → { bodyNodeIds: Set<string>, bodyEdges }`, `planIterations(data, input) → LoopIteration[]` (`{ index, item?, batch }`), `buildIterationNodes(loopNode, bodyNodeIds, nodes)` — identical across Task 3 (defs + tests) and Task 4 (`executeLoopNode`). `loopVars` element shape `{ index: number; item?: Record<string, unknown> }` identical in Task 1, Task 2, Task 4. `loopMaxItems` is a `number` everywhere.
- **No real cycles:** the graph stays acyclic; `topologicalSort` is unchanged. The loop "repeats" only inside `executeLoopNode` via nested `runWorkflow`.
- **Body double-execution guard:** Task 4 excludes body nodes from the main pass (`excludedBody`) AND the loop's post-success branch-prune (`ctx.branches[id]='done'`) drops the `loop`-handle edges — Task 4's "body nodes do not run in the main pass" test locks this in.
- **Reused, not duplicated:** `extractTerminalItems` (Slice G) computes body leaves; `runWorkflow` itself runs each iteration (handles topo, emit, errors, even nested loops).
