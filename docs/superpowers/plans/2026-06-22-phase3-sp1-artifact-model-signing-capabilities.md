# Phase 3 SP-1 — Artifact Model + Signing + Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the marketplace security spine — a signed, versioned, capability-declaring artifact model in a new `packages/marketplace`, and wire signature verification + TOFU publisher trust + semver compatibility gating + capability/publisher recording into the existing plugin install path.

**Architecture:** New `packages/marketplace` (zod + Node `crypto` Ed25519 + `@openldr/db` types; no new external deps) owns the artifact manifest, capability schema, canonical signing bytes, Ed25519 sign/verify, a TOFU publisher trust store (new internal migration `023`), and a semver compatibility check. `packages/plugins` consumes it: `PluginRuntime.install` gains verify/trust/compat/audit steps while staying backward-compatible with legacy unsigned plugin manifests via an adapter.

**Tech Stack:** TypeScript, zod, Node `crypto` (Ed25519), Kysely + pg-mem, Vitest, Turborepo/pnpm workspace. Spec: `docs/superpowers/specs/2026-06-22-phase3-sp1-artifact-model-signing-capabilities-design.md`.

**Conventions:**
- Package tests run from repo root: `pnpm --filter @openldr/marketplace test -- --run` (and `@openldr/plugins`, `@openldr/db`, `@openldr/config`).
- A single package typecheck: `pnpm --filter @openldr/<pkg> exec tsc -p tsconfig.json --noEmit`.
- Full gate (Task 13 only): `pnpm turbo typecheck lint test build && pnpm depcruise`.
- Migration tests use `makeMigratedDb()` from `packages/db/src/migrations/internal/test-helpers.ts` (runs each `up()` against pg-mem).
- Commit after every task.

**Back-compat rule (applies to Task 12):** signature is required only when a manifest declares a `publisher`. Legacy plugin manifests (no publisher) install hash-only as today. A manifest WITH a publisher but no valid signature is rejected unless `devAllowUnsigned` is set.

---

### Task 1: Scaffold `packages/marketplace`

**Files:**
- Create: `packages/marketplace/package.json`, `packages/marketplace/tsconfig.json`, `packages/marketplace/src/index.ts`
- Modify: `.dependency-cruiser.cjs`

- [ ] **Step 1: Create `packages/marketplace/package.json`**

```json
{
  "name": "@openldr/marketplace",
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
    "@openldr/db": "workspace:*",
    "kysely": "^0.27.5",
    "zod": "^3.23.8"
  },
  "devDependencies": { "pg-mem": "^3.0.14", "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```
(Match the exact `zod`/`kysely` versions used elsewhere in the repo if these differ — check `packages/config/package.json` for `zod` and `packages/audit/package.json` for `kysely`/`pg-mem`/`typescript`/`vitest`, and use those.)

- [ ] **Step 2: Create `packages/marketplace/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/marketplace/src/index.ts`**

```ts
export {};
```

- [ ] **Step 4: Add `marketplace` to the depcruise domain-no-apps rule**

In `.dependency-cruiser.cjs`, find the rule `domain-modules-no-apps` and add `marketplace` to the alternation:
```js
      from: { path: '(^|/)packages/(fhir|forms|ingest|plugins|reporting|audit|users|marketplace)/' },
```

- [ ] **Step 5: Install + typecheck**

Run: `pnpm install` then `pnpm --filter @openldr/marketplace exec tsc -p tsconfig.json --noEmit`
Expected: PASS (empty package compiles).

- [ ] **Step 6: Commit**

```bash
git add packages/marketplace .dependency-cruiser.cjs pnpm-lock.yaml
git commit -m "feat(marketplace): scaffold packages/marketplace"
```

---

### Task 2: Capability schema

**Files:**
- Create: `packages/marketplace/src/capabilities.ts`, `packages/marketplace/src/capabilities.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/capabilities.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { capabilitySchema, parseCapabilities } from './capabilities';

describe('capabilities', () => {
  it('accepts each capability kind with its params', () => {
    expect(capabilitySchema.parse({ kind: 'read-input', formats: ['hl7v2'] })).toEqual({ kind: 'read-input', formats: ['hl7v2'] });
    expect(capabilitySchema.parse({ kind: 'emit-fhir', resourceTypes: ['Observation'] }).kind).toBe('emit-fhir');
    expect(capabilitySchema.parse({ kind: 'net-egress', allowedHosts: ['example.org:443'] }).kind).toBe('net-egress');
    expect(capabilitySchema.parse({ kind: 'data-scope', resourceTypes: ['Patient'], fields: ['name'] }).kind).toBe('data-scope');
  });
  it('defaults optional arrays', () => {
    expect(capabilitySchema.parse({ kind: 'read-input' })).toEqual({ kind: 'read-input', formats: [] });
    expect(capabilitySchema.parse({ kind: 'net-egress' })).toEqual({ kind: 'net-egress', allowedHosts: [] });
  });
  it('rejects an unknown kind', () => {
    expect(() => capabilitySchema.parse({ kind: 'filesystem' })).toThrow();
  });
  it('emit-fhir requires at least one resourceType', () => {
    expect(() => capabilitySchema.parse({ kind: 'emit-fhir', resourceTypes: [] })).toThrow();
  });
  it('parseCapabilities validates an array', () => {
    expect(parseCapabilities([{ kind: 'read-input' }])).toHaveLength(1);
    expect(() => parseCapabilities([{ kind: 'bad' }])).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/marketplace test -- --run src/capabilities.test.ts` (cannot resolve `./capabilities`).

- [ ] **Step 3: Implement** — `packages/marketplace/src/capabilities.ts`

```ts
import { z } from 'zod';

/**
 * Fine-grained, parameterized capability declarations a plugin requests.
 * Declaration only — runtime enforcement is SP-2. Each member documents
 * where it will be enforced:
 *  - read-input.formats : advisory (SP-1)
 *  - emit-fhir.resourceTypes : host-side at persist (SP-2)
 *  - net-egress.allowedHosts : Extism allowed_hosts at runner config (SP-2)
 *  - data-scope : host-side read filtering (SP-2; no current plugin reads the store)
 */
export const capabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read-input'), formats: z.array(z.string().min(1)).default([]) }),
  z.object({ kind: z.literal('emit-fhir'), resourceTypes: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('net-egress'), allowedHosts: z.array(z.string().min(1)).default([]) }),
  z.object({ kind: z.literal('data-scope'), resourceTypes: z.array(z.string().min(1)).default([]), fields: z.array(z.string().min(1)).default([]) }),
]);

export type Capability = z.infer<typeof capabilitySchema>;

export function parseCapabilities(raw: unknown): Capability[] {
  return z.array(capabilitySchema).parse(raw);
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @openldr/marketplace test -- --run src/capabilities.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/capabilities.ts packages/marketplace/src/capabilities.test.ts
git commit -m "feat(marketplace): fine-grained capability schema"
```

---

### Task 3: Artifact manifest schema + legacy adapter

**Files:**
- Create: `packages/marketplace/src/artifact-manifest.ts`, `packages/marketplace/src/artifact-manifest.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/artifact-manifest.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseArtifactManifest, pluginManifestToArtifact } from './artifact-manifest';

const fp = 'a'.repeat(64);
const base = {
  schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme', keyFingerprint: fp },
  compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Observation'] }],
  payload: { kind: 'plugin', wasmSha256: 'b'.repeat(64) },
};

describe('artifact manifest', () => {
  it('parses a valid plugin artifact manifest with defaults', () => {
    const m = parseArtifactManifest(base);
    expect(m.id).toBe('demo');
    expect(m.source).toBe('local-file');
    expect(m.dependencies).toEqual([]);
    expect(m.payload.kind).toBe('plugin');
  });
  it('rejects a bad version', () => {
    expect(() => parseArtifactManifest({ ...base, version: 'not-semver' })).toThrow();
  });
  it('rejects a bad publisher fingerprint', () => {
    expect(() => parseArtifactManifest({ ...base, publisher: { ...base.publisher, keyFingerprint: 'xyz' } })).toThrow();
  });
  it('parses form-template and report-template payloads', () => {
    expect(parseArtifactManifest({ ...base, type: 'form-template', payload: { kind: 'form-template', questionnaireSha256: 'c'.repeat(64) } }).type).toBe('form-template');
    expect(parseArtifactManifest({ ...base, type: 'report-template', payload: { kind: 'report-template', templateSha256: 'd'.repeat(64) } }).type).toBe('report-template');
  });
  it('adapts a legacy plugin manifest (no publisher/signature)', () => {
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    const a = pluginManifestToArtifact(legacy);
    expect(a.type).toBe('plugin');
    expect(a.publisher).toBeUndefined();
    expect(a.signature).toBeUndefined();
    expect(a.payload).toMatchObject({ kind: 'plugin', wasmSha256: 'e'.repeat(64), entrypoint: 'convert' });
    expect(() => parseArtifactManifest(a)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/marketplace test -- --run src/artifact-manifest.test.ts`

- [ ] **Step 3: Implement** — `packages/marketplace/src/artifact-manifest.ts`

```ts
import { z } from 'zod';
import { capabilitySchema } from './capabilities';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX64 = /^[0-9a-f]{64}$/;

const pluginPayload = z.object({
  kind: z.literal('plugin'),
  wasmSha256: z.string().regex(HEX64),
  entrypoint: z.string().min(1).default('convert'),
  wasi: z.boolean().default(false),
  limits: z.object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
});
const formPayload = z.object({ kind: z.literal('form-template'), questionnaireSha256: z.string().regex(HEX64) });
const reportPayload = z.object({ kind: z.literal('report-template'), templateSha256: z.string().regex(HEX64) });

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(['plugin', 'form-template', 'report-template']),
  id: z.string().min(1),
  version: z.string().regex(SEMVER, 'version must be semver'),
  description: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  // Publisher is optional: legacy plugin manifests carry none and install hash-only.
  publisher: z.object({ id: z.string().min(1), name: z.string().default(''), keyFingerprint: z.string().regex(HEX64) }).optional(),
  compatibility: z.object({ ceVersion: z.string().min(1) }),
  dependencies: z.array(z.object({ id: z.string().min(1), versionRange: z.string().min(1) })).default([]),
  capabilities: z.array(capabilitySchema).default([]),
  source: z.enum(['local-file', 'registry']).default('local-file'), // 'federated' reserved
  payload: z.discriminatedUnion('kind', [pluginPayload, formPayload, reportPayload]),
  signature: z.string().regex(/^[0-9a-f]+$/).optional(),
});

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

export function parseArtifactManifest(raw: unknown): ArtifactManifest {
  return artifactManifestSchema.parse(raw);
}

/** Legacy plugin manifest shape (packages/plugins manifest.ts). */
export interface LegacyPluginManifest {
  id: string; version: string; entrypoint?: string; wasmSha256: string;
  description?: string; license?: string; wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
}

/** Adapt a legacy plugin manifest to an (unsigned, publisher-less) artifact manifest. */
export function pluginManifestToArtifact(m: LegacyPluginManifest): ArtifactManifest {
  return parseArtifactManifest({
    schemaVersion: 1,
    type: 'plugin',
    id: m.id,
    version: m.version,
    description: m.description ?? '',
    license: m.license ?? 'UNLICENSED',
    compatibility: { ceVersion: '*' },
    payload: { kind: 'plugin', wasmSha256: m.wasmSha256, entrypoint: m.entrypoint ?? 'convert', wasi: m.wasi ?? false, limits: m.limits ?? { memoryMb: 256, timeoutMs: 30_000 } },
  });
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/artifact-manifest.ts packages/marketplace/src/artifact-manifest.test.ts
git commit -m "feat(marketplace): artifact manifest schema + legacy plugin adapter"
```

---

### Task 4: Canonical signing bytes

**Files:**
- Create: `packages/marketplace/src/bundle.ts`, `packages/marketplace/src/bundle.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/bundle.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { canonicalJSON, canonicalSigningBytes } from './bundle';

describe('canonicalJSON', () => {
  it('is key-order stable', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
    expect(canonicalJSON({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
  it('handles nested objects/arrays and skips undefined', () => {
    expect(canonicalJSON({ x: [3, { z: 1, y: 2 }], u: undefined })).toBe('{"x":[3,{"y":2,"z":1}]}');
  });
});

describe('canonicalSigningBytes', () => {
  const manifest = { type: 'plugin', id: 'demo', signature: 'deadbeef' };
  it('excludes the signature field and binds the payload hash', () => {
    const a = canonicalSigningBytes(manifest, 'a'.repeat(64));
    const b = canonicalSigningBytes({ ...manifest, signature: 'OTHER' }, 'a'.repeat(64));
    expect(Buffer.from(a).toString('utf8')).not.toContain('signature');
    expect(Buffer.from(a)).toEqual(Buffer.from(b)); // signature ignored
  });
  it('changes when manifest or payload hash changes', () => {
    const base = canonicalSigningBytes(manifest, 'a'.repeat(64));
    expect(Buffer.from(canonicalSigningBytes({ ...manifest, id: 'other' }, 'a'.repeat(64)))).not.toEqual(Buffer.from(base));
    expect(Buffer.from(canonicalSigningBytes(manifest, 'b'.repeat(64)))).not.toEqual(Buffer.from(base));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — `packages/marketplace/src/bundle.ts`

```ts
/** Deterministic JSON: recursively sorted keys, no insignificant whitespace, undefined props skipped. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJSON(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

/**
 * Bytes an artifact signature is computed over: canonical manifest (minus `signature`)
 * joined to the payload's sha256. Binds the signature to both manifest and payload.
 */
export function canonicalSigningBytes(manifest: Record<string, unknown>, payloadSha256: string): Uint8Array {
  const { signature: _omit, ...rest } = manifest;
  return new TextEncoder().encode(canonicalJSON(rest) + ':' + payloadSha256);
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/bundle.ts packages/marketplace/src/bundle.test.ts
git commit -m "feat(marketplace): canonical signing bytes"
```

---

### Task 5: Ed25519 signing + verification

**Files:**
- Create: `packages/marketplace/src/signing.ts`, `packages/marketplace/src/signing.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/signing.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { generatePublisherKeypair, signManifest, verifyArtifact, keyFingerprint } from './signing';

const manifest = { type: 'plugin', id: 'demo', version: '1.0.0' };
const payloadSha = 'a'.repeat(64);

describe('signing', () => {
  it('round-trips: sign then verify succeeds', () => {
    const kp = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, signature }, payloadSha, kp.publicKeyDer)).toBe(true);
  });
  it('fingerprint is the sha256 of the public key DER', () => {
    const kp = generatePublisherKeypair();
    expect(kp.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(keyFingerprint(kp.publicKeyDer)).toBe(kp.fingerprint);
  });
  it('rejects a tampered manifest', () => {
    const kp = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, id: 'evil', signature }, payloadSha, kp.publicKeyDer)).toBe(false);
  });
  it('rejects a tampered payload hash', () => {
    const kp = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, signature }, 'b'.repeat(64), kp.publicKeyDer)).toBe(false);
  });
  it('rejects a wrong key', () => {
    const kp = generatePublisherKeypair();
    const other = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, signature }, payloadSha, other.publicKeyDer)).toBe(false);
  });
  it('returns false when signature is absent', () => {
    const kp = generatePublisherKeypair();
    expect(verifyArtifact(manifest, payloadSha, kp.publicKeyDer)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — `packages/marketplace/src/signing.ts`

```ts
import { createHash, createPublicKey, createPrivateKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalSigningBytes } from './bundle';

export interface PublisherKeypair {
  publicKeyDer: Uint8Array;   // SPKI DER
  privateKeyDer: Uint8Array;  // PKCS8 DER
  fingerprint: string;        // sha256 hex of publicKeyDer
}

export function keyFingerprint(publicKeyDer: Uint8Array): string {
  return createHash('sha256').update(publicKeyDer).digest('hex');
}

export function generatePublisherKeypair(): PublisherKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { publicKeyDer, privateKeyDer, fingerprint: keyFingerprint(publicKeyDer) };
}

export function signManifest(manifest: Record<string, unknown>, payloadSha256: string, privateKeyDer: Uint8Array): string {
  const key = createPrivateKey({ key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' });
  // Ed25519: algorithm arg must be null.
  const sig = cryptoSign(null, Buffer.from(canonicalSigningBytes(manifest, payloadSha256)), key);
  return sig.toString('hex');
}

export function verifyArtifact(manifest: Record<string, unknown>, payloadSha256: string, publicKeyDer: Uint8Array): boolean {
  const signature = manifest.signature;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: 'der', type: 'spki' });
    return cryptoVerify(null, Buffer.from(canonicalSigningBytes(manifest, payloadSha256)), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/signing.ts packages/marketplace/src/signing.test.ts
git commit -m "feat(marketplace): Ed25519 artifact signing + verification"
```

---

### Task 6: `marketplace_publishers` migration + schema type

**Files:**
- Create: `packages/db/src/migrations/internal/023_marketplace_publishers.ts`, `packages/db/src/migrations/internal/023_marketplace_publishers.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the failing test** — `packages/db/src/migrations/internal/023_marketplace_publishers.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('023_marketplace_publishers', () => {
  it('creates the marketplace_publishers table', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('marketplace_publishers')
      .values({ publisher_id: 'acme', key_fingerprint: 'a'.repeat(64), publisher_name: 'Acme', approved_by: 'admin' })
      .execute();
    const row = await db.selectFrom('marketplace_publishers').selectAll().where('publisher_id', '=', 'acme').executeTakeFirst();
    expect(row?.key_fingerprint).toBe('a'.repeat(64));
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/db test -- --run src/migrations/internal/023_marketplace_publishers.test.ts` (table does not exist).

- [ ] **Step 3: Implement the migration** — `packages/db/src/migrations/internal/023_marketplace_publishers.ts`

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('marketplace_publishers')
    .ifNotExists()
    .addColumn('publisher_id', 'text', (c) => c.primaryKey())
    .addColumn('key_fingerprint', 'text', (c) => c.notNull())
    .addColumn('publisher_name', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('pinned_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('approved_by', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('marketplace_publishers').ifExists().execute();
}
```

- [ ] **Step 4: Register the migration** — in `packages/db/src/migrations/internal/index.ts`

Add the import after the `m022` line:
```ts
import * as m023 from './023_marketplace_publishers';
```
Add the entry after the `'022_dhis2_metadata_cache'` line:
```ts
  '023_marketplace_publishers': { up: m023.up, down: m023.down },
```

- [ ] **Step 5: Add the schema type** — in `packages/db/src/schema/internal.ts`

Add the interface (near the other table interfaces):
```ts
export interface MarketplacePublishersTable {
  publisher_id: string;
  key_fingerprint: string;
  publisher_name: Generated<string>;
  pinned_at: Generated<Date>;
  approved_by: string | null;
}
```
Add to the `InternalSchema` interface members:
```ts
  marketplace_publishers: MarketplacePublishersTable;
```

- [ ] **Step 6: Run, expect PASS** + typecheck db

Run: `pnpm --filter @openldr/db test -- --run src/migrations/internal/023_marketplace_publishers.test.ts`
Run: `pnpm --filter @openldr/db exec tsc -p tsconfig.json --noEmit`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/023_marketplace_publishers.ts packages/db/src/migrations/internal/023_marketplace_publishers.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): 023_marketplace_publishers table + schema type"
```

---

### Task 7: TOFU trust decision

**Files:**
- Create: `packages/marketplace/src/trust.ts`, `packages/marketplace/src/trust.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/trust.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { evaluateTrust } from './trust';

const fp = 'a'.repeat(64);

describe('evaluateTrust', () => {
  it('first-use when no pinned record', () => {
    expect(evaluateTrust('acme', fp, undefined)).toEqual({ decision: 'first-use' });
  });
  it('trusted when fingerprint matches the pinned one', () => {
    expect(evaluateTrust('acme', fp, { keyFingerprint: fp })).toEqual({ decision: 'trusted' });
  });
  it('key-mismatch when fingerprint differs', () => {
    expect(evaluateTrust('acme', fp, { keyFingerprint: 'b'.repeat(64) })).toEqual({ decision: 'key-mismatch', pinned: 'b'.repeat(64) });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — `packages/marketplace/src/trust.ts`

```ts
export type TrustDecision =
  | { decision: 'first-use' }
  | { decision: 'trusted' }
  | { decision: 'key-mismatch'; pinned: string };

export interface PinnedPublisher { keyFingerprint: string }

export interface TrustStore {
  get(publisherId: string): Promise<PinnedPublisher | undefined>;
  pin(input: { publisherId: string; keyFingerprint: string; publisherName: string; approvedBy: string | null }): Promise<void>;
}

/** Trust-on-first-use decision: pure, no I/O. */
export function evaluateTrust(_publisherId: string, fingerprint: string, pinned: PinnedPublisher | undefined): TrustDecision {
  if (!pinned) return { decision: 'first-use' };
  if (pinned.keyFingerprint === fingerprint) return { decision: 'trusted' };
  return { decision: 'key-mismatch', pinned: pinned.keyFingerprint };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/trust.ts packages/marketplace/src/trust.test.ts
git commit -m "feat(marketplace): TOFU trust decision"
```

---

### Task 8: Kysely-backed trust store

**Files:**
- Create: `packages/marketplace/src/trust-store.ts`, `packages/marketplace/src/trust-store.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/trust-store.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/src/migrations/internal/test-helpers';
import { createTrustStore } from './trust-store';

describe('trust store', () => {
  it('pins then gets a publisher', async () => {
    const db = await makeMigratedDb();
    const store = createTrustStore(db);
    expect(await store.get('acme')).toBeUndefined();
    await store.pin({ publisherId: 'acme', keyFingerprint: 'a'.repeat(64), publisherName: 'Acme', approvedBy: 'admin' });
    expect(await store.get('acme')).toEqual({ keyFingerprint: 'a'.repeat(64) });
  });
  it('pin is idempotent on the publisher id (updates fingerprint)', async () => {
    const db = await makeMigratedDb();
    const store = createTrustStore(db);
    await store.pin({ publisherId: 'acme', keyFingerprint: 'a'.repeat(64), publisherName: 'Acme', approvedBy: null });
    await store.pin({ publisherId: 'acme', keyFingerprint: 'b'.repeat(64), publisherName: 'Acme', approvedBy: null });
    expect(await store.get('acme')).toEqual({ keyFingerprint: 'b'.repeat(64) });
  });
});
```

(If importing `@openldr/db/src/...` does not resolve, import the helper via a relative path is not possible across packages — instead re-export `makeMigratedDb` from `@openldr/db`'s package exports. Check `packages/db/package.json` `exports`; if only `.` is exported, add a test that builds its own pg-mem db by importing `internalMigrations` from `@openldr/db` and running each `up()`. Use whichever resolves — prefer importing `internalMigrations` from `@openldr/db` and running them, mirroring `test-helpers.ts`.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — `packages/marketplace/src/trust-store.ts`

```ts
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { TrustStore, PinnedPublisher } from './trust';

export function createTrustStore(db: Kysely<InternalSchema>): TrustStore {
  return {
    async get(publisherId): Promise<PinnedPublisher | undefined> {
      const row = await db.selectFrom('marketplace_publishers')
        .select(['key_fingerprint']).where('publisher_id', '=', publisherId).executeTakeFirst();
      return row ? { keyFingerprint: row.key_fingerprint } : undefined;
    },
    async pin({ publisherId, keyFingerprint, publisherName, approvedBy }) {
      await db.insertInto('marketplace_publishers')
        .values({ publisher_id: publisherId, key_fingerprint: keyFingerprint, publisher_name: publisherName, approved_by: approvedBy })
        .onConflict((oc) => oc.column('publisher_id').doUpdateSet({ key_fingerprint: keyFingerprint, publisher_name: publisherName, approved_by: approvedBy }))
        .execute();
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/trust-store.ts packages/marketplace/src/trust-store.test.ts
git commit -m "feat(marketplace): Kysely-backed publisher trust store"
```

---

### Task 9: Semver compatibility gate

**Files:**
- Create: `packages/marketplace/src/compatibility.ts`, `packages/marketplace/src/compatibility.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/marketplace/src/compatibility.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { isCompatible } from './compatibility';

describe('isCompatible', () => {
  it('wildcard matches anything', () => {
    expect(isCompatible('*', '0.1.0')).toBe(true);
  });
  it('exact match', () => {
    expect(isCompatible('0.1.0', '0.1.0')).toBe(true);
    expect(isCompatible('0.1.0', '0.2.0')).toBe(false);
  });
  it('AND range (space-separated comparators)', () => {
    expect(isCompatible('>=0.1.0 <0.2.0', '0.1.0')).toBe(true);
    expect(isCompatible('>=0.1.0 <0.2.0', '0.1.9')).toBe(true);
    expect(isCompatible('>=0.1.0 <0.2.0', '0.2.0')).toBe(false);
    expect(isCompatible('>=0.1.0 <0.2.0', '0.0.9')).toBe(false);
  });
  it('OR ranges', () => {
    expect(isCompatible('0.1.0 || >=1.0.0', '1.2.3')).toBe(true);
    expect(isCompatible('0.1.0 || >=1.0.0', '0.1.0')).toBe(true);
    expect(isCompatible('0.1.0 || >=1.0.0', '0.5.0')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — `packages/marketplace/src/compatibility.ts`

```ts
/** Compare dotted numeric versions (ignores build/prerelease suffixes). */
function cmp(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number);
  const pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const m = comparator.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] ?? '=';
  const target = m[2].trim();
  if (target === '*') return true;
  const c = cmp(version, target);
  switch (op) {
    case '>=': return c >= 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '<': return c < 0;
    default: return c === 0;
  }
}

/** True if `version` satisfies the semver `range`. Supports `*`, exact, >=/<=/>/<, space=AND, `||`=OR. */
export function isCompatible(range: string, version: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') return true;
  return trimmed.split('||').some((orPart) =>
    orPart.trim().split(/\s+/).filter(Boolean).every((cmpStr) => satisfiesComparator(version, cmpStr)),
  );
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace/src/compatibility.ts packages/marketplace/src/compatibility.test.ts
git commit -m "feat(marketplace): semver compatibility gate"
```

---

### Task 10: Barrel exports

**Files:**
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Replace** `packages/marketplace/src/index.ts`

```ts
export * from './capabilities';
export * from './artifact-manifest';
export * from './bundle';
export * from './signing';
export * from './trust';
export * from './trust-store';
export * from './compatibility';
```

- [ ] **Step 2: Typecheck + full package test**

Run: `pnpm --filter @openldr/marketplace exec tsc -p tsconfig.json --noEmit` (PASS)
Run: `pnpm --filter @openldr/marketplace test -- --run` (all PASS)

- [ ] **Step 3: Commit**

```bash
git add packages/marketplace/src/index.ts
git commit -m "feat(marketplace): barrel exports"
```

---

### Task 11: Config flags

**Files:**
- Modify: `packages/config/src/schema.ts`

- [ ] **Step 1: Add the two flags** to `ConfigSchema` (use the existing `envBoolean` helper, alongside other adapter flags)

```ts
    MARKETPLACE_DEV_ALLOW_UNSIGNED: envBoolean(false),
    MARKETPLACE_AUTO_PIN_FIRST_USE: envBoolean(true),
```

- [ ] **Step 2: Typecheck + config tests**

Run: `pnpm --filter @openldr/config exec tsc -p tsconfig.json --noEmit` (PASS)
Run: `pnpm --filter @openldr/config test -- --run` (PASS — existing tests unaffected; defaults applied)

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/schema.ts
git commit -m "feat(config): MARKETPLACE_DEV_ALLOW_UNSIGNED + MARKETPLACE_AUTO_PIN_FIRST_USE"
```

---

### Task 12: Wire verify/trust/compat/audit into `PluginRuntime.install`

**Files:**
- Modify: `packages/plugins/package.json` (add `@openldr/marketplace` dep), `packages/plugins/src/runtime.ts`, `packages/plugins/src/runtime.test.ts`

**Behavior rule:** signature required only when the manifest declares a `publisher`. Legacy (no-publisher) manifests install hash-only. A publisher-bearing manifest with no valid signature is rejected unless `verifyConfig.devAllowUnsigned`. `key-mismatch` always rejects. Incompatible CE version always rejects. On `first-use`, pin when `autoPinFirstUse`. Emit a `marketplace.install` audit event when a recorder is provided.

- [ ] **Step 1: Add the dependency** to `packages/plugins/package.json`

```json
    "@openldr/marketplace": "workspace:*",
```
Then `pnpm install`.

- [ ] **Step 2: Write/extend failing tests** — append to `packages/plugins/src/runtime.test.ts`

Add a focused describe block. (Use the existing test file's mock helpers for `blob`, `store`, `runner`, `logger`; if absent, build minimal in-memory fakes as shown.) Import marketplace helpers:

```ts
import { generatePublisherKeypair, signManifest, keyFingerprint, createTrustStore } from '@openldr/marketplace';
import { sha256Hex } from './hash';

function fakeDeps() {
  const blobs = new Map<string, Uint8Array>();
  const rows = new Map<string, any>();
  const audit: any[] = [];
  return {
    audit,
    rows,
    deps: {
      blob: {
        put: async (k: string, b: Uint8Array) => { blobs.set(k, b); },
        get: async (k: string) => blobs.get(k)!,
        delete: async (k: string) => { blobs.delete(k); },
      } as any,
      store: {
        upsert: async (r: any) => { rows.set(`${r.id}@${r.version}`, { ...r, status: 'installed' }); },
        get: async (id: string, v?: string) => rows.get(`${id}@${v}`),
        list: async () => [...rows.values()],
        remove: async () => {},
      } as any,
      runner: {} as any,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } as any,
      recordInstall: async (e: any) => { audit.push(e); },
    },
  };
}
```

```ts
describe('install — artifact security pipeline', () => {
  const wasm = new Uint8Array([0, 1, 2, 3]);
  const wasmSha = sha256Hex(wasm);

  function signedManifest(kp: ReturnType<typeof generatePublisherKeypair>) {
    const base = {
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
      compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
      capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Observation'] }],
      payload: { kind: 'plugin', wasmSha256: wasmSha, entrypoint: 'convert', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } },
    };
    return { ...base, signature: signManifest(base, wasmSha, kp.privateKeyDer) };
  }

  it('installs a valid signed artifact, pins the publisher, and audits', async () => {
    const { deps, rows, audit } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await rt.install(wasm, signedManifest(kp), { publicKeyDer: kp.publicKeyDer, actor: { id: 'admin', name: 'Admin' } });
    expect(rows.get('demo@1.0.0')).toBeTruthy();
    expect(await trustStore.get('acme')).toEqual({ keyFingerprint: kp.fingerprint });
    expect(audit.find((e) => e.action === 'marketplace.install')).toBeTruthy();
  });

  it('rejects a publisher-bearing manifest with no signature unless dev-override', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const { signature: _drop, ...unsigned } = signedManifest(kp);
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await expect(rt.install(wasm, unsigned, { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/signature/i);
  });

  it('rejects on key mismatch with a pinned publisher', async () => {
    const { deps } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    await trustStore.pin({ publisherId: 'acme', keyFingerprint: 'f'.repeat(64), publisherName: 'Acme', approvedBy: null });
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await expect(rt.install(wasm, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/key/i);
  });

  it('rejects an incompatible CE version', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.3.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await expect(rt.install(wasm, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/compat/i);
  });

  it('installs a legacy unsigned plugin manifest (no publisher) hash-only', async () => {
    const { deps, rows } = fakeDeps();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: wasmSha, description: '', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    await rt.install(wasm, legacy);
    expect(rows.get('whonet@0.1.0')).toBeTruthy();
  });
});

function inMemoryTrustStore() {
  const m = new Map<string, { keyFingerprint: string }>();
  return {
    get: async (id: string) => m.get(id),
    pin: async (i: any) => { m.set(i.publisherId, { keyFingerprint: i.keyFingerprint }); },
  };
}
```

Run: `pnpm --filter @openldr/plugins test -- --run src/runtime.test.ts` — expect FAILs (new deps/options not yet supported).

- [ ] **Step 3: Implement the augmented runtime** — `packages/plugins/src/runtime.ts`

Replace the imports and the `PluginRuntimeDeps`/`PluginRuntime` interfaces and `install` body. Add:

```ts
import {
  parseArtifactManifest, pluginManifestToArtifact, verifyArtifact, keyFingerprint,
  evaluateTrust, isCompatible, type ArtifactManifest, type TrustStore, type Capability,
} from '@openldr/marketplace';
```

Extend deps:
```ts
export interface MarketplaceInstallAudit {
  action: string; entityType: string; entityId: string;
  actorType: 'user' | 'system'; actorId?: string | null; actorName: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRuntimeDeps {
  blob: BlobStoragePort;
  store: PluginStore;
  runner: PluginRunner;
  logger: Logger;
  trustStore: TrustStore;
  ceVersion: string;
  verifyConfig: { devAllowUnsigned: boolean; autoPinFirstUse: boolean };
  recordInstall?: (e: MarketplaceInstallAudit) => Promise<void>;
}

export interface InstallOptions {
  publicKeyDer?: Uint8Array;
  actor?: { id?: string | null; name: string };
}

export interface PluginRuntime {
  install(wasm: Uint8Array, rawManifest: unknown, opts?: InstallOptions): Promise<PluginManifest>;
  list(): Promise<PluginRow[]>;
  test(id: string, version?: string): Promise<{ ok: boolean; error?: string }>;
  remove(id: string, version?: string): Promise<void>;
  load(id: string, version?: string): Promise<Converter | undefined>;
}
```

Replace `install`:
```ts
    async install(wasm, rawManifest, opts = {}) {
      // Accept either a new artifact manifest or a legacy plugin manifest.
      const artifact: ArtifactManifest = isArtifactManifest(rawManifest)
        ? parseArtifactManifest(rawManifest)
        : pluginManifestToArtifact(rawManifest as never);
      if (artifact.payload.kind !== 'plugin') {
        throw new Error(`install: only plugin artifacts are wired in SP-1 (got ${artifact.payload.kind})`);
      }

      const payloadSha = sha256Hex(wasm);
      if (payloadSha !== artifact.payload.wasmSha256) {
        throw new Error(`manifest wasmSha256 (${artifact.payload.wasmSha256}) does not match the wasm (${payloadSha})`);
      }

      // Compatibility gate.
      if (!isCompatible(artifact.compatibility.ceVersion, deps.ceVersion)) {
        throw new Error(`artifact ${artifact.id}@${artifact.version} is not compatible with CE ${deps.ceVersion} (requires ${artifact.compatibility.ceVersion})`);
      }

      // Signature + trust (only when a publisher is declared).
      if (artifact.publisher) {
        const pub = artifact.publisher;
        const hasKey = !!opts.publicKeyDer;
        const verified = hasKey
          && keyFingerprint(opts.publicKeyDer!) === pub.keyFingerprint
          && verifyArtifact(artifact as unknown as Record<string, unknown>, payloadSha, opts.publicKeyDer!);
        if (!verified) {
          if (!deps.verifyConfig.devAllowUnsigned) {
            throw new Error(`artifact ${artifact.id}@${artifact.version}: invalid or missing signature for publisher ${pub.id}`);
          }
        } else {
          const fingerprint = keyFingerprint(opts.publicKeyDer!);
          const trust = evaluateTrust(pub.id, fingerprint, await deps.trustStore.get(pub.id));
          if (trust.decision === 'key-mismatch') {
            throw new Error(`artifact ${artifact.id}: publisher ${pub.id} key fingerprint does not match the pinned key`);
          }
          if (trust.decision === 'first-use' && deps.verifyConfig.autoPinFirstUse) {
            await deps.trustStore.pin({ publisherId: pub.id, keyFingerprint: fingerprint, publisherName: pub.name, approvedBy: opts.actor?.id ?? null });
          }
        }
      }

      // Persist (legacy plugin manifest shape is what the store/runner expect).
      const pluginManifest = artifactToPluginManifest(artifact);
      await deps.blob.put(wasmKey(artifact.id, artifact.version), wasm, 'application/wasm');
      await deps.blob.put(manifestKey(artifact.id, artifact.version), new TextEncoder().encode(JSON.stringify(pluginManifest)), 'application/json');
      await deps.store.upsert({ id: artifact.id, version: artifact.version, sha256: payloadSha, manifest: pluginManifest });
      cache.delete(`${artifact.id}@${artifact.version}`);
      deps.logger.info({ id: artifact.id, version: artifact.version }, 'plugin installed');

      if (deps.recordInstall) {
        await deps.recordInstall({
          action: 'marketplace.install', entityType: 'artifact', entityId: `${artifact.id}@${artifact.version}`,
          actorType: opts.actor ? 'user' : 'system', actorId: opts.actor?.id ?? null, actorName: opts.actor?.name ?? 'system',
          metadata: { type: artifact.type, publisherId: artifact.publisher?.id ?? null, capabilities: artifact.capabilities },
        });
      }
      return pluginManifest;
    },
```

Add helpers near the top of the module (after the `manifestKey` function):
```ts
function isArtifactManifest(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && 'payload' in raw;
}

function artifactToPluginManifest(a: ArtifactManifest): PluginManifest {
  const p = a.payload as Extract<ArtifactManifest['payload'], { kind: 'plugin' }>;
  return parseManifest({
    id: a.id, version: a.version, entrypoint: p.entrypoint, wasmSha256: p.wasmSha256,
    description: a.description, license: a.license, wasi: p.wasi, limits: p.limits,
  });
}
```
(`Capability` is imported for type completeness in the audit metadata; if eslint/tsc flags it unused, drop it from the import.)

- [ ] **Step 4: Run plugin tests, expect PASS** — `pnpm --filter @openldr/plugins test -- --run src/runtime.test.ts`

- [ ] **Step 5: Update bootstrap wiring if the build breaks** 

The runtime now requires `trustStore`, `ceVersion`, `verifyConfig`. Find where `createPluginRuntime` is called (`grep -rn "createPluginRuntime" packages apps`) — likely `packages/bootstrap`. Wire: `trustStore: createTrustStore(internalDb)`, `ceVersion` from config/server `package.json` version (thread a `ceVersion` value through bootstrap; default `'0.1.0'`), `verifyConfig: { devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED, autoPinFirstUse: cfg.MARKETPLACE_AUTO_PIN_FIRST_USE }`, and `recordInstall: (e) => audit.safeRecord(e)` if an audit recorder is available there. Keep the change minimal and follow the existing bootstrap pattern. Run `pnpm --filter @openldr/bootstrap exec tsc -p tsconfig.json --noEmit` (and the server typecheck) to confirm.

- [ ] **Step 6: Commit**

```bash
git add packages/plugins/package.json packages/plugins/src/runtime.ts packages/plugins/src/runtime.test.ts packages/bootstrap pnpm-lock.yaml
git commit -m "feat(plugins): verify signature + trust + compat + audit on install"
```

---

### Task 13: Full gate + verification

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green; depcruise reports no violations (the new `plugins → marketplace` edge is allowed; `marketplace → apps/*` is forbidden and not present). If `@openldr/web#test` flakes under parallelism, re-run in isolation.

- [ ] **Step 2: Commit any fixes** (only if needed)

```bash
git add -A
git commit -m "fix(marketplace): gate fixes"
```

---

## Self-Review

**Spec coverage:**
- §4 new `packages/marketplace` (deps zod + crypto + db) → Task 1. ✓
- §5 artifact manifest (all 3 types, publisher optional, compatibility, deps, source, payload union) + adapter → Task 3. ✓
- §6 fine-grained capability schema → Task 2. ✓
- §7 canonical signing bytes → Task 4. ✓
- §8 Ed25519 sign/verify/fingerprint → Task 5. ✓
- §9 `marketplace_publishers` migration + TrustStore + evaluateTrust → Tasks 6, 7, 8. ✓
- §10 semver compatibility → Task 9. ✓
- §11 augment `PluginRuntime.install` (verify/trust/compat/record + audit) → Task 12. ✓
- §12 config flags + ceVersion threading → Tasks 11, 12 (bootstrap). ✓
- §13 testing → tests in every task. ✓
- §14 full gate + depcruise edge → Task 1 (rule) + Task 13. ✓
- §15 out-of-scope (enforcement, registry lifecycle, CLI, forms/reports wiring, federation, UI) → none built. ✓

**Placeholder scan:** No TBD/TODO. Task 8 notes a resolve-the-import contingency (with a concrete fallback) and Task 12 Step 5 adapts to the real bootstrap call site (discovered via grep) — both give an explicit fallback rather than a vague instruction. All code steps show complete code.

**Type/name consistency:** `ArtifactManifest`, `Capability`, `TrustStore`/`PinnedPublisher`/`evaluateTrust`, `createTrustStore`, `generatePublisherKeypair`/`signManifest`/`verifyArtifact`/`keyFingerprint`, `canonicalSigningBytes`/`canonicalJSON`, `isCompatible`, `parseArtifactManifest`/`pluginManifestToArtifact`, and the `marketplace_publishers` columns (`publisher_id`/`key_fingerprint`/`publisher_name`/`pinned_at`/`approved_by`) are used identically across the tasks that define and consume them. The install pipeline uses `verifyConfig.devAllowUnsigned`/`autoPinFirstUse` consistently with the config flag names (`MARKETPLACE_DEV_ALLOW_UNSIGNED`/`MARKETPLACE_AUTO_PIN_FIRST_USE`).
