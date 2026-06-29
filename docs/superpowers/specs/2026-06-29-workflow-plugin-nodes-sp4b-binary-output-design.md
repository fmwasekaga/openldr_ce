# Plugin-contributed Workflow Nodes — SP-4b (Binary OUTPUT Lane) Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete)
- **Owner:** Fredrick
- **Parent design:** [2026-06-29-workflow-plugin-nodes-design.md](2026-06-29-workflow-plugin-nodes-design.md) (SP-4). SP-4 = SP-4a (binary input, DONE) + **SP-4b (this doc — binary output)**.
- **Depends on:** SP-2 (`runPluginNode`/`WasmSink`), SP-3a (`WorkflowItem[]` engine, sinks return items), SP-4a (`BinaryRef` lane, blob+cap in the service, `WORKFLOW_FILE_MAX_BYTES`, the `workflow-artifacts/` download route). Related: [[workflow-plugin-nodes-workstream]].

## Problem

SP-4a brought files INTO a run (→ converter → items). SP-4b lets nodes PRODUCE files: a plugin emits bytes, the host turns them into a downloadable `BinaryRef` on an output item, and the web surfaces a download. It also unifies the host `export-artifact` sink onto the same lane so produced files have one consistent surface.

## Goals / Non-goals

**Goals**
- A unified "produced file" = a `WorkflowItem` whose `binary[field]` is a `BinaryRef` under `workflow-artifacts/`.
- Plugin emit: the wasm returns inline bytes (`{ contentType, fileName?, dataBase64 }`) on an item's binary; the bootstrap service materializes them to blob (cap-enforced) → `BinaryRef`. Both abi paths (`items` + `bytes`).
- Unify `export-artifact`: attach a `BinaryRef` (built from its existing blob result) to its output item.
- Web: download links for any output-item `BinaryRef` in the Run-History drawer + the node-config Output tab.
- Reuse the existing `GET /api/workflows/artifacts/*` download route (no new route).
- A `wf_emit` test fixture proving plugin→BinaryRef materialization through real Extism.

**Non-goals (SP-4b)**
- Blob lifecycle / GC of produced files (deferred).
- Streaming / host-function output for very large files (deferred — base64 + cap covers v1).
- A dedicated "Outputs" drawer (chosen surface is run-history + Output tab).
- Re-running / re-downloading from arbitrary historical runs beyond what the run result already stores.

## Key decisions (brainstorm 2026-06-29)

1. **Emit shape = inline base64 in the item, materialized host-side** — `item.binary[field] = { contentType, fileName?, dataBase64 }`; the service decodes → blob → `BinaryRef`. (base64 is the only way to return bytes through the JSON sink ABI; threads into the item stream so a downstream `abi:'bytes'` node can re-consume it.)
2. **Surfacing = run-history drawer + node-config Output tab** (reuse existing run-result surfaces; no new page).
3. **Scope = plugin output + unify host `export-artifact`** onto the same lane.

## Architecture

### The produced-file shape
A `WorkflowItem.binary[field]` after production is a `BinaryRef { objectKey, contentType, fileName?, byteSize }` whose `objectKey` is under `workflow-artifacts/`. The web finds produced files by scanning a node's output items' `binary` maps.

### Plugin emit → materialization (bootstrap service)
The plugin's wasm returns `{ items: [{ json, binary: { out: { contentType, fileName?, dataBase64 } } }], meta? }`. In `createPluginNodeService`, after parsing the wasm response (`out.items`) and before returning, run a materialization pass:

```
materializeEmittedBinary(items, { blob, maxFileBytes }):
  for each item, for each [field, b] in item.binary:
    if b has a string `dataBase64`:
      bytes = Buffer.from(b.dataBase64, 'base64')
      if bytes.length > maxFileBytes: throw  (cap)
      objectKey = `workflow-artifacts/${uuid}/${sanitize(b.fileName ?? 'output')}`
      await blob.put(objectKey, bytes, b.contentType ?? 'application/octet-stream')
      item.binary[field] = { objectKey, contentType: b.contentType ?? 'application/octet-stream', fileName: b.fileName, byteSize: bytes.length }   // replace inline → BinaryRef
    else: leave as-is (already a BinaryRef, e.g. a pass-through input file)
  return items
```

- Applies to **both** abi paths (the normalization is on the returned items, after `invoke`/`invokeBytes`).
- Idempotent for already-materialized refs (no `dataBase64` ⇒ untouched), so an input `BinaryRef` that flows through unchanged is not re-written.
- Cap reuses `WORKFLOW_FILE_MAX_BYTES` (the service already has `maxFileBytes`). Host-generated keys; sanitized filename (reuse a small sanitizer mirroring the server's `sanitizeFilename`).

### Unify `export-artifact` (engine handler)
`node-handlers/export.ts` currently calls `ctx.services.exportArtifact(...)` (writes a `workflow-artifacts/` blob, returns `{ objectKey, format, byteSize }`) and returns the input items unchanged. SP-4b attaches the produced file as a `BinaryRef` on the output:

```
const result = await ctx.services.exportArtifact({ format, filename, title, columns, rows });
const ref = { objectKey: result.objectKey, contentType: CONTENT_TYPE[result.format] ?? 'application/octet-stream',
              fileName: filename ?? `export.${result.format}`, byteSize: result.byteSize };
const items = input.length > 0 ? input : [{ json: {} }];
return items.map((it, i) => i === 0 ? { ...it, binary: { ...(it.binary ?? {}), export: ref } } : it);
```
`CONTENT_TYPE = { csv:'text/csv', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf:'application/pdf' }`. No service change (the result already carries `objectKey`/`format`/`byteSize`).

### Download (reuse the existing route)
`GET /api/workflows/artifacts/*` (MANAGE, traversal-guarded, serves `workflow-artifacts/`) already exists. The web download URL is `/api/workflows/artifacts/${objectKey}` (the route's `*` param is the full key, which it requires to start with `workflow-artifacts/`). Downloads go through the existing authenticated-fetch-then-object-URL pattern the web already uses for artifacts (a small `downloadWorkflowArtifact(objectKey, fileName)` api helper if one doesn't already exist).

### Web surfacing
- A small helper `outputBinaries(nodeResult): { field, ref }[]` extracts every `binary` `BinaryRef` from a node's output items.
- **Run-History drawer:** in the per-node output section, render a download button per produced file (filename + size).
- **Node-config Output tab:** above/below the JSON view, render the same download links for the selected node's last-run output.
- Uniform for plugin outputs and `export-artifact`.

### Test fixture
`wasm/test-sink` gains `wf_emit`: returns `{ items: [{ json: { ok: true }, binary: { out: { contentType: 'text/plain', fileName: 'hello.txt', dataBase64: <base64 of "hello"> } } }] }`. A `bytes`/`items` decl (`items` is fine — it ignores input) `workflowNodes` entry `{ id:'emit', kind:'transform', entrypoint:'wf_emit' }`. Real-Extism test asserts the raw response carries `dataBase64`; a service test asserts materialization → a `BinaryRef` under `workflow-artifacts/` with `byteSize: 5`.

## Components / files

**Modify:** `packages/bootstrap/src/plugin-node-service.ts` (+ test) — `materializeEmittedBinary` pass on the returned items (both abi paths). `packages/workflows/src/engine/node-handlers/export.ts` (+ test) — attach the export `BinaryRef`. `apps/web/src/workflows/components/panels/run-history-drawer.tsx` + `node-config-panel.tsx` (+ tests where practical) — download links. `apps/web/src/api.ts` — a download helper if missing + (binary types already present from SP-4a's `WorkflowBinaryRef`). `wasm/test-sink/src/lib.rs` + `scripts/build-test-sink.mjs` — `wf_emit`; `packages/plugins/src/wf-emit.integration.test.ts` (new).

**Reuse (no change):** the `GET /api/workflows/artifacts/*` route; the `BinaryRef` type; `WORKFLOW_FILE_MAX_BYTES`.

## Testing strategy (TDD)

- **`materializeEmittedBinary` / service:** an item with inline `dataBase64` → blob written under `workflow-artifacts/`, item now carries a `BinaryRef` (`byteSize` = decoded length); over-cap → throw; an item whose binary is already a `BinaryRef` (no `dataBase64`) → untouched; no binary → untouched. Applies after both `invoke` and `invokeBytes`.
- **`export.ts`:** the handler attaches a `BinaryRef` (objectKey/format/byteSize from the service) to the first output item's `binary.export`; empty input → a single `{json:{}}` item carrying it; content-type mapped per format.
- **real wasm:** rebuild test-sink; `wf_emit` returns inline base64 through real Extism (ran, not skipped).
- **web:** `outputBinaries` extracts refs; the run-history drawer + Output tab render a download link for a node whose output item has a `binary` ref (mock the run result). Download helper builds the right `/api/workflows/artifacts/...` URL.
- **Gate:** `pnpm turbo run typecheck --force`, `pnpm depcruise`, the plugins+workflows+bootstrap+server suites + web isolated; build `--force`.

**Acceptance:** a plugin node that emits inline bytes yields a downloadable `BinaryRef` output item (materialized under `workflow-artifacts/`, cap-enforced); `export-artifact` surfaces its file the same way; the web shows download links in run-history + the Output tab; `wf_emit` proven through real Extism; full gate green. (Live browser download deferred to acceptance.)

## Security considerations

- **Cap** on the decoded base64 length before the blob write (a plugin cannot emit an unbounded file); reuses `WORKFLOW_FILE_MAX_BYTES`.
- **Host-generated object keys** (`workflow-artifacts/<uuid>/…`); plugin-supplied `fileName` is sanitized to a single path segment and only used as the key's leaf + the download filename (never a path).
- **Download** reuses the existing MANAGE-gated, traversal-guarded `/artifacts/*` route — no new attack surface; a plugin can only write under the fixed `workflow-artifacts/` prefix.
- **No base64 amplification DoS:** the cap bounds the decoded size; the wasm memory/time limits bound the producing call.

## Open questions (deferred)

- SP-5: whonet/tabular/hl7v2/dhis2-sink real plugins; whether any emit files (e.g. a rejected-rows report) via this lane.
- Future: produced-file GC/retention; a dedicated Outputs view; streaming output for very large files.
