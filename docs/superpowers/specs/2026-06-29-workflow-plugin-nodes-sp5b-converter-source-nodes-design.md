# Plugin-contributed Workflow Nodes — SP-5b (Converter Source Nodes: whonet/tabular/hl7v2) Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete)
- **Owner:** Fredrick
- **Parent design:** [2026-06-29-workflow-plugin-nodes-design.md](2026-06-29-workflow-plugin-nodes-design.md) (SP-5). SP-5 = SP-5a (dhis2-sink node + retire host path — DONE) then **SP-5b (this doc — converter source nodes)**.
- **Depends on:** SP-1..SP-4 (generic node mechanism), SP-4a (binary INPUT lane: `abi:'bytes'`, file trigger), SP-5a (the `wf_*`-envelope-reuses-core pattern + live-e2e harness). Related: [[workflow-plugin-nodes-workstream]].

## Problem

The plugin-contributed workflow-node mechanism is proven for a sink (`dhis2-sink:push`, SP-5a) and a toy converter (`test-sink` `wf_convert`, SP-4a). The real ingestion converters — **whonet-sqlite**, **tabular** (CSV/Excel), **hl7v2** — already exist as packaged Rust/wasm plugins in `reference-plugins/` with a `convert(bytes)→NDJSON-of-FHIR` entrypoint used by the ingest pipeline, but they are **not exposed as workflow nodes**. Until they are, the north-star chain (`whonet-source → process → dhis2-sink`) can't be built in the visual builder.

SP-5b exposes the three converters as `abi:'bytes'` workflow nodes that emit the workflow `{items}` envelope, reusing each crate's proven parser/mapping core (mirroring SP-5a's `wf_push` pattern), and proves the full plugin→plugin north-star end-to-end against a live DHIS2.

## Goals / Non-goals

**Goals**
- A new `wf_convert` (`abi:'bytes'`) entrypoint in each of the three crates that consumes the input item's file bytes and returns `{ items }`, **reusing the existing parser/mapping core** (the legacy `convert` entrypoint + the ingest path stay untouched).
- A **configurable output mode** per node — `output: 'fhir' | 'rows'` (default `fhir`): `fhir` emits one FHIR resource per item (canonical, reuses `mapping::map_*`); `rows` emits the pre-FHIR parsed record per item (for direct consumption by `dhis2-sink:push`, which wants flat rows).
- A reusable **`json` config-field type** (multi-line textarea, JSON-validated) for tabular's `mapping` (and hl7v2's optional code-lists).
- Each converter becomes a `kind:'transform'`, `abi:'bytes'` node fed by the **existing SP-4a file trigger** (per-run upload / webhook / ingest blob).
- Re-pack/sign/install the three plugins with the new entrypoint + `workflowNodes` decl.
- **Builder UX:** palette categories **collapsed by default** (so the library — including Plugins — is scannable, not a long expanded list).
- **Acceptance (north-star):** a live `whonet-source(rows) → dhis2-sink:push` workflow pushing to the Docker DHIS2 (extends the SP-5a acceptance harness) **plus** a manual browser verification that the node appears in the builder, drags, configures, and runs.

**Non-goals (SP-5b)**
- A dedicated FHIR→rows "process/flatten" node — the `rows` output mode covers the dhis2-direct path; FHIR-item chains are composed with existing nodes (code, etc.).
- A saved-mapping store/picker for tabular (the `json` field is sufficient for v1; a picker is a later SP if desired).
- New parsing logic — SP-5b reuses each crate's existing parser/mapping; only a `rows` projection is added where one doesn't already exist.
- Changing the ingest pipeline or the legacy `convert` entrypoint.
- Removing/altering any other plugin or host node.

## Key decisions (brainstorm 2026-06-29)

1. **All three converters** (whonet/tabular/hl7v2) in SP-5b, sequenced two-phase (below).
2. **Configurable `output: 'fhir' | 'rows'`** (default `fhir`) — reuse the FHIR core; add a `rows` projection per crate.
3. **New `json` config-field type** for tabular's `mapping` (reusable; renders a textarea, validated as JSON).
4. **Reuse, don't fork** — new `wf_convert` envelope over the existing parser/mapping core; keep `convert` + the ingest path.
5. **`kind:'transform'`, `abi:'bytes'`**, fed by the SP-4a file trigger (NOT a new "source" archetype — consistent with SP-4a's decision that converters are file-fed transforms).
6. **Live whonet→dhis2 north-star e2e** is in-scope acceptance, plus a manual builder check.
7. **Palette categories collapsed by default.**

## Architecture

### Data flow (run time)
```
file bytes (trigger: upload/webhook/ingest) → item {binary:{file: BinaryRef}} →
 pluginNodeHandler('plugin-node', data={pluginId:'whonet-sqlite', nodeId:'convert', kind:'transform', config})
   → runPluginNode (bytes path, UNCHANGED from SP-4a): read items[0].binary[field], blob.get(bytes),
      node config → Extism config map (JSON.stringify non-strings; NO egress — converters declare no net-egress);
      sink.invokeBytes('wf_convert', bytes, { config: {...wireConfig}, allowedHosts: [] })
   → wasm wf_convert: parse+map core; output==='rows' ? items[].json = parsed record
                                                       : items[].json = FHIR resource;
      return { items }
   → downstream nodes (process / dhis2-sink:push / materialize / …)
```
`runPluginNode`'s bytes path is **unchanged** — the converter's `mapping`/`output`/code-list config rides `opts.config` exactly as tabular's existing `config::get("mapping")` already expects (verified: `plugin-node-service.ts` stringifies each node-config value into the Extism config map).

### 1. `wf_convert` per crate (Rust)
A thin envelope mirroring SP-5a's `wf_push`: a **host-testable build helper** (the `mod plugin` is wasm-only) + a wasm-only `#[plugin_fn] wf_convert`. It reads `config::get("output")` (default `"fhir"`), runs the existing parse, and either maps to FHIR (existing `map_*`) or projects rows, then wraps each as `{ json: <value> }` into `{ items }`.

- **tabular** (`wasm/tabular`): `reader::read_rows(bytes, sheet)` already yields rows.
  - `fhir`: `mapping::map_rows(rows, m)` → resources. (`m` from `config::get("mapping")`, as today.)
  - `rows`: emit each `read_rows` record as `item.json` (header→cell object). The FHIR column-map (`mapping.columns`) is unused in `rows` mode; the `mapping` config is then **optional** (only `sheet` is read). Config: `mapping`(json, optional), `sheet`(text, optional), `output`(select).
- **whonet-sqlite** (`wasm/whonet-sqlite`): `load_db(bytes)` → SQLite conn.
  - `fhir`: `mapping::map_isolates(conn)` → resources.
  - `rows`: a new lightweight `SELECT * FROM <isolate table>` projection → one row object per isolate (raw columns). Config: `output`(select) only.
- **hl7v2** (`wasm/hl7v2`): `parser::parse_messages(text)` → segments per message.
  - `fhir`: `mapping::map_message(segs, cfg, i)` → resources.
  - `rows`: a new projection — one flat record per message of the key fields the mapping reads (patient/specimen/organism/AST), so the record is analysis-usable. Config: `organismIdCodes`(json, optional), `astInterpretationCodes`(json, optional), `output`(select).

Each crate keeps `convert` (ingest) untouched; `wf_convert` and `convert` share the parse/map core.

### 2. `json` config-field type
- **Schema** (`@openldr/marketplace` `workflow-node.ts`): add `'json'` to `WORKFLOW_CONFIG_FIELD_TYPES`. No other schema change (a `json` field stores an arbitrary object in node config).
- **Web** (`plugin-node-form.tsx` `PluginField`): a `json` field renders a `<textarea>` (shadcn `Textarea`); on change it `JSON.parse`s — valid → store the object in config; invalid → keep the text + show an inline error, don't persist a broken object. (The host stringifies the stored object back into the Extism config map.)
- **Validation:** required `json` fields must hold a parseable object before run (surface in the form; the engine treats absent/invalid config per the crate's own error).

### 3. Converter → workflow-node exposure (the one new mechanism)
The converter manifests differ from the sink manifest: a **singular `entrypoint:'convert'`**, converter capabilities (`read-input`/`emit-fhir`, no `net-egress`), no `kind`, built by `scripts/build-wasm-plugins.mjs`. SP-5b must let the workflow path **discover + invoke `wf_convert`** on them:
- **Build/manifest:** `build-wasm-plugins.mjs` adds a `workflowNodes` decl per crate AND ensures `wf_convert` is on the invoke allowlist the workflow path enforces (e.g. an `entrypoints` array, or derive workflow-invocable entrypoints from `workflowNodes[].entrypoint`). Re-sign (the decl rides the signed payload).
- **Registry:** `createWorkflowNodeRegistry` already lists nodes from any enabled plugin's `workflowNodes` (caps⊆grant: the node declares `capabilities: []`, a trivial subset of the converter grant — confirm the empty-set check passes).
- **Host load:** `runPluginNode` loads the plugin as a `WasmSink` and calls `invokeBytes('wf_convert', …)`. `createWasmSink` needs only the wasm + a manifest listing the entrypoint, independent of the converter's ingest (Converter) loading — so the workflow path constructs/loads an invokable sink over the converter wasm. **This is the primary implementation unknown; the plan resolves how `loadSink`/the plugin store yields an invokable instance for a converter-kind plugin (extend the loader vs. a thin adapter).**

### 4. Builder UX — collapsed categories
`sidebar.tsx` currently defaults every category `expanded: true` (line ~150). Flip the default to **collapsed** (`false`) for the initial `expandedCategories` state; the existing `toggleCategory`/`isExpanded` infra is unchanged, and search still force-expands the synthetic results category. This applies uniformly to built-in categories AND the appended "Plugins" category. The per-node "available/coming-soon" logic and drag behavior are untouched.

### 5. Visibility / install (runtime — not a code change)
A plugin's workflow nodes appear in the palette only when the plugin is **installed + enabled** in the running instance (`GET /api/workflows/nodes` → `source:'plugin'`). SP-5b re-packs/signs the three converter plugins; to SEE them the operator installs them (`openldr plugin install reference-plugins/<crate>/plugin.wasm`) and the server is running. The acceptance includes this install step + a manual browser check, so "I can't see the Plugins section" is resolved operationally (and documented).

## Components / files

**Modify (Rust):** `wasm/{whonet-sqlite,tabular,hl7v2}/src/lib.rs` (+ a module for the `rows` projection where needed; + host-test) — `wf_convert` + host-testable build helper. **Modify (packaging):** `scripts/build-wasm-plugins.mjs` — per-crate `workflowNodes` + `wf_convert` allowlist; re-pack/sign. **Modify (schema):** `packages/marketplace/src/workflow-node.ts` (+test) — `'json'` field type. **Modify (web):** `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx` (+test) — `json` textarea field; `apps/web/src/workflows/components/sidebar.tsx` (+test) — collapsed-by-default. **Maybe (host):** the plugin loader / `runPluginNode` plumbing to invoke a converter-kind plugin (resolved in plan). **New tests:** `packages/plugins/src/{whonet,tabular,hl7v2}-wf-convert.integration.test.ts` (real Extism); extend `apps/server/src/dhis2-live.acceptance.test.ts` (whonet→dhis2).

## rows projections (explicit shapes)
- **tabular** `rows`: `{ [header]: cell }` per spreadsheet row (the `reader::read_rows` record).
- **whonet-sqlite** `rows`: `{ [column]: value }` per isolate row from the SQLite isolate table (raw columns: organism, antibiotic/result columns, facility/orgUnit, date, …).
- **hl7v2** `rows`: one flat record per message — `{ patientId, specimen, organism, <ast-antibiotic>: <interpretation>, collectedAt, … }` — the key fields the FHIR mapping consumes, projected flat.

## Testing strategy
- **Rust:** per-crate `wf_convert` host-unit tests (fhir + rows) reusing existing parser fixtures via the host-testable build helper.
- **Real Extism:** per-crate `bytes→{items}` tests (fhir + rows) through the real wasm (mirror `wf-convert.integration.test.ts`); RAN (not skipped) since the wasm is staged.
- **Schema/web:** `json` field type parse/validate (marketplace test); `plugin-node-form` renders a `json` textarea, persists the parsed object, surfaces invalid JSON; `sidebar` categories collapsed by default (+ search still expands).
- **Live north-star e2e (whonet):** extend `dhis2-live.acceptance.test.ts` — `make:whonet-sample` → `wf_convert(rows)` over the WHONET SQLite → items → `dhis2-sink:push` with a purpose-built mapping over the whonet row columns → live DHIS2 import (SUCCESS) + read-back. `DHIS2_LIVE=1`-gated like SP-5a.
- **Manual browser verification:** with the plugins installed + dev server up, the whonet node appears in the Plugins palette, drags onto the canvas, configures (`output`, file), wires to `dhis2-sink:push`, and runs to completion.
- **Gate:** `pnpm turbo run typecheck --force`, `pnpm depcruise`, `cargo test -p {whonet-sqlite,tabular,hl7v2}` (in `wasm/`), the marketplace+plugins+workflows+bootstrap+server suites + web isolated; build `--force`. The three wasm rebuilds + re-packs are part of packaging.

## Security considerations
- Converters declare **no `net-egress`** — the bytes path pins `allowedHosts: []` (no network from a converter), enforced by the SP-4a egress model.
- File size caps (SP-4a: upload read / declared byteSize / fetched length) apply unchanged to the converter input.
- The `mapping`/code-list config is **non-secret** plugin metadata embedded in the (manager-gated) workflow definition.
- `assertNodeAllowed` (caps⊆grant + egress kill-switch) runs on these nodes as on any plugin node; the empty node-cap set is a trivial subset of the converter grant.
- No new routes; the existing MANAGE-gated upload/webhook/execute surfaces are reused.

## Risks
- **Converter-kind plugin invoked via the workflow path** (the new mechanism): the converter manifest/loader differs from sinks. Mitigation: `createWasmSink` is wasm+manifest only; the plan picks the minimal loader extension (or thin adapter) + the registry/build-script wiring; the real-Extism tests + the live e2e are the safety net.
- **Modifies three live converter crates** — mitigated by reusing each core + keeping `convert` untouched + the forced gate + per-crate real-Extism tests.
- **`rows` projections are new** (whonet/hl7v2) — modest; covered by unit + real-Extism tests; the live e2e exercises whonet rows against a real mapping.
- **e2e mapping alignment** — the whonet row columns must line up with a purpose-built dhis2 aggregate mapping; crafted in the acceptance test (detail for the plan).

## Implementation sequencing (delivers all three)
- **Phase 1 (prove the pattern once, end-to-end):** `json` field type + sidebar collapsed-default + the converter→workflow-node exposure mechanism + **whonet** `wf_convert` (fhir+rows) + node decl/packaging + real-Extism + the **live whonet→dhis2 e2e** + manual builder check.
- **Phase 2 (replicate):** **tabular** + **hl7v2** `wf_convert` (fhir+rows) + `rows` projections + node decls/packaging + real-Extism tests.

## Open questions (deferred)
- A dedicated FHIR→rows flatten/aggregate node (vs. composing with code nodes) — later SP if the FHIR-item path needs it for dhis2.
- A saved-mapping store/picker for tabular (vs. the `json` field) — later SP.
- Whether to surface a sample/template mapping for tabular in the node form (UX nicety).
