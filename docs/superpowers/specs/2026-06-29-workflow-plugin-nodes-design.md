# Plugin-contributed Workflow Nodes — Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete); implementation deferred to fresh sessions, per sub-project.
- **Owner:** Fredrick
- **Related:** [[workflow-builder-workstream]], [[marketplace-extensibility-vnext]] (SP-A plugin-contributed surfaces), [[dhis2-sink-plugin-workstream]]

## Problem

Countries doing WHONET → AMR → DHIS2 (and similar lab-data → national-HMIS) integrations today write a swarm of small bespoke Node.js ETL apps: read from a source (WHONET file, lab DB), transform/aggregate, push to DHIS2. Each is hand-built, unversioned, and unmaintained.

OpenLDR already has a **Workflow Builder** (n8n-style canvas, triggers, run history) and the pieces to do this — but its nodes are **host-built and hardcoded** ([packages/workflows/src/engine/node-handlers/](../../../packages/workflows/src/engine/node-handlers/)): `sql`, `fhir`, `http`, `load-dataset` (sources); `code`, `filter`, `if`, `set`, `merge`, `log` (processing); `dhis2-push`, `export`, `materialize` (sinks). The `dhis2-push` sink already pushes live to DHIS2 (proven end-to-end 2026-06-29). But a new integration still needs **host code merged** — the same "bespoke app" problem, just relocated into the monorepo.

**Goal:** make a plugin able to *contribute* workflow nodes — drop in a plugin, get nodes — so a workflow like `whonet-source → processing → dhis2-sink` is built by wiring nodes, with no host changes. Replace the bespoke-app pattern with versioned, signed, capability-scoped plugins on a visual canvas.

## Goals / Non-goals

**Goals**
- A plugin declares one or more workflow nodes in its manifest; the builder shows them automatically.
- Both source archetypes: **converter sources** (bytes/file → items, e.g. `whonet-sqlite`, `tabular`/CSV, `hl7v2`) and **reader sources** (store/report → items).
- Sink nodes (e.g. `dhis2-sink` aggregate push) and, eventually, transform nodes.
- Node permissions reuse the **existing marketplace capability system**, enforced at workflow-run time (egress kill-switch, connector resolution, consent) exactly as the broker enforces them.
- Node config is a **declarative schema + dynamic option sources** rendered by the builder — no per-node UI code in v1.
- Migrate the hardcoded `dhis2-push` node to a plugin-contributed node; whonet/tabular/hl7v2 become source nodes.

**Non-goals (v1)**
- Plugin-contributed *iframe* config UI (the SP-A1 webview). Deferred; declarative forms cover v1. Re-evaluate for the rich DHIS2 column→dataElement mapping editor.
- Strict port type system. Wire payloads are untyped n8n-style items (JSON + optional binary); any output may connect to any input; validation is at run time.
- Streaming/back-pressure between nodes. Items pass as in-memory arrays (bounded by existing limits), as today.
- Moving ingestion wholesale into workflows. Ingestion (`pnpm openldr ingest`) stays; converter *source nodes* are an additional way to run a converter, not a replacement.

## Key decisions (from brainstorm 2026-06-29)

1. **Target:** generic plugin-contributed nodes (not a one-off WHONET→DHIS2 pipeline).
2. **Source semantics:** support both converter sources (bytes→items) and reader sources (store→items). Each converter plugin (`whonet-sqlite`=dedicated WHONET, `tabular`=generic CSV, `hl7v2`) is its own node.
3. **Wire format:** n8n-style **items** — an array of `{ json: object, binary?: Record<string, BinaryRef> }`. JSON by default; binary lane for file readers/writers.
4. **Permissions:** reuse existing marketplace capabilities; the workflow engine enforces the same grants/policy/kill-switches the broker uses. No parallel permission model.
5. **Config UI:** declarative schema + dynamic option sources (select options populated by host endpoints: list connectors / mappings / reports). No iframe in v1.

## Architecture (Approach ①: manifest-declared nodes + one generic engine handler)

```
 Plugin manifest  ──(workflowNodes[])──►  Node Registry  ──(list API)──►  Builder palette + declarative config forms
 (signed)                                  (host nodes +                    (web)
                                            plugin nodes)
                                                │
 Workflow run ──► engine ──► generic `plugin-node` handler ──► resolve plugin (loadSink)
                                                              ──► enforce declared capabilities (broker logic reused)
                                                              ──► resolve config (e.g. decrypt connector)
                                                              ──► invoke wasm entrypoint(items, config) via Extism runner
                                                                  (worker path when egress/ net-egress)
                                                              ──► map wasm output → items
```

Chosen because it maximizes reuse — the Extism runner, `loadSink`, capability enforcement, connector store, and the existing node-handler registry all already exist — and keeps plugins pure wasm + manifest, with **zero host code per new plugin**. (Rejected: ② broker-RPC nodes — broker is request-scoped to a UI principal, awkward headless and for row volumes; ③ host-registered adapter per plugin — no genericity, the status quo we're trying to kill.)

### The node-contribution ABI (manifest `workflowNodes[]`)

Each entry (all fields signed as part of the artifact, like existing manifest fields):

```jsonc
{
  "id": "dhis2.aggregate-push",          // unique within the plugin; registry id = `${pluginId}:${node.id}`
  "label": "DHIS2 Aggregate Push",
  "kind": "sink",                         // "source" | "transform" | "sink"
  "description": "Push rows to DHIS2 as an aggregate dataValueSet.",
  "entrypoint": "wf_push_aggregate",      // wasm export invoked per run (∈ manifest.entrypoints)
  "ports": {
    "inputs":  [{ "name": "in",  "binary": false }],   // [] for a pure source
    "outputs": [{ "name": "out", "binary": false }]    // [] or a result port for a sink
  },
  "capabilities": ["net-egress", "host:connectors"],   // MUST be a subset of the plugin's granted capabilities
  "config": [
    { "key": "connectorId", "label": "Connector", "type": "select", "optionsSource": "connectors", "required": true },
    { "key": "mappingId",   "label": "Mapping",   "type": "select", "optionsSource": "dhis2-mappings", "required": true },
    { "key": "period",      "label": "Period",    "type": "text",   "required": true },
    { "key": "dryRun",      "label": "Dry run",   "type": "boolean", "default": false }
  ]
}
```

- **`kind`** drives palette grouping and validation (a `source` must have empty `inputs`; a `sink` typically has empty/`result` `outputs`).
- **`config[]`** field types (v1): `text`, `number`, `boolean`, `select`, `multiselect`, `file` (binary). `select`/`multiselect` use either static `options` or a **`optionsSource`** key the host resolves dynamically (`connectors`, `dhis2-mappings`, `reports`, `report-columns`, …). Dynamic sources are a host-owned registry of resolver functions (reusing existing stores), NOT arbitrary plugin callbacks.
- **`capabilities[]`** must be a subset of the plugin's granted capabilities (`readGrant`); the engine fail-closes if a node declares a capability the plugin wasn't granted.

### Wire format (items)

```ts
interface WorkflowItem { json: Record<string, unknown>; binary?: Record<string, BinaryRef>; }
interface BinaryRef { objectKey: string; contentType: string; fileName?: string; byteSize: number; } // blob-backed
```

The existing host nodes operate on `{ columns, rows }` datasets; v1 adapts at the boundary: a node-handler shim converts `rows[]` ↔ `items[]` (`{ json: row }`) so plugin nodes and host nodes interoperate without rewriting every host node. Binary payloads live in blob storage (reusing `ctx.blob`); items carry a `BinaryRef`, not bytes, to bound memory.

### Execution model (generic `plugin-node` handler)

A single new handler registered for the synthetic node type `plugin-node` (the saved node carries `pluginId`, `nodeId`, and `config`). Per run it:
1. Looks up the node in the registry; rejects if the plugin is missing/disabled or the node id is unknown.
2. **Enforces capabilities** by reusing the broker's logic (`policyAllows`, `readGrant`, the egress kill-switch, role checks where relevant) — factored into a shared `assertNodeAllowed(node, plugin, policy)` so the broker and the engine share one implementation.
3. **Resolves config** server-side: e.g. `connectorId` → `connectorStore.getDecryptedConfig` + pinned `allowedHost`; `mappingId` → plugin-data mapping doc. Secrets never enter the wasm config except the resolved connector config (as today for `createPluginTarget`).
4. **Invokes the wasm entrypoint** via the existing Extism runner / `loadSink`, passing `{ items, config }`. Egress-bearing nodes (declared `net-egress`) use the **worker path** with the pinned `allowedHosts` (the only path that does HTTP — see [extism-runner](../../../packages/plugins/src/extism-runner.ts)); non-egress nodes run foreground.
5. Maps the wasm result back to `items[]` and emits `node:success`/`node:error` (existing run-history events). Crash capture: the in-flight registry stamp ([crash-log](../../../packages/core/src/crash-log.ts)) already names the plugin if a worker takes the process down mid-run.

The migration target: `dhis2-sink` gains a `workflowNodes` entry whose `wf_push_aggregate` entrypoint accepts `{ items, config }` and reuses its existing aggregate build/push logic; the host `dhis2-push` handler + `WorkflowServices.dhis2Push` are retired once parity is verified.

### Permissions / capability model

Reuse `@openldr/marketplace` capabilities verbatim. A node's `capabilities[]` is the union of host services it touches; the engine enforces them with the **same** checks as the broker:
- Plugin installed + enabled.
- Global policy / kill-switches (`policyAllows`, `PLUGIN_EGRESS_ENABLED` for egress nodes).
- Capability grant (`readGrant`; legacy grandfathered as today).
- Connector resolution + consent unchanged (decrypt is host-side; the wasm only sees the resolved connector config + the pinned egress host).

This is the SP-A capability story applied to the workflow surface — one capability system across UI, broker, and workflows.

### Config UI (declarative)

The builder fetches the node registry (host + plugin nodes) and renders:
- The **palette**, grouped by `kind`, with plugin nodes badged by source plugin.
- A **config form** per node from `config[]`, with `optionsSource` selects populated via host endpoints (`/api/workflows/node-options/:source?...`) that wrap existing stores (connectors, dhis2 mappings, reports). Mappings continue to be authored in Settings ▸ DHIS2; the node just references one by id.

## Decomposition (sub-projects — each its own spec → plan → build)

Build order (later depends on earlier):

- **SP-1 — Node ABI + registry + list API** *(detailed below; the natural first build)*
  Manifest `workflowNodes[]` schema + validation; host **node registry** (host-built nodes + scanned plugin nodes); `GET /api/workflows/nodes` (+ `node-options/:source`); no execution yet.
- **SP-2 — Generic execution handler**
  The `plugin-node` engine handler: capability enforcement (shared `assertNodeAllowed`), config resolution (connector decrypt, mapping lookup), wasm invoke via Extism runner (foreground/worker), items mapping, run-history events.
- **SP-3 — Builder integration**
  Palette from the registry; declarative config-form renderer + `optionsSource` wiring; save/load `plugin-node` nodes; `rows[]↔items[]` boundary shim for host-node interop.
- **SP-4 — Binary / file lane**
  `BinaryRef` (blob-backed) items; file-input config field; converter source nodes consuming bytes; file-writer sinks. File arrival via upload/trigger/blob path.
- **SP-5 — Migrate real plugins**
  `dhis2-sink` contributes its aggregate-push sink node (`wf_push_aggregate`, `{items,config}` ABI) reusing existing build/push; `whonet-sqlite`/`tabular`/`hl7v2` contribute source nodes; retire the hardcoded `dhis2-push` node + `WorkflowServices.dhis2Push`. Live e2e: `whonet-sqlite (file) → code (aggregate) → dhis2-sink` produces the same DHIS2 dataValues as the host path proved on 2026-06-29.

## SP-1 in detail — Node ABI + registry + list API

**Scope:** the contribution surface and discovery only. No execution, no builder changes, no plugin migration. Ends with: a plugin manifest can declare nodes, the host validates + aggregates them into a registry, and an API lists host + plugin nodes. Pure additive; nothing existing changes behavior.

**Deliverables**
1. **Manifest schema** (`packages/plugins/src/manifest.ts`): add optional `workflowNodes?: WorkflowNodeDecl[]`. Zod schema for `WorkflowNodeDecl` (id, label, kind, description?, entrypoint, ports, capabilities[], config[] with the v1 field types + `optionsSource`). Defaults keep every existing manifest byte-identical (absent = no nodes); signing still verifies raw pre-zod bytes. Mirror the change in the artifact adapters (`pluginManifestToArtifact`/`artifactToPluginManifest`) like `pluginKind`/`entrypoints` were handled in the sink-plugin work.
2. **Registry** (new, `packages/bootstrap` or `packages/workflows`): `createWorkflowNodeRegistry({ plugins, hostNodes })` → `list(): WorkflowNodeDescriptor[]` merging the built-in host node descriptors with `workflowNodes` scanned from installed+enabled plugins. Registry id = `${pluginId}:${node.id}`. Validation: `node.capabilities ⊆ readGrant(plugin)`; `kind`↔ports invariants; duplicate-id rejection. Validation failures are logged + the node is dropped (never crash discovery).
3. **Host-node descriptors:** describe the existing built-in nodes (`sql`, `code`, `dhis2-push`, …) in the same `WorkflowNodeDescriptor` shape so the registry is uniform (the builder will later render both from one list). No behavior change to the handlers.
4. **List API** (`apps/server`): `GET /api/workflows/nodes` → `{ nodes: WorkflowNodeDescriptor[] }` (auth as other workflow routes). Stub `GET /api/workflows/node-options/:source` returning `[]` for unknown sources (real resolvers land in SP-3) so the contract exists.
5. **Types** exported from `@openldr/workflows` (`WorkflowNodeDecl`, `WorkflowNodeDescriptor`, config-field types) for web + server reuse.

**Testing (TDD)**
- Manifest: valid `workflowNodes` parse; absent field = `undefined`; invalid kind/port/config rejected; a node declaring an un-granted capability is rejected by the registry (not the manifest parser).
- Registry: merges host + plugin nodes; drops invalid nodes with a logged reason; disabled/missing plugin contributes nothing; composite id format; duplicate id handling.
- Artifact adapters: round-trip `workflowNodes` through `pluginManifestToArtifact`/back; existing signed source/sink artifacts stay byte-identical (no `workflowNodes` ⇒ field absent).
- Route: `GET /api/workflows/nodes` returns host + (fixture) plugin nodes; `node-options/:source` stub shape.

**Acceptance:** install a fixture plugin declaring one source + one sink node → `GET /api/workflows/nodes` lists them alongside the host nodes with correct kind/ports/config/capabilities; full gate green (`pnpm turbo run typecheck`, `pnpm depcruise`, plugins+workflows+server vitest); nothing in the existing builder or runs changes.

## Security considerations

- **Capability subset invariant**: a node can never exceed its plugin's grant (`capabilities ⊆ readGrant`), enforced at registry build *and* execution.
- **Egress** stays on the pinned-host worker path; the egress kill-switch (`PLUGIN_EGRESS_ENABLED`) gates egress nodes globally.
- **Secrets**: connector decryption is host-side; wasm only receives the resolved connector config + pinned host (as `createPluginTarget` does today). Redacted host-op errors get the broker's correlation-id treatment.
- **Signing**: `workflowNodes` is part of the signed manifest; a tampered node declaration fails signature verification.
- **Discovery is fail-soft**: an invalid node declaration is dropped + logged, never crashes node listing or a run.

## Open questions (resolve per sub-project, not blocking SP-1)

- SP-2: exact `{ items, config }` wasm ABI envelope + how converter entrypoints (`convert`) vs sink entrypoints (`push_aggregate`) are normalized under one `entrypoint` convention.
- SP-3: whether host nodes are re-skinned from the registry immediately or only plugin nodes render from it initially.
- SP-4: file arrival (upload widget vs trigger payload vs watched blob path) and binary size caps.
- SP-5: keep `dhis2-push` host node as a deprecated alias for one release vs hard cutover.

## Testing strategy (umbrella)

Each sub-project: TDD on pure units (manifest/registry/handler logic), integration tests with a fixture plugin, and an end-to-end gate. SP-5 closes with a live `whonet → process → dhis2` workflow run matching the 2026-06-29 host-path dataValues.
