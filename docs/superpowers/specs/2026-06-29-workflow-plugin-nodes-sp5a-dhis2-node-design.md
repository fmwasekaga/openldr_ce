# Plugin-contributed Workflow Nodes — SP-5a (Migrate dhis2-sink to a Workflow Node) Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete)
- **Owner:** Fredrick
- **Parent design:** [2026-06-29-workflow-plugin-nodes-design.md](2026-06-29-workflow-plugin-nodes-design.md) (SP-5). SP-5 = **SP-5a (this doc — dhis2-sink node + retire host path)** then SP-5b (converter source nodes).
- **Depends on:** SP-1..SP-4 (the whole generic node mechanism). Related: [[workflow-plugin-nodes-workstream]], [[dhis2-sink-plugin-workstream]].

## Problem

The dhis2-sink plugin already exists and pushes live to DHIS2, but it reaches workflows through a **bespoke host path**: a host `dhis2-push` engine node → `WorkflowServices.dhis2Push` → `buildDhis2PushService` → `dhis2Orch`, which is **report-driven** (the mapping names a report; the host runs it for rows and reads the mapping + orgUnitMap from the dhis2-sink `plugin_data`). This contradicts the workflow-builder model (data flows through the graph) and is exactly the per-plugin host code the whole workstream set out to delete.

SP-5a migrates dhis2-sink to a **generic, items-driven workflow node** (`dhis2-sink:push`) and retires the host path — proving the generic mechanism on the real, live-tested plugin.

## Goals / Non-goals

**Goals**
- A `dhis2-sink:push` workflow sink node, contributed via the plugin's signed manifest, that consumes **upstream items as the rows to push**.
- The mapping + orgUnitMap are **denormalized into the node config** at build time (a generic `detailSource` resolve-on-select), so the engine `runPluginNode` stays dhis2-agnostic (mapping is plain config; only the connector is host-resolved for egress).
- A wasm `wf_push` entrypoint that dispatches **aggregate + tracker** on `mapping.kind`, reusing the plugin's existing build+push logic.
- Retire the host path: the `dhis2-push` engine handler, `WorkflowServices.dhis2Push`, the `buildDhis2PushService` wiring, the web `dhis2-push-form`, and the `dhis2-push` `HOST_NODE_DESCRIPTORS` entry.
- Keep `dhis2Orch` + the `/api/workflows/dhis2-mappings` picker (still used by the DHIS2 plugin UI broker + the plugin schedule runner).

**Non-goals (SP-5a)**
- whonet/tabular/hl7v2 converter source nodes (SP-5b).
- Migrating existing saved workflows' old `dhis2-push` nodes (manual/data migration; out of scope — note for acceptance).
- Changing the DHIS2 plugin UI (Settings ▸ DHIS2 mappings/org-units/connectors) — unchanged; it still owns mapping authoring.
- Removing the deprecated wasm entrypoints (`push_aggregate`/`push_tracker`) — they stay for `dhis2Orch`/the plugin UI.

## Key decisions (brainstorm 2026-06-29)

1. **Items-driven** — the node pushes its upstream items as rows (north-star `source → process → dhis2-sink`), NOT the report-driven model.
2. **Mapping denormalized into config at build time** — keeps the engine generic; the mapping is config data by run time.
3. **Decompose** — SP-5a (dhis2 node + host retirement) now; SP-5b (converters) later.
4. **`wf_push` dispatches aggregate + tracker** so the host path is fully retired.
5. **Generic `detailSource` resolve-on-select** (reusable), not a dhis2 one-off.

## Architecture

### Data flow (run time)
```
[upstream node: report/sql/…] → items (WorkflowItem[]) →
 pluginNodeHandler('plugin-node', data={pluginId:'dhis2-sink', nodeId:'push', kind:'sink', config})
   → runPluginNode (generic, unchanged): resolve connectorId → decrypted connection + allowedHost (egress);
      invoke('wf_push', { items, config: {mapping, orgUnitMap, period, dryRun} }, { config: connConfig, allowedHosts })
   → wasm wf_push: rows = items.map(json); dispatch on mapping.kind;
      build dataValues/events (existing logic); push over HTTP using opts.config connection (unless dryRun);
      return { items: input, meta: <import summary> }
```
`runPluginNode` needs **no dhis2 knowledge** — `mapping`/`orgUnitMap` are opaque config it forwards; `connectorId` it already resolves; secrets/connection ride Extism `opts.config`.

### 1. Wasm `wf_push` (Rust, `wasm/dhis2-sink`)
A thin envelope entrypoint:
- Parse `{ items, config }`. `rows = items[].json`. `config = { mapping, orgUnitMap?, period, dryRun? }` (+ ignored `mappingId`).
- `mapping.kind === 'tracker'` → reuse the existing tracker build+push; else aggregate build+push. The existing `push_aggregate`/`push_tracker` internals (mapping.rs/tracker.rs) are factored so `wf_push` and the legacy entrypoints share the build+push core.
- HTTP push uses the Extism `config` (host-injected connector connection: baseUrl/username/password); `dryRun` skips egress.
- Return `{ "items": <input items unchanged>, "meta": { kind, dataValues|events, skipped, result? } }` (sink passes items through + reports the summary in meta → surfaces in run history via the SP-2 meta→log).
- Add `wf_push` to the manifest `entrypoints`.

### 2. Manifest `workflowNodes` decl (dhis2-sink)
```jsonc
workflowNodes: [{
  id: 'push', label: 'DHIS2 Push', kind: 'sink', entrypoint: 'wf_push', abi: 'items',
  capabilities: ['net-egress', 'host:connectors'],
  ports: { inputs: [{ name: 'in' }], outputs: [] },
  config: [
    { key: 'mappingId', label: 'Mapping', type: 'select', optionsSource: 'dhis2-mappings', detailSource: 'dhis2-mapping', required: true },
    { key: 'connectorId', label: 'Connector', type: 'select', optionsSource: 'connectors', required: true },
    { key: 'period', label: 'Period', type: 'text', required: true },
    { key: 'dryRun', label: 'Dry run', type: 'boolean' },
  ],
}]
```
The plugin bundle is re-packed + re-signed (existing dhis2-sink packaging) with the rebuilt wasm + this manifest, then re-installed into the local registry.

### 3. Generic `detailSource` resolve-on-select
- **Schema** (`@openldr/marketplace` `workflowConfigFieldSchema`): add `detailSource: z.string().optional()`. When set on a select, picking a value resolves an object that is merged into the node config.
- **Server** (`apps/server/src/workflows-node-options.ts` + a route): a `resolveNodeDetail(source, value, deps)` registry + `GET /api/workflows/node-detail/:source?value=<v>` (MANAGE). The `dhis2-mapping` resolver reads the dhis2-sink `plugin_data`: `mappings/<value>` → `definition`, `orgUnitMaps` → `{facilityId: orgUnitId}` map, returns `{ mapping, orgUnitMap }`. (This is exactly `buildDhis2PushService`'s read logic, relocated — so retiring that service loses nothing.)
- **Web** (`PluginNodeForm`): a select field with `detailSource`, on change, calls `fetchNodeDetail(detailSource, value)` and merges the returned object's keys into `config` (alongside the selected `mappingId`). Generic: the form spreads whatever the detail returns.
- **api.ts**: `fetchNodeDetail(source, value): Promise<Record<string, unknown>>`.

### 4. Host-path retirement
Delete / unwire:
- `packages/workflows/src/engine/node-handlers/dhis2-push.ts` + its `ACTION_HANDLERS['dhis2-push']` registration.
- `WorkflowServices.dhis2Push` (the optional method) + the `workflowServices.dhis2Push = buildDhis2PushService(...)` assignment in `packages/bootstrap/src/index.ts`.
- `packages/bootstrap/src/dhis2-push-service.ts` (`buildDhis2PushService`) — its mapping-read logic now lives in the `dhis2-mapping` detail resolver.
- The `dhis2-push` entry in `HOST_NODE_DESCRIPTORS` (`packages/workflows/src/host-nodes.ts`).
- `apps/web/.../node-forms/dhis2-push-form.tsx` (+ `.test.tsx`), its `pickForm`/`FORMS` wiring, the `dhis2-push` `constants.ts` catalog entry, and its `IMPLEMENTED_TEMPLATE_IDS` membership.
- The `/api/workflows/dhis2-mappings` route + `dhis2Orch` + the connector/DHIS2-plugin-UI broker path are **kept**.

### Data shapes (unchanged contracts)
`dhis2Orch.push` / `createPluginTarget` / the mapping types (`AggregateMapping`/`TrackerMapping`) are untouched; SP-5a only adds the items-envelope entrypoint and moves where the workflow node sources its rows/mapping.

## Components / files

**Modify:** `wasm/dhis2-sink/src/*` (+ Rust tests) — `wf_push`; the dhis2-sink manifest + pack/sign script — `workflowNodes` + entrypoints, re-pack/re-sign/re-install; `packages/marketplace/src/workflow-node.ts` (+test) — `detailSource`; `apps/server/src/workflows-node-options.ts` + `workflows-routes.ts` (+test) — detail resolver + route; `apps/web/src/api.ts` — `fetchNodeDetail`; `apps/web/.../node-forms/plugin-node-form.tsx` (+test) — detailSource merge. **Delete:** the host dhis2-push surface listed above. **New test:** `packages/plugins/src/dhis2-wf-push.integration.test.ts` (real Extism `wf_push`).

## Testing strategy

- **Rust:** `wf_push` unit tests (items→rows, aggregate+tracker dispatch, dryRun no-egress) reusing the existing mapping/tracker test fixtures.
- **Real Extism:** `wf_push` dry-run builds dataValues from items+mapping (no egress); a mock-DHIS2 server push imports (mirrors the existing `dhis2-sink.integration.test.ts`).
- **Server:** `GET /api/workflows/node-detail/dhis2-mapping?value=…` returns `{mapping, orgUnitMap}` from plugin_data; MANAGE-gated; unknown → 404/empty.
- **Web:** `PluginNodeForm` with a `detailSource` field merges the resolved detail into config on select; `fetchNodeDetail`.
- **Retirement:** the gate is green after deletion (no dangling imports of `dhis2Push`/`buildDhis2PushService`/`dhis2-push` handler/form/descriptor); `runPluginNode` drives `dhis2-sink:push` (fake sink) with a connector.
- **Gate:** `pnpm turbo run typecheck --force`, `pnpm depcruise`, the marketplace+plugins+workflows+bootstrap+server suites + web isolated; build `--force`. The dhis2-sink wasm rebuild + re-pack is part of the packaging step.

**Acceptance / live e2e (deferred):** a live `report/sql → dhis2-sink:push` workflow pushing to the Docker DHIS2 (extends `pnpm dhis2:accept`): connector resolved, items→dataValues, real worker-path push imported, read back. Verifies the generic node fully replaces the host path against a real server.

## Security considerations

- Egress + connector decrypt are unchanged (the proven SP-2 path: caps-subset + egress kill-switch + connector secrets only in Extism `opts.config`).
- The denormalized `mapping`/`orgUnitMap` in the node config are **non-secret** dhis2 metadata (data-element ids, org-unit ids) — safe to embed in the (manager-gated) workflow definition; no credentials.
- The detail resolver is MANAGE-gated and reads only the dhis2-sink plugin's own `plugin_data` (no cross-plugin access).
- Retiring `buildDhis2PushService` removes a host code path; `dhis2Orch` (the egress-gated push core used by the plugin UI) is retained and unchanged.

## Risks

- **Modifies the live-proven dhis2-sink Rust plugin** — mitigated by reusing the existing build+push core (wf_push is a thin envelope) + the real-Extism test + the deferred live e2e.
- **Removes working host code** — mitigated by the full forced gate (no dangling refs) + keeping `dhis2Orch`/the plugin UI intact.
- **Build-time mapping snapshot staleness** — the denormalized mapping is a snapshot; if the mapping changes the workflow must re-pick it. Acceptable (mappings are stable; re-pick is one click); noted for users.
- **Existing saved `dhis2-push` workflows break** — they must be re-created with `dhis2-sink:push` (manual; out of scope).

## Open questions (deferred)

- SP-5b: whonet/tabular/hl7v2 converter source nodes — item semantics (FHIR resources vs parsed rows), since the dhis2 path wants rows not FHIR.
- Future: a generic run-time detail-refresh (re-resolve the mapping at run rather than build-time snapshot); migrating existing saved workflows automatically.
