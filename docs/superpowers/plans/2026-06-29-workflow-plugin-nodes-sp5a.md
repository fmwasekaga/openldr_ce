# Plugin-contributed Workflow Nodes — SP-5a (Migrate dhis2-sink to a Workflow Node) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make dhis2-sink a generic, items-driven `dhis2-sink:push` workflow node (mapping denormalized into config via a generic `detailSource` resolve-on-select) and retire the bespoke host `dhis2-push` path.

**Architecture:** A new wasm `wf_push` entrypoint consumes `{items, config:{mapping,orgUnitMap,period,dryRun}}`, reuses the plugin's existing aggregate/tracker build+push core, and the generic `runPluginNode` resolves only the connector. The builder denormalizes the picked mapping into config. The host `dhis2-push` handler / `WorkflowServices.dhis2Push` / `buildDhis2PushService` / web form / host-node descriptor are deleted; `dhis2Orch` + the DHIS2 plugin UI stay.

**Tech Stack:** Rust + wasm32-wasip1 (Extism PDK), TypeScript, Fastify, Vitest, React 18, pnpm/turbo, dependency-cruiser.

**Commits:** Work stays **uncommitted** by convention — do **NOT** `git commit`/`git push`. Each task ends with a verification step.

> **Web flake:** run web tests isolated. **Rust:** `cargo 1.96` + `wasm32-wasip1` are installed. **Mid-refactor note:** Task 7 (retirement) removes `WorkflowServices.dhis2Push` + the host handler; do it as ONE task so the gate is consistent.

---

## File Structure

- `packages/marketplace/src/workflow-node.ts` (+test) — `detailSource` on the config-field schema.
- `wasm/dhis2-sink/src/lib.rs` + `types.rs` (+ Rust tests) — `wf_push` envelope entrypoint.
- `scripts/build-dhis2-sink.mjs` — manifest `entrypoints` + `workflowNodes`; rebuild.
- `packages/plugins/src/dhis2-wf-push.integration.test.ts` (new) — real-Extism `wf_push`.
- `apps/server/src/workflows-node-options.ts` + `workflows-routes.ts` (+test) — `resolveNodeDetail` + `GET /api/workflows/node-detail/:source`.
- `apps/web/src/api.ts` — `fetchNodeDetail`; `apps/web/.../node-forms/plugin-node-form.tsx` (+test) — detailSource merge.
- **Delete/unwire (Task 7):** `packages/workflows/src/engine/node-handlers/dhis2-push.ts` + registration; `host-nodes.ts` `dhis2-push` descriptor; `packages/bootstrap/src/dhis2-push-service.ts` + the `workflowServices.dhis2Push` assignment + the `WorkflowServices.dhis2Push` type; `apps/web/.../node-forms/dhis2-push-form.tsx` (+test) + `pickForm`/`FORMS`/`constants.ts`/`IMPLEMENTED_TEMPLATE_IDS`.

---

## Task 1: `detailSource` on the config-field schema

**Files:** Modify `packages/marketplace/src/workflow-node.ts` + `workflow-node.test.ts`.

- [ ] **Step 1: Write the failing test** — append:
```ts
it('accepts a detailSource on a config field', () => {
  const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'sink', entrypoint: 'wf_push',
    config: [{ key: 'mappingId', label: 'Mapping', type: 'select', optionsSource: 'dhis2-mappings', detailSource: 'dhis2-mapping' }] });
  expect(d.config[0].detailSource).toBe('dhis2-mapping');
});
it('defaults detailSource to undefined', () => {
  const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'sink', entrypoint: 'e', config: [{ key: 'k', label: 'K', type: 'text' }] });
  expect(d.config[0].detailSource).toBeUndefined();
});
```

- [ ] **Step 2: Run → fail**: `pnpm -C packages/marketplace exec vitest run src/workflow-node.test.ts`.

- [ ] **Step 3: Implement** — in `workflowConfigFieldSchema`, add after `optionsSource`:
```ts
  /** For a select: a resolver name whose detail object is merged into the node config when a value
   *  is picked (build-time denormalization). See GET /api/workflows/node-detail/:source. */
  detailSource: z.string().min(1).optional(),
```

- [ ] **Step 4: Run → pass**: same command.

---

## Task 2: Rust `wf_push` envelope entrypoint

**Files:** Modify `wasm/dhis2-sink/src/lib.rs`, `wasm/dhis2-sink/src/types.rs` (+ Rust unit tests in the relevant module).

- [ ] **Step 1: Read the existing shapes** — read `types.rs` (`AggregatePushInput`, `TrackerPushInput`, `AggregatePushOutput`, the `rows`/`mapping`/`org_unit_map` field types + serde rename attrs) and `mapping.rs`/`tracker.rs` (`build_data_value_set`, `build_events` signatures). `wf_push` must reuse these exactly.

- [ ] **Step 2: Add the envelope input type** — in `types.rs`, add (matching the crate's serde conventions; `rows`/`org_unit_map` types mirror `AggregatePushInput`):
```rust
#[derive(serde::Deserialize)]
pub struct WfPushItem { pub json: serde_json::Value, #[serde(default)] pub binary: Option<serde_json::Value> }

#[derive(serde::Deserialize)]
pub struct WfPushConfig {
    pub mapping: serde_json::Value,
    #[serde(default, rename = "orgUnitMap")] pub org_unit_map: std::collections::HashMap<String, String>,
    #[serde(default)] pub period: String,
    #[serde(default, rename = "dryRun")] pub dry_run: bool,
}

#[derive(serde::Deserialize)]
pub struct WfPushInput { #[serde(default)] pub items: Vec<WfPushItem>, pub config: WfPushConfig }
```
> Note: the JSON `config` uses camelCase keys (`orgUnitMap`, `dryRun`) because the host forwards the workflow node config verbatim; match those with `rename`. The denormalized `mapping`/`orgUnitMap` come from the detail resolver (Task 5).

- [ ] **Step 3: Add `wf_push`** — in `lib.rs` `mod plugin`, after `push_tracker`. It extracts rows from items, dispatches on `mapping.kind`, reuses the existing build + `client::push_*`, returns `{ items, meta }` (items echoed back; the rows are read from item `.json`):
```rust
    /// Workflow-node ABI: { items, config:{mapping,orgUnitMap,period,dryRun} } -> push, returns { items, meta }.
    #[plugin_fn]
    pub fn wf_push(input: Vec<u8>) -> FnResult<String> {
        let env: WfPushInput = serde_json::from_slice(&input)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid wf_push input: {e}")), 1))?;
        let rows: Vec<Row> = env.items.iter()
            .map(|i| serde_json::from_value(i.json.clone()))
            .collect::<Result<_, _>>()
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid item row: {e}")), 1))?;
        let kind = env.config.mapping.get("kind").and_then(|v| v.as_str()).unwrap_or("aggregate");
        let items_echo: Vec<serde_json::Value> = env.items.iter()
            .map(|i| serde_json::json!({ "json": i.json, "binary": i.binary })).collect();

        if kind == "tracker" {
            let mapping: TrackerMapping = serde_json::from_value(env.config.mapping)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid tracker mapping: {e}")), 1))?;
            let (events, skipped) = tracker::build_events(&rows, &mapping, &env.config.org_unit_map);
            let payload = EventSetPayload { events };
            let result = if env.config.dry_run { None }
                else { Some(client::push_tracker(&serde_json::to_value(&payload)?).map_err(|e| WithReturnCode::new(e, 1))?) };
            let meta = json!({ "kind": "tracker", "events": payload.events.len(), "skipped": skipped.len(), "result": result });
            Ok(json!({ "items": items_echo, "meta": meta }).to_string())
        } else {
            let mapping: AggregateMapping = serde_json::from_value(env.config.mapping)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid aggregate mapping: {e}")), 1))?;
            let (data_values, skipped) = mapping::build_data_value_set(&rows, &mapping, &env.config.org_unit_map, &env.config.period);
            let payload = DataValueSetPayload { data_values };
            let result = if env.config.dry_run { None }
                else { Some(client::push_aggregate(&serde_json::to_value(&payload)?).map_err(|e| WithReturnCode::new(e, 1))?) };
            let meta = json!({ "kind": "aggregate", "dataValues": payload.data_values.len(), "skipped": skipped.len(), "result": result });
            Ok(json!({ "items": items_echo, "meta": meta }).to_string())
        }
    }
```
Adjust `Row`/`AggregateMapping`/`TrackerMapping`/`EventSetPayload`/`DataValueSetPayload` to the actual type names + imports from `types.rs` (read them in Step 1). Add any missing `use crate::types::*;` items.

- [ ] **Step 4: Host-side Rust unit test** — add a `#[cfg(test)]` test (host build, not wasm) exercising the envelope → build path for an aggregate mapping (reuse the existing mapping-test fixtures): a `WfPushInput` with 1 item + an aggregate mapping builds the expected dataValues via the same `build_data_value_set` the legacy path uses. (The push/client part is wasm-only; test only the build dispatch by factoring a small `wf_build(rows, config)` helper if the push is entangled — keep `client::push_*` behind `#[cfg(target_arch="wasm32")]`.)

- [ ] **Step 5: Build** — `cargo test -p dhis2-sink` (host tests) then `pnpm build:dhis2-sink` (wasm). Expect the staged sha line. (The manifest update is Task 3; rebuild again after.)

---

## Task 3: Manifest — `wf_push` entrypoint + `workflowNodes`

**Files:** Modify `scripts/build-dhis2-sink.mjs`.

- [ ] **Step 1: Add the entrypoint** — change the `entrypoints` array (line ~50):
```js
  entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker', 'wf_push'],
```

- [ ] **Step 2: Add the workflowNodes decl** — add a `workflowNodes` field to the `manifest` object (alongside `entrypoints`/`capabilities`):
```js
  workflowNodes: [
    {
      id: 'push', label: 'DHIS2 Push', kind: 'sink', entrypoint: 'wf_push', abi: 'items',
      capabilities: ['net-egress', 'host:connectors'],
      ports: { inputs: [{ name: 'in' }], outputs: [] },
      config: [
        { key: 'mappingId', label: 'Mapping', type: 'select', optionsSource: 'dhis2-mappings', detailSource: 'dhis2-mapping', required: true },
        { key: 'connectorId', label: 'Connector', type: 'select', optionsSource: 'connectors', required: true },
        { key: 'period', label: 'Period', type: 'text', required: true },
        { key: 'dryRun', label: 'Dry run', type: 'boolean' },
      ],
    },
  ],
```

- [ ] **Step 3: Rebuild + stage** — `pnpm build:dhis2-sink` → staged sha line. Confirm `reference-plugins/dhis2-sink/manifest.json` now lists `wf_push` + `workflowNodes` (one node).

---

## Task 4: Real-Extism `wf_push` integration test

**Files:** Create `packages/plugins/src/dhis2-wf-push.integration.test.ts`.

- [ ] **Step 1: Write the test** (mirror `dhis2-sink.integration.test.ts`; dry-run = no egress):
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({ id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker', 'wf_push'], wasmSha256: sha256Hex(wasm), wasi: true });
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
}

describe.skipIf(!present)('dhis2-sink wf_push through the real Extism runner (items envelope, dry-run)', () => {
  it('builds dataValues from items + mapping with no egress', async () => {
    const out = (await sink().invoke('wf_push', {
      items: [{ json: { facility: 'fac-1', tested: 4, r: 2 } }],
      config: {
        mapping: { orgUnitColumn: 'facility', columns: [
          { column: 'tested', dataElement: 'DE_TESTED' },
          { column: 'r', dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT' },
        ] },
        orgUnitMap: { 'fac-1': 'OU_AAA' }, period: '2026Q1', dryRun: true,
      },
    })) as { items: unknown[]; meta: { kind: string; dataValues: number; result: unknown } };
    expect(out.meta.kind).toBe('aggregate');
    expect(out.meta.dataValues).toBe(2);
    expect(out.meta.result).toBeNull();
    expect(out.items).toHaveLength(1);
  });
});
```
(Match the aggregate mapping shape to the crate's `AggregateMapping` — read `wasm/dhis2-sink/src/types.rs`; adjust `orgUnitColumn`/`columns` field names if they differ. The existing `dhis2-sink.integration.test.ts` `aggInput` is the reference shape.)

- [ ] **Step 2: Run → pass (not skipped)**: `pnpm -C packages/plugins exec vitest run src/dhis2-wf-push.integration.test.ts` → 1 RAN.

---

## Task 5: Server — `dhis2-mapping` detail resolver + route

**Files:** Modify `apps/server/src/workflows-node-options.ts`, `workflows-routes.ts`, `workflows-routes.test.ts`.

- [ ] **Step 1: Write the failing test** — in `workflows-routes.test.ts`:
```ts
it('GET /api/workflows/node-detail/dhis2-mapping returns {mapping,orgUnitMap} from plugin_data', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = USER; });
  const ctx = fakeCtx();
  ctx.pluginData.get = vi.fn().mockResolvedValue({ id: 'm1', definition: { orgUnitColumn: 'facility', columns: [] } });
  ctx.pluginData.list = vi.fn().mockResolvedValue([{ doc: { facilityId: 'fac-1', orgUnitId: 'OU_AAA' } }]);
  registerWorkflowRoutes(app, ctx);
  const res = await app.inject({ method: 'GET', url: '/api/workflows/node-detail/dhis2-mapping?value=m1' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ mapping: { orgUnitColumn: 'facility', columns: [] }, orgUnitMap: { 'fac-1': 'OU_AAA' } });
});
it('GET /api/workflows/node-detail/:source is role-gated (technician 403)', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
  registerWorkflowRoutes(app, fakeCtx());
  const res = await app.inject({ method: 'GET', url: '/api/workflows/node-detail/dhis2-mapping?value=m1' });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run → fail**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`.

- [ ] **Step 3: Implement the resolver** — in `workflows-node-options.ts`:
```ts
export interface NodeDetailDeps {
  /** Read the dhis2-sink mapping definition + org-unit map from plugin_data. */
  dhis2Mapping(value: string): Promise<{ mapping: unknown; orgUnitMap: Record<string, string> } | null>;
}
export async function resolveNodeDetail(source: string, value: string, deps: NodeDetailDeps): Promise<Record<string, unknown> | null> {
  try {
    if (source === 'dhis2-mapping') {
      const d = await deps.dhis2Mapping(value);
      return d ? { mapping: d.mapping, orgUnitMap: d.orgUnitMap } : null;
    }
    return null;
  } catch { return null; }
}
```

- [ ] **Step 4: Wire the route** — in `workflows-routes.ts`, add (MANAGE-gated):
```ts
  app.get('/api/workflows/node-detail/:source', MANAGE, async (req, reply) => {
    const { source } = req.params as { source: string };
    const value = String((req.query as { value?: string }).value ?? '');
    const detail = await resolveNodeDetail(source, value, {
      dhis2Mapping: async (id) => {
        const mDoc = (await ctx.pluginData.get('dhis2-sink', 'mappings', id)) as { definition?: unknown } | null;
        if (!mDoc?.definition) return null;
        const entries = await ctx.pluginData.list('dhis2-sink', 'orgUnitMaps');
        const orgUnitMap: Record<string, string> = {};
        for (const e of entries) {
          const d = e.doc as { facilityId?: string; orgUnitId?: string };
          if (typeof d.facilityId === 'string' && typeof d.orgUnitId === 'string') orgUnitMap[d.facilityId] = d.orgUnitId;
        }
        return { mapping: mDoc.definition, orgUnitMap };
      },
    });
    if (!detail) { reply.code(404); return { error: `no detail for ${source}/${value}` }; }
    return detail;
  });
```
Add `resolveNodeDetail` to the import from `./workflows-node-options`. (This is exactly `buildDhis2PushService`'s read logic — which Task 7 deletes.)

- [ ] **Step 5: Run → pass**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts` + `pnpm -C apps/server exec tsc --noEmit`.

---

## Task 6: Web — `fetchNodeDetail` + detailSource merge

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx` (+ test).

- [ ] **Step 1: api helper** — add to `api.ts` (+ `detailSource?: string` on `WorkflowNodeConfigField`):
```ts
export async function fetchNodeDetail(source: string, value: string): Promise<Record<string, unknown>> {
  const r = await authFetch(`/api/workflows/node-detail/${encodeURIComponent(source)}?value=${encodeURIComponent(value)}`);
  if (!r.ok) return {};
  return (await r.json()) as Record<string, unknown>;
}
```

- [ ] **Step 2: Write the failing test** — in `plugin-node-form.test.tsx`, a select field with `detailSource` merges the resolved detail into config on change. Mock `fetchNodeDetail` to return `{ mapping: { x: 1 }, orgUnitMap: { a: 'b' } }`; pick the option; assert `update` was called with config containing `mappingId`, `mapping`, and `orgUnitMap`.

- [ ] **Step 3: Implement** — in `PluginNodeForm`/`PluginField`, when a `select` field has `detailSource`, the onChange becomes async: set the value AND fetch + merge the detail:
```tsx
// in PluginField, for the select branch, when field.detailSource is set:
onChange={(e) => {
  const value = e.target.value;
  onChange(value);
  if (field.detailSource && value) {
    void fetchNodeDetail(field.detailSource, value).then((detail) => onChangeMerge(detail));
  }
}}
```
Thread an `onChangeMerge(detail: Record<string, unknown>)` from `PluginNodeForm` that does `update({ config: { ...config, ...detail } })` (spreads the resolved `{mapping,orgUnitMap}` into config alongside the already-set `mappingId`). Keep the plain `onChange(key, value)` for the id itself. (Import `fetchNodeDetail` from `@/api`.)

- [ ] **Step 4: Run → pass**: `pnpm -C apps/web test src/workflows/components/node-forms/plugin-node-form.test.tsx` + `pnpm -C apps/web exec tsc --noEmit`.

---

## Task 7: Retire the host dhis2-push path

**Files:** Delete/modify across workflows, bootstrap, web (do as ONE coherent task so the gate stays consistent).

- [ ] **Step 1: Engine** — delete `packages/workflows/src/engine/node-handlers/dhis2-push.ts` + its test; remove the `import { dhis2PushHandler }` and the `'dhis2-push': dhis2PushHandler` entry from `node-handlers/index.ts`; remove the `dhis2-push` object from `HOST_NODE_DESCRIPTORS` in `host-nodes.ts` (+ update `host-nodes.test.ts` count if it asserts a length).

- [ ] **Step 2: Services** — remove the optional `dhis2Push?` method from `WorkflowServices` (`engine/services.ts`) and its `RunPluginNodeInput`-adjacent types if any reference it; delete `packages/bootstrap/src/dhis2-push-service.ts`; remove the `import { buildDhis2PushService }` + the `workflowServices.dhis2Push = buildDhis2PushService(...)` line in `packages/bootstrap/src/index.ts`. (Keep `dhis2Orch`, `createPluginScheduleRunner`, and the broker wiring.)

- [ ] **Step 3: Web** — delete `apps/web/.../node-forms/dhis2-push-form.tsx` + `dhis2-push-form.test.tsx`; remove its `FORMS['dhis2-push']` entry + import in `node-forms/index.tsx`; remove the `node('dhis2-push', …)` catalog entry in `constants.ts` and `'dhis2-push'` from `IMPLEMENTED_TEMPLATE_IDS`.

- [ ] **Step 4: Sweep for dangling refs** — grep the repo for `dhis2Push`, `dhis2-push`, `buildDhis2PushService`, `dhis2PushHandler` and remove/adjust any remaining references (e.g. the workflows barrel, sink-handlers.test, sample workflows). The `/api/workflows/dhis2-mappings` route + `dhis2Orch` + `connectors.push` broker op + `createPluginScheduleRunner` STAY.

- [ ] **Step 5: Verify per-package**:
  - `pnpm -C packages/workflows exec vitest run` + `tsc --noEmit`
  - `pnpm -C packages/bootstrap exec vitest run` + `tsc --noEmit`
  - `pnpm -C apps/web exec tsc --noEmit`
  Expected: PASS with no dangling-reference type errors.

---

## Task 8: Full gate

- [ ] **Step 1: Typecheck (forced)**: `pnpm turbo run typecheck --force` → all PASS.
- [ ] **Step 2: Depcruise**: `pnpm depcruise` → 0 errors.
- [ ] **Step 3: Targeted suites**:
  - `pnpm -C packages/marketplace exec vitest run`
  - `cargo test -p dhis2-sink` (in `wasm/`)
  - `pnpm -C packages/plugins exec vitest run` (incl. real-Extism `dhis2-wf-push`)
  - `pnpm -C packages/workflows exec vitest run`
  - `pnpm -C packages/bootstrap exec vitest run`
  - `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`
  - `pnpm -C apps/web test src/workflows` (isolated)
  Expected: all PASS.
- [ ] **Step 4: Build (forced)**: `pnpm turbo run build --force` → PASS.
- [ ] **Step 5: Acceptance** — confirm: `dhis2-sink:push` is a manifest-contributed sink node; picking a mapping in the builder denormalizes `{mapping,orgUnitMap}` into config; `wf_push` builds dataValues from items+mapping through real Extism (dry-run, no egress); the host `dhis2-push` handler/`dhis2Push` service/web form/descriptor are gone with the gate green; `dhis2Orch` + the DHIS2 plugin UI are intact. **Deferred live e2e:** a `report/sql → dhis2-sink:push` workflow pushing to the Docker DHIS2 (extends `pnpm dhis2:accept`) — run at acceptance with the rebuilt+re-signed+re-installed plugin.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 `detailSource`; Task 2 `wf_push` (aggregate+tracker, reuse build core); Task 3 manifest decl; Task 4 real-Extism; Task 5 detail resolver + route; Task 6 web resolve-on-select; Task 7 host retirement; Task 8 gate + deferred live e2e.
- **Type consistency:** the node config keys (`mappingId`, `connectorId`, `period`, `dryRun`, + denormalized `mapping`/`orgUnitMap`) match the wasm `WfPushConfig` (camelCase via serde rename). `runPluginNode` is UNCHANGED (mapping is opaque config; connector resolved as today; `connectorId` stripped from wireConfig). `detailSource` flows schema → manifest decl → form.
- **Reuse, don't fork:** `wf_push` reuses `mapping::build_data_value_set` / `tracker::build_events` / `client::push_*`; the detail resolver reuses `buildDhis2PushService`'s exact plugin_data read (then that service is deleted).
- **Keep:** `dhis2Orch`, `/api/workflows/dhis2-mappings`, `connectors.*` broker ops, `createPluginScheduleRunner`, the DHIS2 plugin Settings UI.
- **Risk:** modifies the live-proven plugin + removes host code — the forced gate (no dangling refs) + the real-Extism test are the unit safety net; the live DHIS2 push is the deferred acceptance e2e.
