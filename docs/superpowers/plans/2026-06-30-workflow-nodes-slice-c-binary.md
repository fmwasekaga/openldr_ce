# Slice C — Tier-3 Binary/File Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up 5 "Coming soon" binary/file workflow nodes — `convert-to-file`, `extract-from-file`, `spreadsheet-file`, `read-pdf`, `compression` — by adding two generic host binary services (`readBinary`/`writeBinary`) and building the handlers on top of them. (`read-write-file` stays deferred — security-gated.)

**Architecture:** The engine's binary lane (`item.binary: Record<string, BinaryRef>`) already exists and is seeded onto the trigger item from uploads/webhook/ingest (`ctx.files`). Today only plugin nodes can read/write bytes (via bootstrap's `blob.get/put`). This slice adds two **optional** `WorkflowServices` methods — `readBinary(objectKey) → Uint8Array` and `writeBinary({bytes,fileName,contentType}) → BinaryRef` — implemented in `packages/bootstrap` (where `blob` + `cfg.WORKFLOW_FILE_MAX_BYTES` live) and consumed by the new host handlers. All format logic (CSV/XLSX/JSON/PDF/ZIP) lives in `packages/workflows` handlers + a shared `file-codecs.ts`, unit-tested with an in-memory fake services object.

**Tech Stack:** TypeScript, Vitest, `@openldr/workflows`, `@openldr/bootstrap`, `xlsx` (CSV/XLSX), `jszip` (ZIP), `pdf-parse` (PDF text), `node:crypto` (uuid in bootstrap).

**Out of scope:** `read-write-file` (arbitrary host FS — deferred), connectors, engine control-flow.

---

## Key facts (verified in code)

- **`BinaryRef`** (`packages/workflows/src/engine/items.ts:2-7`): `{ objectKey: string; contentType: string; fileName?: string; byteSize: number }`. Items carry `binary?: Record<string, BinaryRef>`.
- **Trigger seeding** (`node-handlers/trigger.ts`): when `ctx.files` is set, the trigger emits `[{ json, binary: ctx.files }]`. Uploads (`POST /api/workflows/:id/uploads`), webhook bodies, and ingest blobs all land as `binary.file`.
- **Bytes live in blob storage** (`BlobStoragePort`, `packages/ports/src/blob.ts`): `get(key) → Uint8Array`, `put(key, body, contentType)`. Artifacts use key `workflow-artifacts/<uuid>/<name>`; downloads are served by `GET /api/workflows/artifacts/*` (guarded to the `workflow-artifacts/` namespace) and surfaced in run-history via `outputBinaries()` (`apps/web/src/workflows/lib/output-binaries.ts`) → any `item.binary[*]` with an `objectKey` becomes a download button. **So: attach a `BinaryRef` to an output item and it's automatically downloadable — no web changes needed.**
- **The 50MB cap** is `cfg.WORKFLOW_FILE_MAX_BYTES` (default 52_428_800), enforced today in uploads + plugin-node read/emit. `writeBinary` must enforce it too.
- **Existing write reference**: `exportArtifact` in `bootstrap/src/index.ts:360-381` builds bytes then `blob.put('workflow-artifacts/${randomUUID()}/...', bytes, contentType)`. `materializeEmittedBinary` (`bootstrap/src/plugin-node-service.ts:33-57`) shows the sanitize + cap + key pattern to mirror in `writeBinary`.
- **Handler dispatch**: action nodes via `ACTION_HANDLERS[node.data.action]` in `node-handlers/index.ts`. Config UI auto-renders from a `HOST_NODE_DESCRIPTORS` entry whose `id === action`. **Every descriptor config field MUST set `required: true|false`** (`WorkflowConfigField.required` is non-optional — omitting it fails `tsc` TS2741).
- **Pure-engine tests** run with no `ctx.services`. The new services are **optional** (`?`) on the interface; handlers must guard: `if (!ctx.services?.readBinary) throw new Error('<node> requires server services')` (mirrors `export.ts:11`).

## Library API notes (confirm against installed versions in Task 1)

- **xlsx** (already used in bootstrap): `XLSX.read(bytes, { type: 'array' })` accepts a `Uint8Array`; `XLSX.utils.sheet_to_json(ws)`; `XLSX.utils.json_to_sheet(rows)`; `XLSX.utils.sheet_to_csv(ws)`; `XLSX.write(wb, { type: 'buffer', bookType: 'xlsx'|'csv' })` → Buffer.
- **jszip**: `import JSZip from 'jszip'`. Create: `const z = new JSZip(); z.file(name, uint8); const buf = await z.generateAsync({ type: 'nodebuffer' })`. Read: `const z = await JSZip.loadAsync(uint8); const names = Object.keys(z.files); const bytes = await z.files[name].async('uint8array')` (skip entries where `.dir` is true). Ships its own types.
- **pdf-parse**: import the lib subpath to avoid the package's debug harness that reads a test PDF at import time: `import pdfParse from 'pdf-parse/lib/pdf-parse.js'`. Call: `const data = await pdfParse(Buffer.from(bytes)); data.text; data.numpages`. If the subpath has no types, add `packages/workflows/src/pdf-parse.d.ts` with `declare module 'pdf-parse/lib/pdf-parse.js' { interface PdfData { text: string; numpages: number } function pdf(b: Buffer | Uint8Array): Promise<PdfData>; export default pdf; }`.

> **Implementer note:** Task 1 verifies each import shape empirically. If an import differs, adjust to match the installed version and make `tsc` pass. `tsc --noEmit` is the gate.

## Test command

Single file: `pnpm -C packages/workflows exec vitest run <path>`
Typecheck (both packages): `pnpm -C packages/workflows exec tsc --noEmit` and `pnpm -C packages/bootstrap exec tsc --noEmit` — both MUST exit 0.

## Test helper (fake binary services)

Handlers needing binary I/O are tested with an in-memory fake. Reuse this snippet in each binary-node test file:

```typescript
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeBinaryCtx() {
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const services = {
    readBinary: async (objectKey: string) => {
      const b = store.get(objectKey);
      if (!b) throw new Error('not found: ' + objectKey);
      return b;
    },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/test-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  // createContext(input, emit, edges, codeLimits, services)
  const ctx = createContext(undefined, () => {}, [], undefined, services);
  return { ctx, store };
}
```

## File structure

- **Modify**: `packages/workflows/package.json` (deps), `packages/workflows/src/engine/services.ts` (interface + import BinaryRef), `packages/bootstrap/src/index.ts` (impl), `packages/workflows/src/engine/node-handlers/index.ts` (register 5), `packages/workflows/src/host-nodes.ts` (5 descriptors), `apps/web/src/workflows/constants.ts` (5 ids + defaults).
- **Create**: `packages/workflows/src/engine/node-handlers/file-codecs.ts` (shared CSV/XLSX encode/decode) + `file-codecs.test.ts`; handlers `{convert-to-file,extract-from-file,spreadsheet-file,read-pdf,compression}.ts` + `.test.ts`; possibly `packages/workflows/src/pdf-parse.d.ts`.

---

## Task 1: Add dependencies

**Files:** Modify `packages/workflows/package.json`.

- [ ] **Step 1: Add deps.** In `packages/workflows/package.json` add to `dependencies`: `"xlsx": "0.20.3"` (match the version already in the repo root), `"jszip": "^3.10.1"`, `"pdf-parse": "^1.1.1"`. Add to `devDependencies`: `"@types/pdf-parse": "^1.1.4"`. (jszip and xlsx ship their own types.)

- [ ] **Step 2: Install.**

Run: `pnpm install`
Expected: exit 0. If `xlsx` 0.20.3 is not on the default registry, the repo already resolves it (it's in the root) — keep that version.

- [ ] **Step 3: Confirm import shapes.**

Run: `pnpm -C packages/workflows exec node --input-type=module -e "import * as XLSX from 'xlsx'; import JSZip from 'jszip'; import pdf from 'pdf-parse/lib/pdf-parse.js'; console.log('xlsx', typeof XLSX.read, typeof XLSX.write); console.log('jszip', typeof JSZip, typeof new JSZip().file); console.log('pdf', typeof pdf);"`
Expected: `xlsx function function`, `jszip function function`, `pdf function`. If the pdf-parse subpath import errors, try `import pdf from 'pdf-parse'` and note whether it crashes (debug harness) — prefer the subpath.

- [ ] **Step 4: Confirm baseline still green.**

Run: `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/workflows test`
Expected: tsc 0; all tests pass (246 baseline).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/package.json pnpm-lock.yaml
git commit -m "build(workflows): add xlsx/jszip/pdf-parse deps for binary nodes"
```

---

## Task 2: Add `readBinary` / `writeBinary` host services

**Files:** Modify `packages/workflows/src/engine/services.ts`, `packages/bootstrap/src/index.ts`.

- [ ] **Step 1: Extend the interface.** In `packages/workflows/src/engine/services.ts`, change the items import to also bring `BinaryRef`:

```typescript
import type { WorkflowItem, BinaryRef } from './items';
```

Then add these two members to the `WorkflowServices` interface (after `loadDataset`):

```typescript
  /** Read raw bytes for a stored BinaryRef objectKey. Host-injected (binary nodes). */
  readBinary?(objectKey: string): Promise<Uint8Array>;
  /** Persist raw bytes as a run artifact under workflow-artifacts/ → BinaryRef. Host-injected (binary nodes). */
  writeBinary?(input: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef>;
```

- [ ] **Step 2: Verify it still typechecks (interface-only change).**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Implement in bootstrap.** In `packages/bootstrap/src/index.ts`, inside the `workflowServices` object literal (after the `exportArtifact` member, before the closing `};` at ~line 382), add:

```typescript
    readBinary: async (objectKey) => blob.get(objectKey),
    writeBinary: async ({ bytes, fileName, contentType }) => {
      if (bytes.byteLength > cfg.WORKFLOW_FILE_MAX_BYTES) {
        throw new Error(`file exceeds the ${cfg.WORKFLOW_FILE_MAX_BYTES}-byte limit`);
      }
      const safe = (fileName.split(/[\\/]/).pop() ?? 'output').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'output';
      const objectKey = `workflow-artifacts/${randomUUID()}/${safe}`;
      await blob.put(objectKey, bytes, contentType);
      return { objectKey, contentType, fileName: safe, byteSize: bytes.byteLength };
    },
```

(`blob`, `randomUUID`, and `cfg` are already in scope here — `randomUUID` is imported at the top of index.ts and used by `exportArtifact`.)

- [ ] **Step 4: Typecheck bootstrap.**

Run: `pnpm -C packages/bootstrap exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/services.ts packages/bootstrap/src/index.ts
git commit -m "feat(workflows): add readBinary/writeBinary host binary services"
```

---

## Task 3: Shared `file-codecs.ts` (CSV/XLSX encode/decode)

DRY helper used by convert-to-file, extract-from-file, spreadsheet-file.

**Files:** Create `packages/workflows/src/engine/node-handlers/file-codecs.ts` + `file-codecs.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/file-codecs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { itemsToCsv, itemsToXlsx, fileToRows } from './file-codecs';

describe('file-codecs', () => {
  it('round-trips items → csv bytes → rows', () => {
    const items = [{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }];
    const csv = itemsToCsv(items);
    expect(new TextDecoder().decode(csv)).toContain('a,b');
    const rows = fileToRows(csv);
    expect(rows).toEqual([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
  });

  it('round-trips items → xlsx bytes → rows', () => {
    const items = [{ json: { name: 'Ann', age: 30 } }];
    const xlsx = itemsToXlsx(items);
    expect(xlsx.byteLength).toBeGreaterThan(0);
    const rows = fileToRows(xlsx);
    expect(rows).toEqual([{ name: 'Ann', age: 30 }]);
  });

  it('returns [] for an empty workbook', () => {
    expect(fileToRows(itemsToCsv([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/file-codecs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `packages/workflows/src/engine/node-handlers/file-codecs.ts`:

```typescript
import * as XLSX from 'xlsx';
import type { WorkflowItem } from '../items';

/** items → CSV bytes (utf8). */
export function itemsToCsv(items: WorkflowItem[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(items.map((i) => i.json));
  return new TextEncoder().encode(XLSX.utils.sheet_to_csv(ws));
}

/** items → XLSX bytes. */
export function itemsToXlsx(items: WorkflowItem[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(items.map((i) => i.json));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Uint8Array(buf);
}

/** CSV/XLSX bytes → row objects (first sheet). Empty workbook → []. */
export function fileToRows(bytes: Uint8Array): Record<string, unknown>[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[first]) as Record<string, unknown>[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/file-codecs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/file-codecs.ts packages/workflows/src/engine/node-handlers/file-codecs.test.ts
git commit -m "feat(workflows): shared file-codecs (csv/xlsx encode-decode)"
```

---

## Task 4: `convert-to-file` node

items → a file (csv | xlsx | json | text) attached as `binary[outputField]`.

**Files:** Create `convert-to-file.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/convert-to-file.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { convertToFileHandler } from './convert-to-file';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeBinaryCtx() {
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const services = {
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/test-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'cf1', type: 'action', data: { action: 'convert-to-file', config: cfg } });

describe('convertToFileHandler', () => {
  it('writes json bytes and attaches a BinaryRef', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const result = await convertToFileHandler(node({ format: 'json', fileName: 'out.json', binaryField: 'data' }), ctx, [{ json: { a: 1 } }, { json: { a: 2 } }]);
    const ref = (result[0].binary as Record<string, BinaryRef>).data;
    expect(ref.contentType).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(store.get(ref.objectKey)!))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('writes csv bytes', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const result = await convertToFileHandler(node({ format: 'csv', fileName: 'out.csv', binaryField: 'data' }), ctx, [{ json: { a: 1, b: 2 } }]);
    const ref = (result[0].binary as Record<string, BinaryRef>).data;
    expect(ref.contentType).toBe('text/csv');
    expect(new TextDecoder().decode(store.get(ref.objectKey)!)).toContain('a,b');
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(convertToFileHandler(node({ format: 'json' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/convert-to-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/convert-to-file.ts`:

```typescript
import type { NodeHandler } from './types';
import { itemsToCsv, itemsToXlsx } from './file-codecs';

const CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  text: 'text/plain',
};

/** Encode the input items into a single file attached to the first output item's binary lane. */
export const convertToFileHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.writeBinary) throw new Error('Convert to File requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'json');
  const binaryField = (config.binaryField as string) || 'data';
  const fileName = (config.fileName as string) || `data.${format === 'text' ? 'txt' : format}`;
  const textField = (config.textField as string) || '';

  let bytes: Uint8Array;
  if (format === 'csv') bytes = itemsToCsv(input);
  else if (format === 'xlsx') bytes = itemsToXlsx(input);
  else if (format === 'text') {
    const text = input.map((i) => String(textField ? i.json[textField] ?? '' : JSON.stringify(i.json))).join('\n');
    bytes = new TextEncoder().encode(text);
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(input.map((i) => i.json)));
  }

  const ref = await ctx.services.writeBinary({ bytes, fileName, contentType: CONTENT_TYPE[format] ?? 'application/octet-stream' });
  const items = input.length > 0 ? input : [{ json: {} }];
  return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), [binaryField]: ref } } : it));
};
```

- [ ] **Step 4: Register.** In `index.ts`: `import { convertToFileHandler } from './convert-to-file';` + `'convert-to-file': convertToFileHandler,`.

- [ ] **Step 5: Descriptor.** In `host-nodes.ts` Sinks/Transforms block:

```typescript
  { id: 'convert-to-file', source: 'host', label: 'Convert to File', kind: 'transform', description: 'Encode items to a CSV/XLSX/JSON/text file.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'format', label: 'Format', type: 'select', required: false, options: [{ value: 'json', label: 'JSON' }, { value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'XLSX' }, { value: 'text', label: 'Text' }] }, { key: 'binaryField', label: 'Output binary field', type: 'text', required: false }, { key: 'fileName', label: 'File name', type: 'text', required: false }, { key: 'textField', label: 'Text field (text format only)', type: 'text', required: false }] },
```

- [ ] **Step 6: Palette + enable.** In `constants.ts` replace the `convert-to-file` entry (Files & Storage category):

```typescript
      node('convert-to-file', 'action', 'Convert to File', 'FileOutput', 'Encode data to a file', {
        keywords: ['csv', 'xlsx', 'json'],
        data: { config: { format: 'json', binaryField: 'data', fileName: '', textField: '' } },
      }),
```

Add a `// binary/file (slice C)` line to `IMPLEMENTED_TEMPLATE_IDS` with all 5 ids (one clean edit; later tasks only add handler/descriptor):

```typescript
  // binary/file (slice C)
  'convert-to-file', 'extract-from-file', 'spreadsheet-file', 'read-pdf', 'compression',
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/convert-to-file.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/convert-to-file.ts packages/workflows/src/engine/node-handlers/convert-to-file.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement convert-to-file node"
```

---

## Task 5: `extract-from-file` node

Read an input file (csv | json | text) from `binary[sourceField]` → emit items.

**Files:** Create `extract-from-file.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/extract-from-file.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractFromFileHandler } from './extract-from-file';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeCtxWith(objectKey: string, bytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([[objectKey, bytes]]);
  const services = {
    readBinary: async (k: string) => {
      const b = store.get(k);
      if (!b) throw new Error('not found');
      return b;
    },
  } as unknown as import('../services').WorkflowServices;
  return createContext(undefined, () => {}, [], undefined, services);
}
const ref = (objectKey: string): BinaryRef => ({ objectKey, contentType: 'application/octet-stream', fileName: 'f', byteSize: 1 });
const node = (cfg: Record<string, unknown>) => ({ id: 'ef1', type: 'action', data: { action: 'extract-from-file', config: cfg } });

describe('extractFromFileHandler', () => {
  it('parses a JSON array file into items', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify([{ a: 1 }, { a: 2 }]));
    const ctx = fakeCtxWith('k1', bytes);
    const result = await extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k1') } }]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });

  it('parses a CSV file into items', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,x\n2,y\n');
    const ctx = fakeCtxWith('k2', bytes);
    const result = await extractFromFileHandler(node({ format: 'csv', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k2') } }]);
    expect(result).toEqual([{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }]);
  });

  it('wraps text content under a field', async () => {
    const bytes = new TextEncoder().encode('hello world');
    const ctx = fakeCtxWith('k3', bytes);
    const result = await extractFromFileHandler(node({ format: 'text', sourceField: 'file', outputField: 'content' }), ctx, [{ json: {}, binary: { file: ref('k3') } }]);
    expect(result).toEqual([{ json: { content: 'hello world' } }]);
  });

  it('throws a clear error when the input item has no file', async () => {
    const ctx = fakeCtxWith('k4', new Uint8Array());
    await expect(extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/extract-from-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/extract-from-file.ts`:

```typescript
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';
import { fileToRows } from './file-codecs';

/** Decode an input file (csv|json|text) from binary[sourceField] into items. */
export const extractFromFileHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary) throw new Error('Extract from File requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'json');
  const sourceField = (config.sourceField as string) || 'file';
  const outputField = (config.outputField as string) || 'data';

  const out: WorkflowItem[] = [];
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) throw new Error(`Extract from File: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    if (format === 'csv') {
      for (const row of fileToRows(bytes)) out.push({ json: row });
    } else if (format === 'text') {
      out.push({ json: { [outputField]: new TextDecoder().decode(bytes) } });
    } else {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (Array.isArray(parsed)) for (const r of parsed) out.push({ json: (r && typeof r === 'object' && !Array.isArray(r)) ? r as Record<string, unknown> : { [outputField]: r } });
      else out.push({ json: (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : { [outputField]: parsed } });
    }
  }
  return out;
};
```

- [ ] **Step 4: Register.** In `index.ts`: `import { extractFromFileHandler } from './extract-from-file';` + `'extract-from-file': extractFromFileHandler,`.

- [ ] **Step 5: Descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'extract-from-file', source: 'host', label: 'Extract from File', kind: 'transform', description: 'Parse a CSV/JSON/text file into items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'format', label: 'Format', type: 'select', required: false, options: [{ value: 'json', label: 'JSON' }, { value: 'csv', label: 'CSV' }, { value: 'text', label: 'Text' }] }, { key: 'sourceField', label: 'Input binary field', type: 'text', required: false }, { key: 'outputField', label: 'Output field (json/text)', type: 'text', required: false }] },
```

- [ ] **Step 6: Palette.** In `constants.ts` replace the `extract-from-file` entry:

```typescript
      node('extract-from-file', 'action', 'Extract from File', 'FileInput', 'Parse file contents', {
        data: { config: { format: 'json', sourceField: 'file', outputField: 'data' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/extract-from-file.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/extract-from-file.ts packages/workflows/src/engine/node-handlers/extract-from-file.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement extract-from-file node"
```

---

## Task 6: `spreadsheet-file` node

Read a spreadsheet (xlsx/csv) → items, or write items → an xlsx/csv file. Reuses `file-codecs`.

**Files:** Create `spreadsheet-file.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/spreadsheet-file.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { spreadsheetFileHandler } from './spreadsheet-file';
import { createContext } from '../execution-context';
import { itemsToXlsx } from './file-codecs';
import type { BinaryRef } from '../items';

function fakeBinaryCtx(seed?: { key: string; bytes: Uint8Array }) {
  const store = new Map<string, Uint8Array>();
  if (seed) store.set(seed.key, seed.bytes);
  let n = 0;
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/test-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}
const ref = (objectKey: string): BinaryRef => ({ objectKey, contentType: 'x', fileName: 'f', byteSize: 1 });
const node = (cfg: Record<string, unknown>) => ({ id: 'sf1', type: 'action', data: { action: 'spreadsheet-file', config: cfg } });

describe('spreadsheetFileHandler', () => {
  it('reads an xlsx file into items', async () => {
    const bytes = itemsToXlsx([{ json: { name: 'Ann', age: 30 } }]);
    const { ctx } = fakeBinaryCtx({ key: 'k1', bytes });
    const result = await spreadsheetFileHandler(node({ operation: 'read', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k1') } }]);
    expect(result).toEqual([{ json: { name: 'Ann', age: 30 } }]);
  });

  it('writes items to an xlsx file', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const result = await spreadsheetFileHandler(node({ operation: 'write', format: 'xlsx', binaryField: 'data', fileName: 'sheet.xlsx' }), ctx, [{ json: { a: 1 } }]);
    const r = (result[0].binary as Record<string, BinaryRef>).data;
    expect(r.fileName).toBe('sheet.xlsx');
    expect(store.get(r.objectKey)!.byteLength).toBeGreaterThan(0);
  });

  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(spreadsheetFileHandler(node({ operation: 'read' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/spreadsheet-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/spreadsheet-file.ts`:

```typescript
import type { NodeHandler } from './types';
import { itemsToCsv, itemsToXlsx, fileToRows } from './file-codecs';

const CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Read a spreadsheet (xlsx/csv) into items, or write items to a spreadsheet file. */
export const spreadsheetFileHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'read';

  if (operation === 'write') {
    if (!ctx.services?.writeBinary) throw new Error('Spreadsheet File requires server services');
    const format = String(config.format ?? 'xlsx');
    const binaryField = (config.binaryField as string) || 'data';
    const fileName = (config.fileName as string) || `spreadsheet.${format}`;
    const bytes = format === 'csv' ? itemsToCsv(input) : itemsToXlsx(input);
    const ref = await ctx.services.writeBinary({ bytes, fileName, contentType: CONTENT_TYPE[format] ?? 'application/octet-stream' });
    const items = input.length > 0 ? input : [{ json: {} }];
    return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), [binaryField]: ref } } : it));
  }

  if (!ctx.services?.readBinary) throw new Error('Spreadsheet File requires server services');
  const sourceField = (config.sourceField as string) || 'file';
  const ref = input[0]?.binary?.[sourceField];
  if (!ref) throw new Error(`Spreadsheet File: no file on the input item (field '${sourceField}')`);
  const bytes = await ctx.services.readBinary(ref.objectKey);
  return fileToRows(bytes).map((row) => ({ json: row }));
};
```

- [ ] **Step 4: Register.** In `index.ts`: `import { spreadsheetFileHandler } from './spreadsheet-file';` + `'spreadsheet-file': spreadsheetFileHandler,`.

- [ ] **Step 5: Descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'spreadsheet-file', source: 'host', label: 'Spreadsheet File', kind: 'transform', description: 'Read or write CSV/XLSX spreadsheets.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'read', label: 'Read (file → items)' }, { value: 'write', label: 'Write (items → file)' }] }, { key: 'format', label: 'Format (write)', type: 'select', required: false, options: [{ value: 'xlsx', label: 'XLSX' }, { value: 'csv', label: 'CSV' }] }, { key: 'sourceField', label: 'Input binary field (read)', type: 'text', required: false }, { key: 'binaryField', label: 'Output binary field (write)', type: 'text', required: false }, { key: 'fileName', label: 'File name (write)', type: 'text', required: false }] },
```

- [ ] **Step 6: Palette.** In `constants.ts` replace the `spreadsheet-file` entry:

```typescript
      node('spreadsheet-file', 'action', 'Spreadsheet File', 'Sheet', 'Read / write CSV, XLSX', {
        data: { config: { operation: 'read', format: 'xlsx', sourceField: 'file', binaryField: 'data', fileName: '' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/spreadsheet-file.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/spreadsheet-file.ts packages/workflows/src/engine/node-handlers/spreadsheet-file.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement spreadsheet-file node"
```

---

## Task 7: `read-pdf` node

Read a PDF from `binary[sourceField]` → extract text + page count onto the item.

**Files:** Create `read-pdf.ts` + `.test.ts` (+ maybe `pdf-parse.d.ts`); modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test.** Generate a tiny real PDF at test time with a minimal raw PDF byte string (pdf-parse can parse a minimal PDF). Create `packages/workflows/src/engine/node-handlers/read-pdf.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readPdfHandler } from './read-pdf';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

// A minimal one-page PDF containing the text "Hello".
const MINIMAL_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 20 100 Td (Hello) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

function fakeCtx(bytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([['k', bytes]]);
  const services = { readBinary: async (k: string) => store.get(k)! } as unknown as import('../services').WorkflowServices;
  return createContext(undefined, () => {}, [], undefined, services);
}
const ref: BinaryRef = { objectKey: 'k', contentType: 'application/pdf', fileName: 'f.pdf', byteSize: 1 };
const node = (cfg: Record<string, unknown>) => ({ id: 'pd1', type: 'action', data: { action: 'read-pdf', config: cfg } });

describe('readPdfHandler', () => {
  it('extracts text and page count from a PDF', async () => {
    const ctx = fakeCtx(new TextEncoder().encode(MINIMAL_PDF));
    const result = await readPdfHandler(node({ sourceField: 'file', outputField: 'text' }), ctx, [{ json: {}, binary: { file: ref } }]);
    const json = result[0].json as Record<string, unknown>;
    expect(String(json.text)).toContain('Hello');
    expect(typeof json.numPages).toBe('number');
  });

  it('throws when no file is present', async () => {
    const ctx = fakeCtx(new Uint8Array());
    await expect(readPdfHandler(node({ sourceField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
});
```

> If the minimal PDF above does not parse under the installed pdf-parse, replace `MINIMAL_PDF` with bytes from a tiny committed fixture, or adjust the literal until `pdf-parse` extracts "Hello". Do not weaken the assertion to a non-behavioral check.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/read-pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/read-pdf.ts`:

```typescript
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { NodeHandler } from './types';

/** Extract text + page count from a PDF on binary[sourceField]. */
export const readPdfHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary) throw new Error('Read PDF requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourceField = (config.sourceField as string) || 'file';
  const outputField = (config.outputField as string) || 'text';

  const results = [];
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) throw new Error(`Read PDF: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    const data = await pdfParse(Buffer.from(bytes));
    results.push({ json: { ...item.json, [outputField]: data.text, numPages: data.numpages } });
  }
  return results;
};
```

If `pdf-parse/lib/pdf-parse.js` lacks types, create `packages/workflows/src/pdf-parse.d.ts`:

```typescript
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfData { text: string; numpages: number }
  function pdf(data: Buffer | Uint8Array): Promise<PdfData>;
  export default pdf;
}
```

- [ ] **Step 4: Register.** In `index.ts`: `import { readPdfHandler } from './read-pdf';` + `'read-pdf': readPdfHandler,`.

- [ ] **Step 5: Descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'read-pdf', source: 'host', label: 'Read PDF', kind: 'transform', description: 'Extract text from a PDF.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'sourceField', label: 'Input binary field', type: 'text', required: false }, { key: 'outputField', label: 'Output text field', type: 'text', required: false }] },
```

- [ ] **Step 6: Palette.** In `constants.ts` replace the `read-pdf` entry:

```typescript
      node('read-pdf', 'action', 'Read PDF', 'FileText', 'Extract PDF text', {
        data: { config: { sourceField: 'file', outputField: 'text' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/read-pdf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/read-pdf.ts packages/workflows/src/engine/node-handlers/read-pdf.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts packages/workflows/src/pdf-parse.d.ts
git commit -m "feat(workflows): implement read-pdf node"
```

(Only add `pdf-parse.d.ts` to the commit if you created it.)

---

## Task 8: `compression` node (jszip)

Zip the input items' files into one archive, or unzip an archive into per-entry items.

**Files:** Create `compression.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/compression.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { compressionHandler } from './compression';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeBinaryCtx() {
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/test-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'zp1', type: 'action', data: { action: 'compression', config: cfg } });

describe('compressionHandler', () => {
  it('zips input files into one archive', async () => {
    const { ctx, store } = fakeBinaryCtx();
    // seed two input files
    const a = await (async () => { const r = await ctx.services!.writeBinary!({ bytes: new TextEncoder().encode('AAA'), fileName: 'a.txt', contentType: 'text/plain' }); return r; })();
    const b = await ctx.services!.writeBinary!({ bytes: new TextEncoder().encode('BBB'), fileName: 'b.txt', contentType: 'text/plain' });
    const result = await compressionHandler(node({ operation: 'zip', sourceField: 'file', binaryField: 'zip', fileName: 'out.zip' }), ctx, [
      { json: {}, binary: { file: a } },
      { json: {}, binary: { file: b } },
    ]);
    const zipRef = (result[0].binary as Record<string, BinaryRef>).zip;
    expect(zipRef.fileName).toBe('out.zip');
    const z = await JSZip.loadAsync(store.get(zipRef.objectKey)!);
    expect(Object.keys(z.files).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('unzips an archive into per-entry items', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const zip = new JSZip();
    zip.file('x.txt', 'XXX');
    zip.file('y.txt', 'YYY');
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const zipRef = await ctx.services!.writeBinary!({ bytes: zipBytes, fileName: 'in.zip', contentType: 'application/zip' });
    const result = await compressionHandler(node({ operation: 'unzip', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: zipRef } }]);
    const names = result.map((r) => (r.json as Record<string, unknown>).fileName).sort();
    expect(names).toEqual(['x.txt', 'y.txt']);
    const firstRef = (result[0].binary as Record<string, BinaryRef>).file;
    expect(store.get(firstRef.objectKey)!.byteLength).toBeGreaterThan(0);
  });

  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(compressionHandler(node({ operation: 'zip' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/compression.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/compression.ts`:

```typescript
import JSZip from 'jszip';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Zip the input items' binary files into one archive, or unzip an archive into per-entry items. */
export const compressionHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary || !ctx.services?.writeBinary) throw new Error('Compression requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'zip';
  const sourceField = (config.sourceField as string) || 'file';

  if (operation === 'unzip') {
    const ref = input[0]?.binary?.[sourceField];
    if (!ref) throw new Error(`Compression: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    const zip = await JSZip.loadAsync(bytes);
    const out: WorkflowItem[] = [];
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (entry.dir) continue;
      const entryBytes = await entry.async('uint8array');
      const entryRef = await ctx.services.writeBinary({ bytes: entryBytes, fileName: name, contentType: 'application/octet-stream' });
      out.push({ json: { fileName: name }, binary: { file: entryRef } });
    }
    return out;
  }

  // zip
  const binaryField = (config.binaryField as string) || 'zip';
  const fileName = (config.fileName as string) || 'archive.zip';
  const zip = new JSZip();
  let added = 0;
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) continue;
    const bytes = await ctx.services.readBinary(ref.objectKey);
    zip.file(ref.fileName ?? `file-${added}`, bytes);
    added += 1;
  }
  if (added === 0) throw new Error(`Compression: no files found on input items (field '${sourceField}')`);
  const archive = await zip.generateAsync({ type: 'uint8array' });
  const ref = await ctx.services.writeBinary({ bytes: archive, fileName, contentType: 'application/zip' });
  const first = input[0] ?? { json: {} };
  return [{ ...first, binary: { ...(first.binary ?? {}), [binaryField]: ref } }];
};
```

- [ ] **Step 4: Register.** In `index.ts`: `import { compressionHandler } from './compression';` + `'compression': compressionHandler,`.

- [ ] **Step 5: Descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'compression', source: 'host', label: 'Compression', kind: 'transform', description: 'Zip input files or unzip an archive.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'zip', label: 'Zip' }, { value: 'unzip', label: 'Unzip' }] }, { key: 'sourceField', label: 'Input binary field', type: 'text', required: false }, { key: 'binaryField', label: 'Output binary field (zip)', type: 'text', required: false }, { key: 'fileName', label: 'Archive name (zip)', type: 'text', required: false }] },
```

- [ ] **Step 6: Palette.** In `constants.ts` replace the `compression` entry:

```typescript
      node('compression', 'action', 'Compression', 'FileArchive', 'Zip / unzip', {
        data: { config: { operation: 'zip', sourceField: 'file', binaryField: 'zip', fileName: '' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/compression.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/compression.ts packages/workflows/src/engine/node-handlers/compression.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement compression node (zip/unzip)"
```

---

## Task 9: Full verification gate

- [ ] **Step 1: Typecheck both packages.**

Run: `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/bootstrap exec tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 2: Run the workflows test suite.**

Run: `pnpm -C packages/workflows test`
Expected: all pass — 246 baseline + ~18 new (3 file-codecs, 3 convert, 4 extract, 3 spreadsheet, 2 read-pdf, 3 compression) ≈ 264. `host-nodes`/`node-registry` tests self-adjust to the 5 new descriptors.

- [ ] **Step 3: Typecheck the web package.**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: exit 0 (constants.ts only).

- [ ] **Step 4: Run the web test suite (isolated).**

Run: `pnpm -C apps/web test`
Expected: pass (~584).

- [ ] **Step 5: Final commit (if any gate fixups).**

```bash
git add -A
git commit -m "test(workflows): slice C binary nodes — gate green"
```

> **Post-merge reminder:** after fast-forward merging to `main`, run `pnpm install` in the main checkout before the gate — new deps (xlsx/jszip/pdf-parse) must be linked or the binary test files fail to import (the same trap hit in Slice B: 208 vs 246).

---

## Self-Review (completed during planning)

- **Spec coverage:** Slice C in the inventory = convert-to-file, extract-from-file, spreadsheet-file, read-pdf, compression (read-write-file deferred). All 5 have tasks; Task 1 (deps) + Task 2 (binary services) cover the infrastructure the map showed was missing for host-node binary I/O. ✔
- **Placeholder scan:** every code step has complete code; library-shape uncertainty is handled with Task-1 confirmation + the tsc gate, not TODOs. The read-pdf minimal-PDF literal has an explicit fallback instruction (use a fixture) without weakening the assertion. ✔
- **Type consistency:** all handlers use `NodeHandler`/`WorkflowItem`/`BinaryRef`; binary handlers guard on `ctx.services?.readBinary`/`writeBinary`; every descriptor config field includes `required`; `file-codecs` exports `itemsToCsv`/`itemsToXlsx`/`fileToRows` used identically across convert/extract/spreadsheet. ✔
- **Scope:** `packages/workflows` (deps/services/handlers) + `packages/bootstrap` (service impl) + one web constants file; no DB, no new server routes (download/upload routes already exist). ✔
- **Design notes:** `convert-to-file`/`extract-from-file`/`spreadsheet-file` share `file-codecs` and have distinct roles (encode / decode / spreadsheet-both-ways) mirroring n8n; `compression` operates on the binary lane (zip files in / entries out); `read-pdf` is text extraction only. `read-write-file` deliberately excluded (security).
