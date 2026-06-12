# Plugin Runtime + SDK + WHONET Reference Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `@openldr/plugins` placeholder with a real Extism/WASM plugin runtime, a permissive Rust plugin SDK, and a WHONET SQLite reference plugin that proves the ingest pipeline end-to-end (WHONET SQLite → FHIR R4 AMR).

**Architecture:** Plugins present as the existing `Converter` (`convert(raw, ctx) → FhirResource[]`). A new `ConverterResolver` in `@openldr/ingest` lets `handle.ts` resolve a converter id to either a built-in TS converter or a lazily-loaded WASM plugin. `@openldr/plugins` owns manifest validation, an internal `plugins` table store, blob-backed install/load (sha256-verified), and a `WasmPluginConverter` that runs the plugin through a thin `PluginRunner` seam. All Extism-coupled code lives in ONE module (`extism-runner.ts`) so every other unit is tested hermetically with a fake runner. The Rust side is a separate `wasm/` Cargo workspace.

**Tech Stack:** TypeScript (ESM, Bundler resolution), `@extism/extism` (host), Kysely, zod, Vitest; Rust (`extism-pdk`, `rusqlite` bundled, `serde_json`) targeting `wasm32-wasip1`.

**Reference:** `docs/superpowers/specs/2026-06-12-plugin-runtime-design.md`

**Conventions:** Commits `git -c commit.gpgsign=false commit`, **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions; `import type` for type-only. Packages export `./src/index.ts`. TS tasks (1–8) are hermetic (no toolchain). Rust + live integration (9–13) require the toolchain installed in Task 9.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/internal.ts` | add `PluginsTable` to `InternalSchema` (modify) |
| `packages/db/src/migrations/internal/004_plugins.ts` | new migration |
| `packages/db/src/migrations/internal/index.ts` | register 004 (modify) |
| `packages/ingest/src/resolver.ts` | `ConverterResolver` interface + `registryResolver` |
| `packages/ingest/src/handle.ts` | resolve via `ConverterResolver` (modify) |
| `packages/ingest/src/index.ts` | export resolver (modify) |
| `packages/plugins/src/manifest.ts` | `pluginManifestSchema` + `PluginManifest` |
| `packages/plugins/src/hash.ts` | `sha256Hex` |
| `packages/plugins/src/store.ts` | `createPluginStore` over `Kysely<InternalSchema>` |
| `packages/plugins/src/runner.ts` | `PluginRunner` interface + `RunnerHostFns` |
| `packages/plugins/src/wasm-converter.ts` | `WasmPluginConverter` (NDJSON parse + validate over a runner) |
| `packages/plugins/src/runtime.ts` | `createPluginRuntime` (install/list/test/remove/load) |
| `packages/plugins/src/extism-runner.ts` | the real Extism `PluginRunner` (only Extism-coupled file) |
| `packages/plugins/src/index.ts` | public surface (modify) |
| `packages/bootstrap/src/ingest-context.ts` | wire runtime + combined resolver + plugin admin (modify) |
| `packages/cli/src/plugin.ts` | `plugin install/list/test/run/remove` runners |
| `packages/cli/src/index.ts` | register plugin commands + `ingest --plugin` (modify) |
| `wasm/Cargo.toml` | Cargo workspace |
| `wasm/openldr-plugin-sdk/` | permissive Rust SDK crate |
| `wasm/whonet-sqlite/` | WHONET reference plugin crate |
| `scripts/build-wasm-plugins.mjs` | build + stage wasm + manifest |
| `scripts/make-whonet-sample.mjs` | synthetic sample SQLite generator |

---

## Task 1: `@openldr/db` — `plugins` table + migration 004

**Files:**
- Modify: `packages/db/src/schema/internal.ts`
- Create: `packages/db/src/migrations/internal/004_plugins.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Test: `packages/db/src/migrations/migrations.test.ts` (modify)

- [ ] **Step 1: Add `PluginsTable` and extend `InternalSchema` in `packages/db/src/schema/internal.ts`**

Insert this interface immediately before `export interface InternalSchema {`:

```ts
export interface PluginsTable {
  id: string;
  version: string;
  sha256: string;
  manifest: JSONColumnType<Record<string, unknown>>;
  status: Generated<string>;
  installed_at: Generated<Date>;
}
```

And change the `InternalSchema` interface to:

```ts
export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
  plugins: PluginsTable;
}
```

- [ ] **Step 2: Create `packages/db/src/migrations/internal/004_plugins.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugins')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.notNull())
    .addColumn('version', 'text', (c) => c.notNull())
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addColumn('manifest', 'jsonb', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('installed'))
    .addColumn('installed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('plugins_pkey', ['id', 'version'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('plugins').ifExists().execute();
}
```

- [ ] **Step 3: Replace `packages/db/src/migrations/internal/index.ts`**

```ts
import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';
import * as m002 from './002_outbox';
import * as m003 from './003_ingest_batches';
import * as m004 from './004_plugins';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
  '002_outbox': { up: m002.up, down: m002.down },
  '003_ingest_batches': { up: m003.up, down: m003.down },
  '004_plugins': { up: m004.up, down: m004.down },
};
```

- [ ] **Step 4: Update the migrations test** — in `packages/db/src/migrations/migrations.test.ts`, replace the internal-keys assertion to include `004_plugins`:

```ts
  it('internal has the four migrations with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins']);
    for (const m of Object.values(internalMigrations)) {
      expect(typeof m.up).toBe('function');
      expect(typeof m.down).toBe('function');
    }
  });
```

- [ ] **Step 5: Run + typecheck**

Run: `pnpm --filter @openldr/db test migrations && pnpm --filter @openldr/db typecheck`
Expected: migration-map test passes; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): plugins internal table + migration 004 (P1-PLUG-2)"
```

---

## Task 2: `@openldr/ingest` — `ConverterResolver` seam

**Files:**
- Create: `packages/ingest/src/resolver.ts`
- Modify: `packages/ingest/src/handle.ts`, `packages/ingest/src/index.ts`, `packages/ingest/src/pipeline.test.ts`
- Test: `packages/ingest/src/resolver.test.ts`

- [ ] **Step 1: Create `packages/ingest/src/resolver.ts`**

```ts
import type { Converter, ConverterRegistry } from './converter';

export interface ConverterResolver {
  resolve(id: string): Promise<Converter | undefined>;
}

/** Adapt a synchronous built-in registry to the async resolver interface. */
export function registryResolver(registry: ConverterRegistry): ConverterResolver {
  return {
    async resolve(id) {
      return registry.get(id);
    },
  };
}

/**
 * Compose resolvers: the first to return a Converter wins. Used by the
 * composition root to put built-in converters ahead of WASM plugins.
 */
export function chainResolvers(...resolvers: ConverterResolver[]): ConverterResolver {
  return {
    async resolve(id) {
      for (const r of resolvers) {
        const found = await r.resolve(id);
        if (found) return found;
      }
      return undefined;
    },
  };
}
```

- [ ] **Step 2: Write `packages/ingest/src/resolver.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { ConverterRegistry } from './converter';
import { registryResolver, chainResolvers, type ConverterResolver } from './resolver';

const conv = (id: string) => ({ id, version: '1', convert: async () => [] });

describe('registryResolver', () => {
  it('resolves a registered converter and undefined otherwise', async () => {
    const reg = new ConverterRegistry();
    reg.register(conv('a'));
    const r = registryResolver(reg);
    expect((await r.resolve('a'))?.id).toBe('a');
    expect(await r.resolve('missing')).toBeUndefined();
  });
});

describe('chainResolvers', () => {
  it('returns the first match in order', async () => {
    const first: ConverterResolver = { resolve: async (id) => (id === 'x' ? conv('first') : undefined) };
    const second: ConverterResolver = { resolve: async () => conv('second') };
    const chained = chainResolvers(first, second);
    expect((await chained.resolve('x'))?.id).toBe('first');
    expect((await chained.resolve('y'))?.id).toBe('second');
  });
});
```

- [ ] **Step 3: Run the test to verify it passes once both files exist**

Run: `pnpm --filter @openldr/ingest test resolver`
Expected: PASS (2 tests). If it errors that `resolver` is missing, confirm Step 1 was saved.

- [ ] **Step 4: Switch `packages/ingest/src/handle.ts` to the resolver**

Replace the whole file with:

```ts
import { type Logger, errorMessage, redact } from '@openldr/core';
import type { BlobStoragePort, EventEnvelope } from '@openldr/ports';
import type { Provenance, PersistResult } from '@openldr/db';
import type { ConverterResolver } from './resolver';
import type { BatchStore } from './batch-store';

export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resource: unknown, provenance: Provenance) => Promise<PersistResult>;
  resolver: ConverterResolver;
  batches: BatchStore;
  logger: Logger;
}

interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
}

export async function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void> {
  const { batchId, blobKey, source, converter } = event.payload as IngestPayload;
  await deps.batches.markProcessing(batchId);
  try {
    const raw = await deps.blob.get(blobKey);
    const c = await deps.resolver.resolve(converter);
    if (!c) throw new Error(`unknown converter: ${converter}`);
    const resources = await c.convert(raw, { source, batchId });
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    for (const resource of resources) {
      await deps.persist(resource, provenance);
    }
    await deps.batches.markDone(batchId, resources.length);
    deps.logger.info({ batchId, source, converter, count: resources.length }, 'ingest batch persisted');
  } catch (err) {
    const msg = redact(errorMessage(err));
    await deps.batches.markFailed(batchId, msg);
    deps.logger.error({ batchId, error: msg }, 'ingest batch failed');
    throw err;
  }
}
```

- [ ] **Step 5: Export the resolver from `packages/ingest/src/index.ts`**

Add after the existing exports:

```ts
export * from './resolver';
```

- [ ] **Step 6: Update `packages/ingest/src/pipeline.test.ts`** — the `handleIngestEvent` tests pass `converters: defaultConverters()`; change them to a resolver. Replace the `deps()` helper inside the `handleIngestEvent` describe block with:

```ts
  function deps(persist = vi.fn(async () => ({ saved: true, flattened: 'written' as const }))) {
    return {
      blob: { get: vi.fn(async () => enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] })) } as never,
      persist,
      resolver: registryResolver(defaultConverters()),
      batches: { markProcessing: vi.fn(async () => {}), markDone: vi.fn(async () => {}), markFailed: vi.fn(async () => {}) } as unknown as BatchStore,
      logger,
    };
  }
```

And add these imports at the top of the file (next to the existing imports):

```ts
import { registryResolver } from './resolver';
import type { BatchStore } from './batch-store';
```

- [ ] **Step 7: Run + typecheck**

Run: `pnpm --filter @openldr/ingest test && pnpm --filter @openldr/ingest typecheck`
Expected: resolver tests + converters tests + pipeline tests pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(ingest): ConverterResolver seam (built-in + plugin resolution)"
```

---

## Task 3: `@openldr/plugins` — manifest + hash (pure)

**Files:**
- Modify: `packages/plugins/package.json`
- Create: `packages/plugins/src/manifest.ts`, `packages/plugins/src/hash.ts`, `packages/plugins/src/manifest.test.ts`, `packages/plugins/src/hash.test.ts`
- Modify: `packages/plugins/src/index.ts`

- [ ] **Step 1: Replace `packages/plugins/package.json`**

```json
{
  "name": "@openldr/plugins",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/db": "workspace:*",
    "@openldr/fhir": "workspace:*",
    "@openldr/ingest": "workspace:*",
    "@openldr/ports": "workspace:*",
    "@extism/extism": "^2.0.0",
    "kysely": "^0.27.5",
    "zod": "^3.24.1"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

> Note: `@extism/extism` is added here but only imported by `extism-runner.ts` (Task 6). The version `^2.0.0` is the current major; if `pnpm install` resolves a different major, keep whatever installs cleanly and adjust the `extism-runner.ts` imports in Task 6 to match.

- [ ] **Step 2: Create `packages/plugins/src/manifest.ts`**

```ts
import { z } from 'zod';

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  entrypoint: z.string().min(1).default('convert'),
  wasmSha256: z.string().regex(/^[0-9a-f]{64}$/, 'wasmSha256 must be a 64-char hex digest'),
  description: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  wasi: z.boolean().default(false),
  limits: z
    .object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parseManifest(raw: unknown): PluginManifest {
  return pluginManifestSchema.parse(raw);
}
```

- [ ] **Step 3: Create `packages/plugins/src/hash.ts`**

```ts
import { createHash } from 'node:crypto';

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
```

- [ ] **Step 4: Write `packages/plugins/src/manifest.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseManifest } from './manifest';

const valid = { id: 'whonet-sqlite', version: '0.1.0', wasmSha256: 'a'.repeat(64) };

describe('parseManifest', () => {
  it('fills defaults', () => {
    const m = parseManifest(valid);
    expect(m.entrypoint).toBe('convert');
    expect(m.wasi).toBe(false);
    expect(m.limits.memoryMb).toBe(256);
    expect(m.limits.timeoutMs).toBe(30_000);
  });
  it('rejects a bad sha256', () => {
    expect(() => parseManifest({ ...valid, wasmSha256: 'nope' })).toThrow();
  });
  it('rejects a missing id', () => {
    expect(() => parseManifest({ version: '1', wasmSha256: 'a'.repeat(64) })).toThrow();
  });
});
```

- [ ] **Step 5: Write `packages/plugins/src/hash.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('hashes empty input to the known SHA-256', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
```

- [ ] **Step 6: Replace `packages/plugins/src/index.ts` with a temporary surface**

```ts
export * from './manifest';
export * from './hash';
```

- [ ] **Step 7: Install, run, typecheck**

Run: `pnpm install && pnpm --filter @openldr/plugins test && pnpm --filter @openldr/plugins typecheck`
Expected: manifest + hash tests pass; typecheck clean. (`@extism/extism` downloads but is unused so far.)

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(plugins): manifest schema + sha256 util (P1-PLUG-2)"
```

---

## Task 4: `@openldr/plugins` — runner seam + WasmPluginConverter

**Files:**
- Create: `packages/plugins/src/runner.ts`, `packages/plugins/src/wasm-converter.ts`, `packages/plugins/src/wasm-converter.test.ts`
- Modify: `packages/plugins/src/index.ts`

- [ ] **Step 1: Create `packages/plugins/src/runner.ts`** (the seam that isolates Extism)

```ts
export interface RunnerHostFns {
  log(level: string, msg: string): void;
  progress(done: number, total: number): void;
}

export interface RunOptions {
  entrypoint: string;
  wasi: boolean;
  memoryMb: number;
  timeoutMs: number;
  host: RunnerHostFns;
}

/**
 * Executes a wasm plugin once and returns its raw output bytes. The only
 * abstraction over the Extism host SDK — everything else is tested against a
 * fake implementation of this interface.
 */
export interface PluginRunner {
  run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array>;
}
```

- [ ] **Step 2: Create `packages/plugins/src/wasm-converter.ts`**

```ts
import type { Logger } from '@openldr/core';
import { validateResource, type FhirResource } from '@openldr/fhir';
import type { Converter, ConvertContext } from '@openldr/ingest';
import type { PluginManifest } from './manifest';
import type { PluginRunner, RunnerHostFns } from './runner';

const decoder = new TextDecoder();

function parseNdjson(bytes: Uint8Array): FhirResource[] {
  const text = decoder.decode(bytes);
  const out: FhirResource[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed: unknown = JSON.parse(trimmed);
    const result = validateResource(parsed);
    if (!result.ok) {
      const first = result.outcome.issue[0];
      throw new Error(`plugin emitted invalid FHIR: ${first?.diagnostics ?? 'validation failed'}`);
    }
    out.push(result.resource);
  }
  return out;
}

export function createWasmConverter(
  manifest: PluginManifest,
  wasm: Uint8Array,
  runner: PluginRunner,
  logger: Logger,
): Converter {
  const host: RunnerHostFns = {
    log(level, msg) {
      const fn = (logger as unknown as Record<string, (o: unknown, m?: string) => void>)[level] ?? logger.info;
      fn.call(logger, { plugin: manifest.id }, msg);
    },
    progress(done, total) {
      logger.debug({ plugin: manifest.id, done, total }, 'plugin progress');
    },
  };
  return {
    id: manifest.id,
    version: manifest.version,
    async convert(raw: Uint8Array, _ctx: ConvertContext): Promise<FhirResource[]> {
      const out = await runner.run(wasm, raw, {
        entrypoint: manifest.entrypoint,
        wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs,
        host,
      });
      return parseNdjson(out);
    },
  };
}
```

- [ ] **Step 3: Write `packages/plugins/src/wasm-converter.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWasmConverter } from './wasm-converter';
import { parseManifest } from './manifest';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const manifest = parseManifest({ id: 'demo', version: '0.1.0', wasmSha256: 'a'.repeat(64) });
const enc = (s: string) => new TextEncoder().encode(s);

function runnerReturning(text: string): PluginRunner {
  return { run: vi.fn(async () => enc(text)) };
}

describe('WasmPluginConverter', () => {
  it('parses NDJSON output into validated resources', async () => {
    const ndjson = '{"resourceType":"Patient","id":"p1"}\n{"resourceType":"Organization","id":"o1","name":"L"}\n';
    const c = createWasmConverter(manifest, new Uint8Array(), runnerReturning(ndjson), logger);
    const out = await c.convert(enc('input'), { batchId: 'b1' });
    expect(out).toHaveLength(2);
    expect(out[0].resourceType).toBe('Patient');
    expect(c.id).toBe('demo');
    expect(c.version).toBe('0.1.0');
  });

  it('ignores blank lines and returns empty for empty output', async () => {
    const c = createWasmConverter(manifest, new Uint8Array(), runnerReturning('\n  \n'), logger);
    expect(await c.convert(enc('x'), { batchId: 'b1' })).toEqual([]);
  });

  it('throws when the plugin emits invalid FHIR', async () => {
    const c = createWasmConverter(manifest, new Uint8Array(), runnerReturning('{"foo":1}\n'), logger);
    await expect(c.convert(enc('x'), { batchId: 'b1' })).rejects.toThrow(/invalid FHIR/);
  });
});
```

- [ ] **Step 4: Extend `packages/plugins/src/index.ts`**

```ts
export * from './manifest';
export * from './hash';
export * from './runner';
export * from './wasm-converter';
```

- [ ] **Step 5: Run + typecheck**

Run: `pnpm --filter @openldr/plugins test && pnpm --filter @openldr/plugins typecheck`
Expected: wasm-converter tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(plugins): PluginRunner seam + WasmPluginConverter NDJSON (P1-PLUG-1)"
```

---

## Task 5: `@openldr/plugins` — store + runtime

**Files:**
- Create: `packages/plugins/src/store.ts`, `packages/plugins/src/runtime.ts`, `packages/plugins/src/runtime.test.ts`
- Modify: `packages/plugins/src/index.ts`

- [ ] **Step 1: Create `packages/plugins/src/store.ts`**

```ts
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { PluginManifest } from './manifest';

export interface PluginRow {
  id: string;
  version: string;
  sha256: string;
  manifest: PluginManifest;
  status: string;
}

export interface PluginStore {
  upsert(row: { id: string; version: string; sha256: string; manifest: PluginManifest }): Promise<void>;
  get(id: string, version?: string): Promise<PluginRow | undefined>;
  list(): Promise<PluginRow[]>;
  remove(id: string, version?: string): Promise<void>;
}

const COLUMNS = ['id', 'version', 'sha256', 'manifest', 'status'] as const;

function toRow(r: { id: string; version: string; sha256: string; manifest: unknown; status: string }): PluginRow {
  return { ...r, manifest: r.manifest as PluginManifest };
}

/** Compare semver-ish strings numerically by dotted segment; non-numeric segments fall back to string order. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isInteger(na) && Number.isInteger(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const sa = pa[i] ?? '';
      const sb = pb[i] ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

export function createPluginStore(db: Kysely<InternalSchema>): PluginStore {
  return {
    async upsert(row) {
      await db
        .insertInto('plugins')
        .values({ id: row.id, version: row.version, sha256: row.sha256, manifest: row.manifest as never, status: 'installed' })
        .onConflict((oc) => oc.columns(['id', 'version']).doUpdateSet({ sha256: row.sha256, manifest: row.manifest as never, status: 'installed' }))
        .execute();
    },
    async get(id, version) {
      if (version) {
        const r = await db.selectFrom('plugins').select(COLUMNS).where('id', '=', id).where('version', '=', version).executeTakeFirst();
        return r ? toRow(r) : undefined;
      }
      const rows = await db.selectFrom('plugins').select(COLUMNS).where('id', '=', id).where('status', '=', 'installed').execute();
      if (rows.length === 0) return undefined;
      rows.sort((a, b) => compareVersions(b.version, a.version));
      return toRow(rows[0]);
    },
    async list() {
      const rows = await db.selectFrom('plugins').select(COLUMNS).orderBy('id').orderBy('version', 'desc').execute();
      return rows.map(toRow);
    },
    async remove(id, version) {
      let q = db.deleteFrom('plugins').where('id', '=', id);
      if (version) q = q.where('version', '=', version);
      await q.execute();
    },
  };
}
```

- [ ] **Step 2: Create `packages/plugins/src/runtime.ts`**

```ts
import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { Converter } from '@openldr/ingest';
import { parseManifest, type PluginManifest } from './manifest';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';
import { createWasmConverter } from './wasm-converter';

export interface PluginRuntimeDeps {
  blob: BlobStoragePort;
  store: PluginStore;
  runner: PluginRunner;
  logger: Logger;
}

export interface PluginRuntime {
  install(wasm: Uint8Array, rawManifest: unknown): Promise<PluginManifest>;
  list(): Promise<PluginRow[]>;
  test(id: string, version?: string): Promise<{ ok: boolean; error?: string }>;
  remove(id: string, version?: string): Promise<void>;
  load(id: string, version?: string): Promise<Converter | undefined>;
}

function wasmKey(id: string, version: string): string {
  return `plugins/${id}/${version}/plugin.wasm`;
}
function manifestKey(id: string, version: string): string {
  return `plugins/${id}/${version}/manifest.json`;
}

export function createPluginRuntime(deps: PluginRuntimeDeps): PluginRuntime {
  const cache = new Map<string, Converter>();

  async function loadWasm(row: PluginRow): Promise<Uint8Array> {
    const wasm = await deps.blob.get(wasmKey(row.id, row.version));
    const actual = sha256Hex(wasm);
    if (actual !== row.sha256) {
      throw new Error(`plugin ${row.id}@${row.version} sha256 mismatch (expected ${row.sha256}, got ${actual})`);
    }
    return wasm;
  }

  async function load(id: string, version?: string): Promise<Converter | undefined> {
    const row = await deps.store.get(id, version);
    if (!row) return undefined;
    const key = `${row.id}@${row.version}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const wasm = await loadWasm(row);
    const converter = createWasmConverter(row.manifest, wasm, deps.runner, deps.logger);
    cache.set(key, converter);
    return converter;
  }

  return {
    async install(wasm, rawManifest) {
      const manifest = parseManifest(rawManifest);
      const actual = sha256Hex(wasm);
      if (actual !== manifest.wasmSha256) {
        throw new Error(`manifest wasmSha256 (${manifest.wasmSha256}) does not match the wasm (${actual})`);
      }
      await deps.blob.put(wasmKey(manifest.id, manifest.version), wasm, 'application/wasm');
      await deps.blob.put(manifestKey(manifest.id, manifest.version), new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
      await deps.store.upsert({ id: manifest.id, version: manifest.version, sha256: actual, manifest });
      cache.delete(`${manifest.id}@${manifest.version}`);
      deps.logger.info({ id: manifest.id, version: manifest.version }, 'plugin installed');
      return manifest;
    },
    list: () => deps.store.list(),
    async test(id, version) {
      try {
        const c = await load(id, version);
        if (!c) return { ok: false, error: 'plugin not installed' };
        await c.convert(new Uint8Array(), { batchId: 'plugin-test' });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    remove: (id, version) => deps.store.remove(id, version),
    load,
  };
}
```

- [ ] **Step 3: Write `packages/plugins/src/runtime.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPluginRuntime } from './runtime';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const wasm = new TextEncoder().encode('\0asm fake bytes');
const sha = sha256Hex(wasm);
const enc = (s: string) => new TextEncoder().encode(s);

const fullManifest = (over: Partial<PluginRow['manifest']> = {}) => ({
  id: 'demo', version: '0.1.0', entrypoint: 'convert', wasmSha256: sha, description: '', license: 'x', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 }, ...over,
});

function fakeStore(initial: PluginRow[] = []): PluginStore {
  let rows = [...initial];
  return {
    upsert: vi.fn(async (r) => {
      rows = rows.filter((x) => !(x.id === r.id && x.version === r.version));
      rows.push({ ...r, status: 'installed' });
    }),
    get: vi.fn(async (id, version) => rows.find((x) => x.id === id && (version ? x.version === version : true))),
    list: vi.fn(async () => rows),
    remove: vi.fn(async (id, version) => {
      rows = rows.filter((x) => !(x.id === id && (version ? x.version === version : true)));
    }),
  };
}

function fakeBlob(map: Map<string, Uint8Array>) {
  return {
    put: vi.fn(async (k: string, b: Uint8Array) => { map.set(k, b); }),
    get: vi.fn(async (k: string) => { const v = map.get(k); if (!v) throw new Error('missing blob'); return v; }),
    exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn(),
  } as never;
}

const okRunner: PluginRunner = { run: vi.fn(async () => enc('{"resourceType":"Patient","id":"p1"}\n')) };

describe('PluginRuntime', () => {
  it('install validates sha, writes blob + store', async () => {
    const blobMap = new Map<string, Uint8Array>();
    const store = fakeStore();
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger });
    const out = await rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: sha });
    expect(out.id).toBe('demo');
    expect(blobMap.has('plugins/demo/0.1.0/plugin.wasm')).toBe(true);
    expect(store.upsert).toHaveBeenCalled();
  });

  it('install rejects a sha mismatch', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger });
    await expect(rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: 'b'.repeat(64) })).rejects.toThrow(/does not match/);
  });

  it('load fetches, verifies sha, returns a Converter', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', wasm]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed' }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger });
    const c = await rt.load('demo');
    expect(c?.id).toBe('demo');
    const resources = await c!.convert(enc('in'), { batchId: 'b' });
    expect(resources[0].resourceType).toBe('Patient');
  });

  it('load returns undefined for an unknown plugin', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger });
    expect(await rt.load('nope')).toBeUndefined();
  });

  it('load throws on a blob sha mismatch', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', enc('tampered')]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed' }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger });
    await expect(rt.load('demo')).rejects.toThrow(/sha256 mismatch/);
  });
});
```

- [ ] **Step 4: Extend `packages/plugins/src/index.ts`**

```ts
export * from './manifest';
export * from './hash';
export * from './runner';
export * from './wasm-converter';
export * from './store';
export * from './runtime';
```

- [ ] **Step 5: Run + typecheck**

Run: `pnpm --filter @openldr/plugins test && pnpm --filter @openldr/plugins typecheck`
Expected: store/runtime tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(plugins): PluginStore + createPluginRuntime install/load/test (P1-PLUG-2)"
```

---

## Task 6: `@openldr/plugins` — the real Extism runner

**Files:**
- Create: `packages/plugins/src/extism-runner.ts`
- Modify: `packages/plugins/src/index.ts`, `pnpm-workspace.yaml`

> This is the ONLY Extism-coupled module. It has no unit test (it requires a real wasm + the native Extism host); it is verified live in Task 13. Write it against the installed `@extism/extism` API and adjust if the host-function or call signatures differ in the resolved version.

- [ ] **Step 1: Allow the Extism native build in `pnpm-workspace.yaml`** — under `allowBuilds:` add `@extism/extism: true` so:

```yaml
allowBuilds:
  esbuild: true
  '@extism/extism': true
```

- [ ] **Step 2: Create `packages/plugins/src/extism-runner.ts`**

```ts
import createPlugin from '@extism/extism';
import type { CurrentPlugin } from '@extism/extism';
import type { PluginRunner, RunOptions } from './runner';

const PAGE_BYTES = 64 * 1024;

/**
 * Real Extism-backed runner. Host functions read their string/number args out
 * of plugin memory and forward to the injected host callbacks. The host-fn ABI
 * (arg layout, memory read helpers) follows the installed @extism/extism major;
 * verify against the resolved version during Task 13 and adjust if needed.
 */
export function createExtismRunner(): PluginRunner {
  return {
    async run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array> {
      const readStr = (cp: CurrentPlugin, offset: bigint): string => {
        const block = cp.read(offset);
        return block ? block.text() : '';
      };
      const plugin = await createPlugin(
        { wasm: [{ data: wasm }] },
        {
          useWasi: opts.wasi,
          runInWorker: true,
          memory: { maxPages: Math.ceil((opts.memoryMb * 1024 * 1024) / PAGE_BYTES) },
          timeoutMs: opts.timeoutMs,
          functions: {
            'extism:host/user': {
              log(cp: CurrentPlugin, level: bigint, msg: bigint) {
                opts.host.log(readStr(cp, level) || 'info', readStr(cp, msg));
              },
              progress(_cp: CurrentPlugin, done: bigint, total: bigint) {
                opts.host.progress(Number(done), Number(total));
              },
            },
          },
        },
      );
      try {
        const out = await plugin.call(opts.entrypoint, input);
        return out ? new Uint8Array(out.bytes()) : new Uint8Array();
      } finally {
        await plugin.close();
      }
    },
  };
}
```

- [ ] **Step 3: Export it from `packages/plugins/src/index.ts`** — append:

```ts
export * from './extism-runner';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm install && pnpm --filter @openldr/plugins typecheck`
Expected: typecheck clean. If `@extism/extism` type names differ (e.g. the `CurrentPlugin` type/import path, or `createPlugin` being a named vs default export), adjust the imports to the installed types until typecheck is clean. Do NOT add a unit test here.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(plugins): Extism-backed PluginRunner (P1-PLUG-1)"
```

---

## Task 7: `@openldr/bootstrap` — wire the runtime + resolver

**Files:**
- Modify: `packages/bootstrap/package.json` (add `@openldr/plugins`), `packages/bootstrap/src/ingest-context.ts`

- [ ] **Step 1: Add the dependency** — in `packages/bootstrap/package.json` `dependencies`, add `"@openldr/plugins": "workspace:*",`. Run `pnpm install`.

- [ ] **Step 2: Edit `packages/bootstrap/src/ingest-context.ts`**

Replace the existing `@openldr/ingest` import block with this (adds `registryResolver`, `chainResolvers`, `Converter`), and add the `@openldr/plugins` import block beneath it:

```ts
import {
  acceptPayload,
  handleIngestEvent,
  defaultConverters,
  createBatchStore,
  registryResolver,
  chainResolvers,
  type AcceptInput,
  type BatchStore,
  type Converter,
} from '@openldr/ingest';
import {
  createPluginStore,
  createPluginRuntime,
  createExtismRunner,
  type PluginRuntime,
} from '@openldr/plugins';
```

Extend the `IngestContext` interface — add a `plugins` member:

```ts
export interface IngestContext {
  accept(input: AcceptInput): Promise<{ batchId: string; blobKey: string }>;
  drain(): Promise<{ processed: number; failed: number }>;
  startWorker(): { stop(): Promise<void> };
  batches: BatchStore;
  plugins: PluginRuntime;
  republish(batch: { batch_id: string; blob_key: string; source: string | null; converter: string }): Promise<void>;
  queueStats(): Promise<Record<string, number>>;
  migrateAll(): Promise<void>;
  close(): Promise<void>;
}
```

In `createIngestContext`, after the existing `const converters = defaultConverters();` and `const batches = createBatchStore(internal.db);` lines, add:

```ts
  const pluginStore = createPluginStore(internal.db);
  const plugins = createPluginRuntime({ blob, store: pluginStore, runner: createExtismRunner(), logger });

  const pluginResolver = { resolve: (id: string): Promise<Converter | undefined> => plugins.load(id) };
  const resolver = chainResolvers(registryResolver(converters), pluginResolver);
```

Change the `subscribe` call to pass `resolver` instead of `converters`:

```ts
  await eventing.subscribe('ingest.received', (event) => handleIngestEvent({ blob, persist, resolver, batches, logger }, event));
```

Add `plugins` to the returned object literal (next to `batches,`):

```ts
    batches,
    plugins,
```

- [ ] **Step 3: Typecheck + depcruise**

Run: `pnpm install && pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`
Expected: typecheck clean; depcruise NO violations (confirms `@openldr/plugins` imports no `adapter-*`). If depcruise flags a violation, STOP — the runtime must not import a concrete adapter.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(bootstrap): wire plugin runtime + combined converter resolver (DP-1)"
```

---

## Task 8: CLI — plugin commands + `ingest --plugin`

**Files:**
- Create: `packages/cli/src/plugin.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create `packages/cli/src/plugin.ts`**

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createIngestContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runPluginInstall(wasmPath: string, opts: JsonOpt & { manifest?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const manifestPath = opts.manifest ?? join(dirname(wasmPath), 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const installed = await ctx.plugins.install(wasm, manifest);
    emit(opts.json, { id: installed.id, version: installed.version }, `installed ${installed.id}@${installed.version}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPluginList(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const rows = await ctx.plugins.list();
    emit(
      opts.json,
      rows.map((r) => ({ id: r.id, version: r.version, status: r.status, sha256: r.sha256 })),
      rows.map((r) => `  ${r.id.padEnd(22)} ${r.version.padEnd(10)} ${r.status}`).join('\n') || '  (no plugins)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPluginTest(id: string, opts: JsonOpt & { version?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const result = await ctx.plugins.test(id, opts.version);
    emit(opts.json, result, result.ok ? `plugin ${id}: ok` : `plugin ${id}: FAILED — ${result.error}`);
    return result.ok ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runPluginRun(input: string, opts: JsonOpt & { plugin: string; version?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const converter = await ctx.plugins.load(opts.plugin, opts.version);
    if (!converter) {
      emit(opts.json, { error: 'plugin not installed' }, `plugin ${opts.plugin} not installed`);
      return 1;
    }
    const data = new Uint8Array(readFileSync(input));
    const resources = await converter.convert(data, { source: 'cli', batchId: 'plugin-run' });
    emit(
      opts.json,
      resources,
      `produced ${resources.length} resource(s): [${resources.map((r) => r.resourceType).join(', ')}]`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPluginRemove(id: string, opts: JsonOpt & { version?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    await ctx.plugins.remove(id, opts.version);
    emit(opts.json, { removed: id, version: opts.version ?? 'all' }, `removed ${id}${opts.version ? '@' + opts.version : ' (all versions)'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Register in `packages/cli/src/index.ts`** — add the import beside the others (e.g. after `import { runIngest, ... } from './ingest';`):

```ts
import { runPluginInstall, runPluginList, runPluginTest, runPluginRun, runPluginRemove } from './plugin';
```

Add a `--plugin` alias to the existing `ingest` command. Find its `.option('--converter <id>', 'converter id', 'fhir-bundle')` line and add immediately after it:

```ts
  .option('--plugin <id>', 'plugin/converter id (alias of --converter)')
```

Change that command's `.action` signature to `(file: string, opts: { source: string; converter: string; plugin?: string; json: boolean })` and add as the FIRST line inside the action body:

```ts
      if (opts.plugin) opts.converter = opts.plugin;
```

Insert the plugin command group before the final `program.parseAsync(process.argv);`:

```ts
const plugin = program.command('plugin').description('Manage WASM ingest plugins');
plugin
  .command('install <wasm>')
  .description('Install a plugin (.wasm + manifest.json) into blob + registry')
  .option('--manifest <path>', 'manifest path (default: manifest.json next to the wasm)')
  .option('--json', 'emit JSON', false)
  .action(async (wasm: string, opts: { manifest?: string; json: boolean }) => {
    try { process.exitCode = await runPluginInstall(wasm, opts); } catch (err) { process.stderr.write(`plugin install failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('list')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runPluginList(opts); } catch (err) { process.stderr.write(`plugin list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('test <id>')
  .option('--version <v>', 'specific version')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginTest(id, opts); } catch (err) { process.stderr.write(`plugin test failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('run <input>')
  .description('Convert a local input file through a plugin (no queue)')
  .requiredOption('--plugin <id>', 'plugin id')
  .option('--version <v>', 'specific version')
  .option('--json', 'emit JSON', false)
  .action(async (input: string, opts: { plugin: string; version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginRun(input, opts); } catch (err) { process.stderr.write(`plugin run failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('remove <id>')
  .option('--version <v>', 'specific version (default: all)')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginRemove(id, opts); } catch (err) { process.stderr.write(`plugin remove failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
```

(The existing `errorMessage` import already covers these — do not add a duplicate.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: typecheck clean; `dist/index.js` produced. (Runtime verified in Task 13.)

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): plugin install/list/test/run/remove + ingest --plugin (P1-CLI-1/2)"
```

---

## Task 9: Toolchain + Cargo workspace + SDK crate

> Installs the Rust + LLVM toolchain on the machine (one-time). Run the install commands and verify before writing crates.

**Files:**
- Create: `wasm/Cargo.toml`, `wasm/rust-toolchain.toml`, `wasm/.gitignore`, `wasm/openldr-plugin-sdk/Cargo.toml`, `wasm/openldr-plugin-sdk/src/lib.rs`, `wasm/openldr-plugin-sdk/src/fhir.rs`, `wasm/openldr-plugin-sdk/LICENSE`

- [ ] **Step 1: Install the toolchain (Windows)**

```powershell
winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
winget install --id LLVM.LLVM -e --accept-source-agreements --accept-package-agreements
```

Then in a fresh shell:

```bash
rustup target add wasm32-wasip1
rustc --version && cargo --version && rustup target list --installed | grep wasm32-wasip1
clang --version
```

Expected: `rustc`/`cargo` print versions; `wasm32-wasip1` listed; `clang` prints a version (needed for `rusqlite` bundled). If `clang` is not on PATH after install, add `C:\Program Files\LLVM\bin` to PATH and reopen the shell.

- [ ] **Step 2: Create `wasm/Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = ["openldr-plugin-sdk", "whonet-sqlite"]

[workspace.package]
edition = "2021"
version = "0.1.0"
license = "Apache-2.0"

[profile.release]
opt-level = "z"
lto = true
strip = true
```

- [ ] **Step 3: Create `wasm/rust-toolchain.toml`**

```toml
[toolchain]
targets = ["wasm32-wasip1"]
```

- [ ] **Step 4: Create `wasm/.gitignore`**

```
/target
```

- [ ] **Step 5: Create `wasm/openldr-plugin-sdk/Cargo.toml`**

```toml
[package]
name = "openldr-plugin-sdk"
edition.workspace = true
version.workspace = true
license.workspace = true
description = "Permissive SDK for authoring OpenLDR WASM ingest plugins"

[lib]
crate-type = ["rlib"]

[dependencies]
extism-pdk = "1"
serde_json = "1"
```

- [ ] **Step 6: Create `wasm/openldr-plugin-sdk/LICENSE`** — the standard Apache-2.0 license text (full text from https://www.apache.org/licenses/LICENSE-2.0.txt).

- [ ] **Step 7: Create `wasm/openldr-plugin-sdk/src/fhir.rs`** (thin FHIR builders)

```rust
//! Minimal FHIR R4 resource builders that emit `serde_json::Value`.
use serde_json::{json, Value};

/// A Patient with optional family/given names, gender, and birthDate.
pub fn patient(id: &str, family: Option<&str>, given: Option<&str>, gender: Option<&str>, birth_date: Option<&str>) -> Value {
    let mut p = json!({ "resourceType": "Patient", "id": id });
    if family.is_some() || given.is_some() {
        let mut name = json!({});
        if let Some(f) = family { name["family"] = json!(f); }
        if let Some(g) = given { name["given"] = json!([g]); }
        p["name"] = json!([name]);
    }
    if let Some(g) = gender { p["gender"] = json!(g); }
    if let Some(b) = birth_date { p["birthDate"] = json!(b); }
    p
}

/// A Specimen referencing a subject, with an optional type code and collection date.
pub fn specimen(id: &str, subject_ref: &str, type_code: Option<&str>, collected: Option<&str>) -> Value {
    let mut s = json!({ "resourceType": "Specimen", "id": id, "subject": { "reference": subject_ref } });
    if let Some(t) = type_code {
        s["type"] = json!({ "coding": [{ "code": t }] });
    }
    if let Some(c) = collected {
        s["collection"] = json!({ "collectedDateTime": c });
    }
    s
}

/// An organism-identification Observation (a coded value).
pub fn observation_organism(id: &str, subject_ref: &str, specimen_ref: &str, organism_code: &str, organism_text: &str) -> Value {
    json!({
        "resourceType": "Observation",
        "id": id,
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "code": { "coding": [{ "system": "http://loinc.org", "code": "634-6", "display": "Bacteria identified" }] },
        "subject": { "reference": subject_ref },
        "specimen": { "reference": specimen_ref },
        "valueCodeableConcept": { "coding": [{ "code": organism_code }], "text": organism_text }
    })
}

/// An antibiotic-susceptibility Observation with an S/I/R interpretation code.
pub fn observation_ast(id: &str, subject_ref: &str, specimen_ref: &str, antibiotic: &str, interpretation: &str) -> Value {
    json!({
        "resourceType": "Observation",
        "id": id,
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "code": { "text": antibiotic },
        "subject": { "reference": subject_ref },
        "specimen": { "reference": specimen_ref },
        "interpretation": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": interpretation }] }]
    })
}
```

- [ ] **Step 8: Create `wasm/openldr-plugin-sdk/src/lib.rs`**

```rust
//! OpenLDR plugin SDK (Apache-2.0). Helpers for authoring WASM ingest plugins.
pub mod fhir;

pub use extism_pdk;
use serde_json::Value;

/// Serialize FHIR resources to NDJSON (one compact JSON object per line) — the
/// output ABI every OpenLDR plugin returns from its `convert` entrypoint.
pub fn to_ndjson(resources: &[Value]) -> String {
    resources.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ndjson_joins_one_per_line() {
        let out = to_ndjson(&[json!({ "a": 1 }), json!({ "b": 2 })]);
        assert_eq!(out, "{\"a\":1}\n{\"b\":2}");
    }

    #[test]
    fn patient_builds_name_and_gender() {
        let p = fhir::patient("p1", Some("Doe"), Some("Jane"), Some("female"), Some("1990-01-01"));
        assert_eq!(p["resourceType"], "Patient");
        assert_eq!(p["name"][0]["family"], "Doe");
        assert_eq!(p["gender"], "female");
    }
}
```

- [ ] **Step 9: Build + test the SDK crate**

Run: `cd wasm && cargo test -p openldr-plugin-sdk && cargo build -p openldr-plugin-sdk --target wasm32-wasip1`
Expected: host-side unit tests pass; the wasm-target build succeeds.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(plugins): Rust plugin SDK crate + Cargo workspace (P1-PLUG-3)"
```

---

## Task 10: WHONET SQLite reference plugin

**Files:**
- Create: `wasm/whonet-sqlite/Cargo.toml`, `wasm/whonet-sqlite/src/lib.rs`, `wasm/whonet-sqlite/src/mapping.rs`, `wasm/whonet-sqlite/LICENSE`

> WHONET input schema (the documented subset this plugin reads): a table `isolates` with columns
> `patient_id TEXT, sex TEXT, birth_date TEXT, spec_num TEXT, spec_type TEXT, spec_date TEXT, organism TEXT, organism_code TEXT`
> plus antibiotic result columns named `ab_<NAME>` holding `S` | `I` | `R` (e.g. `ab_AMP`, `ab_CIP`). Each row is one isolate → Patient + Specimen + organism Observation + one AST Observation per non-empty `ab_*` column.

- [ ] **Step 1: Create `wasm/whonet-sqlite/Cargo.toml`**

```toml
[package]
name = "whonet-sqlite"
edition.workspace = true
version.workspace = true
license.workspace = true
description = "WHONET SQLite -> FHIR R4 AMR reference plugin"

[lib]
crate-type = ["cdylib"]

[dependencies]
openldr-plugin-sdk = { path = "../openldr-plugin-sdk" }
extism-pdk = "1"
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled", "serialize"] }
```

> Verify during build: the resolved `rusqlite` `serialize` feature exposes `Connection::deserialize`. If it does not, switch the read in `lib.rs` to write `input` to a WASI temp path (`std::env::temp_dir()`) + `Connection::open`, set the manifest `wasi: true`, and add an `allowedPaths` temp mount in `extism-runner.ts` for that plugin. Keep `mapping.rs` unchanged.

- [ ] **Step 2: Create `wasm/whonet-sqlite/LICENSE`** — full Apache-2.0 text (same as the SDK).

- [ ] **Step 3: Create `wasm/whonet-sqlite/src/mapping.rs`**

```rust
//! WHONET isolate row → FHIR resources.
use openldr_plugin_sdk::fhir;
use rusqlite::Connection;
use serde_json::Value;

pub fn map_isolates(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    // Discover ab_* columns from the table schema.
    let ab_cols: Vec<String> = {
        let mut cols = Vec::new();
        let mut stmt = conn.prepare("PRAGMA table_info(isolates)")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for name in rows {
            let name = name?;
            if name.starts_with("ab_") {
                cols.push(name);
            }
        }
        cols
    };

    let base = "patient_id, sex, birth_date, spec_num, spec_type, spec_date, organism, organism_code";
    let select = if ab_cols.is_empty() { base.to_string() } else { format!("{base}, {}", ab_cols.join(", ")) };
    let sql = format!("SELECT {select} FROM isolates");

    let mut out = Vec::new();
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut idx = 0usize;
    while let Some(row) = rows.next()? {
        idx += 1;
        let patient_id: String = row.get::<_, Option<String>>(0)?.unwrap_or_else(|| format!("isolate-{idx}"));
        let sex: Option<String> = row.get(1)?;
        let birth_date: Option<String> = row.get(2)?;
        let spec_num: String = row.get::<_, Option<String>>(3)?.unwrap_or_else(|| format!("spec-{idx}"));
        let spec_type: Option<String> = row.get(4)?;
        let spec_date: Option<String> = row.get(5)?;
        let organism: Option<String> = row.get(6)?;
        let organism_code: Option<String> = row.get(7)?;

        let pid = format!("whonet-pat-{patient_id}");
        let sid = format!("whonet-spec-{spec_num}");
        let patient_ref = format!("Patient/{pid}");
        let specimen_ref = format!("Specimen/{sid}");

        let gender = sex.as_deref().map(|s| match s {
            "M" | "m" => "male",
            "F" | "f" => "female",
            _ => "unknown",
        });

        out.push(fhir::patient(&pid, None, None, gender, birth_date.as_deref()));
        out.push(fhir::specimen(&sid, &patient_ref, spec_type.as_deref(), spec_date.as_deref()));

        if let Some(org) = organism.as_deref() {
            out.push(fhir::observation_organism(
                &format!("whonet-org-{spec_num}"),
                &patient_ref,
                &specimen_ref,
                organism_code.as_deref().unwrap_or(org),
                org,
            ));
        }

        for (i, col) in ab_cols.iter().enumerate() {
            let val: Option<String> = row.get(8 + i)?;
            if let Some(v) = val {
                let v = v.trim();
                if v == "S" || v == "I" || v == "R" {
                    let ab = col.strip_prefix("ab_").unwrap_or(col);
                    out.push(fhir::observation_ast(
                        &format!("whonet-ast-{spec_num}-{ab}"),
                        &patient_ref,
                        &specimen_ref,
                        ab,
                        v,
                    ));
                }
            }
        }
    }
    Ok(out)
}
```

- [ ] **Step 4: Create `wasm/whonet-sqlite/src/lib.rs`**

```rust
mod mapping;

use extism_pdk::*;
use openldr_plugin_sdk::to_ndjson;
use rusqlite::Connection;

#[host_fn]
extern "ExtismHost" {
    fn log(level: String, msg: String);
    fn progress(done: u64, total: u64);
}

#[plugin_fn]
pub fn convert(input: Vec<u8>) -> FnResult<String> {
    let conn = Connection::open_in_memory().map_err(|e| WithReturnCode::new(Error::msg(format!("open: {e}")), 1))?;
    conn.deserialize(rusqlite::DatabaseName::Main, &input)
        .map_err(|e| WithReturnCode::new(Error::msg(format!("deserialize: {e}")), 1))?;
    let resources = mapping::map_isolates(&conn)
        .map_err(|e| WithReturnCode::new(Error::msg(format!("map: {e}")), 1))?;
    unsafe {
        let _ = log("info".into(), format!("whonet-sqlite produced {} resources", resources.len()));
    }
    Ok(to_ndjson(&resources))
}
```

> Verify during build: `Connection::deserialize` signature/availability under the resolved `rusqlite`; apply the WASI-temp-file fallback from Step 1's note if absent. If the `#[host_fn]`/`#[plugin_fn]` macro names or error wrappers differ in the installed `extism-pdk`, adjust to the documented call form (the host import + the `FnResult<String>` return are the stable contract).

- [ ] **Step 5: Build for wasm**

Run: `cd wasm && cargo build -p whonet-sqlite --release --target wasm32-wasip1`
Expected: produces `wasm/target/wasm32-wasip1/release/whonet_sqlite.wasm`. If `rusqlite` bundled fails to compile, confirm `clang` is on PATH (Task 9 Step 1) and set `CC=clang` / `AR=llvm-ar` for the build if `cc` can't find a wasm-capable compiler.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(plugins): WHONET SQLite reference plugin (P1-PLUG-4)"
```

---

## Task 11: Build wiring + sample data

**Files:**
- Create: `scripts/build-wasm-plugins.mjs`, `scripts/make-whonet-sample.mjs`, `reference-plugins/.gitignore`
- Modify: root `package.json` (scripts + `better-sqlite3` devDep), `pnpm-workspace.yaml`

- [ ] **Step 1: Create `scripts/build-wasm-plugins.mjs`**

```js
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');
const outDir = join(root, 'reference-plugins', 'whonet-sqlite');

execSync('cargo build -p whonet-sqlite --release --target wasm32-wasip1', { cwd: wasmDir, stdio: 'inherit' });

const builtWasm = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'whonet_sqlite.wasm');
mkdirSync(outDir, { recursive: true });
const stagedWasm = join(outDir, 'plugin.wasm');
copyFileSync(builtWasm, stagedWasm);

const bytes = readFileSync(stagedWasm);
const sha = createHash('sha256').update(bytes).digest('hex');
const cargoToml = readFileSync(join(wasmDir, 'whonet-sqlite', 'Cargo.toml'), 'utf8');
const ver = (cargoToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const manifest = {
  id: 'whonet-sqlite',
  version: ver,
  entrypoint: 'convert',
  wasmSha256: sha,
  description: 'WHONET SQLite -> FHIR R4 AMR reference plugin',
  license: 'Apache-2.0',
  wasi: false,
  limits: { memoryMb: 256, timeoutMs: 30000 },
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${stagedWasm} (sha256 ${sha}) + manifest.json\n`);
```

> Note: `whonet-sqlite/Cargo.toml` uses `version.workspace = true`, so the `version = "..."` regex above will NOT match the plugin crate's file — it matches the workspace `version` only if present there. To keep this robust, read the version from `wasm/Cargo.toml` (the `[workspace.package]` `version`) instead: change the `cargoToml` path to `join(wasmDir, 'Cargo.toml')`. Both resolve to `0.1.0` initially; use the workspace file so a single bump flows through.

- [ ] **Step 2: Create `scripts/make-whonet-sample.mjs`**

```js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'whonet-sample.sqlite');
const db = new Database(path);
db.exec(`
  DROP TABLE IF EXISTS isolates;
  CREATE TABLE isolates (
    patient_id TEXT, sex TEXT, birth_date TEXT,
    spec_num TEXT, spec_type TEXT, spec_date TEXT,
    organism TEXT, organism_code TEXT,
    ab_AMP TEXT, ab_CIP TEXT, ab_GEN TEXT
  );
`);
const insert = db.prepare(`INSERT INTO isolates VALUES (@patient_id,@sex,@birth_date,@spec_num,@spec_type,@spec_date,@organism,@organism_code,@ab_AMP,@ab_CIP,@ab_GEN)`);
insert.run({ patient_id: 'P001', sex: 'F', birth_date: '1990-04-12', spec_num: 'S001', spec_type: 'BLOOD', spec_date: '2026-01-10', organism: 'Escherichia coli', organism_code: 'eco', ab_AMP: 'R', ab_CIP: 'S', ab_GEN: 'S' });
insert.run({ patient_id: 'P002', sex: 'M', birth_date: '1985-11-30', spec_num: 'S002', spec_type: 'URINE', spec_date: '2026-01-11', organism: 'Klebsiella pneumoniae', organism_code: 'kpn', ab_AMP: 'R', ab_CIP: 'I', ab_GEN: 'S' });
db.close();
process.stdout.write(`wrote ${path}\n`);
```

- [ ] **Step 3: Create `reference-plugins/.gitignore`**

```
plugin.wasm
manifest.json
```

(The built wasm and its generated manifest are toolchain artifacts produced by `pnpm build:plugins` — not committed.)

- [ ] **Step 4: Add root scripts + dev dep** — in root `package.json`, add to `scripts`:

```json
    "build:plugins": "node scripts/build-wasm-plugins.mjs",
    "make:whonet-sample": "node scripts/make-whonet-sample.mjs"
```

and add to `devDependencies`:

```json
    "better-sqlite3": "^11.7.0"
```

In `pnpm-workspace.yaml` add `better-sqlite3: true` under `allowBuilds:` (native module). Run `pnpm install`.

- [ ] **Step 5: Generate the sample + build the plugin**

Run: `pnpm make:whonet-sample && pnpm build:plugins`
Expected: `samples/whonet-sample.sqlite` written; `reference-plugins/whonet-sqlite/plugin.wasm` + `manifest.json` staged with a real sha256.

- [ ] **Step 6: Commit** (scripts + sample, not the wasm/manifest artifacts)

```bash
git add scripts reference-plugins/.gitignore package.json pnpm-lock.yaml pnpm-workspace.yaml samples/whonet-sample.sqlite
git -c commit.gpgsign=false commit -m "chore(plugins): wasm build script + synthetic WHONET sample"
```

---

## Task 12: Hermetic plugin→pipeline wiring test

**Files:**
- Test: `packages/plugins/src/integration.test.ts`

> A hermetic test that proves a plugin-shaped Converter flows through `handleIngestEvent` end-to-end using fakes (no Extism, no docker) — guards the seam wiring before the live run.

- [ ] **Step 1: Write `packages/plugins/src/integration.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleIngestEvent, chainResolvers, registryResolver, ConverterRegistry } from '@openldr/ingest';
import { createPluginRuntime } from './runtime';
import { sha256Hex } from './hash';
import type { PluginRow, PluginStore } from './store';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const enc = (s: string) => new TextEncoder().encode(s);
const wasm = enc('fake-wasm');
const sha = sha256Hex(wasm);

const row: PluginRow = {
  id: 'whonet-sqlite', version: '0.1.0', sha256: sha, status: 'installed',
  manifest: { id: 'whonet-sqlite', version: '0.1.0', entrypoint: 'convert', wasmSha256: sha, description: '', license: 'Apache-2.0', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } },
};

const store: PluginStore = {
  upsert: vi.fn(), list: vi.fn(async () => [row]), remove: vi.fn(),
  get: vi.fn(async (id) => (id === 'whonet-sqlite' ? row : undefined)),
};
const blob = {
  get: vi.fn(async () => wasm), put: vi.fn(), exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn(),
} as never;
const runner: PluginRunner = { run: vi.fn(async () => enc('{"resourceType":"Patient","id":"p1"}\n{"resourceType":"Specimen","id":"s1","subject":{"reference":"Patient/p1"}}\n')) };

describe('plugin → handleIngestEvent (hermetic)', () => {
  it('resolves a plugin converter and persists its resources with plugin provenance', async () => {
    const runtime = createPluginRuntime({ blob, store, runner, logger });
    const resolver = chainResolvers(registryResolver(new ConverterRegistry()), { resolve: (id) => runtime.load(id) });
    const persist = vi.fn(async () => ({ saved: true, flattened: 'written' as const }));
    const batches = { markProcessing: vi.fn(), markDone: vi.fn(), markFailed: vi.fn() } as never;

    await handleIngestEvent(
      { blob, persist, resolver, batches, logger },
      { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'lab', converter: 'whonet-sqlite' } },
    );

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'Patient' }),
      expect.objectContaining({ pluginId: 'whonet-sqlite', pluginVersion: '0.1.0', sourceSystem: 'lab', batchId: 'b1' }),
    );
    expect(batches.markDone).toHaveBeenCalledWith('b1', 2);
  });
});
```

- [ ] **Step 2: Run + typecheck**

Run: `pnpm --filter @openldr/plugins test && pnpm --filter @openldr/plugins typecheck`
Expected: the integration test passes; typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "test(plugins): hermetic plugin→handleIngestEvent wiring (P1-PLUG-1)"
```

---

## Task 13: Live integration acceptance + final gate

> Requires the docker stack (Postgres + MinIO) and the wasm built in Task 11.

- [ ] **Step 1: Stack up + migrate**

Run: `docker compose up -d` ; `pnpm openldr db reset --json`.
Verify: `docker compose exec -T postgres psql -U openldr -d openldr -c "\dt"` shows `plugins` alongside `fhir_resources`, `outbox_events`, `ingest_batches`.

- [ ] **Step 2: Install + list + test the plugin**

Run: `pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm --json`
Expected: `{ "id": "whonet-sqlite", "version": "..." }`; exit 0.
Run: `pnpm openldr plugin list --json` → shows `whonet-sqlite` `installed`.
Run: `pnpm openldr plugin test whonet-sqlite --json` → `{ "ok": true }` (an empty input yields zero resources without throwing). If `ok:false`, read the error — likely the Extism host-fn ABI (Task 6) or rusqlite read (Task 10) needs the flagged adjustment.
Verify blob: the MinIO bucket has `plugins/whonet-sqlite/<version>/plugin.wasm`.

- [ ] **Step 3: `plugin run` (no queue)**

Run: `pnpm openldr plugin run samples/whonet-sample.sqlite --plugin whonet-sqlite --json`
Expected: a JSON array including `Patient`, `Specimen`, and `Observation` resources (organism + AST); exit 0.

- [ ] **Step 4: Ingest through the pipeline with provenance**

Run: `pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --source whonet --json`
Expected: `status: "done"`, `resourceCount >= 8` (2 patients + 2 specimens + 2 organism + AST rows); exit 0.
Verify provenance:
`docker compose exec -T postgres psql -U openldr -d openldr -c "select resource_type, count(*) from fhir_resources where plugin_id='whonet-sqlite' group by resource_type;"` → Patient/Specimen/Observation counts, all with `plugin_id=whonet-sqlite` and the exact `plugin_version`.
Run: `pnpm openldr provenance audit --json` → `{ "gaps": 0 }`; exit 0 (P1-NFR-6).

- [ ] **Step 5: Graceful failure (DP-7)**

Run: `pnpm openldr ingest packages/cli/src/__fixtures__/bad.json --plugin whonet-sqlite --json`
Expected: the command completes (no crash); batch `failed` (the plugin can't open non-SQLite bytes → traps → caught), exit 1. `pnpm openldr pipeline status` shows the batch `failed` with an error. No stack-trace crash.

- [ ] **Step 6: Final gate (TS)**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build && pnpm --filter @openldr/server build:check`
Expected: typecheck clean; all tests pass; depcruise no violations (`@openldr/plugins` imports no `adapter-*`); builds succeed; server smoke passes (no dynamic-require error).

- [ ] **Step 7: Final gate (Rust)**

Run: `cd wasm && cargo build --release --target wasm32-wasip1 && cargo test`
Expected: wasm build succeeds; SDK host-side tests pass.

- [ ] **Step 8: Commit any final delta**

Run: `git status --short` — commit `pnpm-lock.yaml`/lockfile deltas if any (`chore: finalize plugin-runtime lockfile`).

---

## Done criteria (maps to spec §11)

- [ ] Extism/WASM runtime with the host-function interface — input (Extism input), emit FHIR (NDJSON), `log`, `progress` (P1-PLUG-1).
- [ ] Plugins fetched from blob by id+version, sha256-verified; provenance ties output to the exact plugin version (P1-PLUG-2).
- [ ] Permissive (Apache-2.0) Rust plugin SDK crate (P1-PLUG-3).
- [ ] WHONET SQLite reference plugin proven end-to-end through the live pipeline (P1-PLUG-4).
- [ ] Sandbox isolation (no fs/net host funcs; memory + timeout limits); failures degrade to a failed batch, never an app crash (P1-NFR-2, DP-7).
- [ ] `plugin install|list|test|run|remove` + `ingest --plugin` with `--json` (P1-CLI-1/2).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green; `cargo build --target wasm32-wasip1` succeeds.
