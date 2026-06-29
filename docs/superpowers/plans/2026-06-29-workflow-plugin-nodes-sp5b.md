# Plugin-contributed Workflow Nodes — SP-5b (Converter Source Nodes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing `whonet-sqlite`/`tabular`/`hl7v2` converter plugins as `abi:'bytes'` workflow nodes via a new `wf_convert` entrypoint that reuses each crate's parser/mapping core and emits `{items}` (configurable `output: 'fhir'|'rows'`), add a reusable `json` config-field type + collapsed-by-default palette categories, and prove the whonet→dhis2 north-star end-to-end against a live DHIS2.

**Architecture:** Each converter crate gains a thin wasm-only `wf_convert` entrypoint (mirroring SP-5a's `wf_push`) over a host-testable build helper that reuses the existing parse/map core; the host `loadSink` is relaxed to load any plugin that exposes named `entrypoints` (not only `kind:'sink'`) so a `kind:'source'` converter can also serve workflow invokes; the SP-4a bytes path forwards the node config (incl. `output` + tabular `mapping`) into the Extism config map unchanged. A new `json` config-field type carries multi-line mapping config. Two phases: whonet end-to-end first (proves the whole pattern + live e2e), then tabular + hl7v2.

**Tech Stack:** Rust + wasm32-wasip1 (Extism PDK), TypeScript, Fastify, Vitest, React 18, zod, pnpm/turbo, dependency-cruiser.

**Commits:** Commit at the end of each task (the user is now committing this workstream; frequent commits). Use `feat`/`test`/`docs` scopes. End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` line.

> **Web flake:** run web tests ISOLATED per-file (`pnpm -C apps/web test <file>`); never trust a parallel web red. **Rust:** `cargo 1.96` + `wasm32-wasip1` installed; `whonet-sqlite` wasm build needs clang + the wasi-sdk sysroot (see `scripts/build-wasm-plugins.mjs` env). **Build:** `pnpm build:plugins` builds all three converters; re-install with `pnpm openldr plugin install reference-plugins/<id>/plugin.wasm`. Converters are UNSIGNED (installed under `devAllowUnsigned`), so editing `manifest.json` needs no re-sign.

---

## Background the implementer needs (read once)

- **Existing converter ABI:** each crate has `convert(input: Vec<u8>) -> FnResult<String>` returning NDJSON of FHIR resources (`openldr_plugin_sdk::to_ndjson`). It reads mapping/config from the Extism `config` map (`config::get("mapping")` for tabular; `organismIdCodes`/`astInterpretationCodes` for hl7v2; whonet reads none). The ingest pipeline calls this via `runtime.load()` (a `Converter`). **Leave `convert` untouched.**
- **Workflow `abi:'bytes'` path** (`packages/bootstrap/src/plugin-node-service.ts`): for `decl.abi==='bytes'` the host reads `items[0].binary[field]` (field = `config.binaryField || decl.binaryField || 'file'`), `blob.get`s the bytes, builds `bytesConfig = {...connConfig, ...each node-config value JSON.stringify'd}`, then `sink.invokeBytes(decl.entrypoint, bytes, {config: bytesConfig, allowedHosts})`. So a node-config field `output:'rows'` arrives as `config::get("output") == "rows"`, and tabular's `mapping` object arrives as `config::get("mapping") == <JSON string>` — exactly what the crate already expects.
- **Sink loading:** `runtime.loadSink(id, version)` (`packages/plugins/src/runtime.ts:150`) builds a `WasmSink`; `createWasmSink` enforces an entrypoint allowlist (`wasm-sink.ts:49`: `manifest.entrypoints.includes(entrypoint)` else throws). `loadSink` currently throws if `manifest.kind !== 'sink'` (line 157). Converters are `kind:'source'`, `entrypoints:[]` → Task 2 relaxes this.
- **Node decl** (`@openldr/marketplace` `workflowNodeDeclSchema`): `kind:'source'|'transform'|'sink'`, `abi:'items'|'bytes'`, `binaryField?`, `config[]` of typed fields. Converter nodes are `kind:'transform'`, `abi:'bytes'`, `entrypoint:'wf_convert'`, caps `[]`.
- **SP-5a is the pattern to copy:** `wasm/dhis2-sink/src/lib.rs` `wf_push` = a wasm-only `#[plugin_fn]` over a host-testable `wf_build` helper; `wasm/dhis2-sink/src/types.rs` envelope types; the real-Extism test `packages/plugins/src/dhis2-wf-push.integration.test.ts`; the live test extension in `apps/server/src/dhis2-live.acceptance.test.ts`.

---

## File Structure

- `packages/marketplace/src/workflow-node.ts` (+test) — add `'json'` to `WORKFLOW_CONFIG_FIELD_TYPES`.
- `packages/plugins/src/runtime.ts` (+`runtime.test.ts`) — relax `loadSink` (kind:'sink' OR named entrypoints).
- `wasm/whonet-sqlite/src/lib.rs` (+ a `rows` query helper module; + host tests) — `wf_convert`.
- `wasm/tabular/src/lib.rs` (+ host tests) — `wf_convert` (Phase 2).
- `wasm/hl7v2/src/lib.rs` (+ `mapping`/`parser` row projection; + host tests) — `wf_convert` (Phase 2).
- `scripts/build-wasm-plugins.mjs` — per-crate `entrypoints:['wf_convert']` + `workflowNodes` decl.
- `packages/plugins/src/{whonet,tabular,hl7v2}-wf-convert.integration.test.ts` (new) — real-Extism bytes→{items}.
- `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx` (+test) — `json` textarea field.
- `apps/web/src/workflows/components/sidebar.tsx` (+test) — categories collapsed by default.
- `apps/server/src/dhis2-live.acceptance.test.ts` — whonet→dhis2 north-star e2e.

---

# PHASE 1 — whonet end-to-end (proves the whole pattern)

## Task 1: `json` config-field type

**Files:** Modify `packages/marketplace/src/workflow-node.ts`, `packages/marketplace/src/workflow-node.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `workflow-node.test.ts`:
```ts
describe('workflowConfigFieldSchema json type', () => {
  it('accepts a json config field', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'transform', entrypoint: 'wf_convert',
      config: [{ key: 'mapping', label: 'Mapping', type: 'json', required: true }] });
    expect(d.config[0].type).toBe('json');
  });
});
```

- [ ] **Step 2: Run → fail:** `pnpm -C packages/marketplace exec vitest run src/workflow-node.test.ts` (Expected: FAIL — `'json'` not in the enum).

- [ ] **Step 3: Implement** — in `workflow-node.ts`, add `'json'` to the array:
```ts
export const WORKFLOW_CONFIG_FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'multiselect', 'file', 'json'] as const;
```

- [ ] **Step 4: Run → pass:** `pnpm -C packages/marketplace exec vitest run src/workflow-node.test.ts`; then `pnpm -C packages/marketplace exec vitest run` (full suite) + `pnpm -C packages/marketplace exec tsc --noEmit`.

- [ ] **Step 5: Commit:** `git add packages/marketplace/src/workflow-node.ts packages/marketplace/src/workflow-node.test.ts && git commit -m "feat(marketplace): json workflow config-field type (SP-5b)…"`

---

## Task 2: Relax `loadSink` to load named-entrypoint plugins (the converter→workflow enabler)

**Files:** Modify `packages/plugins/src/runtime.ts`, `packages/plugins/src/runtime.test.ts`.

**Why:** `loadSink` throws unless `kind==='sink'`. Converters are `kind:'source'` (must stay so, for the ingest `load()` path). To invoke `wf_convert` on a converter via the workflow bytes path, `loadSink` must load any plugin that exposes named `entrypoints`.

- [ ] **Step 1: Read** `packages/plugins/src/runtime.ts:150-165` (`loadSink`) and `packages/plugins/src/runtime.test.ts` (find the existing `loadSink` tests + the helper that builds a fake store row with a manifest). Match those conventions.

- [ ] **Step 2: Write the failing test** — add to `runtime.test.ts` a test that a `kind:'source'` plugin whose manifest lists `entrypoints:['wf_convert']` loads as a sink:
```ts
it('loadSink loads a source plugin that exposes named entrypoints', async () => {
  // Build a runtime over a store whose row manifest is kind:'source' with entrypoints:['wf_convert'].
  // (Reuse the test file's existing row/manifest builder; set kind:'source', entrypoints:['wf_convert'].)
  const sink = await runtime.loadSink('whonet-sqlite');
  expect(sink).toBeDefined();
  expect(sink!.entrypoints).toContain('wf_convert');
});
```
Adapt to the test file's actual runtime/store fixture. If a `kind:'source'` + `entrypoints` row helper doesn't exist, construct one inline matching the existing manifest shape.

- [ ] **Step 3: Run → fail:** `pnpm -C packages/plugins exec vitest run src/runtime.test.ts` (Expected: FAIL — `loadSink` throws "is not a sink").

- [ ] **Step 4: Implement** — in `runtime.ts` `loadSink`, replace the guard:
```ts
    const manifest = pluginManifestFromRow(row);
    if (manifest.kind !== 'sink' && manifest.entrypoints.length === 0) {
      throw new Error(`plugin ${row.id}@${row.version} is not invokable (kind=${manifest.kind}, no entrypoints)`);
    }
```
(A `kind:'sink'` plugin still loads; a `kind:'source'` plugin loads iff it declares named `entrypoints`. The `createWasmSink` allowlist then governs which entrypoints are callable.)

- [ ] **Step 5: Run → pass:** `pnpm -C packages/plugins exec vitest run src/runtime.test.ts`; then `pnpm -C packages/plugins exec vitest run` + `pnpm -C packages/plugins exec tsc --noEmit`.

- [ ] **Step 6: Commit:** `git add packages/plugins/src/runtime.ts packages/plugins/src/runtime.test.ts && git commit -m "feat(plugins): loadSink loads named-entrypoint source plugins (SP-5b)…"`

---

## Task 3: whonet `wf_convert` entrypoint (fhir + rows)

**Files:** Modify `wasm/whonet-sqlite/src/lib.rs` (+ a small rows-query helper; + `#[cfg(test)]` host tests). Work from `D:\Projects\Repositories\openldr_ce\wasm`.

- [ ] **Step 1: Read** `wasm/whonet-sqlite/src/lib.rs` (the `convert` body: `load_db(&input)` → `rusqlite::Connection`; `mapping::map_isolates(&conn)` → `Vec<resource>`; `to_ndjson`) and `wasm/whonet-sqlite/src/mapping.rs` (how `map_isolates` queries — find the isolate table name + the columns it SELECTs; the `rows` projection reuses that query but returns raw column→value objects instead of FHIR). Note whether `load_db`/`mapping` are wasm-only or host-available (the rows query + map run inside the wasm-only `mod plugin`/entrypoint, but factor a host-testable builder where possible like SP-5a's `wf_build`).

- [ ] **Step 2: Add a host-testable rows projection** — in `mapping.rs` (or a new `rows.rs`), add a function that runs the SAME `SELECT` `map_isolates` uses but returns `Vec<serde_json::Map<String, serde_json::Value>>` (one object per isolate row, raw columns):
```rust
/// Project the isolate rows as flat JSON records (raw columns), reusing the same query as map_isolates.
pub fn project_rows(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<serde_json::Map<String, serde_json::Value>>> {
    // Use the SAME table/columns map_isolates reads. For each row build { column_name: value }.
    // (Read map_isolates in Step 1 and mirror its SELECT exactly.)
}
```
Keep `rusqlite`-touching code behind the same cfg the existing module uses (the `convert` path is wasm-only; the host `cargo test` for rusqlite-bundled-sqlite runs on the native target — confirm `map_isolates` is host-testable today by checking for existing `#[cfg(test)]` mapping tests; if mapping tests already open an in-memory `rusqlite::Connection`, `project_rows` is host-testable the same way).

- [ ] **Step 3: Add `wf_convert`** — in `lib.rs` (inside the wasm-only `mod plugin`, or top-level if the file isn't split; mirror where `convert` lives). It reads `output`, runs `load_db`, dispatches:
```rust
#[plugin_fn]
pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
    if input.is_empty() {
        return Ok(serde_json::json!({ "items": [] }).to_string());
    }
    let output = config::get("output").ok().flatten().unwrap_or_else(|| "fhir".to_string());
    let conn = load_db(&input).map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
    let items: Vec<serde_json::Value> = if output == "rows" {
        mapping::project_rows(&conn)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("rows: {e}")), 1))?
            .into_iter().map(|r| serde_json::json!({ "json": r })).collect()
    } else {
        mapping::map_isolates(&conn)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("map: {e}")), 1))?
            .into_iter().map(|res| serde_json::json!({ "json": res })).collect()
    };
    Ok(serde_json::json!({ "items": items }).to_string())
}
```
Adjust `load_db`/`map_isolates` return types + error handling to the actual signatures from Step 1 (e.g. if `map_isolates` returns `Vec<serde_json::Value>` already, drop the inner map). Add any missing `use extism_pdk::*;` / `use openldr_plugin_sdk::*` items. **Do NOT touch `convert`.**

- [ ] **Step 4: Host unit test** — add `#[cfg(test)]` tests exercising `project_rows` (and `map_isolates` if not already covered) against an in-memory SQLite seeded with 1–2 isolate rows (reuse the existing whonet mapping-test fixture/seed if present): assert `project_rows` returns N row objects with the expected raw columns, and `map_isolates` returns the FHIR resources. (The `wf_convert` `#[plugin_fn]` itself is wasm-only — test the build/projection helpers, like SP-5a tested `wf_build`.)

- [ ] **Step 5: Build + verify:** `cargo test -p whonet-sqlite` (from `wasm/`) → host tests pass; `pnpm build:plugins` (from repo root) → staged sha line for whonet-sqlite. (Packaging manifest update is Task 4; rebuild again after.)

- [ ] **Step 6: Commit:** `git add wasm/whonet-sqlite/ && git commit -m "feat(whonet): wf_convert items envelope (fhir|rows) (SP-5b)…"`

---

## Task 4: whonet packaging — `entrypoints` + `workflowNodes` + re-install

**Files:** Modify `scripts/build-wasm-plugins.mjs`.

- [ ] **Step 1: Read** `scripts/build-wasm-plugins.mjs` — the whonet `manifest` object (lines ~49-68; note it is the BESPOKE whonet block, not `buildPure`). It has `entrypoint: 'convert'`, `capabilities: [...]`, no `entrypoints`/`workflowNodes`.

- [ ] **Step 2: Implement** — add `entrypoints` + `workflowNodes` to the whonet `manifest` object:
```js
  entrypoints: ['wf_convert'],
  workflowNodes: [
    {
      id: 'convert', label: 'WHONET → items', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
      capabilities: [],
      ports: { inputs: [{ name: 'file' }], outputs: [{ name: 'out' }] },
      config: [
        { key: 'output', label: 'Output', type: 'select', required: true, default: 'fhir',
          options: [{ value: 'fhir', label: 'FHIR resources' }, { value: 'rows', label: 'Parsed rows' }] },
      ],
    },
  ],
```
(Node caps `[]` are a trivial subset of the whonet grant. `binaryField:'file'` matches the SP-4a trigger default. `abi:'bytes'` routes the host bytes path.)

- [ ] **Step 3: Rebuild + re-install:** `pnpm build:plugins` (staged sha line) → confirm `reference-plugins/whonet-sqlite/manifest.json` now lists `entrypoints:['wf_convert']` + the `workflowNodes` node. Then `pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm` (re-installs the refreshed manifest into the registry).

- [ ] **Step 4: Verify the node appears** — run the registry check (adapt the SP-5a scratch script, or curl the authed route): the registry `list()` includes `whonet-sqlite:convert` (kind transform). Minimal inline check (from `apps/server` context):
```ts
import { createInternalDb } from '@openldr/db'; import { createPluginStore } from '@openldr/plugins';
import { createWorkflowNodeRegistry, HOST_NODE_DESCRIPTORS } from '@openldr/workflows';
const internal = createInternalDb(process.env.INTERNAL_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr');
const nodes = await createWorkflowNodeRegistry({ plugins: createPluginStore(internal.db as never) as never, hostNodes: HOST_NODE_DESCRIPTORS }).list();
console.log(nodes.filter(n => n.id.startsWith('whonet')).map(n => n.id)); await internal.db.destroy();
```
Run via `pnpm -C apps/server exec tsx <tmpfile>` (a throwaway under `apps/server/`, deleted after). Expected: `[ 'whonet-sqlite:convert' ]`.

- [ ] **Step 5: Commit:** `git add scripts/build-wasm-plugins.mjs && git commit -m "feat(whonet): contribute wf_convert workflow node (SP-5b)…"`

---

## Task 5: Real-Extism whonet `wf_convert` integration test (fhir + rows)

**Files:** Create `packages/plugins/src/whonet-wf-convert.integration.test.ts`.

- [ ] **Step 1: Read** `packages/plugins/src/wf-convert.integration.test.ts` (the test-sink bytes converter test — your template for `createWasmSink` + `invokeBytes` + the skip guard) AND `packages/plugins/src/integration.test.ts` (how the whonet wasm + a sample SQLite are loaded — find the path to a WHONET sample, e.g. `samples/whonet-sample.sqlite` produced by `pnpm make:whonet-sample`). Match conventions.

- [ ] **Step 2: Write the test** — load `reference-plugins/whonet-sqlite/plugin.wasm`, `parseManifest({ id:'whonet-sqlite', version:'0.1.0', kind:'source', entrypoint:'convert', entrypoints:['wf_convert'], wasmSha256: sha256Hex(wasm), wasi:true, … })`, `createWasmSink(...)`, read a WHONET sample SQLite into bytes, then:
```ts
const fhir = (await sink.invokeBytes('wf_convert', sampleBytes, { config: { output: 'fhir' } })) as { items: { json: { resourceType?: string } }[] };
expect(fhir.items.length).toBeGreaterThan(0);
expect(fhir.items[0].json.resourceType).toBeTruthy();
const rows = (await sink.invokeBytes('wf_convert', sampleBytes, { config: { output: 'rows' } })) as { items: { json: Record<string, unknown> }[] };
expect(rows.items.length).toBeGreaterThan(0);
expect(rows.items[0].json.resourceType).toBeUndefined(); // raw row, not FHIR
```
Use `describe.skipIf(!present)` guarded on the wasm AND the sample existing; generate the sample in a `beforeAll` via the existing make-sample helper if the integration test does, else skip-guard on a committed sample. The manifest MUST include `entrypoints:['wf_convert']` (the allowlist) and `kind:'source'`.

- [ ] **Step 3: Run → pass (not skipped):** `pnpm -C packages/plugins exec vitest run src/whonet-wf-convert.integration.test.ts` (Expected: 1 file, both assertions, RAN). Then full suite: `pnpm -C packages/plugins exec vitest run`.

- [ ] **Step 4: Commit:** `git add packages/plugins/src/whonet-wf-convert.integration.test.ts && git commit -m "test(plugins): real-Extism whonet wf_convert (SP-5b)…"`

---

## Task 6: Web — `json` field renderer + collapsed-by-default categories

**Files:** Modify `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx` (+test), `apps/web/src/workflows/components/sidebar.tsx` (+test).

- [ ] **Step 1: Read** `plugin-node-form.tsx` (the `PluginField` renderer — how `text`/`number`/`boolean`/`select` branches render + call `onChange`/`setField`; you'll add a `json` branch) and the shadcn `Textarea` import path (search `components/ui/textarea`; if none exists, use a styled `<textarea>` with the form's `inputClass`). Read `plugin-node-form.test.tsx` for the render/assert conventions.

- [ ] **Step 2: Write the failing test (json field)** — in `plugin-node-form.test.tsx`: a descriptor with a `json` field; typing valid JSON persists the PARSED object into config; invalid JSON does NOT persist a broken value (and shows an error). Assert via the `update`/`setField` mock:
```ts
// render PluginNodeForm with config [{ key:'mapping', type:'json', label:'Mapping' }]
// type '{"a":1}' into the textarea -> update called with config.mapping === { a: 1 }
// type '{bad' -> update NOT called with a mapping (or called with the last-valid); an error hint shows
```
Match the file's existing event-firing + assertion style.

- [ ] **Step 3: Run → fail:** `pnpm -C apps/web test src/workflows/components/node-forms/plugin-node-form.test.tsx`.

- [ ] **Step 4: Implement the json branch** — in `PluginField`, add before the fallback:
```tsx
if (field.type === 'json') {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormField label={field.label}>
      <textarea
        className={cn(inputClass, 'min-h-[120px] font-mono text-xs')}
        value={text}
        onChange={(e) => {
          const t = e.target.value; setText(t);
          if (t.trim() === '') { setErr(null); onChange(undefined); return; }
          try { const parsed = JSON.parse(t); setErr(null); onChange(parsed); }
          catch (ex) { setErr(ex instanceof Error ? ex.message : 'invalid JSON'); }
        }}
      />
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </FormField>
  );
}
```
(Import `useState` + `cn` if not already imported; reuse the form's `inputClass`. On invalid JSON it keeps the text + shows the error and does NOT call `onChange`, so the last valid object stays in config.)

- [ ] **Step 5: Write the failing test (collapsed categories)** — in a `sidebar.test.tsx` (create if absent; otherwise add a case): on first render, a category's items are NOT shown until its header is clicked. Assert a known built-in node label is absent initially, present after clicking its category header. (If a sidebar test harness doesn't exist, add a minimal one rendering `<Sidebar/>` with `fetchWorkflowNodes` mocked to `[]`.)

- [ ] **Step 6: Implement collapsed default** — in `sidebar.tsx`, change the initial `expandedCategories` state to collapsed:
```tsx
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() =>
    // Default: collapsed so the (now plugin-inclusive) library is scannable; click a header to expand.
    Object.fromEntries(nodeCategories.map((c) => [c.name, false])),
  );
```
And change `isExpanded`'s fallback so an unknown/plugin category also defaults collapsed:
```tsx
  const isExpanded = (name: string) =>
    search.trim().length > 0 ? true : expandedCategories[name] ?? false;
```
(Search still force-expands the synthetic results category. `toggleCategory`'s `?? true` flips a collapsed category open on first click — keep it: `!(prev[name] ?? false)`.)
Update `toggleCategory`:
```tsx
  const toggleCategory = (name: string) => setExpandedCategories((prev) => ({ ...prev, [name]: !(prev[name] ?? false) }));
```

- [ ] **Step 7: Run → pass:** `pnpm -C apps/web test src/workflows/components/node-forms/plugin-node-form.test.tsx` and `pnpm -C apps/web test src/workflows/components/sidebar.test.tsx` (isolated); then `pnpm -C apps/web exec tsc --noEmit`.

- [ ] **Step 8: Commit:** `git add apps/web/src/workflows && git commit -m "feat(web): json config field + collapsed palette categories (SP-5b)…"`

---

## Task 7: Live whonet → dhis2 north-star e2e + manual builder check

**Files:** Modify `apps/server/src/dhis2-live.acceptance.test.ts`.

**Goal:** prove `whonet wf_convert(rows) → items → dhis2-sink:push` against the live Docker DHIS2, in the same `DHIS2_LIVE=1`-gated harness as SP-5a.

- [ ] **Step 1: Read** the current `dhis2-live.acceptance.test.ts` (esp. the SP-5a `wf_push` test + the `buildSink()`/connector/`de`/`coc`/`ou` discovery). You will: (a) build a whonet sink (`buildSink` variant pointing at `reference-plugins/whonet-sqlite/plugin.wasm`, manifest `kind:'source'`, `entrypoints:['wf_convert']`); (b) generate a WHONET sample (`execSync('pnpm make:whonet-sample')` in `beforeAll`, or skip-guard on a committed sample); (c) `wf_convert(rows)` → rows; (d) push those rows via the dhis2-sink `wf_push` with a mapping over the whonet row columns.

- [ ] **Step 2: Write the e2e test** — add a `describe.skipIf(!LIVE)` block (or an `it` in the existing one). Pseudocode with real calls:
```ts
it('north-star: whonet wf_convert(rows) -> dhis2-sink:push lands in live DHIS2 (SP-5b)', async () => {
  const whonet = buildWhonetSink(); // createWasmSink over whonet plugin.wasm, entrypoints:['wf_convert']
  const sampleBytes = readFileSync(whonetSamplePath);
  const conv = (await whonet.invokeBytes('wf_convert', sampleBytes, { config: { output: 'rows' } })) as { items: { json: Record<string, unknown> }[] };
  expect(conv.items.length).toBeGreaterThan(0);
  // Pick a whonet row column to use as the org-unit key + a numeric column to push (read a row to choose columns).
  // Build a minimal aggregate mapping over those columns + an orgUnitMap mapping the row's facility -> the live `ou`.
  const rows = conv.items.map((i) => i.json);
  const dhis2 = buildSink(); // existing dhis2-sink sink (entrypoints incl wf_push)
  const config = await connectors.getDecryptedConfig(connectorId, KEY);
  const out = (await dhis2.invoke('wf_push', {
    items: rows.map((r) => ({ json: r })),
    config: { mapping: { orgUnitColumn: '<facility col>', columns: [{ column: '<numeric col>', dataElement: de, categoryOptionCombo: coc }] },
              orgUnitMap: { '<facility value>': ou }, period: PERIOD, dryRun: false },
  }, { config, allowedHosts: [HOST] })) as { meta: { result?: { status?: string; imported?: number; updated?: number } } };
  const r = out.meta.result;
  expect((r?.status ?? '').toLowerCase()).not.toBe('error');
  expect((r?.imported ?? 0) + (r?.updated ?? 0)).toBeGreaterThanOrEqual(1);
  // read back + best-effort cleanup as in the SP-5a test.
});
```
**Implementer judgment:** read one whonet sample row (log it) to choose `<facility col>`/`<numeric col>`/`<facility value>`; if no numeric column is suitable, synthesize a count (e.g. push `1` per row aggregated) — but keep it a REAL whonet-derived row→dataValue. Reuse the SP-5a read-back + cleanup. If whonet rows don't carry an obvious numeric measure, push a constant `'1'` keyed by the row's facility column (still proves rows→dataValue end-to-end).

- [ ] **Step 3: Run live:** `KEY=$(grep -E '^SECRETS_ENCRYPTION_KEY=' .env | head -1 | sed -e 's/^SECRETS_ENCRYPTION_KEY=//' -e 's/\r$//' -e 's/^"//' -e 's/"$//'); DHIS2_LIVE=1 SECRETS_ENCRYPTION_KEY="$KEY" pnpm -C apps/server exec vitest run src/dhis2-live.acceptance.test.ts --testTimeout=120000` → all pass incl. the new test (import SUCCESS, read-back). (DHIS2 + internal PG already up at :8085/:5433.)

- [ ] **Step 4: Manual builder verification** — with the dev stack running (server :3000, web :5173) and the whonet plugin installed (Task 4): reload the Workflow Builder, confirm the **Plugins** category shows **WHONET → items**, drag it on, set `output`, attach a file via the run-with-file flow, wire it to **DHIS2 Push**, and run. Record the outcome in the task report (no automated assertion required).

- [ ] **Step 5: Commit:** `git add apps/server/src/dhis2-live.acceptance.test.ts && git commit -m "test(dhis2): live whonet->dhis2 north-star e2e (SP-5b)…"`

---

## Task 8: Phase 1 gate

- [ ] **Step 1: Forced typecheck:** `pnpm turbo run typecheck --force` → all PASS.
- [ ] **Step 2: Depcruise:** `pnpm depcruise` → 0 violations.
- [ ] **Step 3: Rust:** `cargo test -p whonet-sqlite` (in `wasm/`) → PASS.
- [ ] **Step 4: Suites:** `pnpm -C packages/marketplace exec vitest run`; `pnpm -C packages/plugins exec vitest run` (incl. real-Extism whonet); `pnpm -C packages/workflows exec vitest run`; `pnpm -C packages/bootstrap exec vitest run`; `pnpm -C apps/web test src/workflows` (isolated) → all PASS.
- [ ] **Step 5: Build:** `pnpm turbo run build --force` → PASS.
- [ ] **Step 6:** confirm Phase-1 acceptance: whonet node visible + draggable in the builder; `wf_convert` fhir+rows through real Extism; live whonet→dhis2 push imported + read back; `convert`/ingest untouched.

---

# PHASE 2 — tabular + hl7v2 (replicate the proven pattern)

> Each crate repeats Task 3 (wf_convert) + Task 4 (packaging) + Task 5 (real-Extism) for its own parser/mapping. Same envelope shape; the only per-crate differences are the parse function, the FHIR map, the `rows` projection, and the config fields. Commit per crate.

## Task 9: tabular `wf_convert` + packaging + real-Extism

**Files:** `wasm/tabular/src/lib.rs` (+ host tests); `scripts/build-wasm-plugins.mjs` (the `buildPure('tabular', …)` call); `packages/plugins/src/tabular-wf-convert.integration.test.ts` (new).

- [ ] **Step 1: Read** `wasm/tabular/src/lib.rs` (`convert`: `config::get("mapping")` → `mapping::Mapping`; `reader::read_rows(&input, m.sheet.as_deref())` → rows; `mapping::map_rows(&rows, &m)` → resources) and `wasm/tabular/src/reader.rs` (the `read_rows` row type — likely `Vec<HashMap<String,String>>` or similar) and `mapping.rs` (`Mapping` fields incl. `sheet`).

- [ ] **Step 2: Add `wf_convert`** — `output` dispatch; `rows` emits the `read_rows` records directly (no FHIR map), so `mapping` is OPTIONAL in rows mode:
```rust
#[plugin_fn]
pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
    if input.is_empty() { return Ok(serde_json::json!({ "items": [] }).to_string()); }
    let output = config::get("output").ok().flatten().unwrap_or_else(|| "fhir".to_string());
    // sheet (+ mapping for fhir) come from config, as convert() reads them today.
    let mapping_raw = config::get("mapping").ok().flatten();
    let m: Option<mapping::Mapping> = match &mapping_raw {
        Some(s) => Some(serde_json::from_str(s).map_err(|e| WithReturnCode::new(Error::msg(format!("invalid mapping: {e}")), 1))?),
        None => None,
    };
    let sheet = m.as_ref().and_then(|m| m.sheet.clone());
    let rows = reader::read_rows(&input, sheet.as_deref()).map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
    let items: Vec<serde_json::Value> = if output == "rows" {
        rows.into_iter().map(|r| serde_json::json!({ "json": r })).collect()
    } else {
        let m = m.ok_or_else(|| WithReturnCode::new(Error::msg("fhir output requires a 'mapping' config"), 1))?;
        m.validate().map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
        mapping::map_rows(&rows, &m).into_iter().map(|res| serde_json::json!({ "json": res })).collect()
    };
    Ok(serde_json::json!({ "items": items }).to_string())
}
```
Adjust `read_rows`'s row type to be `serde::Serialize` (if it's a `HashMap`/struct it already serializes; if it's a custom type, derive `Serialize` or map to a `serde_json::Map`). **Do NOT touch `convert`.**

- [ ] **Step 3: Host unit test** — `wf_convert`-adjacent helpers: parse a tiny CSV via `read_rows` → assert N row records (rows mode shape); and `map_rows` over a fixture mapping → FHIR (reuse existing tabular tests).

- [ ] **Step 4: Packaging** — in `build-wasm-plugins.mjs`, the converter manifests are built by `buildPure(crate, id, description, capabilities)`. Extend `buildPure` to accept an optional `workflowNodes` + set `entrypoints`, OR add tabular/hl7v2-specific manifest fields. Add to the tabular manifest:
```js
  entrypoints: ['wf_convert'],
  workflowNodes: [{
    id: 'convert', label: 'CSV/Excel → items', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
    capabilities: [], ports: { inputs: [{ name: 'file' }], outputs: [{ name: 'out' }] },
    config: [
      { key: 'output', label: 'Output', type: 'select', required: true, default: 'fhir', options: [{ value: 'fhir', label: 'FHIR resources' }, { value: 'rows', label: 'Parsed rows' }] },
      { key: 'mapping', label: 'Column mapping', type: 'json', required: false },
      { key: 'sheet', label: 'Sheet (Excel)', type: 'text', required: false },
    ],
  }],
```
(Generalize `buildPure` to thread these per crate — keep hl7v2's call unchanged until Task 10.) Rebuild `pnpm build:plugins`; re-install `pnpm openldr plugin install reference-plugins/tabular/plugin.wasm`.

- [ ] **Step 5: Real-Extism test** — `packages/plugins/src/tabular-wf-convert.integration.test.ts`: a tiny CSV (inline `Buffer.from('a,b\n1,2\n')`), `invokeBytes('wf_convert', csv, { config: { output: 'rows' } })` → items rows `{a:'1',b:'2'}`; and `output:'fhir'` with a minimal mapping → FHIR items. Mirror Task 5. Run not-skipped.

- [ ] **Step 6: Verify + commit:** `cargo test -p tabular`; `pnpm -C packages/plugins exec vitest run src/tabular-wf-convert.integration.test.ts`; commit `wasm/tabular/`, `scripts/build-wasm-plugins.mjs`, the new test.

---

## Task 10: hl7v2 `wf_convert` + packaging + real-Extism

**Files:** `wasm/hl7v2/src/lib.rs` (+ `mapping`/`parser` row projection; + host tests); `scripts/build-wasm-plugins.mjs` (the `buildPure('hl7v2', …)` call); `packages/plugins/src/hl7v2-wf-convert.integration.test.ts` (new).

- [ ] **Step 1: Read** `wasm/hl7v2/src/lib.rs` (`convert`: `parser::parse_messages(&text)` → `Vec<segments>`; `mapping::map_message(&segs, &cfg, i)` → resources; `load_config()` reads `organismIdCodes`/`astInterpretationCodes`) and `parser.rs`/`mapping.rs` (the segment representation + which fields `map_message` reads — the `rows` projection emits ONE flat record per message of those key fields: patient id, specimen, organism, AST antibiotic→interpretation, collected date).

- [ ] **Step 2: Add a host-testable row projection** — in `mapping.rs`, add `pub fn project_row(segs: &[Segment], cfg: &Config, idx: usize) -> serde_json::Map<String, serde_json::Value>` returning the flat record (mirror which fields `map_message` reads). One record per message.

- [ ] **Step 3: Add `wf_convert`** — `output` dispatch; `fhir` reuses `map_message`, `rows` uses `project_row` per message:
```rust
#[plugin_fn]
pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
    if input.is_empty() { return Ok(serde_json::json!({ "items": [] }).to_string()); }
    let text = String::from_utf8(input).map_err(|e| WithReturnCode::new(Error::msg(format!("utf8: {e}")), 1))?;
    let cfg = load_config();
    let output = config::get("output").ok().flatten().unwrap_or_else(|| "fhir".to_string());
    let mut items: Vec<serde_json::Value> = Vec::new();
    for (i, segs) in parser::parse_messages(&text).into_iter().enumerate() {
        if output == "rows" {
            items.push(serde_json::json!({ "json": mapping::project_row(&segs, &cfg, i + 1) }));
        } else {
            for res in mapping::map_message(&segs, &cfg, i + 1) { items.push(serde_json::json!({ "json": res })); }
        }
    }
    Ok(serde_json::json!({ "items": items }).to_string())
}
```
Adjust types to the actual `parse_messages`/`map_message` signatures from Step 1. **Do NOT touch `convert`.**

- [ ] **Step 4: Host unit test** — `project_row` over a small ORU^R01 fixture (reuse existing hl7v2 parser/mapping test messages) → assert the flat record's key fields; `map_message` → FHIR (existing coverage).

- [ ] **Step 5: Packaging** — extend the `buildPure('hl7v2', …)` manifest (via the threaded `workflowNodes` param from Task 9) :
```js
  entrypoints: ['wf_convert'],
  workflowNodes: [{
    id: 'convert', label: 'HL7v2 → items', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
    capabilities: [], ports: { inputs: [{ name: 'file' }], outputs: [{ name: 'out' }] },
    config: [
      { key: 'output', label: 'Output', type: 'select', required: true, default: 'fhir', options: [{ value: 'fhir', label: 'FHIR resources' }, { value: 'rows', label: 'Parsed rows' }] },
      { key: 'organismIdCodes', label: 'Organism ID codes', type: 'json', required: false },
      { key: 'astInterpretationCodes', label: 'AST interpretation codes', type: 'json', required: false },
    ],
  }],
```
Rebuild `pnpm build:plugins`; re-install `pnpm openldr plugin install reference-plugins/hl7v2/plugin.wasm`.

- [ ] **Step 6: Real-Extism test** — `packages/plugins/src/hl7v2-wf-convert.integration.test.ts`: a small inline ORU^R01 message; `invokeBytes('wf_convert', msg, { config: { output: 'rows' } })` → one flat record per message; `output:'fhir'` → FHIR items. Mirror Task 5. Run not-skipped.

- [ ] **Step 7: Verify + commit:** `cargo test -p hl7v2`; `pnpm -C packages/plugins exec vitest run src/hl7v2-wf-convert.integration.test.ts`; commit `wasm/hl7v2/`, `scripts/build-wasm-plugins.mjs`, the new test.

---

## Task 11: Final gate

- [ ] **Step 1: Forced typecheck:** `pnpm turbo run typecheck --force` → PASS.
- [ ] **Step 2: Depcruise:** `pnpm depcruise` → 0 violations.
- [ ] **Step 3: Rust:** `cargo test -p whonet-sqlite -p tabular -p hl7v2` (in `wasm/`) → PASS.
- [ ] **Step 4: Suites:** marketplace, plugins (incl. all three real-Extism wf_convert), workflows, bootstrap, server (`workflows-routes.test.ts`), web `src/workflows` (isolated) → PASS.
- [ ] **Step 5: Build:** `pnpm turbo run build --force` → PASS.
- [ ] **Step 6: Acceptance** — all three converters are manifest-contributed `transform`/`abi:'bytes'` nodes with `output` fhir|rows; each `wf_convert` builds items through real Extism (both modes); the live whonet→dhis2 north-star e2e imports + reads back; palette categories start collapsed + the `json` field renders; `convert`/ingest paths untouched. **Deferred live e2e** for tabular/hl7v2 (whonet is the proven north-star); re-run `pnpm dhis2:accept`-style harness at acceptance.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 `json` type; Task 2 the converter→workflow loader (the spec's "primary unknown"); Tasks 3-5 whonet wf_convert/packaging/real-Extism; Task 6 web json field + collapsed categories; Task 7 live north-star e2e + manual builder check; Tasks 9-10 tabular+hl7v2; Tasks 8/11 gates.
- **Reuse, don't fork:** every `wf_convert` reuses the crate's existing `parse`/`map_*` core + adds only an `output` dispatch and a `rows` projection; `convert` + the ingest path are untouched (verify per crate).
- **Type consistency:** node config keys (`output`, tabular `mapping`/`sheet`, hl7v2 `organismIdCodes`/`astInterpretationCodes`) are read by the wasm via `config::get(...)` exactly as the host forwards them (`bytesConfig[k] = JSON.stringify(v)` for objects). `abi:'bytes'` + `binaryField:'file'` match the SP-4a trigger. Node `kind:'transform'`, caps `[]`.
- **The one host change** (Task 2) is the load-gate relaxation; everything else is additive (new entrypoint, manifest fields, new tests, a web field type, a default flip). `runPluginNode`/the bytes path is UNCHANGED.
- **Risk:** modifies three live converter crates — mitigated by reuse + keeping `convert` + per-crate real-Extism tests + the forced gate + the whonet live e2e.
