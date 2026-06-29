# Plugin-contributed Workflow Nodes — SP-4b (Binary OUTPUT Lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let nodes PRODUCE downloadable files — a plugin emits inline base64 bytes that the host materializes to a `BinaryRef` output item, the host `export-artifact` sink is unified onto the same lane, and the web surfaces download links in run-history + the node Output tab.

**Architecture:** A "produced file" is a `WorkflowItem.binary[field]` that is a `BinaryRef` under `workflow-artifacts/`. The bootstrap service materializes a plugin's inline `{contentType,fileName?,dataBase64}` → blob → `BinaryRef` (cap-enforced, both abi paths); `export-artifact` attaches a `BinaryRef` from its existing blob result; the web scans output items for binary refs and downloads via the existing `GET /api/workflows/artifacts/*` route.

**Tech Stack:** TypeScript, Vitest, Rust+wasm32-wasip1 (Extism), React 18, pnpm/turbo, dependency-cruiser.

**Commits:** Work stays **uncommitted** by convention — do **NOT** `git commit`/`git push`. Each task ends with a verification step.

> **Web test flake:** run web tests in isolation (`pnpm -C apps/web test ...`); never trust a turbo `web#test` red.

---

## File Structure

- `packages/bootstrap/src/plugin-node-service.ts` (+ test) — `materializeEmittedBinary` pass on the wasm's returned items (both abi paths); `deps.blob` gains `put`.
- `packages/bootstrap/src/index.ts` — already passes `blob` (full `BlobStoragePort` has `put`); no change unless the dep type needs widening (it's the same object).
- `packages/workflows/src/engine/node-handlers/export.ts` (+ test) — attach the export `BinaryRef` to the output.
- `apps/web/src/api.ts` — `downloadWorkflowArtifact(objectKey, fileName)` helper.
- `apps/web/src/workflows/lib/output-binaries.ts` (new, + test) — `outputBinaries(output)` extracts `{field, ref}[]` from a node's output items.
- `apps/web/src/workflows/components/panels/run-history-drawer.tsx` — replace the stale `objectKey` Artifacts section with item-binary download links.
- `apps/web/src/workflows/components/panels/node-config-panel.tsx` — download links above the Output JSON.
- `wasm/test-sink/src/lib.rs`, `scripts/build-test-sink.mjs` — `wf_emit`; `packages/plugins/src/wf-emit.integration.test.ts` (new).

---

## Task 1: Service materializes emitted inline binary

**Files:** Modify `packages/bootstrap/src/plugin-node-service.ts` + `plugin-node-service.test.ts`; `packages/bootstrap/src/index.ts`.

- [ ] **Step 1: Write the failing tests** — append to `plugin-node-service.test.ts` (reuse the `deps()` helper; ensure `blob` has a `put` mock):

```ts
describe('createPluginNodeService binary output', () => {
  it('materializes an item emitting inline base64 into a BinaryRef under workflow-artifacts/', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const emitted = { items: [{ json: { ok: true }, binary: { out: { contentType: 'text/plain', fileName: 'hello.txt', dataBase64: 'aGVsbG8=' } } }] };
    const { deps: d } = deps({}, vi.fn().mockResolvedValue(emitted));
    d.blob = { get: vi.fn(), put };
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^workflow-artifacts\/.+\/hello\.txt$/), expect.any(Uint8Array), 'text/plain');
    const ref = out.items[0].binary!.out as { objectKey: string; contentType: string; fileName: string; byteSize: number };
    expect(ref.objectKey).toMatch(/^workflow-artifacts\//);
    expect(ref.byteSize).toBe(5);
    expect((ref as { dataBase64?: unknown }).dataBase64).toBeUndefined();
  });
  it('leaves an already-materialized BinaryRef (no dataBase64) untouched', async () => {
    const put = vi.fn();
    const passthrough = { items: [{ json: {}, binary: { in: { objectKey: 'workflow-uploads/x/f', contentType: 'x', byteSize: 3 } } }] };
    const { deps: d } = deps({}, vi.fn().mockResolvedValue(passthrough));
    d.blob = { get: vi.fn(), put };
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] });
    expect(put).not.toHaveBeenCalled();
    expect(out.items[0].binary!.in).toEqual({ objectKey: 'workflow-uploads/x/f', contentType: 'x', byteSize: 3 });
  });
  it('throws when an emitted file exceeds the cap', async () => {
    const big = Buffer.from('x'.repeat(20)).toString('base64');
    const { deps: d } = deps({}, vi.fn().mockResolvedValue({ items: [{ json: {}, binary: { out: { contentType: 'text/plain', dataBase64: big } } }] }));
    d.blob = { get: vi.fn(), put: vi.fn() }; d.maxFileBytes = 3;
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] })).rejects.toThrow(/limit|exceed|large/i);
  });
});
```
Make the `deps()` helper's default `blob` include `put: vi.fn().mockResolvedValue(undefined)`.

- [ ] **Step 2: Run → fail**: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-service.test.ts`.

- [ ] **Step 3: Implement** — in `plugin-node-service.ts`:
  - Add `randomUUID` to the imports: `import { randomUUID } from 'node:crypto';`
  - Widen `PluginNodeServiceDeps.blob` to include `put`:
```ts
  blob: { get(key: string): Promise<Uint8Array>; put(key: string, body: Uint8Array, contentType?: string): Promise<void> };
```
  - Add module-scope helpers:
```ts
function sanitizeOutName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'output';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'output';
}

/** Replace any item binary entry carrying inline `dataBase64` with a blob-backed BinaryRef.
 *  Already-materialized refs (no dataBase64) pass through untouched. */
async function materializeEmittedBinary(
  items: WorkflowItem[],
  deps: { blob: { put(key: string, body: Uint8Array, contentType?: string): Promise<void> }; maxFileBytes: number },
): Promise<WorkflowItem[]> {
  for (const item of items) {
    if (!item.binary) continue;
    for (const [field, value] of Object.entries(item.binary)) {
      const inline = value as { contentType?: string; fileName?: string; dataBase64?: unknown };
      if (typeof inline.dataBase64 !== 'string') continue;
      const bytes = Buffer.from(inline.dataBase64, 'base64');
      if (bytes.byteLength > deps.maxFileBytes) throw new Error(`emitted file exceeds the ${deps.maxFileBytes}-byte limit`);
      const fileName = sanitizeOutName(inline.fileName ?? 'output');
      const objectKey = `workflow-artifacts/${randomUUID()}/${fileName}`;
      const contentType = inline.contentType ?? 'application/octet-stream';
      await deps.blob.put(objectKey, new Uint8Array(bytes), contentType);
      item.binary[field] = { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    }
  }
  return items;
}
```
  - At the end of the `runPluginNode` closure, change the return so the items pass through materialization:
```ts
    const out = (raw && typeof raw === 'object' ? raw : {}) as { items?: unknown; meta?: unknown };
    const outItems = Array.isArray(out.items) ? (out.items as WorkflowItem[]) : [];
    const materialized = await materializeEmittedBinary(outItems, { blob: deps.blob, maxFileBytes: deps.maxFileBytes });
    return { items: materialized, meta: out.meta as Record<string, unknown> | undefined };
```

- [ ] **Step 4: Bootstrap dep** — in `packages/bootstrap/src/index.ts`, the `createPluginNodeService({ … blob, … })` call already passes the full `blob` (a `BlobStoragePort`, which has `put`). Confirm no change is needed; if the inline type annotation narrows it, ensure `blob` is passed as-is.

- [ ] **Step 5: Run → pass**: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-service.test.ts` + `pnpm -C packages/bootstrap exec tsc --noEmit`.

---

## Task 2: `export-artifact` attaches a BinaryRef

**Files:** Modify `packages/workflows/src/engine/node-handlers/export.ts` + `export.test.ts` (or `sink-handlers.test.ts` if that's where export is tested).

- [ ] **Step 1: Write the failing test** — the export handler should attach the produced file to the first output item's `binary.export`:

```ts
it('attaches the produced file as a BinaryRef on the first output item', async () => {
  const ctx = createContext(undefined, () => {});
  ctx.services = { exportArtifact: vi.fn().mockResolvedValue({ objectKey: 'workflow-artifacts/u/export.csv', format: 'csv', byteSize: 12 }) } as never;
  const out = await exportHandler({ id: 'e', type: 'action', data: { action: 'export-artifact', config: { format: 'csv' } } } as never, ctx, [{ json: { a: 1 } }]);
  expect(out).toHaveLength(1);
  expect(out[0].json).toEqual({ a: 1 });
  expect(out[0].binary!.export).toEqual({ objectKey: 'workflow-artifacts/u/export.csv', contentType: 'text/csv', fileName: 'export.csv', byteSize: 12 });
});
it('emits a single item carrying the BinaryRef when input is empty', async () => {
  const ctx = createContext(undefined, () => {});
  ctx.services = { exportArtifact: vi.fn().mockResolvedValue({ objectKey: 'workflow-artifacts/u/export.csv', format: 'csv', byteSize: 0 }) } as never;
  const out = await exportHandler({ id: 'e', type: 'action', data: { config: { format: 'csv' } } } as never, ctx, []);
  expect(out).toHaveLength(1);
  expect(out[0].binary!.export.objectKey).toBe('workflow-artifacts/u/export.csv');
});
```

- [ ] **Step 2: Run → fail**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/export.test.ts` (adapt the path to where export is tested).

- [ ] **Step 3: Implement** — rewrite `export.ts`:

```ts
import type { NodeHandler } from './types';
import { fromItems } from '../items';

const CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export const exportHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Export node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'csv') as 'csv' | 'xlsx' | 'pdf';
  const { columns, rows } = fromItems(input);
  const result = await ctx.services.exportArtifact({
    format,
    filename: config.filename as string | undefined,
    title: (node.data.label as string) ?? 'Workflow Export',
    columns,
    rows,
  });
  const ref = {
    objectKey: result.objectKey,
    contentType: CONTENT_TYPE[result.format] ?? 'application/octet-stream',
    fileName: (config.filename as string | undefined) ?? `export.${result.format}`,
    byteSize: result.byteSize,
  };
  const items = input.length > 0 ? input : [{ json: {} }];
  return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), export: ref } } : it));
};
```

- [ ] **Step 4: Run → pass**: the same vitest command + `pnpm -C packages/workflows exec tsc --noEmit`. (If `sink-handlers.test.ts` also exercises export's old passthrough shape, update that assertion to expect the `binary.export` ref.)

---

## Task 3: `wf_emit` wasm fixture

**Files:** Modify `wasm/test-sink/src/lib.rs`, `scripts/build-test-sink.mjs`; create `packages/plugins/src/wf-emit.integration.test.ts`.

- [ ] **Step 1: Add the entrypoint** — in `wasm/test-sink/src/lib.rs`, inside `mod plugin`, after `wf_convert`:
```rust
    /// Emit a produced file as inline base64 on an output item (base64 of "hello" = aGVsbG8=).
    #[plugin_fn]
    pub fn wf_emit(_input: Vec<u8>) -> FnResult<String> {
        Ok(json!({ "items": [{
            "json": { "ok": true },
            "binary": { "out": { "contentType": "text/plain", "fileName": "hello.txt", "dataBase64": "aGVsbG8=" } }
        }] }).to_string())
    }
```

- [ ] **Step 2: Manifest** — in `scripts/build-test-sink.mjs`: add `wf_emit` to `entrypoints` and a node to `workflowNodes`:
```js
  entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert', 'wf_emit'],
```
```js
    {
      id: 'emit', label: 'Emit File', kind: 'transform', entrypoint: 'wf_emit',
      ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [], config: [],
    },
```

- [ ] **Step 3: Rebuild**: `node scripts/build-test-sink.mjs` → staged sha line. (Toolchain present: cargo 1.96 + wasm32-wasip1; if missing, STOP/BLOCKED.)

- [ ] **Step 4: Integration test** — create `packages/plugins/src/wf-emit.integration.test.ts` (mirror `wf-convert.integration.test.ts`); assert the raw response carries the inline base64:
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
  const manifest = parseManifest({ id: 'test-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert', 'wf_emit'], wasmSha256: sha256Hex(wasm), wasi: true });
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('test-sink wf_emit through the real Extism runner (binary output)', () => {
  it('returns an item with inline base64 bytes', async () => {
    const out = (await sink().invoke('wf_emit', {})) as { items: { json: unknown; binary: { out: { contentType: string; fileName: string; dataBase64: string } } }[] };
    expect(out.items[0].binary.out).toEqual({ contentType: 'text/plain', fileName: 'hello.txt', dataBase64: 'aGVsbG8=' });
  });
});
```

- [ ] **Step 5: Run → pass (not skipped)**: `pnpm -C packages/plugins exec vitest run src/wf-emit.integration.test.ts` → 1 RAN.

---

## Task 4: Web — download links in run-history + Output tab

**Files:** Modify `apps/web/src/api.ts`; create `apps/web/src/workflows/lib/output-binaries.ts` (+ test); modify `run-history-drawer.tsx` + `node-config-panel.tsx`.

- [ ] **Step 1: api helper** — add to `apps/web/src/api.ts`:
```ts
/** Authenticated download of a produced workflow artifact (objectKey under workflow-artifacts/). */
export async function downloadWorkflowArtifact(objectKey: string, fileName: string): Promise<void> {
  const path = objectKey.split('/').map(encodeURIComponent).join('/');
  const r = await authFetch(`/api/workflows/artifacts/${path}`);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: `outputBinaries` helper + test** — create `apps/web/src/workflows/lib/output-binaries.ts`:
```ts
export interface ProducedFile { field: string; objectKey: string; fileName: string; contentType: string; byteSize: number }

/** Extract every blob-backed BinaryRef from a node's output (WorkflowItem[]). */
export function outputBinaries(output: unknown): ProducedFile[] {
  if (!Array.isArray(output)) return [];
  const files: ProducedFile[] = [];
  for (const item of output) {
    const bin = (item as { binary?: Record<string, unknown> })?.binary;
    if (!bin || typeof bin !== 'object') continue;
    for (const [field, v] of Object.entries(bin)) {
      const ref = v as { objectKey?: unknown; fileName?: unknown; contentType?: unknown; byteSize?: unknown };
      if (typeof ref.objectKey === 'string') {
        files.push({
          field,
          objectKey: ref.objectKey,
          fileName: typeof ref.fileName === 'string' ? ref.fileName : (ref.objectKey.split('/').pop() ?? 'file'),
          contentType: typeof ref.contentType === 'string' ? ref.contentType : 'application/octet-stream',
          byteSize: typeof ref.byteSize === 'number' ? ref.byteSize : 0,
        });
      }
    }
  }
  return files;
}
```
Create `output-binaries.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { outputBinaries } from './output-binaries';

describe('outputBinaries', () => {
  it('extracts BinaryRefs from output items', () => {
    const out = [{ json: {}, binary: { export: { objectKey: 'workflow-artifacts/u/r.csv', fileName: 'r.csv', contentType: 'text/csv', byteSize: 12 } } }];
    expect(outputBinaries(out)).toEqual([{ field: 'export', objectKey: 'workflow-artifacts/u/r.csv', fileName: 'r.csv', contentType: 'text/csv', byteSize: 12 }]);
  });
  it('returns [] for non-array / no-binary output', () => {
    expect(outputBinaries(undefined)).toEqual([]);
    expect(outputBinaries([{ json: { a: 1 } }])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run → fail/pass the helper test**: `pnpm -C apps/web test src/workflows/lib/output-binaries.test.ts`.

- [ ] **Step 4: Run-history drawer** — in `run-history-drawer.tsx`, REPLACE the stale `Artifacts` block (the one testing `r.output.objectKey`, ~lines 257–287) with one that scans each node result's output items via `outputBinaries` and downloads via `downloadWorkflowArtifact`:
```tsx
{(() => {
  const produced = results.flatMap((r) => outputBinaries(r.output).map((f) => ({ nodeId: r.nodeId, f })));
  if (produced.length === 0) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Produced files</h4>
      <div className="flex flex-col gap-1.5">
        {produced.map(({ nodeId, f }) => (
          <button
            key={`${nodeId}:${f.field}`}
            type="button"
            onClick={() => void downloadWorkflowArtifact(f.objectKey, f.fileName)}
            className="inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/10 hover:text-violet-300"
          >
            <Download className="h-3.5 w-3.5" />
            {f.fileName} ({nodeId})
          </button>
        ))}
      </div>
    </div>
  );
})()}
```
Add imports: `import { outputBinaries } from '../../lib/output-binaries';` and `downloadWorkflowArtifact` from `@/api` (keep the existing `Download` icon import).

- [ ] **Step 5: Node-config Output tab** — in `node-config-panel.tsx`, in the `tab === 'output'` branch, render download links above the `JsonView` when the node's last-run output carries binaries:
```tsx
{tab === 'output' && (
  <div className="space-y-3">
    {runError && (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
        <span className="font-semibold">Error:</span> {runError}
      </div>
    )}
    {outputBinaries(runOutput).map((f) => (
      <button key={f.field} type="button" onClick={() => void downloadWorkflowArtifact(f.objectKey, f.fileName)}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium text-violet-400 hover:bg-violet-500/10">
        <Download className="h-3.5 w-3.5" /> {f.fileName}
      </button>
    ))}
    <JsonView data={runOutput} emptyLabel="Run the workflow to see output data." />
  </div>
)}
```
Add imports: `Download` from `lucide-react`, `outputBinaries` from `../../lib/output-binaries`, `downloadWorkflowArtifact` from `@/api`.

- [ ] **Step 6: Verify**: `pnpm -C apps/web exec tsc --noEmit` + `pnpm -C apps/web test src/workflows` (isolated) → PASS.

---

## Task 5: Full gate

- [ ] **Step 1: Typecheck (forced)**: `pnpm turbo run typecheck --force` → all PASS.
- [ ] **Step 2: Depcruise**: `pnpm depcruise` → 0 errors.
- [ ] **Step 3: Targeted suites**:
  - `pnpm -C packages/bootstrap exec vitest run`
  - `pnpm -C packages/workflows exec vitest run`
  - `pnpm -C packages/plugins exec vitest run`
  - `pnpm -C apps/web test src/workflows` (isolated)
  Expected: all PASS, incl. real-Extism `wf_emit`.
- [ ] **Step 4: Build (forced)**: `pnpm turbo run build --force` → PASS.
- [ ] **Step 5: Acceptance** — confirm: a plugin emitting inline base64 yields a `BinaryRef` output item under `workflow-artifacts/` (cap-enforced); `export-artifact` attaches its `BinaryRef`; the web shows download links in run-history + the Output tab (the stale `objectKey` artifact block is replaced); `wf_emit` ran through real Extism; no SP-4a/abi:'items' behavior changed for non-emitting nodes.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 plugin emit + materialization (both abi paths, cap, idempotent); Task 2 export-artifact unify; Task 3 `wf_emit` fixture; Task 4 web surfacing (run-history + Output tab) + download helper + the stale-section replacement; Task 5 gate.
- **Type consistency:** the materialized ref shape `{objectKey, contentType, fileName, byteSize}` equals `BinaryRef`; `outputBinaries` reads exactly those fields; the download URL is `/api/workflows/artifacts/${objectKey}` (objectKey starts with `workflow-artifacts/`, matching the route guard). `deps.blob` now has both `get` (SP-4a) and `put` (SP-4b).
- **Security:** cap on the decoded base64 length before `blob.put`; host-generated `workflow-artifacts/<uuid>/…` keys; sanitized filename; download reuses the existing MANAGE-gated, traversal-guarded `/artifacts/*` route.
- **Additive / fixes:** non-emitting nodes are unchanged (no `dataBase64` ⇒ items untouched); this also FIXES the SP-3a regression where the run-history Artifacts block stopped matching (export now returns items, not `{objectKey}`).
