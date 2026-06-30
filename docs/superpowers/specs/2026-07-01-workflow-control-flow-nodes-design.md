# Workflow Engine Control-Flow Nodes — `wait` + `execute-workflow` (Slice G)

**Date:** 2026-07-01
**Status:** Approved design
**Workstream:** Workflow node palette — engine control-flow tier.

## Goal

Implement two of the three remaining "engine control-flow" placeholder nodes
whose builder UI already exists but which have no engine handler and are absent
from `IMPLEMENTED_TEMPLATE_IDS`:

- **`wait`** — pause the workflow for a bounded duration, then pass items through.
- **`execute-workflow`** — run another saved workflow as a sub-workflow, passing
  the upstream items as its trigger input and returning the sub-workflow's
  terminal items downstream.

The third control-flow node, **`loop`**, is **explicitly deferred** to its own
future slice: a true cyclic loop-body construct requires a rewrite of the
single-pass topological runner (back-edge support, a second "done" output
handle, loop-back edge) and warrants its own spec. This slice does not touch
`loop`.

## Non-goals (YAGNI)

- The `loop` node (separate slice).
- A durable detached-job queue for fire-and-forget sub-runs.
- Passing typed/structured sub-workflow parameters beyond the item stream.
- Any change to the runner's topological execution model.

## Context / current state

- The runner (`packages/workflows/src/engine/run-workflow.ts`) is a **single-pass
  topological executor**: each node runs exactly once; cycles are not
  expressible. Both nodes in this slice fit this model cleanly.
- Both `wait` and `execute-workflow` are `type: 'action'` palette entries
  (`apps/web/src/workflows/constants.ts`). The `node()` helper sets
  `data.action = id` for action nodes, so `pickHandler` already routes them to
  `ACTION_HANDLERS['wait']` / `ACTION_HANDLERS['execute-workflow']` — currently
  undefined, so they fall through to `defaultHandler` (passthrough).
- Bespoke builder forms already exist and are wired in `pickForm`:
  `node-forms/wait-form.tsx` (`{ duration, unit }`, UI hint "max 30s") and
  `node-forms/execute-workflow-form.tsx` (`{ workflowId, waitForCompletion }`).
- Service-backed nodes follow an established seam: a capability on
  `WorkflowServices` (`packages/workflows/src/engine/services.ts`), injected in
  `packages/bootstrap/src/index.ts`, guarded in the handler with a
  `'… requires server services'` throw when absent (keeps the pure engine and
  legacy paths working).
- The server already re-enters the runner via `runWorkflow(def.nodes, def.edges,
  …)` in `apps/server/src/workflows-routes.ts` (`/execute-stream`), and loads a
  workflow record via `ctx.workflows.store.get(id)` →
  `WorkflowDefinitionSchema.parse(workflow.definition)`. The sub-workflow service
  reuses exactly this path.

## Architecture

No runner changes. No canvas/handle changes. No new node descriptors (the forms
are bespoke, not declarative). The work is purely backend handlers + one new
host service + palette enablement, plus the cross-package `WorkflowServices`
type ripple.

### Component 1 — `wait` (pure-engine, no services)

- **Handler:** `packages/workflows/src/engine/node-handlers/wait.ts`.
  - Read `config.duration` (number) and `config.unit` (`'ms' | 's' | 'm'`,
    default `'s'`).
  - Convert to milliseconds; treat `NaN`/negative as `0`.
  - **Clamp to `[0, 30_000]` ms** (matches the form's "max 30s" hint;
    a longer configured value is capped, not rejected).
  - `await sleep(ms)` then return the **input items unchanged** (identity
    passthrough).
- **Wiring:** register `wait` in `ACTION_HANDLERS`
  (`node-handlers/index.ts`); add `'wait'` to `IMPLEMENTED_TEMPLATE_IDS`
  (`apps/web/src/workflows/constants.ts`).
- **Bootstrap/server impact:** none.

### Component 2 — `execute-workflow` (service-backed)

- **New `WorkflowServices` capability** (`engine/services.ts`):

  ```ts
  runSubWorkflow?(input: {
    workflowId: string;
    input: WorkflowItem[];
    callStack: string[];
  }): Promise<{ items: WorkflowItem[]; status: 'completed' | 'failed' }>;
  ```

  Optional (like every other host-injected capability) so pure-engine tests and
  legacy paths compile and run without it.

- **Bootstrap implementation** (`packages/bootstrap/src/index.ts`,
  `workflowServices.runSubWorkflow = …`):
  1. `const rec = await workflowStore.get(workflowId)` → throw
     `Execute Workflow: unknown workflow: <id>` if missing.
  2. `const def = WorkflowDefinitionSchema.parse(rec.definition)`.
  3. Re-enter the runner:
     `runWorkflow(def.nodes, def.edges, { input, services: workflowServices,
     codeLimits, logger, workflowId, callStack: [...callStack, workflowId] })`.
  4. If `result.status === 'failed'`, throw an `Error` carrying the first failing
     node's message.
  5. Compute **terminal items**: leaf nodes = nodes that are not the `source` of
     any edge in `def.edges`; concatenate the `output` arrays (which are
     `WorkflowItem[]`) of the successful leaf nodes from `result.results`.
  6. Return `{ items, status: result.status }`.

- **Recursion guard:** thread `callStack` through the runner so nested
  `execute-workflow` nodes inherit it.
  - Add `callStack?: string[]` to `RunWorkflowOptions`
    (`run-workflow.ts`), default `[]`.
  - Store it on the execution context: `createContext(...)` →
    `ctx.callStack` (`execution-context.ts`).
  - The handler reads `ctx.callStack` and passes it to the service.
  - The service rejects **before** recursing if:
    - `workflowId` is already present in `callStack` → cycle error
      (`Execute Workflow: cycle detected: <id>`), or
    - `callStack.length >= MAX_SUBWORKFLOW_DEPTH` (= **5**) → depth error
      (`Execute Workflow: max nesting depth (5) exceeded`).

- **Handler:** `packages/workflows/src/engine/node-handlers/execute-workflow.ts`.
  - Validate `config.workflowId` is a non-empty string → throw if missing.
  - Guard: if `!ctx.services?.runSubWorkflow`, throw
    `Execute Workflow requires server services`.
  - If `config.waitForCompletion === false`: log a note via `ctx` that
    fire-and-forget is not yet supported and the sub-workflow ran synchronously,
    then proceed to await normally (the flag is otherwise ignored for the MVP).
  - Call the service with `{ workflowId, input: items, callStack: ctx.callStack }`
    and return the returned `items` downstream.
- **Wiring:** register `execute-workflow` in `ACTION_HANDLERS`; add
  `'execute-workflow'` to `IMPLEMENTED_TEMPLATE_IDS`.

## Data flow

```
upstream items
   → execute-workflow handler
       → runSubWorkflow({ workflowId, input: items, callStack })
           → workflowStore.get → parse → runWorkflow(sub def, input)
               → sub-run executes (its trigger seeds `input` as items)
           → terminal items = concat of leaf-node outputs
       → returned items
   → downstream nodes
```

The implementation must verify the sub-workflow's **trigger handler wraps the
passed `input` (a `WorkflowItem[]`) into the trigger's emitted items** so the
sub-flow actually sees the parent's data. If the trigger handler's `input`
contract differs, adapt the mapping in the service (documented at implementation
time).

## Error handling

- `wait`: no failure modes beyond clamping (always succeeds).
- `execute-workflow`: missing `workflowId`, missing service, unknown workflow,
  cycle, depth-exceeded, and sub-run failure each throw a descriptive `Error`.
  These surface as a normal `node:error` event; the runner stops on the first
  failure exactly as it does today.

## Testing

- **`wait.test.ts`** (pure engine): ms/s/m conversion; 30s clamp; `NaN`/negative
  → `0`; identity passthrough of items. Use short or faked timers.
- **`execute-workflow.test.ts`** (pure engine, injected fake `runSubWorkflow`):
  returns terminal items downstream; missing-service guard throws;
  missing-`workflowId` throws; `waitForCompletion:false` logs the note and still
  awaits; service errors propagate.
- **Service-level test** (bootstrap, or a focused unit on the leaf-extraction +
  recursion helpers): unknown workflow throws; cycle and depth-limit guards
  fire; leaf-node terminal-items extraction is correct for a small multi-leaf
  graph; a failed sub-run throws.
- **Gate (must run all — the `WorkflowServices` change ripples cross-package,
  the recurring Slice C/D/F gate-miss):**
  - `pnpm -C packages/workflows exec tsc` + workflows tests,
  - `pnpm -C packages/bootstrap exec tsc`,
  - `pnpm -C apps/server exec tsc`,
  - `pnpm -C apps/web exec tsc` + web isolated tests (for the
    `IMPLEMENTED_TEMPLATE_IDS` change).

## Decisions (resolved during brainstorming)

- Scope: `wait` + `execute-workflow` now; `loop` is a separate future slice.
- `execute-workflow` output = the sub-workflow's **terminal (leaf-node) items**
  (concatenated when multiple leaves), so the result is chainable.
- `waitForCompletion=false` = **run inline, ignore the flag**, logging a note
  (no durable detached-job queue exists yet).
- `MAX_SUBWORKFLOW_DEPTH = 5`; terminal items defined as **leaf nodes (no
  outgoing edge)**, not the last topo node.
