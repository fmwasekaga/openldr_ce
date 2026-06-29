# Plugin-contributed Workflow Nodes — SP-2 (Generic Execution Handler) Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete)
- **Owner:** Fredrick
- **Parent design:** [2026-06-29-workflow-plugin-nodes-design.md](2026-06-29-workflow-plugin-nodes-design.md) (SP-2 section)
- **Depends on:** SP-1 (Node ABI + registry + list API — DONE 2026-06-29). Related: [[workflow-builder-workstream]], [[dhis2-sink-plugin-workstream]], [[marketplace-extensibility-vnext]].

## Problem

SP-1 lets a plugin *declare* `workflowNodes[]` and the host lists them, but nothing **runs** them. SP-2 adds the single generic engine handler that executes a plugin-contributed node at workflow-run time: it resolves the plugin + node, enforces the declared capabilities exactly as the broker does, resolves config (decrypting a connector when one is referenced), invokes the wasm entrypoint via the existing Extism runner (foreground for no-egress, the worker path for pinned-host egress), and maps the result back into the workflow's item stream.

No builder changes, no binary/file lane, no real-plugin migration — those are SP-3/SP-4/SP-5. SP-2 is **purely additive**: the host `dhis2-push` node, `WorkflowServices.dhis2Push`, and every existing workflow run are untouched.

## Goals / Non-goals

**Goals**
- One generic `plugin-node` engine handler (node type `plugin-node`) that executes any plugin-contributed transform, sink, or reader-source node.
- A unified wasm ABI envelope: every node entrypoint takes `{ items, config }` and returns `{ items, meta? }`. `kind` is metadata, not a separate ABI.
- Capability enforcement at run time identical to the broker (`capabilities ⊆ readGrant`, global policy, egress kill-switch), factored into a shared `assertNodeAllowed`.
- Connector resolution + egress pinning host-side, reusing the connector store + the runner's worker-path egress (as `createPluginTarget` does). Secrets never enter the run-history-visible JSON input.
- A real `wf_echo` wasm fixture (in `wasm/test-sink`) proving the envelope end-to-end through the actual Extism runner.

**Non-goals (SP-2)**
- Builder palette / declarative config-form rendering / `optionsSource` resolvers (SP-3).
- The canonical, complete rows↔items shim that re-skins every host node (SP-3). SP-2 ships only the minimal `toItems`/`fromItems` needed to run.
- Binary/file lane (`BinaryRef` bytes), converter-from-bytes source nodes, file inputs (SP-4).
- Migrating the real `dhis2-sink` to a `wf_push_aggregate` workflow node or retiring the host `dhis2-push` handler / `WorkflowServices.dhis2Push` (SP-5).
- New host-data bridges into the wasm (e.g. plugin wasm reading the internal FHIR/report store). A "reader source" in SP-2 produces items from its `{items:[], config}` invocation (optionally egress-backed via a connector); it does not get a new host read capability.

## Key decisions (brainstorm 2026-06-29)

1. **ABI envelope:** unified `{items, config}` → `{items, meta?}` for every node entrypoint. `kind` (source/transform/sink) drives only input handling + palette, never the ABI. New `wf_*` entrypoint convention, distinct from the existing sink `push_aggregate` ABI (which stays for the host path until SP-5).
2. **Archetype scope this session:** transform + sink + reader-source nodes (all JSON-items). Converter/file sources (bytes→items) wait for SP-4.
3. **Test depth:** build a real `wf_echo` wasm fixture now and run it through real Extism (ABI proof), plus fast fake-`WasmSink` unit tests for the bootstrap orchestration.
4. **Execution location:** injected as an optional `WorkflowServices.runPluginNode`, implemented in `bootstrap` (mirrors `dhis2Push`). The engine stays free of `@openldr/plugins`/`bootstrap`.
5. **Secrets boundary:** decrypted connector connection map rides the Extism `opts.config`; the node's declarative config rides the JSON `input.config`. Secrets never appear in the JSON wire input (which is echoed into run history).

## Architecture

```
 [workflow run] engine walks graph → node.type === 'plugin-node'
        │
        ▼
 pluginNodeHandler (packages/workflows/src/engine/node-handlers/plugin-node.ts)
   • reads node.data: { pluginId, nodeId, kind, config }
   • items = kind === 'source' ? [] : toItems(upstreamOutput)
   • out = await ctx.services.runPluginNode({ pluginId, nodeId, config, items })   ← throws if service absent
   • returns out  (out.items become this node's output; downstream nodes consume via toItems)
        │
        ▼  (injected at bootstrap; engine has no plugin/bootstrap dep)
 createPluginNodeService (packages/bootstrap/src/plugin-node-service.ts) → runPluginNode(input):
   1. row = plugins.list().find(id === pluginId && enabled)            else throw "not installed/disabled"
   2. decl = readNodeDecls(row.manifest).find(d.id === nodeId)         else throw "unknown node"
   3. assertNodeAllowed(decl, row, policy())                           (caps ⊆ grant; policy; egress kill-switch)
   4. if decl.capabilities ∋ 'host:connectors' && config.connectorId:
          { config: connConfig, allowedHost } = connectors.getDecryptedConfig(config.connectorId)
      else connConfig = {}, allowedHost = null
   5. dryRun = Boolean(config.dryRun)
      allowedHosts = (decl.capabilities ∋ 'net-egress' && !dryRun && allowedHost) ? [allowedHost] : []
   6. sink = loadSink(pluginId)
      raw  = sink.invoke(decl.entrypoint, { items, config: stripConnectorId(config) },
                         { config: connConfig, allowedHosts })
   7. return normalizeResult(raw)   // { items: raw.items ?? [], meta: raw.meta }
```

### The ABI envelope (types)

```ts
// @openldr/workflows (engine) — the wire format
interface WorkflowItem { json: Record<string, unknown>; binary?: Record<string, BinaryRef>; }
interface BinaryRef { objectKey: string; contentType: string; fileName?: string; byteSize: number; } // SP-4 lane

// runPluginNode request / response (the host-side service contract)
interface RunPluginNodeInput  { pluginId: string; nodeId: string; config: Record<string, unknown>; items: WorkflowItem[]; }
interface RunPluginNodeOutput { items: WorkflowItem[]; meta?: Record<string, unknown>; }
```

- **JSON sent to wasm:** `{ items: WorkflowItem[], config: Record<string,unknown> }`. `config` is the node's declarative config (e.g. `period`, `dryRun`, `mappingId`) with `connectorId` removed (it has been resolved host-side; the wasm never needs the id).
- **Extism `opts.config`:** the resolved connector connection map (`baseUrl`, `username`, `password`, …) — host-only, never in the JSON input.
- **JSON returned by wasm:** `{ items?: WorkflowItem[], meta?: Record<string,unknown> }`. Missing `items` ⇒ `[]` (sinks). Invalid JSON ⇒ the existing `WasmSink.invoke` throws.

### Engine handler + minimal items boundary

`packages/workflows/src/engine/node-handlers/plugin-node.ts`:
- Registered in `pickHandler`/`TYPE_HANDLERS` for `node.type === 'plugin-node'`.
- Reads `node.data.{pluginId, nodeId, kind, config}` (the builder will persist these in SP-3; SP-2 defines the contract).
- `items = node.data.kind === 'source' ? [] : toItems(upstreamOutput)`.
- Calls `ctx.services?.runPluginNode`; if absent throws `plugin node execution is not available` (mirrors `dhis2PushHandler`).
- Returns the `{items, meta?}` output (becomes `ctx.nodeOutputs[node.id]`; downstream `toItems` re-normalizes).

`packages/workflows/src/engine/items.ts` — pure, tested helpers (SP-2 minimal; the canonical shim is SP-3):
- `toItems(upstream): WorkflowItem[]` — `WorkflowItem[]` pass-through (each element already `{json}`); `{columns, rows}` or `{rows}` → `rows.map(r => ({json:r}))`; a plain object-array → `.map(r => ({json:r}))`; `undefined`/`null` → `[]`; anything else → `[{ json: { value: upstream } }]`.
- `fromItems(items): { columns; rows }` — `rows = items.map(i => i.json)`; `columns` derived from the union of row keys. (Provided for downstream host-node interop; used where a plugin node feeds a host node.)

### `WorkflowServices` extension

```ts
// packages/workflows/src/engine/services.ts
runPluginNode?(input: RunPluginNodeInput): Promise<RunPluginNodeOutput>;
```
Optional (like `dhis2Push`) so pure-engine tests and the legacy paths stay valid.

### Shared `assertNodeAllowed`

`packages/bootstrap/src/plugin-node-policy.ts` (importable by both the broker and the node service):

```ts
function assertNodeAllowed(
  decl: { capabilities: string[] },
  row: { id: string; enabled: boolean; manifest: Record<string, unknown> },
  policy: PluginPolicy,
): void
```
- Row must be enabled (caller already filters; re-assert).
- `readGrant(row.manifest)`: legacy ⇒ allowed; else every `decl.capabilities` string must be a granted `.kind` (same `capsSubset` posture as the SP-1 registry and the broker).
- `policyAllows(policy, gate)` for each capability that maps to a host gate (`host:connectors`, etc.).
- Egress kill-switch: if `decl.capabilities ∋ 'net-egress'` and `!policy.egressEnabled` → throw (mirrors the broker's egress gate).
- Throws a precise, non-secret message on any failure (fail-closed).

The broker (`plugin-broker.ts`) keeps its per-op gating, but the capability-subset + egress-kill-switch logic is factored here so there is one implementation across registry/broker/engine.

### Bootstrap wiring

`createPluginNodeService({ plugins, connectors, policy, logger, audit? })` is constructed in `createAppContext` and assigned to `ctx.workflows.services.runPluginNode` and the trigger-runner's `deps.services`. Unlike `dhis2Push` (assigned late, after the DHIS2 context), `runPluginNode` depends only on the plugin runtime + connector store + policy, all available during normal services construction — so it is wired inline with the other workflow services.

- `plugins`: the `PluginRuntime` (`list()` + `loadSink()`), already on `AppContext`.
- `connectors`: `createConnectorStore(...)` with `getDecryptedConfig(id) → { config, allowedHost }` (already exists for `createPluginTarget`).
- `policy`: `() => PluginPolicy` (same source the broker uses).
- `audit?`: best-effort security-event sink (node execution = a sensitive op), never throws into the run.

### Real `wf_echo` wasm fixture

`wasm/test-sink/src/lib.rs` gains:

```rust
/// Workflow-node ABI echo: parse { items, config }, return { items, meta }.
#[plugin_fn]
pub fn wf_echo(input: Vec<u8>) -> FnResult<String> {
    let parsed: Value = if input.is_empty() { json!({}) }
        else { serde_json::from_slice(&input)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))? };
    let items = parsed.get("items").cloned().unwrap_or_else(|| json!([]));
    let config = parsed.get("config").cloned().unwrap_or_else(|| json!({}));
    let count = items.as_array().map(|a| a.len()).unwrap_or(0);
    Ok(json!({ "items": items, "meta": { "count": count, "config": config } }).to_string())
}
```

`scripts/build-test-sink.mjs`: add `wf_echo` to `entrypoints` and add a `workflowNodes` decl so the staged manifest exercises SP-1's schema too:

```js
entrypoints: ['health_check', 'push_aggregate', 'wf_echo'],
workflowNodes: [
  { id: 'echo', label: 'Echo', kind: 'transform', entrypoint: 'wf_echo',
    ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
    config: [{ key: 'note', label: 'Note', type: 'text' }] },
],
```

The plan **rebuilds** the fixture (`node scripts/build-test-sink.mjs`) so the integration test runs rather than skips.

## Components / files

**Create**
- `packages/workflows/src/engine/items.ts` (+ test) — `WorkflowItem`/`BinaryRef` types, `toItems`/`fromItems`.
- `packages/workflows/src/engine/node-handlers/plugin-node.ts` (+ test) — `pluginNodeHandler`.
- `packages/bootstrap/src/plugin-node-policy.ts` (+ test) — `assertNodeAllowed`, `capsSubset` (factored).
- `packages/bootstrap/src/plugin-node-service.ts` (+ test) — `createPluginNodeService`/`runPluginNode`.
- `packages/plugins/src/wf-echo.integration.test.ts` — `wf_echo` through real Extism (skip-if-absent).

**Modify**
- `packages/workflows/src/engine/services.ts` — add optional `runPluginNode` + the `RunPluginNodeInput/Output` types; export `WorkflowItem`/`BinaryRef`.
- `packages/workflows/src/engine/node-handlers/index.ts` — register `plugin-node` → `pluginNodeHandler`.
- `packages/workflows/src/index.ts` — export the new item/service types.
- `packages/bootstrap/src/index.ts` — construct `createPluginNodeService` + assign `ctx.workflows.services.runPluginNode` and the trigger-runner `deps.services`.
- `packages/bootstrap/src/plugin-broker.ts` — (optional, low-risk) reuse the factored `capsSubset`/egress check from `plugin-node-policy.ts` so there is a single implementation. If the refactor is non-trivial, leave the broker as-is and only share the helper from the new module (the broker behavior must not change).
- `wasm/test-sink/src/lib.rs`, `scripts/build-test-sink.mjs` — `wf_echo` entrypoint + manifest.

## Testing strategy (TDD)

- **`items.ts`:** `toItems` for each upstream shape (items pass-through, `{columns,rows}`, `{rows}`, object-array, undefined→[], scalar→wrapped); `fromItems` round-trip + column union.
- **`plugin-node.ts` handler:** source kind sends `items:[]`; transform sends `toItems(upstream)`; absent `ctx.services.runPluginNode` throws; output is returned verbatim; `nodeId`/`config`/`pluginId` forwarded correctly. (`runPluginNode` mocked.)
- **`plugin-node-policy.ts`:** allowed when caps ⊆ grant; legacy grandfathered; throws when a cap exceeds grant; throws when `net-egress` + kill-switch off; `policyAllows` gate respected.
- **`plugin-node-service.ts`** (fake `WasmSink` + fake `plugins.list`/`loadSink` + fake connector store):
  - unknown/disabled plugin → throw; unknown nodeId → throw.
  - no connector → `opts.config = {}`, `allowedHosts = []`, foreground; JSON input has no `connectorId`.
  - connector + `net-egress` + not dry-run → `getDecryptedConfig` called, `opts.config = connConfig`, `allowedHosts = [allowedHost]`.
  - dry-run → `allowedHosts = []` even with a connector (no egress).
  - secrets never appear in the JSON `input.config` (assert the object passed as `invoke`'s 2nd arg).
  - response normalization: missing `items` → `[]`; `meta` passed through.
- **Real wasm (`plugins`):** rebuild `test-sink`; `wf_echo` invoked with `{items:[{json:{a:1}}], config:{note:'x'}}` returns `{items:[{json:{a:1}}], meta:{count:1, config:{note:'x'}}}`. Asserts the test RAN (fixture present).
- **Gate:** `pnpm turbo run typecheck --force`, `pnpm depcruise`, and the workflows + bootstrap + plugins vitest suites; periodic `--force`. Known `@openldr/web` parallel flake is unrelated (no web change).

**Acceptance:** a `plugin-node` graph (manual trigger → `test-sink:echo` transform) runs through `runWorkflow` with a wired `runPluginNode` and produces the echoed items; capability/connector/egress orchestration is unit-proven; the `wf_echo` ABI is proven through real Extism; full gate green; the host `dhis2-push` node + existing runs are unchanged.

## Security considerations

- **Capability subset re-enforced at execution** (`assertNodeAllowed`), not just at SP-1 discovery — defense in depth.
- **Egress** stays on the pinned-host worker path; `net-egress` nodes are gated by `PLUGIN_EGRESS_ENABLED`; dry-run pins no host.
- **Secrets**: connector decryption is host-side; the decrypted map only ever enters Extism `opts.config`; the JSON `input.config` (echoed into run history) carries no secrets and not even the `connectorId`. Redacted, correlation-id'd errors for connector-bearing failures follow the broker's treatment.
- **Fail-closed**: unknown/disabled plugin, unknown node id, un-granted capability, or kill-switched egress all throw before any wasm runs.
- **Crash capture**: the wasm boundary stamp (`createWasmSink` → `beginOp`) already names the plugin/entrypoint if a worker takes the process down mid-run.

## Open questions (resolve in later sub-projects, not blocking SP-2)

- SP-3: exact saved-node `data` schema the builder writes (this spec assumes `{pluginId, nodeId, kind, config}`); the canonical rows↔items shim for all host nodes; `optionsSource` resolver endpoints.
- SP-4: `BinaryRef` blob plumbing + converter-from-bytes source entrypoint convention (does a converter reuse `wf_*({items,config})` with the file as a `BinaryRef` in `config`, or a distinct envelope?).
- SP-5: whether `dhis2-sink` exposes `wf_push_aggregate` reusing its existing aggregate builder, and the cutover/deprecation of the host `dhis2-push` node + `WorkflowServices.dhis2Push`.
