# Workflow `read-write-file` Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `read-write-file` node — read/write/list/delete real host files, strictly confined to an operator-configured sandbox root, off by default.

**Architecture:** A pure `resolveWithinRoot` choke-point (in bootstrap) enforces the sandbox (disabled/root-unset guards, `..`/absolute/symlink-escape rejection). Four gated host-FS services wrap it and are injected on `WorkflowServices`. A thin node handler validates config, templates the path per item, and delegates — bridging host files to the existing binary channel (`readBinary`/`writeBinary`). The pure engine never touches the host FS.

**Tech Stack:** TypeScript, node:fs/node:path, `@openldr/config`, `@openldr/bootstrap`, `@openldr/workflows`, React (builder), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-workflow-read-write-file-design.md`

---

## Background the implementer needs

- **Service-injection pattern:** privileged capabilities are optional methods on `WorkflowServices` (`packages/workflows/src/engine/services.ts`), assigned in `packages/bootstrap/src/index.ts` (see `readBinary`/`writeBinary` ~line 394-405, and the post-construction `workflowServices.runPluginNode = …` pattern ~line 441). Handlers guard `ctx.services?.method` absent → throw `… requires server services`.
- **Binary channel:** `writeBinary({ bytes, fileName, contentType }) → BinaryRef` writes to the blob store; `readBinary(objectKey) → Uint8Array`. A `BinaryRef` is `{ objectKey, contentType, fileName?, byteSize }` (`engine/items.ts`). Attaching a ref to `item.binary[field]` makes it downloadable/consumable downstream.
- **Config:** `packages/config/src/schema.ts` — `envBoolean(defaultValue)` for booleans (`WORKFLOW_CODE_ENABLED: envBoolean(false)`); `z.string().default('')` for strings. Reuse `WORKFLOW_FILE_MAX_BYTES` for caps.
- **Handler + templates:** `NodeHandler = (node, ctx, input) => WorkflowItem[]`; `resolveTemplate(str, ctx, items)` (`engine/template.ts`) resolves `{{ … }}` against `items`. Register handlers in `node-handlers/index.ts` `ACTION_HANDLERS` keyed on `node.data.action`.
- **Palette:** add the id to `IMPLEMENTED_TEMPLATE_IDS` (`apps/web/src/workflows/constants.ts`); the node already exists there (`read-write-file`, action type). Forms register by template id in `node-forms/index.tsx` `FORMS`.

### File map
- `packages/config/src/schema.ts` (+ test) — 2 knobs.
- `packages/workflows/src/engine/services.ts` — 4 optional method signatures.
- Create `packages/bootstrap/src/host-file-sandbox.ts` (+ test) — pure resolver.
- Create `packages/bootstrap/src/host-file-service.ts` (+ test) — 4 gated methods.
- `packages/bootstrap/src/index.ts` — construct + assign the 4 methods.
- Create `packages/workflows/src/engine/node-handlers/read-write-file.ts` (+ test) + register in `index.ts`.
- `apps/web/src/workflows/constants.ts` — `IMPLEMENTED_TEMPLATE_IDS` + palette default config.
- Create `apps/web/src/workflows/components/node-forms/read-write-file-form.tsx` + register in `node-forms/index.tsx`.

---

## Task 1: Config knobs + service signatures

**Files:**
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/schema.test.ts`
- Modify: `packages/workflows/src/engine/services.ts`

- [ ] **Step 1: Write the failing config test** — append inside the `'workflow code sandbox config'` describe (mirror the neighbors' `ConfigSchema.parse(base)`):
```ts
  it('defaults host file access knobs', () => {
    const c = ConfigSchema.parse(base);
    expect(c.WORKFLOW_FILE_ACCESS_ENABLED).toBe(false);
    expect(c.WORKFLOW_FILE_ACCESS_ROOT).toBe('');
  });
  it('accepts host file access overrides', () => {
    const c = ConfigSchema.parse({ ...base, WORKFLOW_FILE_ACCESS_ENABLED: 'true', WORKFLOW_FILE_ACCESS_ROOT: '/data/wf' });
    expect(c.WORKFLOW_FILE_ACCESS_ENABLED).toBe(true);
    expect(c.WORKFLOW_FILE_ACCESS_ROOT).toBe('/data/wf');
  });
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/config exec vitest run` → FAIL.

- [ ] **Step 3: Add the knobs** in `schema.ts`, after the listener knobs (or after `WORKFLOW_FILE_MAX_BYTES`):
```ts
    // Master switch for the read-write-file node's host filesystem access (privilege risk → off by default).
    WORKFLOW_FILE_ACCESS_ENABLED: envBoolean(false),
    // The single sandbox root all host file operations are confined to (empty = unset).
    WORKFLOW_FILE_ACCESS_ROOT: z.string().default(''),
```

- [ ] **Step 4: Add the service signatures** in `packages/workflows/src/engine/services.ts`, inside the `WorkflowServices` interface (next to the other optional host-injected methods):
```ts
  /** Read a host file within the sandbox root → bytes. Host-injected (read-write-file node). */
  hostFileRead?(path: string): Promise<{ bytes: Uint8Array }>;
  /** Write bytes to a host file within the sandbox root. Host-injected. */
  hostFileWrite?(path: string, bytes: Uint8Array): Promise<{ byteSize: number }>;
  /** List a host directory within the sandbox root. Host-injected. */
  hostFileList?(path: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }>;
  /** Delete a host file (not a directory) within the sandbox root. Host-injected. */
  hostFileDelete?(path: string): Promise<{ ok: true }>;
```

- [ ] **Step 5: Gate**
Run: `pnpm -C packages/config exec vitest run` → PASS.
Run: `pnpm -C packages/config exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**
```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts packages/workflows/src/engine/services.ts
git commit -m "feat(config): host file access knobs + hostFile* service signatures"
```

---

## Task 2: Sandbox resolver (the security core)

**Files:**
- Create: `packages/bootstrap/src/host-file-sandbox.ts`
- Test: `packages/bootstrap/src/host-file-sandbox.test.ts`

- [ ] **Step 1: Write the failing test** — create `host-file-sandbox.test.ts`. Uses a real temp dir; the symlink case is skipped on platforms where symlink creation isn't permitted:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWithinRoot } from './host-file-sandbox';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rwf-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'hi');
  fs.mkdirSync(path.join(root, 'sub'));
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const ok = (userPath: string, mustExist: boolean) => resolveWithinRoot({ enabled: true, root, userPath, mustExist });

describe('resolveWithinRoot guards', () => {
  it('throws when disabled', () => {
    expect(() => resolveWithinRoot({ enabled: false, root, userPath: 'a.txt', mustExist: true })).toThrow(/disabled/);
  });
  it('throws when root is unset', () => {
    expect(() => resolveWithinRoot({ enabled: true, root: '', userPath: 'a.txt', mustExist: true })).toThrow(/not configured/);
  });
  it('throws when the root does not exist', () => {
    expect(() => resolveWithinRoot({ enabled: true, root: path.join(root, 'nope'), userPath: 'a.txt', mustExist: true })).toThrow(/does not exist/);
  });
  it('resolves a relative path inside the root', () => {
    expect(ok('a.txt', true)).toBe(fs.realpathSync(path.join(root, 'a.txt')));
  });
  it('allows the root itself', () => {
    expect(ok('', true)).toBe(fs.realpathSync(root));
  });
  it('rejects .. traversal', () => {
    expect(() => ok('../escape', false)).toThrow(/escapes the sandbox/);
    expect(() => ok('sub/../../escape', false)).toThrow(/escapes the sandbox/);
  });
  it('rejects an absolute path', () => {
    expect(() => ok(path.join(os.tmpdir(), 'x'), false)).toThrow(/escapes the sandbox/);
  });
  it('rejects a not-found path when mustExist', () => {
    expect(() => ok('missing.txt', true)).toThrow(/not found/);
  });
  it('resolves a new file for write (parent exists, tail does not)', () => {
    const p = ok('sub/new.txt', false);
    expect(p).toBe(path.join(fs.realpathSync(path.join(root, 'sub')), 'new.txt'));
  });
  it('resolves a new file whose parent dirs do not exist yet', () => {
    const p = ok('deep/newer/file.txt', false);
    expect(p.startsWith(fs.realpathSync(root))).toBe(true);
  });
});

describe('resolveWithinRoot symlink escape', () => {
  it('rejects an in-root symlink pointing outside (read)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rwf-out-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'sensitive');
    const link = path.join(root, 'link');
    try { fs.symlinkSync(outside, link, 'dir'); } catch { return; } // skip if symlinks not permitted
    try {
      expect(() => resolveWithinRoot({ enabled: true, root, userPath: 'link/secret.txt', mustExist: true })).toThrow(/escapes the sandbox/);
    } finally {
      fs.rmSync(link, { force: true }); fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/bootstrap exec vitest run src/host-file-sandbox.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `host-file-sandbox.ts`**:
```ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ResolveOpts {
  enabled: boolean;
  root: string;
  userPath: string;
  /** true for read/list/delete (target must exist); false for write (may not exist). */
  mustExist: boolean;
}

const isWin = process.platform === 'win32';

/** Is `candidate` the root itself or strictly inside it? win32 compares case-insensitively. */
function within(root: string, candidate: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const c = isWin ? candidate.toLowerCase() : candidate;
  const r = isWin ? root.toLowerCase() : root;
  const p = isWin ? prefix.toLowerCase() : prefix;
  return c === r || c.startsWith(p);
}

/**
 * Resolve `userPath` to a safe absolute path inside the sandbox root, or throw.
 * The single choke-point for all host file operations.
 */
export function resolveWithinRoot(opts: ResolveOpts): string {
  if (!opts.enabled) throw new Error('Read/Write File: host file access is disabled');
  if (!opts.root) throw new Error('Read/Write File: WORKFLOW_FILE_ACCESS_ROOT is not configured');

  let canonicalRoot: string;
  try { canonicalRoot = fs.realpathSync(opts.root); }
  catch { throw new Error(`Read/Write File: sandbox root does not exist: ${opts.root}`); }

  const up = opts.userPath ?? '';
  if (path.isAbsolute(up)) throw new Error('Read/Write File: path escapes the sandbox root');
  if (up.split(/[\\/]/).some((seg) => seg === '..')) throw new Error('Read/Write File: path escapes the sandbox root');

  const candidate = path.resolve(canonicalRoot, up);
  if (!within(canonicalRoot, candidate)) throw new Error('Read/Write File: path escapes the sandbox root');

  if (opts.mustExist) {
    let real: string;
    try { real = fs.realpathSync(candidate); }
    catch { throw new Error(`Read/Write File: not found: ${up}`); }
    if (!within(canonicalRoot, real)) throw new Error('Read/Write File: path escapes the sandbox root');
    return real;
  }

  // Write: realpath the DEEPEST EXISTING ancestor (guards against an escaping
  // symlinked parent). Non-existent tail segments can't be escaping symlinks.
  let existing = candidate;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  let realExisting: string;
  try { realExisting = fs.realpathSync(existing); }
  catch { throw new Error('Read/Write File: path escapes the sandbox root'); }
  if (!within(canonicalRoot, realExisting)) throw new Error('Read/Write File: path escapes the sandbox root');
  const finalPath = path.join(realExisting, ...tail);
  if (!within(canonicalRoot, finalPath)) throw new Error('Read/Write File: path escapes the sandbox root');
  return finalPath;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm -C packages/bootstrap exec vitest run src/host-file-sandbox.test.ts` → PASS (symlink test may self-skip on restricted platforms).

- [ ] **Step 5: Typecheck**
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**
```bash
git add packages/bootstrap/src/host-file-sandbox.ts packages/bootstrap/src/host-file-sandbox.test.ts
git commit -m "feat(bootstrap): host file sandbox resolver (traversal + symlink escape guards)"
```

---

## Task 3: Host-file service (4 gated methods)

**Files:**
- Create: `packages/bootstrap/src/host-file-service.ts`
- Test: `packages/bootstrap/src/host-file-service.test.ts`

- [ ] **Step 1: Write the failing test** — create `host-file-service.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHostFileService } from './host-file-service';

let root: string;
let svc: ReturnType<typeof createHostFileService>;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rwf-svc-'));
  svc = createHostFileService({ enabled: true, root, maxBytes: 1024 });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('host file service', () => {
  it('writes then reads bytes round-trip', async () => {
    await svc.hostFileWrite('out/x.bin', new Uint8Array([1, 2, 3]));
    const { bytes } = await svc.hostFileRead('out/x.bin');
    expect([...bytes]).toEqual([1, 2, 3]);
  });
  it('creates missing parent dirs on write', async () => {
    await svc.hostFileWrite('a/b/c.txt', new Uint8Array([9]));
    expect(fs.existsSync(path.join(root, 'a', 'b', 'c.txt'))).toBe(true);
  });
  it('lists directory entries', async () => {
    await svc.hostFileWrite('f1.txt', new Uint8Array([1]));
    fs.mkdirSync(path.join(root, 'd1'));
    const { entries } = await svc.hostFileList('');
    expect(entries.find((e) => e.name === 'f1.txt')).toMatchObject({ type: 'file', size: 1 });
    expect(entries.find((e) => e.name === 'd1')).toMatchObject({ type: 'dir' });
  });
  it('deletes a file but refuses a directory', async () => {
    await svc.hostFileWrite('del.txt', new Uint8Array([1]));
    await svc.hostFileDelete('del.txt');
    expect(fs.existsSync(path.join(root, 'del.txt'))).toBe(false);
    fs.mkdirSync(path.join(root, 'dd'));
    await expect(svc.hostFileDelete('dd')).rejects.toThrow(/refusing to delete a directory/);
  });
  it('enforces the size cap on read and write', async () => {
    await expect(svc.hostFileWrite('big.bin', new Uint8Array(2048))).rejects.toThrow(/exceeds/);
    fs.writeFileSync(path.join(root, 'big2.bin'), Buffer.alloc(2048));
    await expect(svc.hostFileRead('big2.bin')).rejects.toThrow(/exceeds/);
  });
  it('throws when disabled', async () => {
    const off = createHostFileService({ enabled: false, root, maxBytes: 1024 });
    await expect(off.hostFileRead('x')).rejects.toThrow(/disabled/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/bootstrap exec vitest run src/host-file-service.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `host-file-service.ts`**:
```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWithinRoot } from './host-file-sandbox';

export interface HostFileDeps { enabled: boolean; root: string; maxBytes: number; }

export function createHostFileService(deps: HostFileDeps) {
  const resolve = (userPath: string, mustExist: boolean) =>
    resolveWithinRoot({ enabled: deps.enabled, root: deps.root, userPath, mustExist });

  return {
    async hostFileRead(userPath: string): Promise<{ bytes: Uint8Array }> {
      const abs = resolve(userPath, true);
      const st = fs.statSync(abs);
      if (st.isDirectory()) throw new Error('Read/Write File: path is a directory');
      if (st.size > deps.maxBytes) throw new Error(`Read/Write File: file exceeds the ${deps.maxBytes}-byte limit`);
      return { bytes: new Uint8Array(fs.readFileSync(abs)) };
    },
    async hostFileWrite(userPath: string, bytes: Uint8Array): Promise<{ byteSize: number }> {
      if (bytes.byteLength > deps.maxBytes) throw new Error(`Read/Write File: file exceeds the ${deps.maxBytes}-byte limit`);
      const abs = resolve(userPath, false);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      return { byteSize: bytes.byteLength };
    },
    async hostFileList(userPath: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }> {
      const abs = resolve(userPath, true);
      const dirents = fs.readdirSync(abs, { withFileTypes: true });
      const entries = dirents.map((d) => {
        let size = 0;
        try { size = fs.statSync(path.join(abs, d.name)).size; } catch { /* ignore */ }
        return { name: d.name, type: d.isDirectory() ? ('dir' as const) : ('file' as const), size };
      });
      return { entries };
    },
    async hostFileDelete(userPath: string): Promise<{ ok: true }> {
      const abs = resolve(userPath, true);
      if (fs.statSync(abs).isDirectory()) throw new Error('Read/Write File: refusing to delete a directory');
      fs.unlinkSync(abs);
      return { ok: true };
    },
  };
}
```

- [ ] **Step 4: Run test + typecheck**
Run: `pnpm -C packages/bootstrap exec vitest run src/host-file-service.test.ts` → PASS.
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/src/host-file-service.ts packages/bootstrap/src/host-file-service.test.ts
git commit -m "feat(bootstrap): gated host file service (read/write/list/delete)"
```

---

## Task 4: Node handler

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/read-write-file.ts`
- Test: `packages/workflows/src/engine/node-handlers/read-write-file.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Modify: `apps/web/src/workflows/constants.ts`

- [ ] **Step 1: Write the failing test** — create `read-write-file.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { readWriteFileHandler } from './read-write-file';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const node = (config: Record<string, unknown>) => ({ id: 'f', type: 'action', data: { action: 'read-write-file', config } });

describe('readWriteFileHandler', () => {
  it('read (binary) → BinaryRef on item.binary', async () => {
    const hostFileRead = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]) }));
    const writeBinary = vi.fn(async () => ({ objectKey: 'k', contentType: 'application/octet-stream', fileName: 'a.bin', byteSize: 2 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileRead, writeBinary } as unknown as WorkflowServices);
    const out = await readWriteFileHandler(node({ operation: 'read', path: 'a.bin' }), ctx, [{ json: {} }]);
    expect(hostFileRead).toHaveBeenCalledWith('a.bin');
    expect(out[0].binary?.file).toMatchObject({ objectKey: 'k' });
  });

  it('read (asText) → utf8 into json', async () => {
    const hostFileRead = vi.fn(async () => ({ bytes: new Uint8Array(Buffer.from('hello', 'utf8')) }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileRead } as unknown as WorkflowServices);
    const out = await readWriteFileHandler(node({ operation: 'read', path: 'a.txt', asText: true }), ctx, [{ json: {} }]);
    expect(out[0].json.content).toBe('hello');
  });

  it('write from textContent', async () => {
    const hostFileWrite = vi.fn(async () => ({ byteSize: 5 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileWrite } as unknown as WorkflowServices);
    await readWriteFileHandler(node({ operation: 'write', path: 'o.txt', textContent: 'hello' }), ctx, [{ json: {} }]);
    const [p, bytes] = hostFileWrite.mock.calls[0];
    expect(p).toBe('o.txt');
    expect(Buffer.from(bytes).toString('utf8')).toBe('hello');
  });

  it('write from a binary field via readBinary', async () => {
    const readBinary = vi.fn(async () => new Uint8Array([7, 8]));
    const hostFileWrite = vi.fn(async () => ({ byteSize: 2 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { readBinary, hostFileWrite } as unknown as WorkflowServices);
    await readWriteFileHandler(node({ operation: 'write', path: 'o.bin' }), ctx, [{ json: {}, binary: { file: { objectKey: 'k', contentType: 'x', byteSize: 2 } } }]);
    expect(readBinary).toHaveBeenCalledWith('k');
    expect([...hostFileWrite.mock.calls[0][1]]).toEqual([7, 8]);
  });

  it('list → entries into json', async () => {
    const hostFileList = vi.fn(async () => ({ entries: [{ name: 'a', type: 'file' as const, size: 1 }] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileList } as unknown as WorkflowServices);
    const out = await readWriteFileHandler(node({ operation: 'list', path: '' }), ctx, [{ json: {} }]);
    expect(out[0].json.entries).toEqual([{ name: 'a', type: 'file', size: 1 }]);
  });

  it('delete → hostFileDelete', async () => {
    const hostFileDelete = vi.fn(async () => ({ ok: true as const }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileDelete } as unknown as WorkflowServices);
    await readWriteFileHandler(node({ operation: 'delete', path: 'gone.txt' }), ctx, [{ json: {} }]);
    expect(hostFileDelete).toHaveBeenCalledWith('gone.txt');
  });

  it('throws when the service is absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(readWriteFileHandler(node({ operation: 'read', path: 'a' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/read-write-file.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `read-write-file.ts`**:
```ts
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';
import { resolveTemplate } from '../template';

/**
 * Host filesystem read/write/list/delete, confined to the sandbox root by the
 * injected hostFile* services. Operates per input item; the path is templated.
 */
export const readWriteFileHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const op = String(config.operation ?? 'read');
  const asText = config.asText === true;
  const field = (String(config.binaryField ?? '') || (asText ? 'content' : 'file'));
  const svc = ctx.services;
  const items: WorkflowItem[] = input.length ? input : [{ json: {} }];
  const out: WorkflowItem[] = [];

  for (const item of items) {
    const p = resolveTemplate(String(config.path ?? ''), ctx, [item]);
    if (op === 'read') {
      if (!svc?.hostFileRead) throw new Error('Read/Write File requires server services');
      const { bytes } = await svc.hostFileRead(p);
      if (asText) {
        out.push({ ...item, json: { ...item.json, [field]: Buffer.from(bytes).toString('utf8') } });
      } else {
        if (!svc.writeBinary) throw new Error('Read/Write File requires server services');
        const ref = await svc.writeBinary({ bytes, fileName: p.split(/[\\/]/).pop() || 'file', contentType: 'application/octet-stream' });
        out.push({ ...item, binary: { ...(item.binary ?? {}), [field]: ref } });
      }
    } else if (op === 'write') {
      if (!svc?.hostFileWrite) throw new Error('Read/Write File requires server services');
      let bytes: Uint8Array;
      const ref = item.binary?.[field];
      if (ref) {
        if (!svc.readBinary) throw new Error('Read/Write File requires server services');
        bytes = await svc.readBinary(ref.objectKey);
      } else {
        bytes = new Uint8Array(Buffer.from(resolveTemplate(String(config.textContent ?? ''), ctx, [item]), 'utf8'));
      }
      const { byteSize } = await svc.hostFileWrite(p, bytes);
      out.push({ ...item, json: { ...item.json, writtenBytes: byteSize, writtenPath: p } });
    } else if (op === 'list') {
      if (!svc?.hostFileList) throw new Error('Read/Write File requires server services');
      const { entries } = await svc.hostFileList(p);
      out.push({ ...item, json: { ...item.json, entries } });
    } else if (op === 'delete') {
      if (!svc?.hostFileDelete) throw new Error('Read/Write File requires server services');
      await svc.hostFileDelete(p);
      out.push({ ...item, json: { ...item.json, deletedPath: p } });
    } else {
      throw new Error(`Read/Write File: unknown operation: ${op}`);
    }
  }
  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/read-write-file.test.ts` → PASS.

- [ ] **Step 5: Register the handler + enable the palette node.**
In `packages/workflows/src/engine/node-handlers/index.ts`: add `import { readWriteFileHandler } from './read-write-file';` and the `ACTION_HANDLERS` entry `'read-write-file': readWriteFileHandler,`.
In `apps/web/src/workflows/constants.ts`: add `'read-write-file'` to `IMPLEMENTED_TEMPLATE_IDS`, and update the palette entry to seed default config:
```ts
      node('read-write-file', 'action', 'Read/Write File', 'FileCog', 'Sandboxed host disk file operations', {
        data: { action: 'read-write-file', config: { operation: 'read', path: '', asText: false } },
      }),
```

- [ ] **Step 6: Typecheck + full workflows suite**
Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/workflows exec vitest run` → 0 failures.

- [ ] **Step 7: Commit**
```bash
git add packages/workflows/src/engine/node-handlers/read-write-file.ts packages/workflows/src/engine/node-handlers/read-write-file.test.ts packages/workflows/src/engine/node-handlers/index.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): read-write-file node handler (read/write/list/delete)"
```

---

## Task 5: Bootstrap wiring

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Construct + assign** in `bootstrap/index.ts`. Add the import near the other service imports:
```ts
import { createHostFileService } from './host-file-service';
```
After `workflowServices` is constructed (near the other post-construction assignments like `workflowServices.runPluginNode = …`), add:
```ts
  const hostFiles = createHostFileService({
    enabled: cfg.WORKFLOW_FILE_ACCESS_ENABLED,
    root: cfg.WORKFLOW_FILE_ACCESS_ROOT,
    maxBytes: cfg.WORKFLOW_FILE_MAX_BYTES,
  });
  workflowServices.hostFileRead = hostFiles.hostFileRead;
  workflowServices.hostFileWrite = hostFiles.hostFileWrite;
  workflowServices.hostFileList = hostFiles.hostFileList;
  workflowServices.hostFileDelete = hostFiles.hostFileDelete;
```

- [ ] **Step 2: Cross-package gate**
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.
Run: `pnpm -C apps/server exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/bootstrap exec vitest run` → 0 failures (report count).

- [ ] **Step 3: Commit**
```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): wire the sandboxed host file service onto workflow services"
```

---

## Task 6: Web form

**Files:**
- Create: `apps/web/src/workflows/components/node-forms/read-write-file-form.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`
- Test: `apps/web/src/workflows/components/node-forms/read-write-file-form.test.tsx`

- [ ] **Step 1: Write the failing test** — create `read-write-file-form.test.tsx` (mirror an existing node-form test harness; assert config writes on plain inputs). Note `FormField` renders a bare `<label>` (no htmlFor), so query by placeholder/role, not `getByLabelText`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReadWriteFileForm } from './read-write-file-form';

const node = (config: Record<string, unknown> = {}) =>
  ({ id: 'f', type: 'action', data: { label: 'x', action: 'read-write-file', config } } as never);

describe('ReadWriteFileForm', () => {
  it('writes the path', () => {
    const update = vi.fn();
    const { getByPlaceholderText } = render(<ReadWriteFileForm node={node({ operation: 'read' })} update={update} />);
    fireEvent.change(getByPlaceholderText(/path/i), { target: { value: 'sub/a.txt' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ path: 'sub/a.txt' }) });
  });
});
```
(If the shadcn Select for `operation` needs a mock in jsdom, mirror how `listener-forms.test.tsx` / `event-trigger-form.test.tsx` mock `@/components/ui/select`.)

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C apps/web exec vitest run src/workflows/components/node-forms/read-write-file-form.test.tsx` → FAIL.

- [ ] **Step 3: Implement `read-write-file-form.tsx`** (mirror `wait-form.tsx` structure; `FormField`/`TextInput`/`Select` from `./shared`; a `patchConfig` helper). Fields:
- `operation` Select: read / write / list / delete.
- `path` TextInput (placeholder `"path relative to the sandbox root"`), always shown.
- read-only: an `asText` checkbox; a `binaryField` TextInput (output field, default shown as `file`/`content`).
- write-only: a `binaryField` TextInput (input binary field) + a `textContent` TextInput/textarea ("used when no binary field is present").
Show a short hint that host file access must be enabled by the operator (`WORKFLOW_FILE_ACCESS_ENABLED` + `WORKFLOW_FILE_ACCESS_ROOT`).
Register in `node-forms/index.tsx` `FORMS`: `'read-write-file': ReadWriteFileForm,`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm -C apps/web exec vitest run src/workflows/components/node-forms/read-write-file-form.test.tsx` → PASS.

- [ ] **Step 5: Web gate**
Run: `pnpm -C apps/web exec tsc --noEmit` → 0 errors.
Run: `pnpm -C apps/web exec vitest run src/workflows` → 0 failures (report count).

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/workflows/components/node-forms/read-write-file-form.tsx apps/web/src/workflows/components/node-forms/read-write-file-form.test.tsx apps/web/src/workflows/components/node-forms/index.tsx
git commit -m "feat(web): read-write-file node form"
```

---

## Task 7: Holistic gate + memory

- [ ] **Step 1: Full per-package gate**
```
pnpm -C packages/config exec tsc --noEmit && pnpm -C packages/config exec vitest run
pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/workflows exec vitest run
pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/bootstrap exec vitest run
pnpm -C apps/server exec tsc --noEmit
pnpm -C apps/web exec tsc --noEmit && pnpm -C apps/web exec vitest run src/workflows
```
Expected: all green. (`@openldr/web#test` has a known parallel flake — run web tests isolated.)

- [ ] **Step 2: Manual sanity (optional)** — set `WORKFLOW_FILE_ACCESS_ENABLED=true` + `WORKFLOW_FILE_ACCESS_ROOT=<a temp dir>`; build a workflow Manual → Read/Write File (write, path `hello.txt`, textContent `hi`) → run; confirm the file appears in the root. Then a read (path `hello.txt`, asText) and confirm `content: "hi"`. Confirm a `../escape` path fails, and that with the flag off the node errors "disabled".

- [ ] **Step 3: Update memory** — `workflow-node-palette.md`: add a Slice J paragraph (sandboxed host-FS node; `resolveWithinRoot` choke-point with `..`/absolute/symlink guards + win32 case; 4 gated services; `WORKFLOW_FILE_ACCESS_ENABLED` default false + `WORKFLOW_FILE_ACCESS_ROOT`; read=binary|asText, write=binary-field|textContent, delete=file-only). Move `read-write-file` out of "Still disabled" — **the palette is now COMPLETE (no placeholders left).** Refresh the `MEMORY.md` pointer.

- [ ] **Step 4: Commit (if in-repo files changed)**
```bash
git add -A && git commit -m "docs(workflows): record Slice J (read-write-file) complete"
```
(Per repo convention: merge to local `main` is the operator's call; do NOT push.)

---

## Self-review notes (for the implementer)

- **Spec coverage:** config knobs (Task 1), service signatures (Task 1), sandbox resolver + guards (Task 2), 4 gated services (Task 3), handler for all 4 operations + asText + binary/text write (Task 4), bootstrap wiring (Task 5), web form + palette (Task 4 palette + Task 6 form). Off-by-default + root-unset + escape errors all covered.
- **Type consistency:** `resolveWithinRoot({ enabled, root, userPath, mustExist }) → string` identical across Task 2 (def + tests) and Task 3 (`resolve` wrapper). `createHostFileService({ enabled, root, maxBytes })` returns the 4 methods used in Task 3 tests + Task 5 assignment. The 4 `WorkflowServices.hostFile*` signatures (Task 1) match the service return shapes (Task 3) and the handler calls (Task 4). `field` defaulting (`file` for binary, `content` for text) is consistent between handler + tests.
- **Security is centralized:** every operation routes through `resolveWithinRoot`; the handler/services never build paths another way. The resolver is pure (takes enabled/root as args) so it's exhaustively unit-tested.
- **Windows note:** the symlink test self-skips where symlink creation is unprivileged; the `within()` check is case-insensitive on win32.
