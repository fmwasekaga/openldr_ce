# Plugin-contributed Workflow Nodes — SP-3a (Engine Items Rewrite) Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete)
- **Owner:** Fredrick
- **Parent design:** [2026-06-29-workflow-plugin-nodes-design.md](2026-06-29-workflow-plugin-nodes-design.md) (SP-3). SP-3 is split into **SP-3a (this doc — engine items rewrite)** then **SP-3b (builder UI + optionsSource resolvers)**.
- **Depends on:** SP-2 (execution handler + `engine/items.ts` `WorkflowItem`/`toItems`/`fromItems`). Related: [[workflow-plugin-nodes-workstream]], [[workflow-builder-workstream]].

## Problem

After SP-2 a plugin node runs and emits the n8n-style `{ items }` envelope, but the host nodes still pass ad-hoc shapes between each other (`{columns,rows}`, bare arrays, `{result,branch}`, single objects). So a plugin node feeding a host sink (the north-star `whonet-source → process → dhis2-sink` chain) is not cleanly runnable: the sink can't read the plugin's items, and the template language (`{{ $input.foo }}`) assumes upstream is a single object.

SP-3a makes **`WorkflowItem[]` the single inter-node currency** across the whole engine: every handler consumes `WorkflowItem[]` and produces `WorkflowItem[]`, the runner merges and routes items, and the template/expression language is updated to the item model. This is a backend-only, regression-sensitive refactor gated by the engine test suite. No web, no new node, no optionsSource — those are SP-3b.

## Goals / Non-goals

**Goals**
- One wire format: `WorkflowItem[]` (`{ json, binary? }`) between every node.
- Convert all ~16 handlers (trigger, set, log, merge, if, filter, code, sql, fhir, http, materialize, export, dhis2-push, load-dataset, default, plugin-node) to consume/produce items.
- Runner feeds each node the concatenation of all ran upstream edges' items; branch routing moves off the data channel into `ctx.branches`.
- Template language clean break: `$input` = `WorkflowItem[]`; add `$json` (current/first item's json) + `$items` (all items' json). `$node('id')` returns that node's items.
- Update the seeded package `sampleWorkflow` templates to the new model.
- Every engine test updated to the items wire format — the suite is the regression gate.

**Non-goals (SP-3a)**
- Any `apps/web` change (palette, forms, ReactFlow `plugin-node` component, form placeholder hints, the web `lib/sample-workflow.ts`) — SP-3b.
- `optionsSource` resolvers / the real `node-options/:source` route — SP-3b.
- Per-item fan-out execution (running a node once per item, n8n-style). The engine keeps running each node **once** with the whole item array; per-item iteration stays a future concern.
- Binary lane semantics (`BinaryRef` bytes) — SP-4.

## Key decisions (brainstorm 2026-06-29)

1. **Full bidirectional rewrite** (chosen over the minimal "teach host sinks only" option): every handler speaks `WorkflowItem[]`.
2. **Template `$input` clean break** (chosen over a back-compat shim): `$input` becomes the item array; add `$json`/`$items`; update the sample workflow + (in SP-3b) form hints. Consistent with the Code node's `$input` = items.
3. **Branch off the data channel:** If/Filter write their decision to `ctx.branches[nodeId]`; the runner reads `ctx.branches` for edge-pruning instead of sniffing `output.branch`. `nodeOutputs[id]` is always a clean `WorkflowItem[]`.
4. **Runner merges all upstream items** (concatenation) instead of "first upstream that ran" — makes Merge correct and is a no-op for linear single-input flows.

## Architecture

### The wire format (already defined in SP-2)
```ts
interface WorkflowItem { json: Record<string, unknown>; binary?: Record<string, BinaryRef>; }
```
`engine/items.ts` already exports `WorkflowItem`, `BinaryRef`, `toItems`, `fromItems`. SP-3a adds one small helper:
```ts
/** rows → items (source convenience). */
export const rowsToItems = (rows: Record<string, unknown>[]): WorkflowItem[] => rows.map((json) => ({ json }));
```

### Handler signature
`engine/node-handlers/types.ts`:
```ts
export type NodeHandler = (node: RunnerNode, ctx: ExecutionContext, input: WorkflowItem[]) => Promise<WorkflowItem[]> | WorkflowItem[];
```
Every handler returns `WorkflowItem[]`. (The plugin-node handler returns `result.items`; its `meta`, if any, is emitted as a `node:log` line rather than riding the channel.)

### Runner (`run-workflow.ts`)
- `upstreamItemsFor(node, edges, nodeOutputs): WorkflowItem[]` — concatenate `nodeOutputs[source]` (each already `WorkflowItem[]`) for **every** incoming edge whose source has run and whose edge is not skipped. Single-input → that node's items; multi-input → concatenation (Merge relies on this).
- Feed `input` (items) to the handler; store the returned items in `nodeOutputs[node.id]`.
- **Branch pruning:** after a node runs, read `ctx.branches[node.id]` (set by If/Filter). For each outgoing edge whose `sourceHandle` differs from the chosen branch, add to `skippedEdges`. (Replaces the `node.type === 'condition' && output.branch` block.)
- `node:success` `input`/`output` now carry `WorkflowItem[]`; the run-history JSON view renders them unchanged.

### Execution context (`execution-context.ts`)
- `nodeOutputs: Record<string, WorkflowItem[]>`.
- Add `branches: Record<string, string>` (node id → chosen `sourceHandle`, e.g. `'true'`/`'false'`).
- `input` (trigger payload) stays `unknown` (raw external payload); the trigger handler wraps it into items.

### Template language (`template.ts`)
`resolveExpression(expr, ctx, input: WorkflowItem[])`:
- `$input` root → `input` (the `WorkflowItem[]`). `{{ $input }}` logs the array; `{{ $input.0.json.foo }}` indexes.
- `$json` root → `input[0]?.json` (the current/first item). `{{ $json.foo }}` is the common per-field accessor.
- `$items` root → `input.map((i) => i.json)` (array of jsons).
- `$node('id')` root → `ctx.nodeOutputs[id]` (that node's `WorkflowItem[]`).
- `readPath` unchanged (numeric segments already index arrays).
`resolveTemplate`/`resolveTemplatesDeep` third arg becomes `input: WorkflowItem[]`.

### Per-handler conversion

| Handler | In (items) → Out (items) |
|---|---|
| **trigger** | ignores input; `toItems(ctx.input)` when set, else one item `{json:{triggered,triggerType,timestamp}}`. |
| **set** | for each input item, build a new `json` from the configured fields (templates resolved with that item as `$json`); `keepExisting` spreads the item's json first. Returns one output item per input item (≥1; empty input → one item from a `{}` base, preserving today's "produce an object" behavior). |
| **log** | resolve `message` (with `$json`/`$input`), push the log line, return input items **unchanged** (passthrough). |
| **merge** | `append` → concat all incoming items (the runner already concatenates, so merge returns its input); `combine` → one item whose json is the deep-merge of all input items' json; `chooseBranch` → items from the preferred incoming branch. |
| **if** | evaluate condition (sandbox `$input`=items, `$json`=first item) → set `ctx.branches[id]='true'|'false'`; return input items unchanged (the chosen branch carries them). |
| **filter** | evaluate condition per item; return only passing items; set `ctx.branches[id]` = `'true'` if ≥1 passes else `'false'` (so a fully-empty filter still prunes its single `true` handle). |
| **code** | sandbox `$input` = items, `$node` returns items; `toItems(returnValue)` so the output is always items[]. |
| **sql / fhir / http / load-dataset** (sources) | call the service, take its `{columns,rows}`/rows, return `rowsToItems(rows)`. (`columns` is dropped from the channel; sinks re-derive columns from item json or carry them in `meta` later.) |
| **materialize / export** (sinks) | `const { columns, rows } = fromItems(input)` → existing service call; return input items unchanged (so a sink can be mid-chain). |
| **dhis2-push** (sink) | unchanged inputs path (reads mappingId/period from config, not items) but accepts items; returns input items unchanged. |
| **default** | passthrough: return input items unchanged. |
| **plugin-node** (SP-2) | unchanged delegation, but return `result.items` (not the `{items,meta}` envelope); emit `meta` as a `node:log` if present. |

### Sandbox (`sandbox.ts`)
`runInSandbox` `input` becomes `WorkflowItem[]`; the in-worker `$input` is the items array, `$node(id)` returns items. The handler `toItems`-normalizes the return value.

### Seeded sample (`packages/workflows/src/sample-workflow.ts`)
Update any `{{ $input… }}` templates to `{{ $json… }}` so the seeded sample reflects the new model. (The web `lib/sample-workflow.ts` + form placeholder hints are updated in SP-3b.)

## Testing strategy (TDD)

Every existing engine test is rewritten to the items wire format (this is the bulk of the work and the regression gate):
- **template.test**: `$input` = items[], `$json` = first item json, `$items` = jsons, `$node('id')` = items.
- **Each handler test**: feed `WorkflowItem[]`, assert `WorkflowItem[]` out. New assertions: set maps per item; filter drops failing items + sets branch; if sets `ctx.branches`; merge concat/combine; sources wrap rows; sinks call the service with `fromItems(input)` and pass items through; code returns `toItems(return)`.
- **run-workflow.test**: multi-input concatenation; branch pruning via `ctx.branches`; node outputs are items[]; a plugin-node → materialize chain (with a fake `runPluginNode`/`materializeDataset`) produces the sink call from the plugin's items (the north-star interop, unit-level).
- **items.test**: add `rowsToItems`.
- **Gate**: `pnpm turbo run typecheck --force`, `pnpm depcruise`, the workflows + bootstrap + server vitest suites (the server `workflows-routes` + bootstrap `plugin-node-service` exercise the engine), periodic `--force`. Known `@openldr/web` flake is irrelevant (no web change).

**Acceptance:** every node passes `WorkflowItem[]`; a plugin-node → host-sink chain runs end-to-end at the unit level (sink receives the plugin's items via `fromItems`); If/Filter branch-prune via `ctx.branches`; templates resolve `$json`/`$items`/`$input`/`$node`; the seeded sample still runs; full gate green. No `apps/web` files changed.

## Risks & mitigations

- **Template semantics break existing saved workflows' `{{ $input.foo }}`.** Accepted (chosen clean break); few exist (sample + hints). The seeded sample is updated here; web hints in SP-3b.
- **Branch-routing regression.** Covered by run-workflow tests asserting prune-by-`ctx.branches` for both If (two handles) and Filter (single handle, false → prune).
- **Multi-input concatenation changes behavior for any node that previously got "first upstream".** Only Merge and genuinely multi-input nodes are affected; linear flows unchanged. Run-workflow tests assert both.
- **Code node contract change** (`$input` = items). No production user code exists; the sandbox test updates.
- **Large diff.** Mitigated by per-handler TDD (one handler at a time, its test first) and the `--force` gate so cross-package type breaks can't hide behind turbo cache.

## Open questions (deferred)

- SP-3b: the web form hints + `lib/sample-workflow.ts` + the generic config-form renderer + the Plugins palette category + `optionsSource` resolvers (connectors/datasets/dhis2-mappings/fhir-resource-types) + the `plugin-node` ReactFlow component.
- Future: per-item fan-out execution; carrying `columns`/`meta` alongside items for richer sink rendering; binary lane (SP-4).
