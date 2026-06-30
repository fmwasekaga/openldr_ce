# Workflow `loop` Node — Acyclic Body Re-execution (Slice H)

**Date:** 2026-07-01
**Status:** Approved design
**Workstream:** Workflow node palette — engine control-flow tier (final node).

## Goal

Implement the `loop` builder node — the last remaining engine control-flow
placeholder. The loop repeatedly executes an inline **body subgraph** and emits
the accumulated result, in two modes:

- **count** — run the body a fixed number of times (`iterations`, clamped
  `[1, 1000]`).
- **items** — run the body once per batch over the upstream items
  (`batchSize`, default 1).

`$index` (iteration number) and `$item` (current item) become available to the
body via templates, fulfilling the loop form's existing promise.

## Key decision: acyclic body re-execution (no cycle)

The runner (`packages/workflows/src/engine/run-workflow.ts`) is a **single-pass
topological executor**; cycles are not expressible. Rather than rewrite it to
handle a back-edge (n8n SplitInBatches style), the loop keeps the graph
**acyclic**: the loop node re-executes a downstream **DAG region** under its own
control. There is no loop-back edge. The topological sort is untouched.

## Non-goals (YAGNI)

- `break` / `continue`, while-condition loops (only count + items).
- Parallel iterations (iterations run sequentially).
- Per-iteration error-continue (loop is fail-fast: a body error fails the loop).
- Persisting per-iteration artifacts / run-history per iteration.
- A true cyclic runner / loop-back edges.

## Node shape & graph model

The `loop` node (`type: 'loop'`) renders:
- one **input** target handle (left), and
- two **source** handles (right): `loop` (body) and `done` (continuation) —
  rendered via `NodeShell`'s `extraHandles` with `hasOutput={false}`, mirroring
  how the condition node renders branch handles. Edges from the loop carry
  `sourceHandle: 'loop' | 'done'`.

**Body region.** The body is the subgraph **dominated by the loop node through
its `loop` handle**: every path from a trigger/source to a body node passes
through the loop node's `loop` output. Operationally, `computeLoopBody` returns
the nodes reachable from the `loop`-handle target(s) that are **not** reachable
from any source node without passing through the loop node. The body region is
**excluded from the main topological pass** — those nodes run only under loop
control.

**`done` is the only bridge back to the main flow.** Constraints (strict —
violations are hard errors surfaced as a normal `node:error`):
- A body node whose output reaches a non-body node by any path **other than**
  through the loop's `done` handle is a **malformed loop**
  (`Loop: body must not connect back into the main flow except via the done output`).
- A loop node with no `loop`-handle edge (empty body) is a malformed loop
  (`Loop: no body connected to the loop output`).
- An **unwired `done`** handle is allowed: the body runs for side-effects and the
  loop emits nothing downstream (no error).

Nested loops are allowed (a body may contain another loop); the acyclic model
means no recursion risk.

## Runner integration (`run-workflow.ts`)

1. **Pre-pass:** identify loop nodes; for each, call `computeLoopBody` and add its
   body nodes to an `excludedFromMainPass` set. Topo-sort + iterate the
   non-excluded nodes as today.
2. When the main pass reaches loop node `L` (`node.type === 'loop'`):
   - Gather `L`'s upstream input items (via the existing `upstreamItemsFor`).
   - Build the **iteration plan** (`planIterations`):
     - `count`: `iterations` clamped to `[1, 1000]`; each iteration's batch = the
       full upstream input items.
     - `items`: `batchSize` coerced to `>= 1` (default 1); iterations =
       `ceil(items.length / batchSize)`; iteration `i`'s batch =
       `items.slice(i*batchSize, (i+1)*batchSize)`. Zero input items → zero
       iterations (the body never runs; `done` emits `[]`).
   - For each iteration, call `runLoopIteration` (see below); concatenate its
     terminal items into an accumulator.
   - **Cap:** if the accumulator length would exceed `ctx.loopMaxItems`, throw
     `Loop: accumulated items exceeded the limit (<n>)`.
   - Set `ctx.nodeOutputs[L.id]` keyed for the `done` handle so only
     `done`-downstream edges receive the accumulation (the runner's existing
     branch-pruning machinery, `ctx.branches` + `sourceHandle`, is reused: the
     loop records `branch = 'done'` so `loop`-handle edges from `L` are pruned in
     the main pass — the body already ran under loop control). Continue the main
     pass.

### `runLoopIteration` (in `engine/loop.ts`)

Runs the body region once for a given `(batch, index)`:
- Seed a working outputs map with `{ [L.id]: batch }` so body-entry nodes read the
  loop node as their satisfied upstream.
- Push `{ index, item }` onto `ctx.loopVars` (item = batch-size-1 → the single
  item's `json`; batch>1 → the first item's `json`; count mode → `undefined`).
- Topologically execute the **body region only**, using `pickHandler` exactly as
  the main runner does, writing each body node's output into `ctx.nodeOutputs`
  (so `$node('body-node')` resolves within the iteration) AND the working map.
- Collect **terminal items** = outputs of the body region's leaf nodes (a body
  node with no outgoing edge that stays inside the body), reusing the leaf logic
  from Slice G's `extractTerminalItems`.
- Pop `ctx.loopVars`; **clear the body nodes' keys from `ctx.nodeOutputs`** so
  iteration `i` does not leak into `i+1` (isolation). Return the terminal items.

Body node lifecycle events (`node:start`/`node:success`/`node:error`) stream as
usual; the same body node id emitting once per iteration is expected (shows
iteration progress in the UI). A body node error propagates → the loop fails →
the runner stops on first failure (unchanged behavior).

## Iteration variables (`template.ts` + `execution-context.ts`)

Add `ctx.loopVars: Array<{ index: number; item?: Record<string, unknown> }>` (a
**stack** — innermost loop on top; default `[]`). `resolveExpression` gains:
- `$index` → top-of-stack `index` (empty string if no active loop).
- `$item` / `$item.path` → top-of-stack `item` (or a path into it).

Within a body, `$json`/`$items`/`$input` continue to reference the body node's
normal input (the current batch).

## Config knob (`packages/config/src/schema.ts` + threading)

Add `WORKFLOW_LOOP_MAX_ITEMS: z.coerce.number().int().positive().default(100_000)`
next to the other `WORKFLOW_*` knobs. Thread it to the engine exactly like
`codeLimits`:
- `RunWorkflowOptions.loopMaxItems?: number` → stored on `ctx.loopMaxItems`
  (engine default `100_000` when the option is absent, so pure-engine tests need
  no config).
- Bootstrap (`createWorkflowTriggerRunner`) and the server `/execute-stream`
  route pass `loopMaxItems: cfg.WORKFLOW_LOOP_MAX_ITEMS`.

## Components / files

- Create `packages/workflows/src/engine/loop.ts` — `computeLoopBody`,
  `planIterations`, `runLoopIteration`, accumulation cap. Pure / unit-tested.
- Modify `run-workflow.ts` — pre-pass exclusion + loop branch + `loopMaxItems`
  option.
- Modify `engine/execution-context.ts` — `loopVars` stack + `loopMaxItems`.
- Modify `engine/template.ts` — `$index` / `$item`.
- **No change to `node-handlers/index.ts`:** the loop is intercepted by the runner
  on `node.type === 'loop'` BEFORE `pickHandler` is consulted, so it never reaches
  `defaultHandler`. (`pickHandler`'s existing `loop → defaultHandler` fallthrough
  is simply never exercised for a loop node.)
- Modify `apps/web/src/workflows/components/node-types/loop-node.tsx` — render
  `loop` + `done` handles.
- Modify `apps/web/src/workflows/components/node-forms/loop-form.tsx` — add a
  `batchSize` field (items mode, default 1).
- Modify `apps/web/src/workflows/constants.ts` — add `'loop'` to
  `IMPLEMENTED_TEMPLATE_IDS`; ensure the loop palette default seeds `loopMode`,
  `iterations`, and `batchSize`.
- Modify `packages/config/src/schema.ts` — `WORKFLOW_LOOP_MAX_ITEMS`.

## Error handling

- Malformed loop (no body / body escapes to main flow) → descriptive error.
- Body node throws → loop fails; runner stops (unchanged).
- Accumulation exceeds `loopMaxItems` → error.
- `done` unwired → no error; nothing emitted downstream.

## Testing

**Pure-engine (`engine/loop.test.ts` + `run-workflow.test.ts`):**
- `computeLoopBody`: correct region for a clean body; malformed (escaping body)
  → error; empty body → error.
- `planIterations`: count clamp `[1,1000]`; items batching incl. remainder batch;
  zero items → zero iterations.
- count mode: N iterations, accumulation of body terminal items.
- items mode: batchSize 1 and >1; `$index`/`$item` correct per iteration.
- `done` accumulation + cap (`loopMaxItems` small → throws).
- iteration isolation: iteration `i` outputs don't leak into `i+1`.
- nested loop: inner `$index` shadows outer; both resolve.
- body-failure propagation: a throwing body node fails the loop.
- `done` unwired → loop runs, emits nothing.

**Template (`template.test.ts`):** `$index` / `$item` / `$item.path` resolution
with a `loopVars` stack; empty stack → empty string.

**Web:** loop node renders two handles (`loop`/`done`); palette enablement;
`loop-form` batchSize field (items mode only); isolated tests.

**Config (`schema.test.ts`):** `WORKFLOW_LOOP_MAX_ITEMS` default + override.

**Gate (cross-package — config + RunWorkflowOptions ripple):**
`pnpm -C packages/config exec tsc` + tests, `pnpm -C packages/workflows exec tsc`
+ tests, `pnpm -C packages/bootstrap exec tsc`, `pnpm -C apps/server exec tsc`,
`pnpm -C apps/web exec tsc` + isolated tests.

## Decisions (resolved during brainstorming)

- Execution model: **acyclic body re-execution** (no back-edge); the body is a
  DAG dominated by the loop node, re-run by the loop node.
- `done` emits the **accumulation of every iteration's body terminal items**
  (capped).
- items mode uses a **configurable `batchSize`** (default 1); `$index` = batch
  number; `$item` = the batch's first item's json (use `$items`/`$input` for the
  full batch).
- Malformed loop (escaping body / empty body) = **strict hard error**.
- The accumulation cap is a **config knob** `WORKFLOW_LOOP_MAX_ITEMS`
  (default 100_000), threaded like `codeLimits`.
