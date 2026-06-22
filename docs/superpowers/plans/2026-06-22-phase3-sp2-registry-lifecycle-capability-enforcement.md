# Phase 3 SP-2 — Registry Lifecycle + Consent + Capability Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist approved capability grants, run the full plugin registry lifecycle (install/update/rollback/enable-disable/remove) with explicit consent, and enforce granted capabilities at runtime (fail-closed `emit-fhir`, `net-egress` allowlist) — proven by a live-acceptance run against the `openldr-ce-marketplace` repo.

**Architecture:** Extend the `plugins` table (migration `024`) with `enabled`/`active`/`approved_by`/`granted_at` and persist the FULL artifact manifest (capabilities included). The runtime gains lifecycle ops + consent on install; `load()` returns the active+enabled version. Enforcement threads the grant `load()`→`createWasmConverter`→`runner.run`: the converter rejects out-of-allowlist `resourceType`s (fail closed), and the Extism runner passes `allowedHosts`. A `market` CLI group + a `marketplace:accept` harness exercise it end to end. Enforcement applies only to capability-declaring (marketplace) artifacts; legacy `wasm/*` plugins stay unrestricted.

**Tech Stack:** TypeScript, zod, Node `crypto`, Kysely + pg-mem, Extism (`@extism/extism` 1.0.3), commander CLI, Vitest, tsx, Turborepo/pnpm. Spec: `docs/superpowers/specs/2026-06-22-phase3-sp2-registry-lifecycle-capability-enforcement-design.md`.

**Conventions:**
- Tests from repo root: `pnpm --filter @openldr/<pkg> test -- --run <path>`. Single-package typecheck: `pnpm --filter @openldr/<pkg> exec tsc -p tsconfig.json --noEmit`.
- Migration tests use `makeMigratedDb()` (`packages/db/src/migrations/internal/test-helpers.ts`).
- Full gate (final task): `pnpm turbo typecheck lint test build && pnpm depcruise`.
- Commit after every task.
- **Back-compat invariant (every task must preserve):** a persisted manifest with NO `capabilities` field is "legacy" — unrestricted at runtime, no consent required. A manifest WITH `capabilities` (incl. `[]`) is a marketplace artifact — enforced.

---

## Slice 1 — Capability persistence + registry columns

### Task 1: Migration `024_plugin_registry` + schema columns

**Files:**
- Create: `packages/db/src/migrations/internal/024_plugin_registry.ts`, `packages/db/src/migrations/internal/024_plugin_registry.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/internal/migrations.test.ts`, `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the failing migration test** — `024_plugin_registry.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('024_plugin_registry', () => {
  it('adds enabled/active/approved_by/granted_at to plugins', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('plugins').values({
      id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: {} as never, status: 'installed',
      enabled: true, active: true, approved_by: 'admin', granted_at: new Date(),
    }).execute();
    const row = await db.selectFrom('plugins').selectAll().where('id', '=', 'p').executeTakeFirst();
    expect(row?.enabled).toBe(true);
    expect(row?.active).toBe(true);
    expect(row?.approved_by).toBe('admin');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/db test -- --run src/migrations/internal/024_plugin_registry.test.ts`

- [ ] **Step 3: Implement migration** — `024_plugin_registry.ts`

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('plugins').addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true)).execute();
  await db.schema.alterTable('plugins').addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true)).execute();
  await db.schema.alterTable('plugins').addColumn('approved_by', 'text').execute();
  await db.schema.alterTable('plugins').addColumn('granted_at', 'timestamptz').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('plugins').dropColumn('granted_at').execute();
  await db.schema.alterTable('plugins').dropColumn('approved_by').execute();
  await db.schema.alterTable('plugins').dropColumn('active').execute();
  await db.schema.alterTable('plugins').dropColumn('enabled').execute();
}
```

- [ ] **Step 4: Register** in `index.ts` — add `import * as m024 from './024_plugin_registry';` and `'024_plugin_registry': { up: m024.up, down: m024.down },`.

- [ ] **Step 5: Update `migrations.test.ts`** — it asserts the exact list of migration keys; add `'024_plugin_registry'` to its expected array (find the array and append).

- [ ] **Step 6: Update `PluginsTable`** in `packages/db/src/schema/internal.ts`:
```ts
export interface PluginsTable {
  id: string;
  version: string;
  sha256: string;
  manifest: JSONColumnType<Record<string, unknown>>;
  status: Generated<string>;
  installed_at: Generated<Date>;
  enabled: Generated<boolean>;
  active: Generated<boolean>;
  approved_by: string | null;
  granted_at: Date | null;
}
```

- [ ] **Step 7: Run tests + db typecheck** — `pnpm --filter @openldr/db test -- --run src/migrations/internal/024_plugin_registry.test.ts` (PASS), `pnpm --filter @openldr/db test -- --run src/migrations/internal/migrations.test.ts` (PASS), `pnpm --filter @openldr/db exec tsc -p tsconfig.json --noEmit` (PASS).

- [ ] **Step 8: Commit**
```bash
git add packages/db/src/migrations/internal/024_plugin_registry.ts packages/db/src/migrations/internal/024_plugin_registry.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/internal/migrations.test.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): 024_plugin_registry — enabled/active/approved_by/granted_at"
```

### Task 2: `readGrant` helper in marketplace

**Files:**
- Create: `packages/marketplace/src/grant.ts`, `packages/marketplace/src/grant.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test** — `grant.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readGrant, allowedResourceTypes, allowedHosts } from './grant';

describe('readGrant', () => {
  it('treats a manifest with no capabilities field as legacy (unrestricted)', () => {
    expect(readGrant({ id: 'x', version: '1.0.0' })).toEqual({ legacy: true });
  });
  it('returns capabilities for a marketplace manifest', () => {
    const caps = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }];
    expect(readGrant({ schemaVersion: 1, capabilities: caps })).toEqual({ legacy: false, capabilities: caps });
  });
  it('an empty capabilities array is a marketplace artifact, not legacy', () => {
    expect(readGrant({ schemaVersion: 1, capabilities: [] })).toEqual({ legacy: false, capabilities: [] });
  });
});

describe('allowedResourceTypes / allowedHosts', () => {
  it('extracts the emit-fhir allowlist', () => {
    expect(allowedResourceTypes([{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Observation'] }])).toEqual(['Patient', 'Observation']);
    expect(allowedResourceTypes([])).toEqual([]);
  });
  it('extracts the net-egress allowlist', () => {
    expect(allowedHosts([{ kind: 'net-egress', allowedHosts: ['ex.org:443'] }])).toEqual(['ex.org:443']);
    expect(allowedHosts([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/marketplace test -- --run src/grant.test.ts`

- [ ] **Step 3: Implement** — `grant.ts`

```ts
import type { Capability } from './capabilities';

export type Grant = { legacy: true } | { legacy: false; capabilities: Capability[] };

/** A persisted manifest with a `capabilities` field is a marketplace artifact (enforced); otherwise legacy (unrestricted). */
export function readGrant(manifest: Record<string, unknown>): Grant {
  const caps = manifest.capabilities;
  if (!Array.isArray(caps)) return { legacy: true };
  return { legacy: false, capabilities: caps as Capability[] };
}

export function allowedResourceTypes(capabilities: Capability[]): string[] {
  const cap = capabilities.find((c): c is Extract<Capability, { kind: 'emit-fhir' }> => c.kind === 'emit-fhir');
  return cap ? cap.resourceTypes : [];
}

export function allowedHosts(capabilities: Capability[]): string[] {
  const cap = capabilities.find((c): c is Extract<Capability, { kind: 'net-egress' }> => c.kind === 'net-egress');
  return cap ? cap.allowedHosts : [];
}
```

- [ ] **Step 4: Run, expect PASS**; add `export * from './grant';` to `packages/marketplace/src/index.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/marketplace/src/grant.ts packages/marketplace/src/grant.test.ts packages/marketplace/src/index.ts
git commit -m "feat(marketplace): readGrant + capability allowlist helpers"
```

---

## Slice 2 — Registry lifecycle in the store

### Task 3: Extend `PluginStore` with active/enabled lifecycle

**Files:**
- Modify: `packages/plugins/src/store.ts`, `packages/plugins/src/store.test.ts` (create the test file if absent)

- [ ] **Step 1: Write failing tests** — `packages/plugins/src/store.test.ts` (create if missing; use the pg-mem pattern: import `internalMigrations` from `@openldr/db`, build a db, run each `up()` — mirror `packages/marketplace/src/trust-store.test.ts`).

```ts
import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from '@openldr/db';
import { createPluginStore } from './store';

async function db() {
  const k = newDb().adapters.createKysely() as Kysely<any>;
  for (const m of Object.values(internalMigrations)) await m.up(k);
  return k;
}
const man = (caps?: unknown) => ({ id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 }, ...(caps ? { schemaVersion: 1, capabilities: caps } : {}) });

describe('plugin store lifecycle', () => {
  it('install marks the new version active and deactivates others', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.install({ id: 'p', version: '2.0.0', sha256: 'b'.repeat(64), manifest: man(), approvedBy: null });
    const active = await s.get('p');
    expect(active?.version).toBe('2.0.0');
  });
  it('rollback activates a prior version', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.install({ id: 'p', version: '2.0.0', sha256: 'b'.repeat(64), manifest: man(), approvedBy: null });
    await s.rollback('p', '1.0.0');
    expect((await s.get('p'))?.version).toBe('1.0.0');
  });
  it('disable hides the plugin from get; enable restores it', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await s.setEnabled('p', false);
    expect(await s.get('p')).toBeUndefined();
    await s.setEnabled('p', true);
    expect((await s.get('p'))?.version).toBe('1.0.0');
  });
  it('rollback to an uninstalled version throws', async () => {
    const s = createPluginStore(await db());
    await s.install({ id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: man(), approvedBy: null });
    await expect(s.rollback('p', '9.9.9')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/plugins test -- --run src/store.test.ts`

- [ ] **Step 3: Rewrite `store.ts`** to the lifecycle-aware shape. `PluginRow` gains `enabled`/`active`/`approvedBy`. `get(id)` returns the active+enabled row (or a specific version if given). Add `install` (sets active, deactivates siblings, records approvedBy/granted_at), `rollback`, `setEnabled`, keep `list`/`remove`.

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export interface PluginRow {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  status: string;
  enabled: boolean;
  active: boolean;
  approvedBy: string | null;
}

export interface PluginInstallInput {
  id: string; version: string; sha256: string; manifest: Record<string, unknown>; approvedBy: string | null;
}

export interface PluginStore {
  install(input: PluginInstallInput): Promise<void>;
  get(id: string, version?: string): Promise<PluginRow | undefined>;
  list(): Promise<PluginRow[]>;
  rollback(id: string, version: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string, version?: string): Promise<void>;
}

const COLUMNS = ['id', 'version', 'sha256', 'manifest', 'status', 'enabled', 'active', 'approved_by'] as const;

function toRow(r: Record<string, unknown>): PluginRow {
  return {
    id: r.id as string, version: r.version as string, sha256: r.sha256 as string,
    manifest: r.manifest as Record<string, unknown>, status: r.status as string,
    enabled: r.enabled as boolean, active: r.active as boolean, approvedBy: (r.approved_by as string | null) ?? null,
  };
}

export function createPluginStore(db: Kysely<InternalSchema>): PluginStore {
  return {
    async install({ id, version, sha256, manifest, approvedBy }) {
      // The newly installed version becomes the sole active one.
      await db.updateTable('plugins').set({ active: false }).where('id', '=', id).execute();
      await db.insertInto('plugins')
        .values({ id, version, sha256, manifest: manifest as never, status: 'installed', enabled: true, active: true, approved_by: approvedBy, granted_at: sql`now()` })
        .onConflict((oc) => oc.columns(['id', 'version']).doUpdateSet({ sha256, manifest: manifest as never, status: 'installed', active: true, enabled: true, approved_by: approvedBy, granted_at: sql`now()` }))
        .execute();
    },
    async get(id, version) {
      let q = db.selectFrom('plugins').select(COLUMNS).where('id', '=', id);
      q = version ? q.where('version', '=', version) : q.where('active', '=', true).where('enabled', '=', true);
      const r = await q.executeTakeFirst();
      return r ? toRow(r) : undefined;
    },
    async list() {
      const rows = await db.selectFrom('plugins').select(COLUMNS).orderBy('id').orderBy('version', 'desc').execute();
      return rows.map(toRow);
    },
    async rollback(id, version) {
      const exists = await db.selectFrom('plugins').select('version').where('id', '=', id).where('version', '=', version).executeTakeFirst();
      if (!exists) throw new Error(`cannot roll back ${id}: version ${version} is not installed`);
      await db.updateTable('plugins').set({ active: false }).where('id', '=', id).execute();
      await db.updateTable('plugins').set({ active: true }).where('id', '=', id).where('version', '=', version).execute();
    },
    async setEnabled(id, enabled) {
      await db.updateTable('plugins').set({ enabled }).where('id', '=', id).execute();
    },
    async remove(id, version) {
      let q = db.deleteFrom('plugins').where('id', '=', id);
      if (version) q = q.where('version', '=', version);
      await q.execute();
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @openldr/plugins test -- --run src/store.test.ts`

- [ ] **Step 5: Commit**
```bash
git add packages/plugins/src/store.ts packages/plugins/src/store.test.ts
git commit -m "feat(plugins): lifecycle-aware plugin store (active/enabled/rollback)"
```

---

## Slice 3 — Consent + lifecycle on the runtime

### Task 4: Consent on install + persist the full artifact manifest

**Files:**
- Modify: `packages/plugins/src/runtime.ts`, `packages/plugins/src/runtime.test.ts`

- [ ] **Step 1: Write failing tests** — append to the artifact-security describe block in `runtime.test.ts` (the `fakeDeps`/`inMemoryTrustStore` helpers exist there; update the fake store to the new `PluginStore` interface — `install`/`get`/`rollback`/`setEnabled`/`remove`).

```ts
it('requires approval for a publisher-bearing artifact', async () => {
  const { deps } = fakeDeps();
  const kp = generatePublisherKeypair();
  const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
  // No opts.approval -> reject
  await expect(rt.install(wasm, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/approv/i);
});

it('installs with approval, persisting capabilities + approver', async () => {
  const { deps, rows } = fakeDeps();
  const kp = generatePublisherKeypair();
  const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
  const m = signedManifest(kp);
  await rt.install(wasm, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
  const row = rows.get('demo@1.0.0');
  expect(row.approvedBy).toBe('admin');
  expect((row.manifest as any).capabilities).toEqual(m.capabilities);
});

it('rejects approval that does not match requested capabilities', async () => {
  const { deps } = fakeDeps();
  const kp = generatePublisherKeypair();
  const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
  await expect(rt.install(wasm, signedManifest(kp), { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: [] } })).rejects.toThrow(/acknowledg/i);
});

it('legacy no-publisher manifest installs without approval (unrestricted)', async () => {
  const { deps, rows } = fakeDeps();
  const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
  const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: wasmSha, description: '', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
  await rt.install(wasm, legacy);
  expect(rows.get('whonet@0.1.0')).toBeTruthy();
});
```
Update the `fakeDeps()` store fake so `install({id,version,sha256,manifest,approvedBy})` stores `{ ...row, manifest, approvedBy, active: true, enabled: true }` keyed `${id}@${version}`, and `get`/`rollback`/`setEnabled`/`remove` behave minimally.

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/plugins test -- --run src/runtime.test.ts`

- [ ] **Step 3: Edit `runtime.ts`** — (a) drop `autoPinFirstUse` from `verifyConfig`; (b) add `approval` to `InstallOptions`; (c) persist the FULL artifact manifest (not the stripped one) via `store.install`; (d) enforce consent; (e) pin on first-use as part of an approved/verified install.

Change the deps + options interfaces:
```ts
  verifyConfig: { devAllowUnsigned: boolean };
```
```ts
export interface InstallApproval { approvedBy: string; acknowledgedCapabilities: Capability[] }
export interface InstallOptions {
  publicKeyDer?: Uint8Array;
  actor?: { id?: string | null; name: string };
  approval?: InstallApproval;
}
```
Add `Capability` to the marketplace import. In `install`, after the compatibility gate, replace the signature/trust block's pinning + add consent. Specifically:
- Keep signature verify exactly as is, but in the `verified` branch do NOT auto-pin yet.
- After the signature block, add consent handling:
```ts
      // Consent: publisher-bearing artifacts require explicit approval of the requested capabilities.
      let approvedBy: string | null = null;
      if (artifact.publisher) {
        if (!opts.approval) {
          throw new Error(`artifact ${artifact.id}@${artifact.version}: install requires explicit approval (publisher ${artifact.publisher.id})`);
        }
        const requested = JSON.stringify(artifact.capabilities);
        const acknowledged = JSON.stringify(opts.approval.acknowledgedCapabilities);
        if (requested !== acknowledged) {
          throw new Error(`artifact ${artifact.id}: acknowledged capabilities do not match the requested capabilities`);
        }
        approvedBy = opts.approval.approvedBy;
        if (signatureVerified) {
          const fingerprint = keyFingerprint(opts.publicKeyDer!);
          const trust = evaluateTrust(artifact.publisher.id, fingerprint, await deps.trustStore.get(artifact.publisher.id));
          if (trust.decision === 'first-use') {
            await deps.trustStore.pin({ publisherId: artifact.publisher.id, keyFingerprint: fingerprint, publisherName: artifact.publisher.name, approvedBy });
          }
          // key-mismatch already threw inside the signature block.
        }
      }
```
(Move the `key-mismatch` check to remain inside the signature block; remove the `autoPinFirstUse` pin there.)
- Persist the full artifact manifest:
```ts
      const fullManifest = isArtifact ? (rawManifest as Record<string, unknown>) : (artifact as unknown as Record<string, unknown>);
      const pluginManifest = artifactToPluginManifest(artifact); // still returned for back-compat callers + blob
      await deps.blob.put(wasmKey(artifact.id, artifact.version), wasm, 'application/wasm');
      await deps.blob.put(manifestKey(artifact.id, artifact.version), new TextEncoder().encode(JSON.stringify(fullManifest)), 'application/json');
      await deps.store.install({ id: artifact.id, version: artifact.version, sha256: payloadSha, manifest: fullManifest, approvedBy });
```
Keep the `recordInstall` audit (now also include `approvedBy` in metadata). Return `pluginManifest` (unchanged signature).

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @openldr/plugins test -- --run src/runtime.test.ts`

- [ ] **Step 5: Commit**
```bash
git add packages/plugins/src/runtime.ts packages/plugins/src/runtime.test.ts
git commit -m "feat(plugins): explicit consent on install + persist full artifact manifest"
```

### Task 5: Lifecycle ops on the runtime (update/rollback/enable/disable/remove) + audit

**Files:**
- Modify: `packages/plugins/src/runtime.ts`, `packages/plugins/src/runtime.test.ts`

- [ ] **Step 1: Write failing tests** — add lifecycle tests asserting the runtime exposes `rollback`/`setEnabled` and emits lifecycle audit events.

```ts
it('rollback + enable/disable delegate to the store and audit', async () => {
  const { deps, audit } = fakeDeps();
  const trustStore = inMemoryTrustStore();
  const kp = generatePublisherKeypair();
  const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
  const m = signedManifest(kp);
  await rt.install(wasm, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
  await rt.setEnabled('demo', false, { actor: { id: 'admin', name: 'Admin' } });
  await rt.rollback('demo', '1.0.0', { actor: { id: 'admin', name: 'Admin' } });
  expect(audit.find((e) => e.action === 'marketplace.disable')).toBeTruthy();
  expect(audit.find((e) => e.action === 'marketplace.rollback')).toBeTruthy();
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — add to `PluginRuntime` interface and the returned object:
```ts
  rollback(id: string, version: string, opts?: { actor?: { id?: string | null; name: string } }): Promise<void>;
  setEnabled(id: string, enabled: boolean, opts?: { actor?: { id?: string | null; name: string } }): Promise<void>;
```
Implement them delegating to the store + emitting `recordInstall` (rename the audit dep mentally — it's a generic recorder) events `marketplace.rollback`, `marketplace.enable`/`marketplace.disable`, and have `remove` emit `marketplace.remove`. Each cache-invalidates the affected `id`'s entries. Example:
```ts
    async rollback(id, version, o = {}) {
      await deps.store.rollback(id, version);
      for (const k of [...cache.keys()]) if (k.startsWith(`${id}@`)) cache.delete(k);
      await deps.recordInstall?.({ action: 'marketplace.rollback', entityType: 'artifact', entityId: `${id}@${version}`, actorType: o.actor ? 'user' : 'system', actorId: o.actor?.id ?? null, actorName: o.actor?.name ?? 'system' });
    },
    async setEnabled(id, enabled, o = {}) {
      await deps.store.setEnabled(id, enabled);
      for (const k of [...cache.keys()]) if (k.startsWith(`${id}@`)) cache.delete(k);
      await deps.recordInstall?.({ action: enabled ? 'marketplace.enable' : 'marketplace.disable', entityType: 'artifact', entityId: id, actorType: o.actor ? 'user' : 'system', actorId: o.actor?.id ?? null, actorName: o.actor?.name ?? 'system' });
    },
```
Update `remove` to emit `marketplace.remove` and accept the same `opts`.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**
```bash
git add packages/plugins/src/runtime.ts packages/plugins/src/runtime.test.ts
git commit -m "feat(plugins): runtime rollback/enable/disable/remove + lifecycle audit"
```

---

## Slice 4 — Runtime capability enforcement

### Task 6: `net-egress` — thread `allowedHosts` through the runner

**Files:**
- Modify: `packages/plugins/src/runner.ts`, `packages/plugins/src/extism-runner.ts`

- [ ] **Step 1: Add `allowedHosts` to `RunOptions`** in `runner.ts`:
```ts
export interface RunOptions {
  entrypoint: string;
  wasi: boolean;
  memoryMb: number;
  timeoutMs: number;
  host: RunnerHostFns;
  config?: Record<string, string>;
  allowedHosts?: string[]; // net-egress allowlist; undefined/[] = default-deny (no egress)
}
```

- [ ] **Step 2: Pass it to Extism** in `extism-runner.ts` — add `allowedHosts: opts.allowedHosts ?? []` to the `createPlugin` options object (top-level, alongside `useWasi`/`config`). Update the sandbox-notes comment to state egress is now restricted to the granted allowlist (default-deny when empty).

- [ ] **Step 3: Typecheck** — `pnpm --filter @openldr/plugins exec tsc -p tsconfig.json --noEmit` (PASS). (No unit test for the real Extism runner; covered by the converter test in Task 7 via a fake runner, and by live acceptance.)

- [ ] **Step 4: Commit**
```bash
git add packages/plugins/src/runner.ts packages/plugins/src/extism-runner.ts
git commit -m "feat(plugins): runner allowedHosts (net-egress enforcement)"
```

### Task 7: `emit-fhir` fail-closed enforcement in the converter

**Files:**
- Modify: `packages/plugins/src/wasm-converter.ts`, `packages/plugins/src/runtime.ts` (thread the grant into `createWasmConverter`)
- Create: `packages/plugins/src/wasm-converter.test.ts` (if absent)

- [ ] **Step 1: Write failing tests** — `wasm-converter.test.ts`. Use a fake `PluginRunner` that returns a fixed NDJSON of resources, and assert enforcement.

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWasmConverter } from './wasm-converter';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
const manifest = { id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), description: '', license: 'x', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } } as any;

function runnerEmitting(resources: object[]): PluginRunner {
  const ndjson = resources.map((r) => JSON.stringify(r)).join('\n');
  return { run: vi.fn(async () => new TextEncoder().encode(ndjson)) };
}
const patient = { resourceType: 'Patient', id: 'p1' };
const obs = { resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } };

describe('wasm-converter enforcement', () => {
  it('legacy (no grant) is unrestricted', async () => {
    const c = createWasmConverter(manifest, new Uint8Array(), runnerEmitting([patient, obs]), logger, undefined);
    const out = await c.convert(new Uint8Array(), { batchId: 'b' });
    expect(out).toHaveLength(2);
  });
  it('emit-fhir allowlist passes in-grant resources', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Observation'] }] as any;
    const c = createWasmConverter(manifest, new Uint8Array(), runnerEmitting([patient, obs]), logger, grant);
    expect(await c.convert(new Uint8Array(), { batchId: 'b' })).toHaveLength(2);
  });
  it('fails closed on an out-of-grant resourceType', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any;
    const c = createWasmConverter(manifest, new Uint8Array(), runnerEmitting([patient, obs]), logger, grant);
    await expect(c.convert(new Uint8Array(), { batchId: 'b' })).rejects.toThrow(/capability|not permitted|Observation/i);
  });
  it('an empty grant denies all emits', async () => {
    const c = createWasmConverter(manifest, new Uint8Array(), runnerEmitting([patient]), logger, []);
    await expect(c.convert(new Uint8Array(), { batchId: 'b' })).rejects.toThrow();
  });
  it('passes allowedHosts from a net-egress grant to the runner', async () => {
    const grant = [{ kind: 'net-egress', allowedHosts: ['ex.org:443'] }, { kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any;
    const runner = runnerEmitting([patient]);
    const c = createWasmConverter(manifest, new Uint8Array(), runner, logger, grant);
    await c.convert(new Uint8Array(), { batchId: 'b' });
    expect((runner.run as any).mock.calls[0][2].allowedHosts).toEqual(['ex.org:443']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/plugins test -- --run src/wasm-converter.test.ts`

- [ ] **Step 3: Implement** — `wasm-converter.ts`. Add a `grant?: Capability[]` param (5th). When `grant` is defined (marketplace artifact), compute the `emit-fhir` allowlist + `net-egress` allowedHosts; pass `allowedHosts` to `runner.run`; after `parseNdjson`, reject any resource whose `resourceType` ∉ allowlist (fail closed).

```ts
import type { Logger } from '@openldr/core';
import { validateResource, type FhirResource } from '@openldr/fhir';
import type { Converter, ConvertContext } from '@openldr/ingest';
import type { Capability } from '@openldr/marketplace';
import { allowedResourceTypes, allowedHosts } from '@openldr/marketplace';
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
  grant?: Capability[],
): Converter {
  const host: RunnerHostFns = {
    log(level, msg) {
      const fn = (logger as unknown as Record<string, (o: unknown, m?: string) => void>)[level] ?? logger.info;
      fn.call(logger, { plugin: manifest.id }, msg);
    },
    progress(done, total) { logger.debug({ plugin: manifest.id, done, total }, 'plugin progress'); },
  };
  const enforced = grant !== undefined;
  const allowTypes = enforced ? allowedResourceTypes(grant) : null;
  const hosts = enforced ? allowedHosts(grant) : undefined;
  return {
    id: manifest.id,
    version: manifest.version,
    async convert(raw: Uint8Array, ctx: ConvertContext): Promise<FhirResource[]> {
      const out = await runner.run(wasm, raw, {
        entrypoint: manifest.entrypoint, wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb, timeoutMs: manifest.limits.timeoutMs,
        config: ctx.config, host, allowedHosts: hosts,
      });
      const resources = parseNdjson(out);
      if (allowTypes !== null) {
        for (const r of resources) {
          const rt = (r as { resourceType?: string }).resourceType ?? '';
          if (!allowTypes.includes(rt)) {
            throw new Error(`plugin ${manifest.id} emitted ${rt}, which is not permitted by its emit-fhir capability grant`);
          }
        }
      }
      return resources;
    },
  };
}
```

- [ ] **Step 4: Thread the grant in `runtime.ts` `load()`** — compute the grant from the persisted manifest and pass it:
```ts
import { readGrant } from '@openldr/marketplace';
// ...in load():
      const grant = readGrant(row.manifest);
      const converter = createWasmConverter(pluginManifestFromRow(row), wasm, deps.runner, deps.logger, grant.legacy ? undefined : grant.capabilities);
```
where `pluginManifestFromRow(row)` parses the legacy plugin fields out of `row.manifest` (the persisted manifest may be a full artifact manifest — extract `id/version/entrypoint/wasi/limits` from its `payload` when `schemaVersion` is present, else use it directly via `parseManifest`). Add this helper:
```ts
function pluginManifestFromRow(row: PluginRow): PluginManifest {
  const m = row.manifest;
  if (m.schemaVersion && m.payload && (m.payload as { kind?: string }).kind === 'plugin') {
    return artifactToPluginManifest(parseArtifactManifest(m));
  }
  return parseManifest(m);
}
```

- [ ] **Step 5: Add a runtime enforcement integration test** — install a signed artifact whose `emit-fhir` grant is `['Patient']`, with a fake runner emitting an `Observation`, and assert `load(...).convert(...)` rejects. (Add to `runtime.test.ts`, reusing the fake runner approach.)

- [ ] **Step 6: Run, expect PASS** — `pnpm --filter @openldr/plugins test -- --run src/wasm-converter.test.ts src/runtime.test.ts`

- [ ] **Step 7: Commit**
```bash
git add packages/plugins/src/wasm-converter.ts packages/plugins/src/wasm-converter.test.ts packages/plugins/src/runtime.ts packages/plugins/src/runtime.test.ts
git commit -m "feat(plugins): fail-closed emit-fhir enforcement + grant-driven allowedHosts"
```

### Task 8: Bootstrap wiring (drop autoPinFirstUse; violation audit recorder)

**Files:**
- Modify: `packages/bootstrap/src/ingest-context.ts`

- [ ] **Step 1: Update `createPluginRuntime` wiring** — remove `autoPinFirstUse` from `verifyConfig` (now `{ devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED }`). Keep `recordInstall: (e) => safeRecord(audit, logger, e)` — it now also carries rollback/enable/disable/remove/violation events. Ensure the IngestContext `plugins` wrapper still exposes `install`/`remove` and now also `rollback`/`setEnabled` (pass through to the runtime). Remove the redundant manual `plugin.install`/`plugin.remove` audit wrapper if the runtime now audits `marketplace.*` (keep `plugin.*` only if you want both; prefer dropping the manual wrapper to avoid double audit — the runtime's `marketplace.install`/`marketplace.remove` supersede it). Expose `rollback`/`setEnabled` on the `IngestContext.plugins` type.

- [ ] **Step 2: Typecheck** — `pnpm --filter @openldr/bootstrap exec tsc -p tsconfig.json --noEmit` and `pnpm --filter @openldr/server exec tsc -p tsconfig.json --noEmit` (PASS). Fix any other `createPluginRuntime`/`createWasmConverter`/store callers the signature changes broke (`grep -rn "createWasmConverter\|\.setEnabled\|autoPinFirstUse" packages apps`).

- [ ] **Step 3: Commit**
```bash
git add packages/bootstrap/src/ingest-context.ts
git commit -m "feat(bootstrap): drop autoPinFirstUse; wire lifecycle audit recorder"
```

---

## Slice 5 — Bundle helpers + `market` CLI

### Task 9: Bundle read/verify helpers in marketplace

**Files:**
- Create: `packages/marketplace/src/bundle-fs.ts`, `packages/marketplace/src/bundle-fs.test.ts`
- Modify: `packages/marketplace/src/index.ts`

A **bundle** is a directory with `manifest.json`, `plugin.wasm`, and `publisher.pub` (hex SPKI DER public key). These helpers are Node-fs (the package already runs in Node; add no new deps — use `node:fs/promises`).

- [ ] **Step 1: Write the failing test** — `bundle-fs.test.ts`: write a temp bundle dir (manifest+wasm+pub from `generatePublisherKeypair`+`signManifest`), `readBundle(dir)` returns `{ manifest, wasm, publicKeyDer }`, and `verifyBundle(bundle)` returns `{ valid: true, fingerprint }` for a good bundle and `{ valid: false }` for a tampered manifest. Use `node:os.tmpdir()` + a unique subdir (derive the name from a passed-in suffix, not Date/random — e.g. accept a dir path the test creates via `mkdtemp`).

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePublisherKeypair, signManifest } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';

async function makeBundle(tamper = false) {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-'));
  const kp = generatePublisherKeypair();
  const wasm = new Uint8Array([1, 2, 3, 4]);
  const { sha256Hex } = await import('@openldr/plugins'); // or inline a sha256
  const wasmSha = sha256Hex(wasm);
  const base = {
    schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
    compatibility: { ceVersion: '*' }, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    payload: { kind: 'plugin', wasmSha256: wasmSha },
  };
  const manifest = { ...base, signature: signManifest(base, wasmSha, kp.privateKeyDer) };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(tamper ? { ...manifest, id: 'evil' } : manifest));
  await writeFile(join(dir, 'plugin.wasm'), wasm);
  await writeFile(join(dir, 'publisher.pub'), Buffer.from(kp.publicKeyDer).toString('hex'));
  return { dir };
}

describe('bundle-fs', () => {
  it('reads and verifies a good bundle', async () => {
    const { dir } = await makeBundle();
    const b = await readBundle(dir);
    expect(verifyBundle(b).valid).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
  it('rejects a tampered manifest', async () => {
    const { dir } = await makeBundle(true);
    const b = await readBundle(dir);
    expect(verifyBundle(b).valid).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
```
(If importing `sha256Hex` from `@openldr/plugins` creates an unwanted dependency direction, inline a sha256 in the test using `node:crypto`.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — `bundle-fs.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArtifactManifest, type ArtifactManifest } from './artifact-manifest';
import { verifyArtifact, keyFingerprint } from './signing';

export interface Bundle { manifest: ArtifactManifest; raw: Record<string, unknown>; wasm: Uint8Array; publicKeyDer: Uint8Array; payloadSha256: string; }

export async function readBundle(dir: string): Promise<Bundle> {
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const manifest = parseArtifactManifest(raw);
  const wasm = new Uint8Array(await readFile(join(dir, 'plugin.wasm')));
  const publicKeyDer = Uint8Array.from(Buffer.from((await readFile(join(dir, 'publisher.pub'), 'utf8')).trim(), 'hex'));
  const payloadSha256 = createHash('sha256').update(wasm).digest('hex');
  return { manifest, raw, wasm, publicKeyDer, payloadSha256 };
}

export function verifyBundle(b: Bundle): { valid: boolean; fingerprint: string } {
  const fingerprint = keyFingerprint(b.publicKeyDer);
  const okFp = b.manifest.publisher ? b.manifest.publisher.keyFingerprint === fingerprint : false;
  const okSha = b.raw.payload && (b.raw.payload as { wasmSha256?: string }).wasmSha256 === b.payloadSha256;
  const valid = !!okFp && !!okSha && verifyArtifact(b.raw, b.payloadSha256, b.publicKeyDer);
  return { valid, fingerprint };
}
```
Add `export * from './bundle-fs';` to `index.ts`. (Verify the marketplace package can use `node:fs` — it's a Node lib package; fine.)

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**
```bash
git add packages/marketplace/src/bundle-fs.ts packages/marketplace/src/bundle-fs.test.ts packages/marketplace/src/index.ts
git commit -m "feat(marketplace): bundle read + verify helpers"
```

### Task 10: `market` CLI group

**Files:**
- Create: `packages/cli/src/market.ts`, `packages/cli/src/market.test.ts`
- Modify: `packages/cli/src/index.ts`

Follow the exact structure of `packages/cli/src/plugin.ts` (its `runPlugin*` functions + how `index.ts` registers the `plugin` group and obtains `ctx = await createAppContext(cfg)`; the runtime is at `ctx.plugins`). Read `plugin.ts` and `index.ts` first.

- [ ] **Step 1: Write the failing test** — `market.test.ts` follows `packages/cli/src/read-commands.test.ts`/`export.test.ts` patterns (mock `@openldr/bootstrap` `createAppContext` to return a fake `ctx.plugins`, assert each `run*` calls the right runtime method and shapes `--json`). Cover `verify`, `install` (requires approval flag for publisher bundles), `list`, `rollback`, `enable`, `disable`, `remove`.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `market.ts`** — `run*` functions:
  - `runMarketVerify(dir, opts)` — `readBundle` + `verifyBundle`; print/JSON the manifest id/version/publisher/capabilities/compatibility + `valid`.
  - `runMarketInstall(dir, opts)` — `readBundle`; `ctx.plugins.install(b.wasm, b.raw, { publicKeyDer: b.publicKeyDer, actor: { name: 'cli' }, approval: opts.approve ? { approvedBy: opts.approvedBy ?? 'cli', acknowledgedCapabilities: b.manifest.capabilities } : undefined })`.
  - `runMarketList`, `runMarketRollback(id, version)`, `runMarketEnable(id)`/`runMarketDisable(id)` (`ctx.plugins.setEnabled`), `runMarketRemove(id, version?)`. All support `--json` and use the repo's redact-error pattern.

- [ ] **Step 4: Register in `index.ts`** — `const market = program.command('market').description('Plugin/artifact marketplace');` with subcommands `verify <dir>`, `install <dir>` (`--approve`, `--approved-by <actor>`, `--json`), `list` (`--json`), `update <dir>` (alias of install; `--approve`/`--approved-by`/`--json`), `rollback <id> <version>` (`--json`), `enable <id>`, `disable <id>`, `remove <id> [version]`. Import the `runMarket*` functions.

- [ ] **Step 5: Run tests + cli typecheck** — `pnpm --filter @openldr/cli test -- --run src/market.test.ts` (PASS), cli typecheck (PASS).

- [ ] **Step 6: Commit**
```bash
git add packages/cli/src/market.ts packages/cli/src/market.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): market group (verify/install/list/rollback/enable/disable/remove)"
```

---

## Slice 6 — Live acceptance

### Task 11: `marketplace:accept` harness + signed bundle

**Files:**
- Create: `scripts/marketplace-live-acceptance.ts`, `scripts/make-marketplace-bundle.ts`
- Modify: `package.json` (scripts), and write bundle artifacts into `../openldr-ce-marketplace`

Read `scripts/mssql-live-acceptance.ts` first for the harness shape (config load, internal-PG connection on :5433, `createAppContext`, assertions, exit codes, console output). Mirror it.

- [ ] **Step 1: Bundle builder** — `scripts/make-marketplace-bundle.ts`: generate (or load) a publisher keypair; read an existing built wasm (`reference-plugins/whonet-sqlite/plugin.wasm` — the path used by `e2e:seed`; confirm it exists after `pnpm build:plugins`); compute its sha256; build an artifact manifest (`type:'plugin'`, publisher set, `compatibility.ceVersion:'*'`, payload from the wasm, narrow `emit-fhir: ['Patient']`, `net-egress: []`); sign it; write `manifest.json` + `plugin.wasm` + `publisher.pub` into `../openldr-ce-marketplace/bundles/whonet-narrow/`. Write the PRIVATE key to a gitignored local fixture path under the MAIN repo (e.g. `scripts/.marketplace-keys/whonet.priv` — add to `.gitignore`), NEVER into `../openldr-ce-marketplace`. Print the bundle path.

- [ ] **Step 2: Harness** — `scripts/marketplace-live-acceptance.ts` runs these assertions against internal PG (reset/migrate first), printing PASS/FAIL per step and exiting non-zero on any failure:
  1. `readBundle` + `verifyBundle` → valid; capabilities report shows `emit-fhir: [Patient]`.
  2. install with approval → succeeds; the `plugins` row has `approved_by` set and `manifest.capabilities` persisted; the publisher is pinned in `marketplace_publishers`.
  3. tamper a copy of the bundle manifest → install rejects.
  4. ingest a WHONET sample (reuse `samples/whonet-sample.sqlite` from `e2e:seed`, or `pnpm make:whonet-sample`) through the installed plugin → the batch **fails** AND a `marketplace.capability.violation` (or the emit-fhir rejection surfaced through batch failure) is observable; assert the batch errored on a non-Patient resourceType.
  5. rebuild the bundle with a widened grant (`['Patient','Specimen','Observation','DiagnosticReport']`), `market install` as an update → re-ingest → batch **succeeds** and rows land.
  6. `rollback` to the narrow version → `get` shows the narrow grant active; `disable` → `load` returns nothing; `enable` → restored.

- [ ] **Step 3: package.json scripts** — add:
```json
    "make:marketplace-bundle": "tsx scripts/make-marketplace-bundle.ts",
    "marketplace:accept": "tsx scripts/marketplace-live-acceptance.ts",
```
Add `scripts/.marketplace-keys/` to `.gitignore`.

- [ ] **Step 4: Run the live acceptance** — Prereqs: internal PG up on :5433, `pnpm build:plugins`, `pnpm make:whonet-sample` (or reuse the sample). Then `pnpm make:marketplace-bundle && pnpm marketplace:accept`. Expected: every step prints PASS; exit 0. If a step legitimately can't run in this environment, capture the failure and report it rather than weakening an assertion.

- [ ] **Step 5: Commit** (harness + scripts in the main repo; bundle artifacts are committed in the separate `openldr-ce-marketplace` repo by you, not here)
```bash
git add scripts/marketplace-live-acceptance.ts scripts/make-marketplace-bundle.ts package.json .gitignore
git commit -m "feat(marketplace): live-acceptance harness + bundle builder"
```

---

### Task 12: Full gate + verification

- [ ] **Step 1: Full gate** — `pnpm turbo typecheck lint test build && pnpm depcruise`. Expected: all green. `depcruise` must still pass — `marketplace` now imports `node:fs` (allowed) and `plugins → marketplace` edge remains; confirm no `marketplace → apps` and no new cycle (marketplace must not import `@openldr/plugins`; if the bundle-fs test imported `sha256Hex` from plugins, that's TEST-only — verify it doesn't create a prod cycle, otherwise inline the sha256).
- [ ] **Step 2: Live acceptance** — run `pnpm marketplace:accept` (Task 11 Step 4) and capture the PASS output as the SP-2 "seeing it run" evidence.
- [ ] **Step 3: Commit any fixes.**

---

## Self-Review

**Spec coverage:**
- §4 capability persistence (migration 024 + full artifact manifest in the column + readGrant) → Tasks 1, 2, 4. ✓
- §5 consent (explicit approve, required for publisher artifacts, acknowledged==requested, legacy bypass, drop autoPinFirstUse) → Tasks 4, 8. ✓
- §6 enforcement (emit-fhir fail-closed in converter, net-egress allowedHosts in runner, grant threading, data-scope reserved, back-compat seam) → Tasks 6, 7. ✓
- §7 lifecycle (install active/deactivate, update, rollback, enable/disable, remove, load=active+enabled, lifecycle audit) → Tasks 3, 5. ✓
- §8 market CLI group → Task 10 (+ bundle helpers Task 9). ✓
- §9 live acceptance harness + bundle in openldr-ce-marketplace → Task 11. ✓
- §10 testing → tests in every task. ✓
- §11 verification (gate + marketplace:accept) → Task 12. ✓
- §12 out-of-scope (UI/HTTP API, forms/reports lifecycle, federation, hard memory, authoring CLI) → none built. ✓
- §13 risks (load semantics, legacy manifests, private-key hygiene, autoPinFirstUse removal) → addressed in Tasks 3/4/8/11. ✓

**Placeholder scan:** No TBD/TODO. Task 9/10/11 reference reading existing files (`plugin.ts`, `mssql-live-acceptance.ts`) for the exact pattern and give the precise function list + assertions — concrete, not vague. Live-harness Step 4 gives an explicit fallback (report, don't weaken).

**Type/name consistency:** `PluginStore.install/get/rollback/setEnabled/remove`, `PluginRow` (`enabled/active/approvedBy/manifest`), `PluginInstallInput`, `InstallApproval`/`InstallOptions.approval`, `createWasmConverter(manifest, wasm, runner, logger, grant?)`, `RunOptions.allowedHosts`, `readGrant`/`allowedResourceTypes`/`allowedHosts`, `readBundle`/`verifyBundle`/`Bundle`, audit actions (`marketplace.install/update/rollback/enable/disable/remove/capability.violation`) are used consistently across tasks. Migration `024_plugin_registry` columns (`enabled/active/approved_by/granted_at`) match the `PluginsTable` interface and the store reads/writes.
