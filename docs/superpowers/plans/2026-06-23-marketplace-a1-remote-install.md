# Marketplace A1 — Remote Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the OpenLDR server install marketplace artifacts over HTTPS from a published `index.json` (instead of only a local folder), behind a `RegistrySource` abstraction, with a manual Refresh and a Local/Remote source indicator.

**Architecture:** Extract the registry read path behind a `RegistrySource` interface in `@openldr/marketplace` with two impls — `LocalRegistrySource` (today's dir scan) and `HttpRegistrySource` (reads `index.json` for listing, fetches+assembles+verifies a single bundle for detail/install). The server resolves the source from config (`MARKETPLACE_REGISTRY_URL` → http, else `MARKETPLACE_REGISTRY_DIR` → local) once at route registration. Verification stays fail-closed at install. This is sub-project A, phase 1 (install only); publishing is A2.

**Tech Stack:** Node global `fetch`, zod, Fastify, React + react-i18next + shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-marketplace-a-remote-registry-design.md` (§3.1, §3.2; install half).

---

## File Structure

- Modify: `packages/config/src/schema.ts` — add `MARKETPLACE_REGISTRY_URL`.
- Modify: `packages/marketplace/src/bundle-fs.ts` — export `payloadFileName`, add `assembleBundle`, refactor `readBundle` to use it.
- Create: `packages/marketplace/src/index-json.ts` — `index.json` zod schema + `parseIndex` + `mergeIndexEntry`.
- Create: `packages/marketplace/src/index-json.test.ts`.
- Create: `packages/marketplace/src/registry-source.ts` — `RegistrySource` + `LocalRegistrySource` + `HttpRegistrySource`.
- Create: `packages/marketplace/src/registry-source.test.ts`.
- Modify: `packages/marketplace/src/index.ts` — export the two new modules.
- Modify: `apps/server/src/marketplace-routes.ts` — resolve source, route through it, add `/refresh`, add `source`/`host` to `available`.
- Modify: `apps/server/src/marketplace-routes.test.ts` — cover http source + refresh.
- Modify: `apps/web/src/api.ts` — relax `AvailableArtifact`, add `source`/`host` to the available response, add `refreshRegistry`.
- Modify: `apps/web/src/pages/settings/marketplace/util.ts` — default capabilities in `availableToEntry`.
- Modify: `apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx` — source indicator + Refresh button.
- Modify: `apps/web/src/pages/settings/Marketplace.tsx` — pass source/host + onRefresh.
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx` — refresh + source indicator.
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts` — `refresh`, `sourceLocal`, `sourceRemote`, `registryUnreachable` keys.

---

## Task 1: Config — `MARKETPLACE_REGISTRY_URL`

**Files:** Modify `packages/config/src/schema.ts:86-87`

- [ ] **Step 1: Add the key**

In `packages/config/src/schema.ts`, in the `// Marketplace artifact security.` block (currently lines 86-87), add a line so it reads:

```ts
    // Marketplace artifact security.
    MARKETPLACE_DEV_ALLOW_UNSIGNED: envBoolean(false),
    MARKETPLACE_REGISTRY_DIR: z.string().optional(),
    MARKETPLACE_REGISTRY_URL: z.string().optional(), // raw base URL of a remote registry; takes precedence over _DIR for install
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C packages/config typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/schema.ts
git commit -m "feat(config): MARKETPLACE_REGISTRY_URL for remote marketplace install"
```

---

## Task 2: bundle-fs — extract `assembleBundle` + `payloadFileName`

**Files:** Modify `packages/marketplace/src/bundle-fs.ts`

This lets `HttpRegistrySource` build a `Bundle` from fetched bytes using the exact same assembly as `readBundle` (DRY).

- [ ] **Step 1: Refactor `bundle-fs.ts`**

Replace the body of `packages/marketplace/src/bundle-fs.ts` from the `PAYLOAD_FILE` map through the end of `readBundle` with:

```ts
/** Map from payload.kind to the filename stored in the bundle directory. */
const PAYLOAD_FILE: Record<string, string> = {
  plugin: 'plugin.wasm',
  'form-template': 'questionnaire.json',
  'report-template': 'report.json',
};

/** The payload filename for a manifest's payload.kind (defaults to plugin.wasm). */
export function payloadFileName(kind: string): string {
  return PAYLOAD_FILE[kind] ?? 'plugin.wasm';
}

/**
 * Assemble a Bundle from raw manifest JSON + payload bytes + hex public key.
 * Shared by readBundle (local dir) and HttpRegistrySource (remote fetch).
 */
export function assembleBundle(raw: Record<string, unknown>, payload: Uint8Array, pubHex: string): Bundle {
  const manifest = parseArtifactManifest(raw);
  const publicKeyDer = Uint8Array.from(Buffer.from(pubHex.trim(), 'hex'));
  const payloadSha256 = createHash('sha256').update(payload).digest('hex');
  return { manifest, raw, wasm: payload, publicKeyDer, payloadSha256 };
}

/**
 * Read a bundle directory containing:
 *   manifest.json          — the (signed) artifact manifest
 *   plugin.wasm            — plugin binary  (payload.kind === 'plugin')
 *   questionnaire.json     — FHIR Questionnaire  (payload.kind === 'form-template')
 *   report.json            — report definition  (payload.kind === 'report-template')
 *   publisher.pub          — hex-encoded SPKI DER public key
 */
export async function readBundle(dir: string): Promise<Bundle> {
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const kind = String((raw.payload as { kind?: string } | null)?.kind ?? 'plugin');
  const payload = new Uint8Array(await readFile(join(dir, payloadFileName(kind))));
  const pubHex = await readFile(join(dir, 'publisher.pub'), 'utf8');
  return assembleBundle(raw, payload, pubHex);
}
```

(Note: `assembleBundle` reads `kind` from the parsed manifest internally is unnecessary — the caller selects the payload file. `readBundle` derives `kind` from `raw.payload.kind` before choosing the filename, matching the prior behavior which used the parsed manifest; reading from `raw` is equivalent and avoids parsing twice.)

- [ ] **Step 2: Run the existing bundle tests**

Run: `pnpm -C packages/marketplace test -- bundle-fs`
Expected: PASS (the existing `bundle-fs` / `bundle` tests still pass — behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add packages/marketplace/src/bundle-fs.ts
git commit -m "refactor(marketplace): extract assembleBundle + payloadFileName from readBundle"
```

---

## Task 3: `index-json.ts` — schema + parse + merge (TDD)

**Files:**
- Create: `packages/marketplace/src/index-json.ts`
- Create: `packages/marketplace/src/index-json.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/marketplace/src/index-json.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseIndex, mergeIndexEntry, type MarketplaceIndexEntry } from './index-json';

const entry = (over: Partial<MarketplaceIndexEntry> = {}): MarketplaceIndexEntry => ({
  id: 'whonet-sqlite', kind: 'plugin', latestVersion: '1.1.0',
  publisher: 'OpenLDR', summary: 'WHONET -> FHIR',
  path: 'bundles/whonet-sqlite-1.1.0', signatureFingerprint: 'a'.repeat(64), ...over,
});

describe('index-json', () => {
  it('parses a valid index', () => {
    const idx = parseIndex({ schemaVersion: 1, name: 'M', updatedAt: '2026-01-01T00:00:00Z', packages: [entry()] });
    expect(idx.packages).toHaveLength(1);
    expect(idx.packages[0].id).toBe('whonet-sqlite');
  });

  it('rejects malformed input', () => {
    expect(() => parseIndex({ schemaVersion: 1, packages: 'nope' })).toThrow();
  });

  it('appends a new entry and bumps updatedAt', () => {
    const idx = parseIndex({ schemaVersion: 1, name: 'M', updatedAt: 'old', packages: [] });
    const next = mergeIndexEntry(idx, entry(), '2026-06-23T00:00:00Z');
    expect(next.packages).toHaveLength(1);
    expect(next.updatedAt).toBe('2026-06-23T00:00:00Z');
  });

  it('updates an existing entry by id (no duplicate)', () => {
    const idx = parseIndex({ schemaVersion: 1, name: 'M', updatedAt: 'old', packages: [entry({ latestVersion: '1.0.0' })] });
    const next = mergeIndexEntry(idx, entry({ latestVersion: '1.1.0' }), 'now');
    expect(next.packages).toHaveLength(1);
    expect(next.packages[0].latestVersion).toBe('1.1.0');
  });

  it('seeds an empty index from scratch', () => {
    const seeded = mergeIndexEntry(parseIndex(null), entry(), 'now');
    expect(seeded.packages).toHaveLength(1);
    expect(seeded.schemaVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/marketplace test -- index-json`
Expected: FAIL — `Cannot find module './index-json'`.

- [ ] **Step 3: Implement — `packages/marketplace/src/index-json.ts`**

```ts
import { z } from 'zod';

const indexEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['plugin', 'form-template', 'report-template', 'form', 'report', 'test-definition']),
  latestVersion: z.string().min(1),
  publisher: z.string().default(''),
  summary: z.string().default(''),
  path: z.string().min(1),
  signatureFingerprint: z.string().optional(),
});

const indexSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().default('OpenLDR CE Marketplace'),
  updatedAt: z.string().default(''),
  packages: z.array(indexEntrySchema).default([]),
});

export type MarketplaceIndexEntry = z.infer<typeof indexEntrySchema>;
export type MarketplaceIndex = z.infer<typeof indexSchema>;

const EMPTY_INDEX: MarketplaceIndex = { schemaVersion: 1, name: 'OpenLDR CE Marketplace', updatedAt: '', packages: [] };

/** Parse an index.json. `null`/`undefined` (e.g. a 404 on first publish) yields an empty index. */
export function parseIndex(raw: unknown): MarketplaceIndex {
  if (raw === null || raw === undefined) return { ...EMPTY_INDEX };
  return indexSchema.parse(raw);
}

/** Update-or-append an entry by id and set updatedAt. Pure; caller supplies the timestamp. */
export function mergeIndexEntry(index: MarketplaceIndex, entry: MarketplaceIndexEntry, nowIso: string): MarketplaceIndex {
  const packages = index.packages.some((p) => p.id === entry.id)
    ? index.packages.map((p) => (p.id === entry.id ? entry : p))
    : [...index.packages, entry];
  return { ...index, updatedAt: nowIso, packages };
}
```

- [ ] **Step 4: Export from the package barrel**

In `packages/marketplace/src/index.ts`, add after the existing exports:

```ts
export * from './index-json';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/marketplace test -- index-json`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/marketplace/src/index-json.ts packages/marketplace/src/index-json.test.ts packages/marketplace/src/index.ts
git commit -m "feat(marketplace): index.json schema + parseIndex + mergeIndexEntry"
```

---

## Task 4: `registry-source.ts` — Local + Http sources (TDD)

**Files:**
- Create: `packages/marketplace/src/registry-source.ts`
- Create: `packages/marketplace/src/registry-source.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/marketplace/src/registry-source.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { generatePublisherKeypair, packBundle, verifyBundle } from './index';
import { LocalRegistrySource, HttpRegistrySource } from './registry-source';

let dir: string;
let manifestJson: string;
let wasmBytes: Uint8Array;
let pubHex: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reg-src-'));
  const kp = generatePublisherKeypair();
  const manifest = {
    schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    payload: { kind: 'plugin', wasmSha256: '0'.repeat(64) },
  };
  const bundleDir = join(dir, 'demo-1');
  await packBundle({ manifest, payload: new Uint8Array([1, 2, 3, 4]), outDir: bundleDir, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
  manifestJson = readFileSync(join(bundleDir, 'manifest.json'), 'utf8');
  wasmBytes = new Uint8Array(readFileSync(join(bundleDir, 'plugin.wasm')));
  pubHex = readFileSync(join(bundleDir, 'publisher.pub'), 'utf8');
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('LocalRegistrySource', () => {
  it('lists and gets a verifiable bundle', async () => {
    const src = new LocalRegistrySource(dir);
    const list = await src.list();
    expect(list.map((l) => l.ref)).toContain('demo-1');
    const b = await src.getBundle('demo-1');
    expect(verifyBundle(b).valid).toBe(true);
  });
});

describe('HttpRegistrySource', () => {
  const base = 'https://example.test/mkt';
  const indexJson = JSON.stringify({
    schemaVersion: 1, name: 'M', updatedAt: 'now',
    packages: [{ id: 'demo', kind: 'plugin', latestVersion: '1.0.0', publisher: 'Acme', summary: 's', path: 'bundles/demo-1', signatureFingerprint: 'x' }],
  });

  function mockFetch() {
    return vi.fn(async (url: string) => {
      const u = String(url);
      const ok = (body: BodyInit) => ({ ok: true, status: 200, text: async () => String(body), arrayBuffer: async () => (body as Uint8Array).buffer, json: async () => JSON.parse(String(body)) }) as unknown as Response;
      if (u.endsWith('/index.json')) return ok(indexJson);
      if (u.endsWith('/bundles/demo-1/manifest.json')) return ok(manifestJson);
      if (u.endsWith('/bundles/demo-1/plugin.wasm')) return { ok: true, status: 200, arrayBuffer: async () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) } as unknown as Response;
      if (u.endsWith('/bundles/demo-1/publisher.pub')) return ok(pubHex);
      return { ok: false, status: 404, text: async () => 'nope' } as unknown as Response;
    });
  }

  it('lists from index.json without downloading payloads', async () => {
    const fetchMock = mockFetch();
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    const list = await src.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: 'demo-1', id: 'demo', version: '1.0.0', type: 'plugin' });
    // only index.json fetched for listing
    expect(fetchMock.mock.calls.every((c) => String(c[0]).endsWith('/index.json'))).toBe(true);
  });

  it('getBundle assembles a verifiable bundle from fetched files', async () => {
    const src = new HttpRegistrySource(base, mockFetch() as unknown as typeof fetch);
    await src.list();
    const b = await src.getBundle('demo-1');
    expect(verifyBundle(b).valid).toBe(true);
  });

  it('throws a registry-unreachable error when index.json is missing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => 'x' }) as unknown as Response);
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    await expect(src.list()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/marketplace test -- registry-source`
Expected: FAIL — `Cannot find module './registry-source'`.

- [ ] **Step 3: Implement — `packages/marketplace/src/registry-source.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { readBundle, assembleBundle, payloadFileName, type Bundle } from './bundle-fs';
import { parseIndex, type MarketplaceIndexEntry } from './index-json';

export interface RegistryListing {
  ref: string;            // safe single segment (local: dir name; http: path basename)
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
  valid?: boolean;        // computed only for local (which reads bundles); undefined for http
}

export interface RegistrySource {
  kind: 'local' | 'http';
  /** A human-friendly host/label for the UI source indicator. */
  label: string;
  /** Drop any cached index so the next list() re-reads. */
  refresh(): void;
  list(): Promise<RegistryListing[]>;
  getBundle(ref: string): Promise<Bundle>;
}

export class LocalRegistrySource implements RegistrySource {
  readonly kind = 'local' as const;
  constructor(private readonly dir: string) {}
  get label(): string { return 'local'; }
  refresh(): void { /* no cache */ }

  async list(): Promise<RegistryListing[]> {
    const dirs = (await readdir(this.dir, { withFileTypes: true })).filter((d) => d.isDirectory());
    const out: RegistryListing[] = [];
    for (const d of dirs) {
      try {
        const b = await readBundle(join(this.dir, d.name));
        const { verifyBundle } = await import('./bundle-fs');
        out.push({
          ref: d.name, id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
          publisher: b.manifest.publisher ?? null, description: b.manifest.description,
          license: b.manifest.license, valid: verifyBundle(b).valid,
        });
      } catch { /* not a readable bundle dir — skip */ }
    }
    return out;
  }

  async getBundle(ref: string): Promise<Bundle> {
    return readBundle(join(this.dir, ref));
  }
}

export class HttpRegistrySource implements RegistrySource {
  readonly kind = 'http' as const;
  private cache: Map<string, MarketplaceIndexEntry> | null = null;
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  get label(): string {
    try { return new URL(this.baseUrl).host; } catch { return this.baseUrl; }
  }
  refresh(): void { this.cache = null; }

  private async loadIndex(): Promise<Map<string, MarketplaceIndexEntry>> {
    if (this.cache) return this.cache;
    const res = await this.fetchImpl(`${this.baseUrl}/index.json`);
    if (!res.ok) throw new Error(`registry unreachable: index.json ${res.status}`);
    const index = parseIndex(JSON.parse(await res.text()));
    const map = new Map<string, MarketplaceIndexEntry>();
    for (const e of index.packages) map.set(basename(e.path), e);
    this.cache = map;
    return map;
  }

  async list(): Promise<RegistryListing[]> {
    const map = await this.loadIndex();
    return [...map.entries()].map(([ref, e]) => ({
      ref, id: e.id, version: e.latestVersion, type: e.kind,
      publisher: e.publisher ? { id: e.publisher, name: e.publisher } : null,
      summary: e.summary, signatureFingerprint: e.signatureFingerprint,
    }));
  }

  async getBundle(ref: string): Promise<Bundle> {
    const map = await this.loadIndex();
    const entry = map.get(ref);
    if (!entry) throw new Error(`unknown bundle ref: ${ref}`);
    const dir = `${this.baseUrl}/${entry.path}`;
    const manifestRes = await this.fetchImpl(`${dir}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`registry unreachable: manifest ${manifestRes.status}`);
    const raw = JSON.parse(await manifestRes.text()) as Record<string, unknown>;
    const kind = String((raw.payload as { kind?: string } | null)?.kind ?? 'plugin');
    const payloadRes = await this.fetchImpl(`${dir}/${payloadFileName(kind)}`);
    if (!payloadRes.ok) throw new Error(`registry unreachable: payload ${payloadRes.status}`);
    const payload = new Uint8Array(await payloadRes.arrayBuffer());
    const pubRes = await this.fetchImpl(`${dir}/publisher.pub`);
    if (!pubRes.ok) throw new Error(`registry unreachable: publisher.pub ${pubRes.status}`);
    const pubHex = await pubRes.text();
    return assembleBundle(raw, payload, pubHex);
  }
}
```

(Note: the dynamic `await import('./bundle-fs')` for `verifyBundle` inside `LocalRegistrySource.list` avoids a circular static import concern; alternatively add `verifyBundle` to the top import from `./bundle-fs` — do that if the static import resolves cleanly. Prefer the static import: `import { readBundle, assembleBundle, payloadFileName, verifyBundle, type Bundle } from './bundle-fs';` and drop the dynamic import.)

- [ ] **Step 4: Use the static `verifyBundle` import**

Change the top import to include `verifyBundle` and remove the dynamic import in `list()`:

```ts
import { readBundle, assembleBundle, payloadFileName, verifyBundle, type Bundle } from './bundle-fs';
```
and in `LocalRegistrySource.list`, replace `const { verifyBundle } = await import('./bundle-fs');` usage by calling `verifyBundle(b)` directly.

- [ ] **Step 5: Export from the barrel**

In `packages/marketplace/src/index.ts` add:

```ts
export * from './registry-source';
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm -C packages/marketplace test -- registry-source`
Expected: PASS (Local + Http tests).

- [ ] **Step 7: Run the whole marketplace suite (no regressions)**

Run: `pnpm -C packages/marketplace test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/marketplace/src/registry-source.ts packages/marketplace/src/registry-source.test.ts packages/marketplace/src/index.ts
git commit -m "feat(marketplace): RegistrySource abstraction (Local + Http index.json)"
```

---

## Task 5: Server routes — resolve source, add `/refresh`, source/host on `available`

**Files:**
- Modify: `apps/server/src/marketplace-routes.ts`
- Modify: `apps/server/src/marketplace-routes.test.ts`

- [ ] **Step 1: Write/adjust failing tests**

In `apps/server/src/marketplace-routes.test.ts`, add a helper for an http-backed app and tests. Add near the top (after the existing imports):

```ts
import { LocalRegistrySource } from '@openldr/marketplace';
```

Then add these tests inside the `describe` block:

```ts
  it('available reports the source kind and host', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.source).toBe('local');
  });

  it('refresh returns ok', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
```

(The existing available tests still assert `ref`, `id`, `version`, `valid`, `description`, `license` — those remain in the row shape for the local source.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: FAIL — `/refresh` 404s and `available` has no `source`.

- [ ] **Step 3: Implement — refactor `marketplace-routes.ts` to use a `RegistrySource`**

In `apps/server/src/marketplace-routes.ts`:

1. Update imports:

```ts
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { CE_VERSION } from '@openldr/bootstrap';
import {
  verifyBundle, readGrant, isCompatible,
  LocalRegistrySource, HttpRegistrySource, type RegistrySource, type Capability,
} from '@openldr/marketplace';
import { requireRole } from './rbac';
```

(Remove the now-unused `readdir` and `readBundle` imports and the `basename` import if it's only used by `safeRef` — keep `basename` if `safeRef` uses it.)

2. At the top of `registerMarketplaceRoutes`, replace the `const registryDir = ctx.cfg.MARKETPLACE_REGISTRY_DIR;` line with source resolution (created once):

```ts
  const source: RegistrySource | null =
    ctx.cfg.MARKETPLACE_REGISTRY_URL ? new HttpRegistrySource(ctx.cfg.MARKETPLACE_REGISTRY_URL)
    : ctx.cfg.MARKETPLACE_REGISTRY_DIR ? new LocalRegistrySource(ctx.cfg.MARKETPLACE_REGISTRY_DIR)
    : null;
```

3. Replace the `GET /api/marketplace/available` handler with one driven by `source.list()`:

```ts
  app.get('/api/marketplace/available', { preHandler: requireRole('lab_admin') }, async () => {
    if (!source) return { configured: false, bundles: [], source: null, host: null };
    try {
      const listing = await source.list();
      return {
        configured: true,
        source: source.kind,
        host: source.label,
        bundles: listing.map((l) => ({
          ref: l.ref, id: l.id, version: l.version, type: l.type,
          publisher: l.publisher, description: l.description, license: l.license,
          summary: l.summary, signatureFingerprint: l.signatureFingerprint,
          // capabilities/compatibility/valid come from the detail endpoint for http;
          // local provides `valid` here, others undefined.
          valid: l.valid,
        })),
      };
    } catch (e) {
      return { configured: true, source: source.kind, host: source.label, bundles: [], error: e instanceof Error ? e.message : 'registry unreachable' };
    }
  });
```

4. Replace the `GET /api/marketplace/available/:ref` handler to use `source.getBundle`:

```ts
  app.get('/api/marketplace/available/:ref', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!source) { reply.code(400); return { error: 'no marketplace registry configured' }; }
    const ref = safeRef((req.params as { ref: string }).ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    try {
      const b = await source.getBundle(ref);
      const v = verifyBundle(b);
      return {
        ref, id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
        description: b.manifest.description, license: b.manifest.license,
        publisher: b.manifest.publisher ?? null, capabilities: b.manifest.capabilities,
        compatibility: b.manifest.compatibility,
        compatible: isCompatible(b.manifest.compatibility.ceVersion, CE_VERSION),
        ceVersion: CE_VERSION, payload: b.manifest.payload, valid: v.valid,
      };
    } catch {
      reply.code(404);
      return { error: 'bundle not found' };
    }
  });
```

5. Replace the `POST /api/marketplace/install` handler's bundle read to use `source.getBundle(ref)`:

```ts
  app.post('/api/marketplace/install', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!source) { reply.code(400); return { error: 'no marketplace registry configured' }; }
    const body = (req.body ?? {}) as { ref?: unknown; acknowledgedCapabilities?: unknown };
    const ref = safeRef(body.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    if (body.acknowledgedCapabilities !== undefined && !Array.isArray(body.acknowledgedCapabilities)) {
      reply.code(400); return { error: 'acknowledgedCapabilities must be an array' };
    }
    try {
      const b = await source.getBundle(ref);
      const a = actor(req);
      const acknowledgedCapabilities = (body.acknowledgedCapabilities as Capability[] | undefined) ?? b.manifest.capabilities;
      const installed = await ctx.plugins.install(b.wasm, b.raw, {
        publicKeyDer: b.publicKeyDer, actor: a,
        approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
      });
      return { id: installed.id, version: installed.version };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
```

6. Add the refresh route (after `install`, before the `:id/enable` routes):

```ts
  app.post('/api/marketplace/refresh', { preHandler: requireRole('lab_admin') }, async () => {
    source?.refresh();
    return { ok: true };
  });
```

(`safeRef`, `actor`, the `installed`/enable/disable/rollback/remove handlers stay unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: PASS (existing + new tests). The existing `'reports unconfigured when no registry dir'` test still passes because `source` is null → `{ configured: false, bundles: [], source: null, host: null }` (its assertion `toEqual({ configured: false, bundles: [] })` — UPDATE that test's expectation to `toEqual({ configured: false, bundles: [], source: null, host: null })`).

- [ ] **Step 5: Update the unconfigured test**

In `apps/server/src/marketplace-routes.test.ts`, change the `'reports unconfigured when no registry dir'` assertion to:

```ts
    expect(res.json()).toEqual({ configured: false, bundles: [], source: null, host: null });
```

Re-run: `pnpm -C apps/server test -- marketplace-routes` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/marketplace-routes.ts apps/server/src/marketplace-routes.test.ts
git commit -m "feat(server): drive marketplace routes via RegistrySource; add /refresh + source/host"
```

---

## Task 6: Web — relax types, source indicator, Refresh

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/settings/marketplace/util.ts`
- Modify: `apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.tsx`
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts`
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx`

- [ ] **Step 1: api.ts — relax `AvailableArtifact`, add source/host + refresh**

In `apps/web/src/api.ts`, change `AvailableArtifact` so `capabilities` and `compatibility` are optional, and add `summary`/`signatureFingerprint`:

```ts
export interface AvailableArtifact {
  ref: string;
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  capabilities?: unknown[];
  compatibility?: { ceVersion: string };
  valid?: boolean;
  description?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
}
```

Change the `listAvailableArtifacts` return type and add `refreshRegistry`:

```ts
export const listAvailableArtifacts = (): Promise<{ configured: boolean; source: 'local' | 'http' | null; host: string | null; bundles: AvailableArtifact[]; error?: string }> =>
  apiGet('/api/marketplace/available', 'list available artifacts');

export async function refreshRegistry(): Promise<void> {
  const r = await authFetch('/api/marketplace/refresh', { method: 'POST' });
  if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
}
```

- [ ] **Step 2: util.ts — default capabilities in `availableToEntry`**

In `apps/web/src/pages/settings/marketplace/util.ts`, change `availableToEntry` to default capabilities:

```ts
export function availableToEntry(b: AvailableArtifact, installedIds: Set<string>): CardEntry {
  return {
    ref: b.ref, id: b.id, version: b.version, type: b.type,
    publisher: b.publisher, capabilities: b.capabilities ?? [], valid: b.valid,
    installed: installedIds.has(b.id),
  };
}
```

- [ ] **Step 3: i18n — add keys to en/fr/pt**

`en.ts` `settings.marketplace`:
```ts
      refresh: 'Refresh',
      sourceLocal: 'Local registry',
      sourceRemote: 'Remote · {{host}}',
      registryUnreachable: 'Registry unreachable.',
```
`fr.ts`:
```ts
      refresh: 'Actualiser',
      sourceLocal: 'Registre local',
      sourceRemote: 'Distant · {{host}}',
      registryUnreachable: 'Registre injoignable.',
```
`pt.ts`:
```ts
      refresh: 'Atualizar',
      sourceLocal: 'Registo local',
      sourceRemote: 'Remoto · {{host}}',
      registryUnreachable: 'Registo inacessível.',
```

- [ ] **Step 4: MarketplaceTabs.tsx — source indicator + Refresh button**

Add two props and render them in the Browse filter row. Change the props interface to add:

```ts
  source: 'local' | 'http' | null;
  host: string | null;
  onRefresh: () => void;
```

In the Browse `<TabsContent>`, change the filter row `<div className="mb-3 flex items-center gap-2">…</div>` to append a source label + Refresh button at the end:

```tsx
        <div className="mb-3 flex items-center gap-2">
          <Input className="max-w-xs" placeholder={t('settings.marketplace.searchPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('settings.marketplace.allTypes')}</SelectItem>
              <SelectItem value="plugin">Plugin</SelectItem>
              <SelectItem value="form-template">Form template</SelectItem>
              <SelectItem value="report-template">Report</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {props.source ? (
              <span className="text-xs text-muted-foreground" data-testid="registry-source">
                {props.source === 'http' ? t('settings.marketplace.sourceRemote', { host: props.host ?? '' }) : t('settings.marketplace.sourceLocal')}
              </span>
            ) : null}
            <Button variant="outline" size="sm" data-testid="refresh-registry" onClick={props.onRefresh}>
              {t('settings.marketplace.refresh')}
            </Button>
          </div>
        </div>
```

Add `import { Button } from '@/components/ui/button';` to the file's imports.

- [ ] **Step 5: Marketplace.tsx — thread source/host + onRefresh**

In `apps/web/src/pages/settings/Marketplace.tsx`:
- Add state: `const [source, setSource] = useState<'local' | 'http' | null>(null);` and `const [host, setHost] = useState<string | null>(null);`
- In `load`, set them from the response: after `setAvailable(avail.bundles);` add `setSource(avail.source); setHost(avail.host);`
- Add an `onRefresh` callback:
```tsx
  const onRefresh = useCallback(async () => {
    try { await refreshRegistry(); await load(); toast.success(t('settings.marketplace.refresh')); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);
```
- Import `refreshRegistry` from `@/api`.
- Pass to `<MarketplaceTabs source={source} host={host} onRefresh={onRefresh} … />`.

- [ ] **Step 6: Update `Marketplace.test.tsx`**

The mocked `listAvailableArtifacts` now must return `source`/`host`. Update `oneBundle` and the unconfigured/installed mocks to include `source: 'local', host: 'local'` (and `source: null, host: null` for the unconfigured case). Add `refreshRegistry: vi.fn()` to the `@/api` mock. Add a test:

```ts
it('refreshes the registry', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  (api.refreshRegistry as any).mockResolvedValue(undefined);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('refresh-registry'));
  await waitFor(() => expect(api.refreshRegistry).toHaveBeenCalled());
});
```

Update the existing `oneBundle` const to include `source: 'local', host: 'local'` and the unconfigured mock to `{ configured: false, source: null, host: null, bundles: [] }`.

- [ ] **Step 7: Verify**

Run: `pnpm -C apps/web test -- Marketplace`
Run: `pnpm -C apps/web typecheck`
Expected: PASS (if a documented parallel flake hits, re-run once in isolation).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/settings/marketplace/util.ts apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx apps/web/src/pages/settings/Marketplace.tsx apps/web/src/pages/settings/Marketplace.test.tsx apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): marketplace source indicator + Refresh (remote registry install)"
```

---

## Task 7: Full verification gate

- [ ] **Step 1: Run the gate**

Run: `pnpm turbo typecheck lint test build --filter=@openldr/web --filter=@openldr/server --filter=@openldr/marketplace --filter=@openldr/config`
Expected: all green. If `@openldr/web#test` flakes in parallel (known), re-run `pnpm -C apps/web test` in isolation.

- [ ] **Step 2: Commit any lint autofixes**

```bash
git add -A && git commit -m "chore(marketplace): A1 remote-install gate green" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage (install half):** RegistrySource + Local/Http (Task 4) ✓; index.json read (Task 3) ✓; source resolution via `MARKETPLACE_REGISTRY_URL` (Tasks 1,5) ✓; in-memory index cache + Refresh (Tasks 4,5,6) ✓; fail-closed verify at install — `install` still calls `verifyBundle` inside `ctx.plugins.install` and the runtime enforces (unchanged) ✓; source indicator (Task 6) ✓; verify-at-detail via `:ref` (Task 5) ✓.
- **Deferred to A2 (publish):** `github-publish.ts`, `mergeIndexEntry` *usage* (the function ships in A1 Task 3 but is exercised by tests only here), `/publish` + `/publish/status`, publish UI, and the publish config keys (`MARKETPLACE_PUBLISH_*`). A1 does not import or wire any publish path.
- **Contract change:** `AvailableArtifact.capabilities`/`compatibility`/`valid` become optional; the Browse card never read capabilities, and install/consent capabilities flow from the `:ref` detail (unchanged), so no behavior regression. `availableToEntry` defaults capabilities to `[]`.
- **Type consistency:** `RegistryListing` (registry-source) → `available` response → `AvailableArtifact` (api.ts) → `availableToEntry`/`CardEntry`. `MarketplaceIndexEntry` (index-json) used by `HttpRegistrySource` and (in A2) by publish. `RegistrySource` created once at route registration so the http in-memory cache persists across requests and `/refresh` can clear it.
- **`mergeIndexEntry` in A1:** shipped + unit-tested now (it lives in `index-json.ts` with `parseIndex`), but only consumed by A2's publish flow. This is intentional cohesion, not dead code — flagged so a spec reviewer doesn't treat it as unused.
