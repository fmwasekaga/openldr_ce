# Plugin-contributed Workflow Nodes — SP-4a (Binary INPUT Lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the binary INPUT lane end-to-end — files arrive via manual upload / webhook body / ingest blob, ride the item stream as a `BinaryRef`, and reach a converter plugin node as raw bytes that returns `{items}`.

**Architecture:** One shared `files` channel seeds the trigger's item with a `BinaryRef`; a `bytes`-abi converter node reads that binary, the host fetches the blob bytes (cap-bounded) and invokes the wasm with raw bytes. Spans marketplace (schema), plugins (`invokeBytes`), workflows (files channel + trigger), ingest (event enrich), bootstrap (abi routing), config (cap), server (routes), web (run-with-file), and the test-sink fixture.

**Tech Stack:** TypeScript, Fastify, Vitest, Rust+wasm32-wasip1 (Extism), pnpm/turbo, dependency-cruiser.

**Commits:** Work stays **uncommitted** by convention — do **NOT** `git commit`/`git push`. Each task ends with a verification step.

> **Web test flake:** run web tests in isolation (`pnpm -C apps/web test ...`); never trust a turbo `web#test` red.

---

## File Structure

- `packages/marketplace/src/workflow-node.ts` (+test) — `abi`/`binaryField` on the decl schema.
- `packages/plugins/src/wasm-sink.ts` (+test) — `invokeBytes` (raw-bytes entrypoint).
- `packages/workflows/src/engine/execution-context.ts`, `run-workflow.ts`, `node-handlers/trigger.ts` (+tests) — the `files` channel + binary trigger item.
- `packages/workflows/src/trigger-runner.ts` (+test) — `runAndRecord(…, files?)` + ingest `BinaryRef`.
- `packages/ingest/src/handle.ts` (+test) — enrich `onBatchDone`.
- `packages/config/src/schema.ts` — `WORKFLOW_FILE_MAX_BYTES`.
- `packages/bootstrap/src/plugin-node-service.ts` (+test) — `abi` routing + blob + cap; `packages/bootstrap/src/index.ts` — wire blob/cap/files.
- `apps/server/src/workflows-routes.ts` (+test) — `/uploads` route, execute-stream `files`, webhook octet-stream.
- `apps/web/src/api.ts` + `apps/web/src/workflows/page.tsx` — `uploadWorkflowFile` + run-with-file.
- `wasm/test-sink/src/lib.rs`, `scripts/build-test-sink.mjs` — `wf_convert`; `packages/plugins/src/wf-convert.integration.test.ts` (new).

---

## Task 1: `abi` + `binaryField` on the node decl schema

**Files:** Modify `packages/marketplace/src/workflow-node.ts` + `workflow-node.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `workflow-node.test.ts`:

```ts
describe('workflowNodeDeclSchema abi', () => {
  it('defaults abi to "items"', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'transform', entrypoint: 'e' });
    expect(d.abi).toBe('items');
    expect(d.binaryField).toBeUndefined();
  });
  it('accepts abi:"bytes" + binaryField', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'c', label: 'C', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file' });
    expect(d.abi).toBe('bytes');
    expect(d.binaryField).toBe('file');
  });
  it('rejects an unknown abi', () => {
    expect(() => workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'transform', entrypoint: 'e', abi: 'stream' })).toThrow();
  });
});
```
(Ensure `workflowNodeDeclSchema` is imported at the top of the test file.)

- [ ] **Step 2: Run → fail**: `pnpm -C packages/marketplace exec vitest run src/workflow-node.test.ts`.

- [ ] **Step 3: Implement** — in `workflow-node.ts`, add to the `workflowNodeDeclSchema` object (after `entrypoint`):

```ts
  /** Wire ABI: 'items' = JSON {items,config} (default, SP-2); 'bytes' = the host passes the input
   *  item's binary file as RAW bytes to the wasm entrypoint, which returns {items} (converter). */
  abi: z.enum(['items', 'bytes']).default('items'),
  /** For abi:'bytes' — the binary field on the input item to read (default 'file'). */
  binaryField: z.string().min(1).optional(),
```

- [ ] **Step 4: Run → pass**: same command. Also run the full file to confirm existing decl tests still pass.

---

## Task 2: `WasmSink.invokeBytes` (raw-bytes entrypoint)

**Files:** Modify `packages/plugins/src/wasm-sink.ts` + `wasm-sink.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `wasm-sink.test.ts` (mirror the existing `invoke` tests' fake runner):

```ts
describe('invokeBytes', () => {
  it('passes raw bytes to the runner and parses the JSON result', async () => {
    let received: Uint8Array | undefined;
    const runner = { run: async (_w: Uint8Array, input: Uint8Array) => { received = input; return new TextEncoder().encode('{"items":[{"json":{"line":"a"}}]}'); } };
    const manifest = parseManifest({ id: 'p', version: '1.0.0', kind: 'sink', entrypoints: ['wf_convert'], wasmSha256: 'a'.repeat(64) });
    const sink = createWasmSink(manifest, new Uint8Array([1, 2, 3]), runner as never, logger, []);
    const out = await sink.invokeBytes('wf_convert', new Uint8Array([9, 9]));
    expect(Array.from(received!)).toEqual([9, 9]);   // raw bytes, NOT JSON-encoded
    expect(out).toEqual({ items: [{ json: { line: 'a' } }] });
  });
  it('rejects an unknown entrypoint', async () => {
    const runner = { run: async () => new Uint8Array() };
    const manifest = parseManifest({ id: 'p', version: '1.0.0', kind: 'sink', entrypoints: ['wf_convert'], wasmSha256: 'a'.repeat(64) });
    const sink = createWasmSink(manifest, new Uint8Array(), runner as never, logger, []);
    await expect(sink.invokeBytes('nope', new Uint8Array())).rejects.toThrow(/unknown entrypoint/);
  });
});
```
(Reuse the file's existing `logger`/`parseManifest` imports.)

- [ ] **Step 2: Run → fail**: `pnpm -C packages/plugins exec vitest run src/wasm-sink.test.ts`.

- [ ] **Step 3: Implement** — in `wasm-sink.ts`: add `invokeBytes` to the `WasmSink` interface and the returned object. Refactor the shared body into a private helper so `invoke` and `invokeBytes` don't duplicate the egress gate / stamp / parse:

Interface:
```ts
export interface WasmSink {
  id: string;
  version: string;
  entrypoints: string[];
  invoke(entrypoint: string, input: unknown, opts?: SinkInvokeOptions): Promise<unknown>;
  invokeBytes(entrypoint: string, bytes: Uint8Array, opts?: SinkInvokeOptions): Promise<unknown>;
}
```
Inside `createWasmSink`, replace the `invoke` implementation with a shared `runEntrypoint` + two thin wrappers:
```ts
  async function runEntrypoint(entrypoint: string, inputBytes: Uint8Array, opts: SinkInvokeOptions): Promise<unknown> {
    if (!manifest.entrypoints.includes(entrypoint)) {
      throw new Error(`sink ${manifest.id}: unknown entrypoint '${entrypoint}' (declared: ${manifest.entrypoints.join(', ') || 'none'})`);
    }
    if (opts.allowedHosts && opts.allowedHosts.length > 0 && enforced && !hasNetEgress) {
      throw new Error(`sink ${manifest.id}: egress to ${opts.allowedHosts.join(', ')} requested but the plugin has no net-egress capability`);
    }
    const doneOp = beginOp({ pluginId: manifest.id, op: 'invoke', entrypoint });
    let out: Uint8Array;
    try {
      out = await runner.run(wasm, inputBytes, {
        entrypoint, wasi: manifest.wasi, memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs, config: opts.config, host, allowedHosts: opts.allowedHosts,
      });
    } finally { doneOp(); }
    const text = decoder.decode(out).trim();
    if (!text) return {};
    try { return JSON.parse(text) as unknown; }
    catch (err) { throw new Error(`sink ${manifest.id} entrypoint '${entrypoint}' returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return {
    id: manifest.id,
    version: manifest.version,
    entrypoints: manifest.entrypoints,
    invoke: (entrypoint, input, opts = {}) => runEntrypoint(entrypoint, encoder.encode(JSON.stringify(input ?? {})), opts),
    invokeBytes: (entrypoint, bytes, opts = {}) => runEntrypoint(entrypoint, bytes, opts),
  };
```

- [ ] **Step 4: Run → pass**: `pnpm -C packages/plugins exec vitest run src/wasm-sink.test.ts` (incl. the existing invoke tests).

---

## Task 3: The `files` channel + binary trigger item

**Files:** Modify `packages/workflows/src/engine/execution-context.ts`, `run-workflow.ts`, `node-handlers/trigger.ts` + their tests.

- [ ] **Step 1: execution-context** — import `BinaryRef` and add `files`:
```ts
import type { WorkflowItem, BinaryRef } from './items';
```
In `ExecutionContext` add:
```ts
  /** Per-run file attachments (BinaryRefs), seeded onto the trigger's item. */
  files?: Record<string, BinaryRef>;
```
Add a `files` parameter to `createContext` (last, optional) and include it in the returned object:
```ts
export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
  codeLimits: CodeLimits = { timeoutMs: 5000, memoryMb: 128, enabled: false },
  services?: WorkflowServices,
  workflowId?: string,
  logger?: ExecutionContext['logger'],
  files?: Record<string, BinaryRef>,
): ExecutionContext {
  return { input, nodeOutputs: {}, branches: {}, logs: {}, emit, edges, codeLimits, services, workflowId, logger, files };
}
```

- [ ] **Step 2: run-workflow** — add `files` to `RunWorkflowOptions` and pass it:
```ts
  /** Per-run file attachments seeded onto the trigger item. */
  files?: Record<string, import('./items').BinaryRef>;
```
In `runWorkflow`, extend the `createContext(...)` call's args with `opts.files` (last positional):
```ts
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges, opts.codeLimits, opts.services, opts.workflowId, opts.logger, opts.files);
```

- [ ] **Step 3: trigger handler** — make it seed the binary item. Replace `trigger.ts`:
```ts
import type { NodeHandler } from './types';
import { toItems } from '../items';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export const triggerHandler: NodeHandler = async (node, ctx) => {
  // A per-run file attachment (manual upload / webhook body / ingest blob) rides the trigger item.
  if (ctx.files && Object.keys(ctx.files).length > 0) {
    return [{ json: isRecord(ctx.input) ? ctx.input : {}, binary: ctx.files }];
  }
  if (ctx.input !== undefined) return toItems(ctx.input);
  return [{ json: {
    triggered: true,
    triggerType: (node.data.triggerType as string | undefined) ?? 'manual',
    timestamp: new Date().toISOString(),
  } }];
};
```

- [ ] **Step 4: Update tests**:
  - `trigger.test.ts`: add a case — `ctx.files = { file: { objectKey:'k', contentType:'application/octet-stream', byteSize: 3 } }` → returns `[{ json: {...|{} }, binary: ctx.files }]`. Build ctx via `createContext(input, () => {}, [], undefined, undefined, undefined, undefined, files)`.
  - `run-workflow.test.ts`: add a case threading `files` through `runWorkflow(nodes, edges, { files })` → the trigger node's output item carries `binary`.

- [ ] **Step 5: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/trigger.test.ts src/engine/run-workflow.test.ts` → PASS. (Whole-package tsc may briefly lag if other files reference the new arg; run `pnpm -C packages/workflows exec tsc --noEmit` to confirm clean — only these files changed signatures.)

---

## Task 4: `WORKFLOW_FILE_MAX_BYTES` config

**Files:** Modify `packages/config/src/schema.ts`.

- [ ] **Step 1: Add the var** — next to the other `WORKFLOW_*` entries:
```ts
    WORKFLOW_FILE_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),
```

- [ ] **Step 2: Typecheck**: `pnpm -C packages/config exec tsc --noEmit` → PASS.

---

## Task 5: `abi` routing in the plugin-node service

**Files:** Modify `packages/bootstrap/src/plugin-node-service.ts` + `plugin-node-service.test.ts`; `packages/bootstrap/src/index.ts`.

- [ ] **Step 1: Write the failing tests** — append to `plugin-node-service.test.ts` (reuse the file's fake-deps helper, adding `blob`+`maxFileBytes`):

```ts
const BYTES_NODE = {
  id: 'convert', label: 'Convert', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
  ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
};

it('abi:bytes reads the input item binary, fetches the blob, and calls invokeBytes', async () => {
  const invokeBytes = vi.fn().mockResolvedValue({ items: [{ json: { line: 'a' } }] });
  const blobGet = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const { deps: d } = deps({
    plugins: { list: vi.fn().mockResolvedValue([pluginRow([BYTES_NODE])]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn(), invokeBytes }) },
    blob: { get: blobGet }, maxFileBytes: 1000,
  } as never);
  const items = [{ json: {}, binary: { file: { objectKey: 'uploads/x', contentType: 'application/octet-stream', byteSize: 3 } } }];
  const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'convert', config: {}, items });
  expect(blobGet).toHaveBeenCalledWith('uploads/x');
  expect(invokeBytes).toHaveBeenCalledWith('wf_convert', new Uint8Array([1, 2, 3]), { config: {}, allowedHosts: [] });
  expect(out).toEqual({ items: [{ json: { line: 'a' } }] });
});
it('abi:bytes throws when the input item has no file', async () => {
  const { deps: d } = deps({
    plugins: { list: vi.fn().mockResolvedValue([pluginRow([BYTES_NODE])]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn(), invokeBytes: vi.fn() }) },
    blob: { get: vi.fn() }, maxFileBytes: 1000,
  } as never);
  await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'convert', config: {}, items: [{ json: {} }] })).rejects.toThrow(/no file/i);
});
it('abi:bytes enforces the size cap (declared byteSize over limit)', async () => {
  const { deps: d } = deps({
    plugins: { list: vi.fn().mockResolvedValue([pluginRow([BYTES_NODE])]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn(), invokeBytes: vi.fn() }) },
    blob: { get: vi.fn() }, maxFileBytes: 2,
  } as never);
  const items = [{ json: {}, binary: { file: { objectKey: 'k', contentType: 'x', byteSize: 99 } } }];
  await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'convert', config: {}, items })).rejects.toThrow(/limit|large|exceed/i);
});
```
Update the file's `deps()` helper + the `SinkLike` mocks so `loadSink` returns an object with BOTH `invoke` and `invokeBytes`, and add `blob`/`maxFileBytes` defaults (`blob: { get: vi.fn() }`, `maxFileBytes: 52_428_800`).

- [ ] **Step 2: Run → fail**: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-service.test.ts`.

- [ ] **Step 3: Implement** — in `plugin-node-service.ts`:
  - Extend `SinkLike`:
```ts
interface SinkLike {
  invoke(entrypoint: string, input: unknown, opts?: { config?: Record<string, string>; allowedHosts?: string[] }): Promise<unknown>;
  invokeBytes(entrypoint: string, bytes: Uint8Array, opts?: { config?: Record<string, string>; allowedHosts?: string[] }): Promise<unknown>;
}
```
  - Extend `PluginNodeServiceDeps` with:
```ts
  blob: { get(key: string): Promise<Uint8Array> };
  maxFileBytes: number;
```
  - The decl now has `abi`/`binaryField` (from Task 1's schema, surfaced via `parseWorkflowNodeDecls`). Replace the single `sink.invoke(...)` call with abi routing (after `loadSink` + `wireConfig`):
```ts
    let raw: unknown;
    if (decl.abi === 'bytes') {
      const field = (typeof config.binaryField === 'string' && config.binaryField) || decl.binaryField || 'file';
      const ref = items[0]?.binary?.[field];
      if (!ref) throw new Error(`plugin ${pluginId} node ${nodeId}: no file on the input item (field '${field}')`);
      if (ref.byteSize > deps.maxFileBytes) throw new Error(`plugin ${pluginId} node ${nodeId}: file exceeds the ${deps.maxFileBytes}-byte limit`);
      const bytes = await deps.blob.get(ref.objectKey);
      if (bytes.byteLength > deps.maxFileBytes) throw new Error(`plugin ${pluginId} node ${nodeId}: file exceeds the ${deps.maxFileBytes}-byte limit`);
      // No JSON input on the bytes path — declarative config (minus connectorId) rides Extism opts.config alongside the connector secrets.
      const bytesConfig: Record<string, string> = { ...connConfig };
      for (const [k, v] of Object.entries(wireConfig)) bytesConfig[k] = typeof v === 'string' ? v : JSON.stringify(v);
      raw = await sink.invokeBytes(decl.entrypoint, bytes, { config: bytesConfig, allowedHosts });
    } else {
      raw = await sink.invoke(decl.entrypoint, { items, config: wireConfig }, { config: connConfig, allowedHosts });
    }
```
  - (`items`, `connConfig`, `wireConfig`, `allowedHosts`, `sink` are all already in scope from the existing SP-2 body. `WorkflowItem.binary` typing comes from `@openldr/workflows`.)

- [ ] **Step 4: Bootstrap wiring** — in `packages/bootstrap/src/index.ts`, extend the `createPluginNodeService({...})` call (added in SP-2, after the `dhis2Push` assignment) with:
```ts
    blob,
    maxFileBytes: cfg.WORKFLOW_FILE_MAX_BYTES,
```
(`blob` is already in scope in `createAppContext`.)

- [ ] **Step 5: Run → pass**: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-service.test.ts` + `pnpm -C packages/bootstrap exec tsc --noEmit`.

---

## Task 6: Enrich `ingest.batch.done` with the blob ref

**Files:** Modify `packages/ingest/src/handle.ts` + `handle.test.ts` / `pipeline.test.ts`.

- [ ] **Step 1: Write/extend the failing test** — in the ingest tests, assert `onBatchDone` receives `blobKey` + `byteSize`:
```ts
it('onBatchDone carries the blob ref for downstream binary consumers', async () => {
  const onBatchDone = vi.fn();
  const d = { /* existing fake deps */, onBatchDone };
  // blob.get returns 4 bytes for blobKey 'k'
  await handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'WHONET', converter: 'fhir-bundle' } });
  expect(onBatchDone).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'b1', blobKey: 'k', byteSize: 4 }));
});
```
(Adapt to the existing test file's fake-deps construction; ensure the fake `blob.get` returns a known-length Uint8Array.)

- [ ] **Step 2: Run → fail**: `pnpm -C packages/ingest exec vitest run`.

- [ ] **Step 3: Implement** — in `handle.ts`:
  - Widen the `onBatchDone` type:
```ts
  onBatchDone?: (info: { batchId: string; source: string; converter: string; count: number; blobKey: string; byteSize: number }) => Promise<void>;
```
  - At the call site (currently line ~55) pass the new fields (`blobKey` and `raw` are in scope):
```ts
    await deps.onBatchDone?.({ batchId, source, converter, count: resources.length, blobKey, byteSize: raw.byteLength });
```

- [ ] **Step 4: Run → pass**: `pnpm -C packages/ingest exec vitest run`. (`ingest-context.ts`'s `onBatchDone: (info) => eventing.publish(... payload: info)` forwards the new fields automatically — no change there.)

---

## Task 7: Trigger-runner — `files` arg + ingest BinaryRef

**Files:** Modify `packages/workflows/src/trigger-runner.ts` + `trigger-runner.test.ts`.

- [ ] **Step 1: Write the failing test** — in `trigger-runner.test.ts`, extend the ingest case so the event payload carries `blobKey`+`byteSize` and assert the workflow runs with a `files` map. Since `runAndRecord` calls `deps.runWorkflow`, spy on `runWorkflow` and assert it received `files: { file: { objectKey: 'ingest/b1/whonet.sqlite', byteSize: 10, ... } }`:
```ts
it('ingest event with a blob ref runs the workflow with a file on the trigger', async () => {
  const runWorkflow = vi.fn().mockResolvedValue({ status: 'completed', startedAt: 't', finishedAt: 't', results: [] });
  // build deps with this runWorkflow + an ingest-tagged workflow id
  const runner = createWorkflowTriggerRunner({ /* …deps…, */ runWorkflow });
  runner.setIngestWorkflowIds(['wf1']);
  await runner.registerRunner(ev);
  await ev.handlers.get('ingest.batch.done')!({ type: 'ingest.batch.done', payload: { source: 'WHONET', count: 1, blobKey: 'ingest/b1/whonet.sqlite', byteSize: 10 } });
  expect(runWorkflow).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    expect.objectContaining({ files: { file: expect.objectContaining({ objectKey: 'ingest/b1/whonet.sqlite', byteSize: 10 }) } }));
});
```
(Adapt to the file's existing fake-eventing `ev` + deps construction; make the workflow's `ingestNodeMatches` pass — an enabled workflow with an ingest trigger node and matching/empty sourceFilter.)

- [ ] **Step 2: Run → fail**: `pnpm -C packages/workflows exec vitest run src/trigger-runner.test.ts`.

- [ ] **Step 3: Implement** — in `trigger-runner.ts`:
  - Import the type: `import type { BinaryRef } from './engine/items';`
  - Widen `runAndRecord` to accept `files`:
```ts
  async function runAndRecord(workflowId: string, source: TriggerSource, input: unknown, files?: Record<string, BinaryRef>): Promise<void> {
```
  and pass it into the `deps.runWorkflow(def.nodes, def.edges, { input, files, codeLimits: …, services: …, workflowId, logger: … })` call.
  - Update the `WorkflowTriggerRunner` interface's `runAndRecord` signature to add `files?: Record<string, BinaryRef>`.
  - In the `INGEST_DONE` subscriber, derive the BinaryRef and pass it:
```ts
      await eventing.subscribe(INGEST_DONE, async (event) => {
        const payload = (event.payload ?? {}) as { source?: unknown; blobKey?: unknown; byteSize?: unknown };
        const source = String(payload.source ?? '').trim().toLowerCase();
        const files = (typeof payload.blobKey === 'string' && typeof payload.byteSize === 'number')
          ? { file: { objectKey: payload.blobKey, contentType: 'application/octet-stream', fileName: payload.blobKey.split('/').pop() ?? 'payload', byteSize: payload.byteSize } as BinaryRef }
          : undefined;
        for (const workflowId of ingestIds) {
          try {
            if (!(await ingestNodeMatches(workflowId, source))) continue;
            await runAndRecord(workflowId, 'ingest', event.payload, files);
          } catch (err) {
            deps.logger.error({ err, workflowId }, 'ingest-triggered workflow run failed');
          }
        }
      });
```

- [ ] **Step 4: Run → pass**: `pnpm -C packages/workflows exec vitest run src/trigger-runner.test.ts` + `pnpm -C packages/workflows exec tsc --noEmit`.

---

## Task 8: Server — upload route, execute-stream files, webhook octet-stream

**Files:** Modify `apps/server/src/workflows-routes.ts` + `workflows-routes.test.ts`.

- [ ] **Step 1: Write the failing tests** — in `workflows-routes.test.ts`:
  - `POST /api/workflows/:id/uploads` with an octet-stream body → 200 + a `BinaryRef` (`ctx.blob.put` called). Over-cap → 413. (The fake ctx needs a `blob: { put: vi.fn(), get: vi.fn() }` and `cfg.WORKFLOW_FILE_MAX_BYTES`.) Use `app.inject({ method:'POST', url:'/api/workflows/w1/uploads?filename=a.csv', headers:{'content-type':'application/octet-stream'}, payload: Buffer.from('hello') })`.
  - `POST /api/workflows/:id/execute-stream` already covered; add that a `files` body field is accepted (passed into `runWorkflow` — spy or assert no error). (Optional if hard to assert with SSE; the unit coverage of `files` lives in the engine tests.)
  - webhook: a `POST /api/workflows/hooks/<path>` with octet-stream body + valid token → `runner.runAndRecord` called with a `files` map.

```ts
it('POST /uploads stores an octet-stream body and returns a BinaryRef', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = USER; });
  const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx);
  const res = await app.inject({ method: 'POST', url: '/api/workflows/w1/uploads?filename=a.csv', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('hello') });
  expect(res.statusCode).toBe(200);
  const ref = res.json();
  expect(ref).toMatchObject({ contentType: 'application/octet-stream', fileName: 'a.csv', byteSize: 5 });
  expect(ref.objectKey).toMatch(/^workflow-uploads\//);
  expect(ctx.blob.put).toHaveBeenCalled();
});
it('POST /uploads rejects an over-cap body with 413', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = USER; });
  const ctx = fakeCtx(); ctx.cfg.WORKFLOW_FILE_MAX_BYTES = 2; registerWorkflowRoutes(app, ctx);
  const res = await app.inject({ method: 'POST', url: '/api/workflows/w1/uploads', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('toolong') });
  expect(res.statusCode).toBe(413);
});
```
Extend `fakeCtx` with `blob: { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() }` and ensure `cfg.WORKFLOW_FILE_MAX_BYTES` is set (e.g. 52428800).

- [ ] **Step 2: Run → fail**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`.

- [ ] **Step 3: Implement** — in `workflows-routes.ts`:
  - At the top of `registerWorkflowRoutes`, ensure an octet-stream parser (stream passthrough — mirrors terminology-admin; guarded so it doesn't double-register):
```ts
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
  }
```
  - Add a capped stream/Buffer reader helper (module scope):
```ts
async function readBinaryBody(body: unknown, maxBytes: number): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    if (body.length > maxBytes) throw Object.assign(new Error('file too large'), { statusCode: 413 });
    return body;
  }
  if (body && typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = []; let total = 0;
    for await (const c of body as AsyncIterable<Buffer | string>) {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > maxBytes) throw Object.assign(new Error('file too large'), { statusCode: 413 });
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  }
  throw Object.assign(new Error('expected a binary body'), { statusCode: 400 });
}
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'upload';
}
```
  - The upload route:
```ts
  app.post('/api/workflows/:id/uploads', MANAGE, async (req, reply) => {
    const max = ctx.cfg.WORKFLOW_FILE_MAX_BYTES;
    let buf: Buffer;
    try { buf = await readBinaryBody(req.body, max); }
    catch (err) { const code = (err as { statusCode?: number }).statusCode ?? 400; reply.code(code); return { error: (err as Error).message }; }
    const filename = sanitizeFilename(((req.query as { filename?: string }).filename) ?? 'upload');
    const objectKey = `workflow-uploads/${randomUUID()}/${filename}`;
    const contentType = (req.headers['content-type'] as string | undefined) ?? 'application/octet-stream';
    await ctx.blob.put(objectKey, new Uint8Array(buf), contentType);
    return { objectKey, contentType, fileName: filename, byteSize: buf.length };
  });
```
  - Extend the execute-stream body parse to read `files`:
```ts
    const body = (req.body ?? {}) as { input?: unknown; files?: Record<string, unknown> };
```
  and add `files: body.files as Record<string, import('@openldr/workflows').BinaryRef> | undefined,` to the `runWorkflow(...)` options.
  - Webhook: in `POST /api/workflows/hooks/*`, after the secret check, branch on a binary body:
```ts
    let files: Record<string, unknown> | undefined;
    let body = req.body as unknown;
    const ct = String(req.headers['content-type'] ?? '');
    if (!ct.includes('application/json') && req.body && typeof (req.body as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      let buf: Buffer;
      try { buf = await readBinaryBody(req.body, ctx.cfg.WORKFLOW_FILE_MAX_BYTES); }
      catch (err) { const code = (err as { statusCode?: number }).statusCode ?? 400; reply.code(code); return { error: (err as Error).message }; }
      const objectKey = `workflow-uploads/${randomUUID()}/webhook`;
      await ctx.blob.put(objectKey, new Uint8Array(buf), 'application/octet-stream');
      files = { file: { objectKey, contentType: 'application/octet-stream', fileName: 'webhook', byteSize: buf.length } };
      body = undefined;
    }
    await ctx.workflows.runner.runAndRecord(entry.workflowId, 'webhook', {
      method: req.method, body, headers: stripAuthHeaders(req.headers as Record<string, unknown>), query: req.query,
    }, files as Record<string, import('@openldr/workflows').BinaryRef> | undefined);
```
  (Add `randomUUID` to the existing `node:crypto` import if not present — it is already imported in this file.)

- [ ] **Step 4: Run → pass**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts` + `pnpm -C apps/server exec tsc --noEmit`.

---

## Task 9: `wf_convert` wasm fixture

**Files:** Modify `wasm/test-sink/src/lib.rs`, `scripts/build-test-sink.mjs`; create `packages/plugins/src/wf-convert.integration.test.ts`.

- [ ] **Step 1: Add the entrypoint** — in `wasm/test-sink/src/lib.rs`, inside `mod plugin`, after `wf_echo`:
```rust
    /// Converter ABI: raw bytes in (UTF-8 text) → { items: one per non-empty line }.
    #[plugin_fn]
    pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
        let text = String::from_utf8_lossy(&input);
        let items: Vec<Value> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| json!({ "json": { "line": l } }))
            .collect();
        Ok(json!({ "items": items }).to_string())
    }
```

- [ ] **Step 2: Manifest** — in `scripts/build-test-sink.mjs`: add `wf_convert` to `entrypoints` and add a `bytes` node to `workflowNodes`:
```js
  entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert'],
```
```js
    {
      id: 'convert', label: 'Convert Lines', kind: 'transform', entrypoint: 'wf_convert',
      abi: 'bytes', binaryField: 'file',
      ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
      config: [],
    },
```

- [ ] **Step 3: Rebuild**: `node scripts/build-test-sink.mjs` → expect the staged sha line. If the Rust toolchain is missing, STOP/BLOCKED (it was present when planned: cargo 1.96 + wasm32-wasip1).

- [ ] **Step 4: Integration test** — create `packages/plugins/src/wf-convert.integration.test.ts` (mirror `wf-echo.integration.test.ts`):
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
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({ id: 'test-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert'], wasmSha256: sha256Hex(wasm), wasi: true });
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('test-sink wf_convert through the real Extism runner (bytes ABI)', () => {
  it('parses raw bytes (lines) into items', async () => {
    const bytes = new TextEncoder().encode('alpha\nbeta\n\ngamma\n');
    const out = (await sink().invokeBytes('wf_convert', bytes)) as { items: { json: { line: string } }[] };
    expect(out.items).toEqual([{ json: { line: 'alpha' } }, { json: { line: 'beta' } }, { json: { line: 'gamma' } }]);
  });
});
```

- [ ] **Step 5: Run → pass (not skipped)**: `pnpm -C packages/plugins exec vitest run src/wf-convert.integration.test.ts` → 1 test executed.

---

## Task 10: Web — upload helper + run-with-file

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/workflows/page.tsx`.

- [ ] **Step 1: api.ts** — add `abi`/`binaryField` to the descriptor types (from Task 3 of SP-3b) and an upload helper; extend `executeWorkflowStream` to pass `files`:
```ts
// in WorkflowNodeConfigField/WorkflowNodeDescriptor (add):
//   abi?: 'items' | 'bytes';  binaryField?: string;   (on WorkflowNodeDescriptor)
export interface WorkflowBinaryRef { objectKey: string; contentType: string; fileName?: string; byteSize: number }
export async function uploadWorkflowFile(workflowId: string, file: File): Promise<WorkflowBinaryRef> {
  const r = await authFetch(`/api/workflows/${encodeURIComponent(workflowId)}/uploads?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return r.json() as Promise<WorkflowBinaryRef>;
}
```
Add `abi?: 'items' | 'bytes'` and `binaryField?: string` to `WorkflowNodeDescriptor`. Change `executeWorkflowStream(id, input, onEvent)` to `executeWorkflowStream(id, input, onEvent, files?)` and include `files` in the POST body JSON.

- [ ] **Step 2: page.tsx run-with-file** — read the existing `execute` handler (passed as `onRun={execute}` to the Toolbar). Add: before running, determine whether the workflow needs a file — fetch the node catalog once (`fetchWorkflowNodes`) and check whether any canvas node is a `plugin-node` whose descriptor has `abi==='bytes'`. If so, open a hidden `<input type="file">`; on selection, `uploadWorkflowFile(workflowId, file)` → `executeWorkflowStream(id, input, onEvent, { file: ref })`. If no bytes node, run as today (no files). Keep the existing SSE handling. Persist the workflow first if it has no `workflowId` (uploads need the id) — reuse the existing save-before-run guard if present, else save then run.

- [ ] **Step 3: Verify**: `pnpm -C apps/web exec tsc --noEmit` + `pnpm -C apps/web test src/workflows` (isolated) → PASS. (Add a focused test only if the run handler is unit-testable; otherwise rely on tsc + the manual acceptance note.)

---

## Task 11: Full gate

- [ ] **Step 1: Typecheck (forced)**: `pnpm turbo run typecheck --force` → all PASS.
- [ ] **Step 2: Depcruise**: `pnpm depcruise` → 0 errors. (`@openldr/ingest` already a dep where used; no new cross-package cycles — bootstrap→workflows/plugins/marketplace and ingest are pre-existing edges.)
- [ ] **Step 3: Targeted suites**:
  - `pnpm -C packages/marketplace exec vitest run`
  - `pnpm -C packages/plugins exec vitest run`
  - `pnpm -C packages/workflows exec vitest run`
  - `pnpm -C packages/ingest exec vitest run`
  - `pnpm -C packages/bootstrap exec vitest run`
  - `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`
  - `pnpm -C apps/web test src/workflows` (isolated)
  Expected: all PASS, incl. the real-Extism `wf_convert`.
- [ ] **Step 4: Build (forced)**: `pnpm turbo run build --force` → PASS.
- [ ] **Step 5: Acceptance** — confirm: a `Manual Trigger (file) → test-sink:convert (bytes) → materialize` chain feeds the uploaded file's bytes to the wasm and the sink receives the converted items (unit/integration level); webhook + ingest seed the same binary trigger item; the cap is enforced (413 / throw); `wf_convert` ran through real Extism (not skipped); no SP-2/3 behavior changed for `abi:'items'` nodes.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 schema (`abi`/`binaryField`); Task 2 `invokeBytes`; Task 3 files channel + binary trigger item; Task 4 cap config; Task 5 abi routing + bootstrap wiring; Task 6 ingest event enrich; Task 7 trigger-runner files + ingest BinaryRef; Task 8 server upload/execute-stream/webhook; Task 9 `wf_convert` fixture; Task 10 web; Task 11 gate.
- **Type consistency:** `BinaryRef` is sourced from `@openldr/workflows` (`engine/items`); the `files` channel is `Record<string, BinaryRef>` everywhere (ctx, RunWorkflowOptions, runAndRecord, route bodies). `invokeBytes(entrypoint, Uint8Array, opts)` matches between `wasm-sink.ts` and the service's `SinkLike`. The decl's `abi`/`binaryField` flow from the marketplace schema through `parseWorkflowNodeDecls` into the service.
- **Security:** size cap at upload, webhook store, declared `byteSize`, AND fetched length; host-generated `workflow-uploads/<uuid>/…` keys; sanitized filename; webhook stays secret-gated; converter nodes keep `assertNodeAllowed`.
- **Additive:** `abi` defaults `'items'` so every SP-2/3 node is unchanged; the engine `pluginNodeHandler` is untouched (binary rides the items it already forwards); existing trigger/run behavior is unchanged when no `files` are present.
- **Mid-refactor note:** Task 3 changes `createContext`'s arity — only `run-workflow.ts` calls it in-package; the bootstrap/server call `runWorkflow` (not `createContext`), so they're unaffected. `tsc` should stay green per-package after each task.
