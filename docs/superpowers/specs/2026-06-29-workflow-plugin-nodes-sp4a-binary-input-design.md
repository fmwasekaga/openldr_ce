# Plugin-contributed Workflow Nodes — SP-4a (Binary INPUT Lane) Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm complete)
- **Owner:** Fredrick
- **Parent design:** [2026-06-29-workflow-plugin-nodes-design.md](2026-06-29-workflow-plugin-nodes-design.md) (SP-4). SP-4 is split into **SP-4a (this doc — binary input)** then **SP-4b (binary output)**.
- **Depends on:** SP-1 (`workflowNodeDeclSchema`), SP-2 (`runPluginNode`, `WasmSink`, `BinaryRef`), SP-3a (`WorkflowItem[]` engine), SP-3b (builder). Related: [[workflow-plugin-nodes-workstream]].

## Problem

A plugin can contribute and run JSON `{items,config}` nodes (SP-2/3), but the north-star — a WHONET **file** → converter plugin → items → DHIS2 — needs a binary path: files must arrive into a run, ride the item stream, and reach a converter plugin as raw bytes. SP-4a builds the binary **input** lane end-to-end: per-run/upload/webhook/ingest file arrival, the `BinaryRef` lane on items, and a raw-bytes converter execution path. Binary **output** (nodes emitting files) is SP-4b.

## Goals / Non-goals

**Goals**
- `WorkflowItem.binary?: Record<string, BinaryRef>` becomes real (blob-backed file attachments riding the item stream).
- A converter-from-bytes plugin node: declares `abi:'bytes'`; the host reads its input item's binary, fetches the blob bytes, and invokes the wasm entrypoint with **raw bytes** (not JSON), parsing back `{items}`.
- Files arrive via all three triggers, each seeding one shared `files` channel onto the trigger's item: **manual** (per-run upload), **webhook** (octet-stream body), **ingest** (the already-stored batch blob).
- A `WORKFLOW_FILE_MAX_BYTES` cap enforced at every blob read/write.
- A real `wf_convert` wasm fixture proving bytes→items through Extism.
- Web: the Run flow prompts for a file when the workflow contains a `bytes` node.

**Non-goals (SP-4a)**
- Binary **output** — plugin nodes emitting files, binary download routes, web surfacing of output files (SP-4b).
- Multipart upload (`@fastify/multipart`). SP-4a uses raw `application/octet-stream` bodies only.
- Streaming/chunked blob reads into the sandbox (whole-file read, cap-bounded).
- Migrating the real whonet-sqlite plugin to a converter node (SP-5).

## Key decisions (brainstorm 2026-06-29)

1. **File arrival = per-run upload** + webhook body + ingest blob — all three wired in 4a, each seeding one `files` channel.
2. **Converter ABI = distinct raw-bytes envelope** — wasm Extism input is the raw file bytes; config via `opts.config`; returns `{items}` JSON.
3. **Scope = input lane** (4a); output lane = 4b.
4. **Converter is a `kind:'transform'`** fed by a file-carrying trigger (not a `source` — sources get `items:[]` and couldn't see the file). An `abi:'bytes'` decl discriminator routes the raw-bytes path; default `abi:'items'` keeps SP-2 nodes unchanged.
5. **Ingest reuses the existing batch blob** — enrich `ingest.batch.done` with `{blobKey, byteSize}` (the file is already at `ingest/<batchId>/…`); no re-storage.

## Architecture

### The binary lane
`engine/items.ts` already declares `BinaryRef = {objectKey, contentType, fileName?, byteSize}` and `WorkflowItem.binary?`. SP-4a uses them: an item may carry `binary: { <field>: BinaryRef }`. `toItems`/`fromItems` are unaffected (they operate on `.json`); binary rides alongside.

### File arrival → one `files` channel
A run is seeded with an optional `files: Record<string, BinaryRef>`. It flows: route/trigger → `RunWorkflowOptions.files` → `ExecutionContext.files` → the **trigger handler** builds the first item as `{ json: <input-as-json>, binary: ctx.files }`. So every trigger type produces a binary-bearing item through the same path.

- `RunWorkflowOptions` gains `files?: Record<string, BinaryRef>`; `createContext`/`ExecutionContext` gain `files`.
- `triggerHandler`: when `ctx.files` is non-empty → `[{ json: (isRecord(ctx.input) ? ctx.input : {}), binary: ctx.files }]`; else unchanged (`toItems(ctx.input)`).

**1. Manual upload**
- `POST /api/workflows/:id/uploads` (MANAGE) — `application/octet-stream` raw body (Fastify `addContentTypeParser`, mirroring `terminology-admin-routes`), optional `?filename=`. Enforces `WORKFLOW_FILE_MAX_BYTES`. Stores to blob `workflow-uploads/<uuid>/<filename>`, returns `BinaryRef { objectKey, contentType, fileName, byteSize }`.
- `POST /api/workflows/:id/execute-stream` body extends to `{ input?, files? }`; passes `files` into `runWorkflow`.

**2. Webhook**
- `POST /api/workflows/hooks/*` adds an `octet-stream` content-type parser (raw body). When the body is binary (not JSON), store to blob `workflow-uploads/<uuid>/<name>` (cap-checked) → `files: { file: BinaryRef }`; JSON bodies behave as today (no file). `runAndRecord` gets the `files`.

**3. Ingest**
- `packages/ingest/handle.ts`: enrich `onBatchDone` info from `{ batchId, source, converter, count }` to also include `{ blobKey, byteSize: raw.byteLength }` (both already in scope at the call site). `ingest.batch.done` payload carries them.
- `trigger-runner.ts`: the `INGEST_DONE` handler builds `BinaryRef { objectKey: blobKey, contentType: 'application/octet-stream', fileName: blobKey.split('/').pop(), byteSize }` and calls `runAndRecord(workflowId, 'ingest', payload, { file: ref })`.
- `runAndRecord(workflowId, source, input, files?)` — new optional `files` arg threaded into `runWorkflow`.

### Converter-from-bytes execution path
- **Schema:** add `abi: z.enum(['items','bytes']).default('items')` and `binaryField: z.string().optional()` to `workflowNodeDeclSchema` (`@openldr/marketplace`). Additive; existing decls unchanged (default `'items'`).
- **WasmSink:** add `invokeBytes(entrypoint, bytes: Uint8Array, opts?) => Promise<unknown>` to `packages/plugins/src/wasm-sink.ts` — same entrypoint-allowlist check, egress gate, crash stamp, and JSON-output parsing as `invoke`, but passes the **raw bytes** to `runner.run` instead of `JSON.stringify(input)`.
- **Bootstrap `createPluginNodeService` / `runPluginNode`:** route on the resolved decl's `abi`:
  - `abi:'items'` (default) → the SP-2 `{items,config}` path (unchanged).
  - `abi:'bytes'` → read `field = decl-or-config binaryField ?? 'file'`; `const ref = items[0]?.binary?.[field]`; if absent → throw `converter node: no file on the input item`; enforce `ref.byteSize <= maxFileBytes`; `const bytes = await blob.get(ref.objectKey)` (re-check `bytes.byteLength <= maxFileBytes`); `const raw = await sink.invokeBytes(decl.entrypoint, bytes, { config: wireConfig, allowedHosts })`; normalize `{items}`.
  - Deps gain `blob: { get(key): Promise<Uint8Array> }` and `maxFileBytes: number`. Connector/egress handling is shared with the items path.
- The engine `pluginNodeHandler` is unchanged — it already forwards the full input items (binary included); the host service decides the abi.

### Config
`packages/config/src/schema.ts`: `WORKFLOW_FILE_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800)` (50 MB). Threaded to `createPluginNodeService` (`maxFileBytes`) + the upload/webhook routes.

### Test fixture
`wasm/test-sink` gains a `wf_convert` entrypoint: raw bytes in (e.g. UTF-8 lines) → `{ items: lines.map(l => ({ json: { line: l } })) }`. `scripts/build-test-sink.mjs` lists `wf_convert` in `entrypoints` and adds a `bytes`-abi `workflowNodes` decl (`{ id:'convert', kind:'transform', abi:'bytes', entrypoint:'wf_convert', config:[{key:'binaryField',…}] }`). Rebuilt.

### Web
- `api.ts`: `uploadWorkflowFile(id, file): Promise<BinaryRef>` (POST octet-stream) + extend `executeWorkflowStream` to accept `files`.
- The Run flow (toolbar/run action): if the workflow definition has any `plugin-node` whose descriptor `abi==='bytes'`, show a file picker; on run, upload → pass `files`. (Descriptor abi comes from `fetchWorkflowNodes`.)
- The `WorkflowNodeConfigField`/descriptor types gain `abi`/`binaryField` so the form + run flow can see them.

## Components / files

**Modify:** `packages/marketplace/src/workflow-node.ts` (+ test) — `abi`/`binaryField`. `packages/plugins/src/wasm-sink.ts` (+ test) — `invokeBytes`. `packages/plugins/src/manifest.ts` mirror if needed (entrypoints already cover it). `packages/workflows/src/engine/{execution-context,run-workflow}.ts` + `node-handlers/trigger.ts` (+ tests) — `files` channel + binary trigger item. `packages/workflows/src/engine/services.ts` — (no new field; binary rides items). `packages/workflows/src/trigger-runner.ts` (+ test) — `runAndRecord(…, files?)` + ingest BinaryRef. `packages/ingest/src/handle.ts` (+ test) — enrich `onBatchDone`. `packages/bootstrap/src/plugin-node-service.ts` (+ test) — `abi` routing + blob + cap. `packages/bootstrap/src/index.ts` — pass `blob`+`maxFileBytes`; thread `files` to the trigger-runner ingest path. `packages/config/src/schema.ts` — `WORKFLOW_FILE_MAX_BYTES`. `apps/server/src/workflows-routes.ts` (+ test) — `/uploads` route + execute-stream `files` + webhook octet-stream. `apps/web/src/api.ts` + the Run flow. `wasm/test-sink/src/lib.rs` + `scripts/build-test-sink.mjs`.

## Testing strategy (TDD)

- **Schema:** `abi` defaults `'items'`; accepts `'bytes'`; `binaryField` optional. Existing decl tests unchanged.
- **`invokeBytes`:** passes raw bytes to the runner (spy), parses JSON output, enforces the entrypoint allowlist + egress gate (fake runner).
- **trigger handler + run-workflow:** `ctx.files` → first item carries `binary`; no files → unchanged. Multi-trigger seeding via `RunWorkflowOptions.files`.
- **trigger-runner:** ingest event with `{blobKey, byteSize}` → `runAndRecord` called with a `files` map carrying the right `BinaryRef`; `runAndRecord(…, files)` threads into `runWorkflow`.
- **ingest handle:** `onBatchDone` receives `blobKey`+`byteSize`.
- **plugin-node-service (bytes path):** fake blob+runner+decl(`abi:'bytes'`) → reads `items[0].binary.file`, fetches the blob, calls `invokeBytes`, returns items; missing binary → throw; over-cap → throw; `abi:'items'` still uses the JSON path.
- **upload route:** stores to blob + returns a `BinaryRef`; over-cap → 413; MANAGE-gated. **webhook:** octet-stream body → `files` seeded; JSON body → no file (unchanged).
- **real wasm:** rebuild test-sink; `wf_convert` bytes→items through real Extism (ran, not skipped).
- **web:** Run flow shows the picker for a `bytes` workflow; `uploadWorkflowFile` posts octet-stream.
- **Gate:** `pnpm turbo run typecheck --force`, `pnpm depcruise`, the marketplace+plugins+workflows+bootstrap+ingest+server suites, web isolated; build `--force`.

**Acceptance:** a `Manual Trigger (file) → test-sink:convert (bytes) → materialize` workflow runs end-to-end at the unit/integration level — the uploaded file's bytes reach the wasm and its items reach the sink; webhook and ingest seed the same binary item; `wf_convert` proven through real Extism; cap enforced; full gate green. (Live browser e2e deferred to acceptance.)

## Security considerations

- **Size cap** at upload, webhook store, and blob read (defense in depth) → 413/throw over `WORKFLOW_FILE_MAX_BYTES`.
- **Host-generated object keys** (`workflow-uploads/<uuid>/…`); the caller never controls the blob path. Filename is sanitized to a single path segment.
- **Webhook stays secret-gated**; a binary body is still subject to the per-path secret check before any blob write.
- **Converter nodes** get the same `assertNodeAllowed` caps-subset + egress kill-switch as items nodes; bytes are read host-side and handed to the sandbox (no host-fs/path access for the plugin).
- **Blob reads** are bounded by the cap before allocation; a forged `BinaryRef.byteSize` is re-checked against the actual fetched length.

## Open questions (deferred)

- SP-4b: how a plugin emits a file (inline base64 in the `{items}` response → host materializes to blob → `BinaryRef`), binary item threading, the download route + web surfacing.
- SP-5: migrate whonet-sqlite/tabular/hl7v2 to converter nodes (`abi:'bytes'`); whether they emit `{items}` directly or reuse the FHIR-NDJSON converter path.
- Future: multipart upload; streaming blob reads for very large files; per-item fan-out so a converter can emit a binary-per-item.
