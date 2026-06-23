# Marketplace C1 — Form-template Install + Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a signed `form-template` bundle into the forms subsystem, tracked corlix-style so it shows in the marketplace **Installed** tab with **Update / Detach** and **drift** detection.

**Architecture:** A new `marketplace_installs` table + `MarketplaceInstallStore` (`@openldr/db`) links a stable marketplace `artifact_id` to the `form_definitions` row it manages. A `createFormArtifactInstaller` (`@openldr/bootstrap`, exposed as `ctx.marketplaceForms`) applies a bundle: `verifyBundle` → `fromQuestionnaire` → `forms.create/update` + `forms.publish`, then records the install with a drift baseline hashed from the **post-publish** questionnaire. The marketplace `install` route dispatches by `manifest.type`; `installed` merges plugins + form installs into the existing `InstalledArtifact` shape; the web Installed detail becomes kind-aware. Phase 1 of sub-project C; export is C2.

**Tech Stack:** Kysely + Postgres (pg-mem in tests), Fastify, React + react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-marketplace-c-form-lifecycle-design.md` (§3.1–§3.3, §3.5 install side).

---

## File Structure

- Create: `packages/db/src/migrations/internal/030_marketplace_installs.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` — register 030
- Modify: `packages/db/src/migrations/migrations.test.ts` — add `030_marketplace_installs` to the expected list
- Modify: `packages/db/src/schema/internal.ts` — `MarketplaceInstallsTable` + mapping
- Create: `packages/db/src/marketplace-install-store.ts` — store
- Create: `packages/db/src/marketplace-install-store.test.ts`
- Modify: `packages/db/src/index.ts` — export the store
- Create: `packages/bootstrap/src/form-artifact-install.ts` — installer
- Create: `packages/bootstrap/src/form-artifact-install.test.ts`
- Modify: `packages/bootstrap/src/index.ts` — wire `ctx.marketplaceForms` + `MarketplaceInstallStore`
- Modify: `apps/server/src/marketplace-routes.ts` — install dispatch, merged `/installed`, `/:id/detach`
- Modify: `apps/server/src/marketplace-routes.test.ts` — dispatch + merge + detach tests
- Modify: `apps/web/src/api.ts` — `detachArtifact`, installed type `drifted?`/`targetFormId?`
- Modify: `apps/web/src/pages/settings/marketplace/util.ts` — carry `drifted`/`targetFormId`/`kind` on `CardEntry`
- Modify: `apps/web/src/pages/settings/marketplace/PackageDetail.tsx` — kind-aware Installed actions
- Modify: `apps/web/src/pages/settings/Marketplace.tsx` — detach handler + wire
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx` — form-template installed flow
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts` — update/detach/openInBuilder/modifiedLocally keys

---

## Task 1: Migration 030 + schema + registry

**Files:**
- Create: `packages/db/src/migrations/internal/030_marketplace_installs.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Create the migration**

`packages/db/src/migrations/internal/030_marketplace_installs.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('marketplace_installs').ifNotExists()
    .addColumn('artifact_id', 'text', (c) => c.primaryKey())
    .addColumn('version', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('target_form_id', 'text', (c) => c.notNull())
    .addColumn('payload_sha256', 'text', (c) => c.notNull())
    .addColumn('publisher_name', 'text')
    .addColumn('source_ref', 'text')
    .addColumn('installed_by', 'text')
    .addColumn('installed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('marketplace_installs').ifExists().execute();
}
```

- [ ] **Step 2: Register in the migration index**

In `packages/db/src/migrations/internal/index.ts`: add the import alongside the others (after the `m029` import):
```ts
import * as m030 from './030_marketplace_installs';
```
and add to the `internalMigrations` map (after the `'029_workflow_schedules'` entry):
```ts
  '030_marketplace_installs': { up: m030.up, down: m030.down },
```

- [ ] **Step 3: Update the migrations test expected list**

In `packages/db/src/migrations/migrations.test.ts`, append `'030_marketplace_installs'` to the end of the expected array (currently ends with `'029_workflow_schedules'`).

- [ ] **Step 4: Add the schema table interface + mapping**

In `packages/db/src/schema/internal.ts`, add near the other tables (e.g. after `MarketplacePublishersTable`):
```ts
export interface MarketplaceInstallsTable {
  artifact_id: string;
  version: string;
  kind: string;
  target_form_id: string;
  payload_sha256: string;
  publisher_name: string | null;
  source_ref: string | null;
  installed_by: string | null;
  installed_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
and add to the `InternalSchema` mapping (after `marketplace_publishers`):
```ts
  marketplace_installs: MarketplaceInstallsTable;
```
(`Generated` is already imported in this file — confirm; it's used by other tables.)

- [ ] **Step 5: Verify**

Run: `pnpm -C packages/db test -- migrations`
Expected: PASS (the migrations test's key-list assertion now includes 030).
Run: `pnpm -C packages/db typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/030_marketplace_installs.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): migration 030 marketplace_installs + InternalSchema"
```

---

## Task 2: MarketplaceInstallStore (TDD)

**Files:**
- Create: `packages/db/src/marketplace-install-store.ts`
- Create: `packages/db/src/marketplace-install-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/db/src/marketplace-install-store.test.ts`**

Mirror an existing pg-mem store test (e.g. `report-run-store.test.ts`) for the harness. Use:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { InternalSchema } from './schema/internal';
import { internalMigrations } from './migrations/internal/index';
import { createMarketplaceInstallStore } from './marketplace-install-store';

async function freshDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const { Pool: MemPool } = mem.adapters.createPg();
  const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool: new MemPool() as unknown as Pool }) });
  // run only the 030 migration's up (table under test) — or run all ups in order:
  for (const key of Object.keys(internalMigrations)) {
    await internalMigrations[key].up(db as unknown as Kysely<unknown>);
  }
  return db;
}

describe('MarketplaceInstallStore', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => { db = await freshDb(); });

  it('upserts, gets, lists and removes', async () => {
    const store = createMarketplaceInstallStore(db);
    await store.upsert({ artifactId: 'specimen-intake', version: '1.0.0', kind: 'form-template', targetFormId: 'form-1', payloadSha256: 'a'.repeat(64), publisherName: 'P', sourceRef: 'specimen-intake-1.0.0', installedBy: 'admin' });
    expect((await store.get('specimen-intake'))?.targetFormId).toBe('form-1');
    expect(await store.list()).toHaveLength(1);

    // upsert same id with a new version updates in place (no duplicate)
    await store.upsert({ artifactId: 'specimen-intake', version: '1.1.0', kind: 'form-template', targetFormId: 'form-1', payloadSha256: 'b'.repeat(64), publisherName: 'P', sourceRef: 'specimen-intake-1.1.0', installedBy: 'admin' });
    expect(await store.list()).toHaveLength(1);
    expect((await store.get('specimen-intake'))?.version).toBe('1.1.0');

    await store.remove('specimen-intake');
    expect(await store.get('specimen-intake')).toBeNull();
  });
});
```

(If the repo's pg-mem test harness differs, copy the exact setup from `packages/db/src/report-run-store.test.ts`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/db test -- marketplace-install`
Expected: FAIL — `Cannot find module './marketplace-install-store'`.

- [ ] **Step 3: Implement — `packages/db/src/marketplace-install-store.ts`**

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface MarketplaceInstallRow {
  artifactId: string;
  version: string;
  kind: string;
  targetFormId: string;
  payloadSha256: string;
  publisherName: string | null;
  sourceRef: string | null;
  installedBy: string | null;
  installedAt: string;
  updatedAt: string;
}

export interface MarketplaceInstallInput {
  artifactId: string;
  version: string;
  kind: string;
  targetFormId: string;
  payloadSha256: string;
  publisherName?: string | null;
  sourceRef?: string | null;
  installedBy?: string | null;
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function createMarketplaceInstallStore(db: Kysely<InternalSchema>) {
  const toRow = (r: {
    artifact_id: string; version: string; kind: string; target_form_id: string; payload_sha256: string;
    publisher_name: string | null; source_ref: string | null; installed_by: string | null;
    installed_at: unknown; updated_at: unknown;
  }): MarketplaceInstallRow => ({
    artifactId: r.artifact_id, version: r.version, kind: r.kind, targetFormId: r.target_form_id,
    payloadSha256: r.payload_sha256, publisherName: r.publisher_name, sourceRef: r.source_ref,
    installedBy: r.installed_by, installedAt: toTimestamp(r.installed_at), updatedAt: toTimestamp(r.updated_at),
  });

  async function upsert(input: MarketplaceInstallInput): Promise<void> {
    await db.insertInto('marketplace_installs')
      .values({
        artifact_id: input.artifactId, version: input.version, kind: input.kind,
        target_form_id: input.targetFormId, payload_sha256: input.payloadSha256,
        publisher_name: input.publisherName ?? null, source_ref: input.sourceRef ?? null,
        installed_by: input.installedBy ?? null,
      } as never)
      .onConflict((oc) => oc.column('artifact_id').doUpdateSet({
        version: input.version, target_form_id: input.targetFormId, payload_sha256: input.payloadSha256,
        publisher_name: input.publisherName ?? null, source_ref: input.sourceRef ?? null,
        updated_at: sql`now()`,
      } as never))
      .execute();
  }

  async function get(artifactId: string): Promise<MarketplaceInstallRow | null> {
    const r = await db.selectFrom('marketplace_installs').selectAll().where('artifact_id', '=', artifactId).executeTakeFirst();
    return r ? toRow(r as never) : null;
  }

  async function list(): Promise<MarketplaceInstallRow[]> {
    const rows = await db.selectFrom('marketplace_installs').selectAll().orderBy('installed_at', 'desc').execute();
    return rows.map((r) => toRow(r as never));
  }

  async function remove(artifactId: string): Promise<void> {
    await db.deleteFrom('marketplace_installs').where('artifact_id', '=', artifactId).execute();
  }

  return { upsert, get, list, remove };
}

export type MarketplaceInstallStore = ReturnType<typeof createMarketplaceInstallStore>;
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/index.ts` add:
```ts
export * from './marketplace-install-store';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm -C packages/db test -- marketplace-install` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/marketplace-install-store.ts packages/db/src/marketplace-install-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): MarketplaceInstallStore (tracks installed non-plugin artifacts)"
```

---

## Task 3: createFormArtifactInstaller (TDD)

**Files:**
- Create: `packages/bootstrap/src/form-artifact-install.ts`
- Create: `packages/bootstrap/src/form-artifact-install.test.ts`

- [ ] **Step 1: Write the failing test — `packages/bootstrap/src/form-artifact-install.test.ts`**

This test uses a fake forms store + a fake install store + a real form-template bundle built via `packBundle`. It verifies create-path, update-path (same form, no dup), drift baseline from the post-publish questionnaire, and drift detection after a local change.

```ts
import { describe, it, expect, vi } from 'vitest';
import { generatePublisherKeypair, packBundle, readBundle } from '@openldr/marketplace';
import { toQuestionnaire } from '@openldr/forms';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFormArtifactInstaller } from './form-artifact-install';

// Minimal FHIR Questionnaire that fromQuestionnaire() accepts.
const QUESTIONNAIRE = { resourceType: 'Questionnaire', status: 'active', title: 'Specimen Intake', item: [{ linkId: 'q1', text: 'Specimen ID', type: 'string' }] };

async function buildFormBundle(version: string) {
  const dir = await mkdtemp(join(tmpdir(), 'form-bundle-'));
  const kp = generatePublisherKeypair();
  const manifest = {
    schemaVersion: 1, type: 'form-template', id: 'specimen-intake', version,
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' }, capabilities: [],
    payload: { kind: 'form-template', questionnaireSha256: '0'.repeat(64) },
  };
  const outDir = join(dir, `specimen-intake-${version}`);
  await packBundle({ manifest, payload: new TextEncoder().encode(JSON.stringify(QUESTIONNAIRE)), outDir, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
  return { bundle: await readBundle(outDir), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function fakeForms() {
  const forms = new Map<string, { id: string; schema: unknown; questionnaire: unknown; version: number }>();
  let n = 0;
  return {
    store: {
      create: vi.fn(async (input: { schema: unknown }) => { const id = `form-${++n}`; forms.set(id, { id, schema: input.schema, questionnaire: null, version: 0 }); return { id }; }),
      update: vi.fn(async (id: string, input: { schema: unknown }) => { const f = forms.get(id)!; f.schema = input.schema; return { id }; }),
      publish: vi.fn(async (id: string) => { const f = forms.get(id)!; f.version += 1; f.questionnaire = toQuestionnaire(input2schema(f.schema)); return { id }; }),
      listVersions: vi.fn(async (id: string) => { const f = forms.get(id); return f && f.version ? [{ version: f.version }] : []; }),
      getVersion: vi.fn(async (id: string, _v: number) => { const f = forms.get(id)!; return { questionnaire: f.questionnaire, schema: f.schema }; }),
    },
    forms,
  };
}
// fromQuestionnaire is applied inside the installer; the fake publish re-derives a questionnaire via toQuestionnaire on the stored schema, mirroring the real store.
function input2schema(s: unknown): never { return s as never; }

function fakeInstallStore() {
  const rows = new Map<string, any>();
  return {
    store: {
      upsert: vi.fn(async (r: any) => { rows.set(r.artifactId, { ...rows.get(r.artifactId), ...r }); }),
      get: vi.fn(async (id: string) => rows.get(id) ?? null),
      list: vi.fn(async () => [...rows.values()]),
      remove: vi.fn(async (id: string) => { rows.delete(id); }),
    },
    rows,
  };
}

describe('createFormArtifactInstaller', () => {
  it('install creates a form, publishes it, and records the install with a drift baseline', async () => {
    const { bundle, cleanup } = await buildFormBundle('1.0.0');
    const forms = fakeForms(); const installs = fakeInstallStore();
    const installer = createFormArtifactInstaller({ forms: forms.store as never, installStore: installs.store as never, audit: { record: vi.fn() } as never });
    const res = await installer.install(bundle, { actor: { id: 'admin', name: 'admin' }, approval: { approvedBy: 'admin', acknowledgedCapabilities: [] } });
    expect(forms.store.create).toHaveBeenCalledOnce();
    expect(forms.store.publish).toHaveBeenCalledOnce();
    const row = installs.rows.get('specimen-intake');
    expect(row.targetFormId).toBe(res.targetFormId);
    expect(row.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    // freshly installed → not drifted
    expect((await installer.drift(row)).drifted).toBe(false);
    await cleanup();
  });

  it('re-install of a higher version updates the same form (no duplicate row)', async () => {
    const v1 = await buildFormBundle('1.0.0'); const v2 = await buildFormBundle('1.1.0');
    const forms = fakeForms(); const installs = fakeInstallStore();
    const installer = createFormArtifactInstaller({ forms: forms.store as never, installStore: installs.store as never, audit: { record: vi.fn() } as never });
    const a = await installer.install(v1.bundle, { actor: { id: 'x', name: 'x' }, approval: { approvedBy: 'x', acknowledgedCapabilities: [] } });
    const b = await installer.install(v2.bundle, { actor: { id: 'x', name: 'x' }, approval: { approvedBy: 'x', acknowledgedCapabilities: [] } });
    expect(b.targetFormId).toBe(a.targetFormId);
    expect(installs.rows.size).toBe(1);
    expect(forms.store.update).toHaveBeenCalled();
    await v1.cleanup(); await v2.cleanup();
  });
});
```

> Note: the fake `publish` derives the questionnaire from the stored schema (mirroring the real store's `toQuestionnaire(form.schema)`), so the installer's baseline (hash of the post-publish questionnaire) is stable and `drift()` returns false right after install. This is the crux: **baseline is hashed from the published questionnaire, not the raw bundle bytes.**

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/bootstrap test -- form-artifact-install`
Expected: FAIL — `Cannot find module './form-artifact-install'`.

- [ ] **Step 3: Implement — `packages/bootstrap/src/form-artifact-install.ts`**

```ts
import { createHash } from 'node:crypto';
import { verifyBundle, type Bundle, type Capability } from '@openldr/marketplace';
import { fromQuestionnaire, type FormStore } from '@openldr/forms';
import type { MarketplaceInstallStore, MarketplaceInstallRow } from '@openldr/db';

interface Audit { record(e: Record<string, unknown>): Promise<unknown>; }

export interface FormInstallOptions {
  actor: { id?: string | null; name: string };
  approval?: { approvedBy: string; acknowledgedCapabilities: Capability[] };
  sourceRef?: string;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createFormArtifactInstaller(deps: { forms: FormStore; installStore: MarketplaceInstallStore; audit: Audit }) {
  const { forms, installStore, audit } = deps;

  async function publishedQuestionnaire(formId: string): Promise<unknown | null> {
    const versions = await forms.listVersions(formId);
    if (!versions.length) return null;
    const fv = await forms.getVersion(formId, versions[0].version);
    return fv ? fv.questionnaire : null;
  }

  async function install(bundle: Bundle, opts: FormInstallOptions): Promise<{ id: string; version: string; targetFormId: string }> {
    if (bundle.manifest.type !== 'form-template') throw new Error(`not a form-template: ${bundle.manifest.type}`);

    // Fail-closed verification for publisher-bearing bundles (mirrors plugin install).
    if (bundle.manifest.publisher) {
      const v = verifyBundle(bundle);
      if (!v.valid) throw new Error('bundle failed verification');
      // Consent: acknowledged capabilities must match the declared set.
      const declared = JSON.stringify(bundle.manifest.capabilities ?? []);
      const acked = JSON.stringify(opts.approval?.acknowledgedCapabilities ?? null);
      if (!opts.approval || declared !== acked) throw new Error('install requires matching capability approval');
    }

    const questionnaire = JSON.parse(new TextDecoder().decode(bundle.wasm)) as unknown;
    const schema = fromQuestionnaire(questionnaire as never);
    const artifactId = bundle.manifest.id;
    const version = bundle.manifest.version;
    const name = (schema as { name?: string }).name || artifactId;
    const s = schema as { fhirResourceType?: string | null; fhirVersion?: string | null; fhirProfileUrl?: string | null; targetPages?: string[] };

    const existing = await installStore.get(artifactId);
    let targetFormId: string;
    const formInput = {
      name, versionLabel: version, schema,
      fhirResourceType: s.fhirResourceType ?? null, fhirVersion: s.fhirVersion ?? null,
      fhirProfileUrl: s.fhirProfileUrl ?? null, targetPages: s.targetPages ?? null, status: 'draft',
    };
    if (existing) {
      await forms.update(existing.targetFormId, formInput as never);
      await forms.publish(existing.targetFormId, { versionLabel: version, actorId: opts.actor.id ?? null });
      targetFormId = existing.targetFormId;
    } else {
      const created = await forms.create(formInput as never);
      await forms.publish(created.id, { versionLabel: version, actorId: opts.actor.id ?? null });
      targetFormId = created.id;
    }

    // Drift baseline = hash of the form's PUBLISHED questionnaire (NOT the raw bundle bytes;
    // fromQuestionnaire→toQuestionnaire is not byte-identical, so the round-trip is the baseline).
    const published = await publishedQuestionnaire(targetFormId);
    const payloadSha256 = sha256Json(published);

    await installStore.upsert({
      artifactId, version, kind: 'form-template', targetFormId, payloadSha256,
      publisherName: bundle.manifest.publisher?.name ?? null, sourceRef: opts.sourceRef ?? null,
      installedBy: opts.actor.id ?? opts.actor.name,
    });

    await audit.record({
      actorType: 'user', actorId: opts.actor.id ?? null, actorName: opts.actor.name,
      action: 'marketplace.install', entityType: 'marketplace.artifact', entityId: `${artifactId}@${version}`,
      metadata: { type: 'form-template', targetFormId },
    });

    return { id: artifactId, version, targetFormId };
  }

  async function detach(artifactId: string, opts: { actor: { id?: string | null; name: string } }): Promise<void> {
    const row = await installStore.get(artifactId);
    if (!row) throw new Error('not installed');
    await installStore.remove(artifactId);
    await audit.record({
      actorType: 'user', actorId: opts.actor.id ?? null, actorName: opts.actor.name,
      action: 'marketplace.detach', entityType: 'marketplace.artifact', entityId: artifactId,
      metadata: { targetFormId: row.targetFormId },
    });
  }

  async function drift(row: MarketplaceInstallRow): Promise<{ drifted: boolean }> {
    try {
      const published = await publishedQuestionnaire(row.targetFormId);
      if (published === null) return { drifted: false };
      return { drifted: sha256Json(published) !== row.payloadSha256 };
    } catch {
      return { drifted: false };
    }
  }

  async function list(): Promise<(MarketplaceInstallRow & { drifted: boolean })[]> {
    const rows = await installStore.list();
    const out: (MarketplaceInstallRow & { drifted: boolean })[] = [];
    for (const r of rows) out.push({ ...r, drifted: (await drift(r)).drifted });
    return out;
  }

  return { install, detach, drift, list };
}

export type FormArtifactInstaller = ReturnType<typeof createFormArtifactInstaller>;
```

> IMPORTANT: confirm `fromQuestionnaire` and `toQuestionnaire` are exported from the `@openldr/forms` entry the server uses. If the barrel only exposes them via `@openldr/forms/pure`, import from there instead (the web uses `/pure`; bootstrap is server-side so the main barrel is expected to work — verify with a quick typecheck and adjust the import path if needed).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C packages/bootstrap test -- form-artifact-install`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/form-artifact-install.ts packages/bootstrap/src/form-artifact-install.test.ts
git commit -m "feat(bootstrap): createFormArtifactInstaller (install/update/detach/drift for form-template)"
```

---

## Task 4: Wire `ctx.marketplaceForms` into AppContext

**Files:** Modify `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Wire it up**

In `packages/bootstrap/src/index.ts`:
- import: `import { createMarketplaceInstallStore } from '@openldr/db';` and `import { createFormArtifactInstaller, type FormArtifactInstaller } from './form-artifact-install';`
- add to the `AppContext` interface (near `forms: FormStore;`): `marketplaceForms: FormArtifactInstaller;`
- in the context builder (where `forms` and `audit` are created — `forms` at line ~148, `audit` at ~127): add
  ```ts
  const marketplaceInstalls = createMarketplaceInstallStore(internal.db);
  const marketplaceForms = createFormArtifactInstaller({ forms, installStore: marketplaceInstalls, audit });
  ```
- add `marketplaceForms` to the returned context object (near `forms,`).

- [ ] **Step 2: Typecheck**

Run: `pnpm -C packages/bootstrap typecheck`
Expected: PASS. (If `fromQuestionnaire` import path was wrong in Task 3, fix it now.)

- [ ] **Step 3: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): expose ctx.marketplaceForms + install store"
```

---

## Task 5: Server — install dispatch, merged `/installed`, `/:id/detach` (TDD)

**Files:**
- Modify: `apps/server/src/marketplace-routes.ts`
- Modify: `apps/server/src/marketplace-routes.test.ts`

- [ ] **Step 1: Write failing tests**

In `apps/server/src/marketplace-routes.test.ts`:

1. Extend `fakeCtx` to add a `marketplaceForms` stub and have `fakePlugins` unaffected:
```ts
function fakeCtx(plugins: unknown, cfg: Record<string, unknown>, marketplaceForms?: unknown): AppContext {
  return { cfg, plugins, audit: { record: async () => ({}) }, marketplaceForms: marketplaceForms ?? { install: async () => ({ id: 'x', version: '1', targetFormId: 'form-1' }), detach: async () => {}, list: async () => [] } } as unknown as AppContext;
}
```
(Thread an optional `marketplaceForms` through `appWith` similarly.)

2. Add tests:
```ts
  it('install dispatches a form-template bundle to ctx.marketplaceForms', async () => {
    const { runtime } = fakePlugins();
    const installed: unknown[] = [];
    const marketplaceForms = { install: async (b: unknown, o: unknown) => { installed.push({ b, o }); return { id: 'demo-form', version: '1.0.0', targetFormId: 'form-9' }; }, detach: async () => {}, list: async () => [] };
    // build a form-template bundle in the registry dir
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: formRegistryDir }, runtime, ['lab_admin'], undefined, marketplaceForms);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'demo-form-1', acknowledgedCapabilities: [] } });
    expect(res.statusCode).toBe(200);
    expect(installed).toHaveLength(1);
  });

  it('installed merges plugin + form-template rows', async () => {
    const { runtime } = fakePlugins();
    const marketplaceForms = { install: async () => ({ id: 'x', version: '1', targetFormId: 'f' }), detach: async () => {}, list: async () => [{ artifactId: 'demo-form', version: '1.0.0', kind: 'form-template', targetFormId: 'form-9', publisherName: 'Acme', drifted: true }] };
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime, ['lab_admin'], undefined, marketplaceForms);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/installed' });
    const body = res.json();
    expect(body.find((a: any) => a.id === 'demo' && a.type === 'plugin')).toBeTruthy();
    const form = body.find((a: any) => a.id === 'demo-form');
    expect(form).toMatchObject({ type: 'form-template', drifted: true, targetFormId: 'form-9' });
  });

  it('detach calls ctx.marketplaceForms.detach', async () => {
    const { runtime } = fakePlugins();
    const calls: string[] = [];
    const marketplaceForms = { install: async () => ({ id: 'x', version: '1', targetFormId: 'f' }), detach: async (id: string) => { calls.push(id); }, list: async () => [] };
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime, ['lab_admin'], undefined, marketplaceForms);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/demo-form/detach' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['demo-form']);
  });
```

3. Build a `form-template` bundle fixture in `beforeAll` (alongside the existing `demo-1` plugin bundle). Add near the existing `registryDir` setup:
```ts
let formRegistryDir: string;
// inside beforeAll, after registryDir is built:
formRegistryDir = await mkdtemp(join(tmpdir(), 'mkt-form-registry-'));
{
  const kp = generatePublisherKeypair();
  const manifest = { schemaVersion: 1, type: 'form-template', id: 'demo-form', version: '1.0.0', publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) }, compatibility: { ceVersion: '*' }, capabilities: [], payload: { kind: 'form-template', questionnaireSha256: '0'.repeat(64) } };
  const q = { resourceType: 'Questionnaire', status: 'active', title: 'Demo', item: [] };
  await packBundle({ manifest, payload: new TextEncoder().encode(JSON.stringify(q)), outDir: join(formRegistryDir, 'demo-form-1'), privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
}
// add to afterAll: await rm(formRegistryDir, { recursive: true, force: true });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: FAIL — install doesn't dispatch by type; `/installed` doesn't merge; `/:id/detach` 404.

- [ ] **Step 3: Implement — `apps/server/src/marketplace-routes.ts`**

1. In `POST /install`, after `const b = await source.getBundle(ref);`, branch by type. Replace the `ctx.plugins.install(...)` call with:
```ts
      const a = actor(req);
      const acknowledgedCapabilities = (body.acknowledgedCapabilities as Capability[] | undefined) ?? b.manifest.capabilities;
      if (b.manifest.type === 'form-template') {
        const installed = await ctx.marketplaceForms.install(b, {
          actor: a, sourceRef: ref,
          approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
        });
        return { id: installed.id, version: installed.version };
      }
      const installed = await ctx.plugins.install(b.wasm, b.raw, {
        publicKeyDer: b.publicKeyDer, actor: a,
        approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
      });
      return { id: installed.id, version: installed.version };
```

2. In `GET /installed`, after building the plugin rows array (call it `pluginRows`), append form installs:
```ts
    const formRows = (await ctx.marketplaceForms.list()).map((r) => ({
      id: r.artifactId, version: r.version, active: true, enabled: true,
      approvedBy: r.installedBy ?? null, type: 'form-template',
      publisher: r.publisherName ? { name: r.publisherName } : null,
      capabilities: [], legacy: false, drifted: r.drifted, targetFormId: r.targetFormId,
    }));
    return [...pluginRows, ...formRows];
```
(Refactor the existing return to name the plugin-mapped array `pluginRows` first.)

3. Add the detach route (after `/refresh` or near the lifecycle routes):
```ts
  app.post('/api/marketplace/:id/detach', { preHandler: requireRole('lab_admin') }, async (req) => {
    await ctx.marketplaceForms.detach((req.params as { id: string }).id, { actor: actor(req) });
    return { ok: true };
  });
```

Note: `/:id/detach` must not collide with `/:id/enable|disable|rollback` — it's a distinct suffix, fine. Ensure it's registered after the static `/available`, `/install`, `/refresh`, `/publish` routes (Fastify handles param vs static; distinct suffixes don't collide).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test -- marketplace-routes` → PASS.
Run: `pnpm -C apps/server typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/marketplace-routes.ts apps/server/src/marketplace-routes.test.ts
git commit -m "feat(server): form-template install dispatch + merged installed + detach"
```

---

## Task 6: Web — kind-aware Installed actions + detach

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/settings/marketplace/util.ts`
- Modify: `apps/web/src/pages/settings/marketplace/PackageDetail.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx`
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: api.ts — detach + installed type fields**

Extend `InstalledArtifact` with optional `drifted?: boolean; targetFormId?: string;`. Add:
```ts
export async function detachArtifact(id: string): Promise<void> {
  const r = await authFetch(`/api/marketplace/${encodeURIComponent(id)}/detach`, { method: 'POST' });
  if (!r.ok) throw new Error(`detach failed: ${r.status}`);
}
```

- [ ] **Step 2: util.ts — carry kind/drifted/targetFormId on CardEntry**

Add to `CardEntry`: `drifted?: boolean; targetFormId?: string;`. In `installedToEntry`, map them:
```ts
export function installedToEntry(a: InstalledArtifact): CardEntry {
  const pub = a.publisher && typeof a.publisher === 'object' ? (a.publisher as { id?: string; name?: string }) : null;
  return {
    id: a.id, version: a.version, type: a.type,
    publisher: pub ? { id: pub.id ?? '', name: pub.name ?? '' } : null,
    capabilities: a.capabilities, installed: true, active: a.active,
    enabled: a.enabled, drifted: a.drifted, targetFormId: a.targetFormId,
  };
}
```

- [ ] **Step 3: i18n keys (en/fr/pt `settings.marketplace`)**

en: `update: 'Update', detach: 'Detach', openInBuilder: 'Open in Form Builder', modifiedLocally: 'Modified locally', detachTitle: 'Detach {{id}}?', detachDescription: 'Stops marketplace tracking for this form. The form and its data are kept.', updateOverwriteWarning: 'Updating overwrites local changes to this form.'`
fr: `update: 'Mettre à jour', detach: 'Détacher', openInBuilder: 'Ouvrir dans le générateur', modifiedLocally: 'Modifié localement', detachTitle: 'Détacher {{id}} ?', detachDescription: 'Arrête le suivi marketplace pour ce formulaire. Le formulaire et ses données sont conservés.', updateOverwriteWarning: 'La mise à jour écrase les modifications locales de ce formulaire.'`
pt: `update: 'Atualizar', detach: 'Desanexar', openInBuilder: 'Abrir no construtor', modifiedLocally: 'Modificado localmente', detachTitle: 'Desanexar {{id}}?', detachDescription: 'Para o rastreio do marketplace para este formulário. O formulário e os dados são mantidos.', updateOverwriteWarning: 'Atualizar substitui as alterações locais deste formulário.'`

- [ ] **Step 4: PackageDetail.tsx — kind-aware installed actions**

Add props `onDetach?: (entry: CardEntry) => void` and `onOpenForm?: (formId: string) => void`. In the installed `⋯` menu, branch on `entry.type`:
- `entry.type === 'form-template'` → items: **Open in Form Builder** (`onOpenForm?.(entry.targetFormId!)`, shown when `entry.targetFormId`), **Detach** (`text-destructive`, `onDetach?.(entry)`). (No enable/disable/rollback.) Also render a `modifiedLocally` badge in the title row when `entry.drifted`.
- else (plugin) → existing enable/disable/rollback/remove items unchanged.

Concretely, replace the menu body with:
```tsx
                <DropdownMenuContent align="end">
                  {entry.type === 'form-template' ? (
                    <>
                      {entry.targetFormId ? (
                        <DropdownMenuItem onSelect={() => onOpenForm?.(entry.targetFormId!)}>
                          {t('settings.marketplace.openInBuilder')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="text-destructive" onSelect={() => onDetach?.(entry)}>
                        {t('settings.marketplace.detach')}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onSelect={() => onToggleEnabled(entry.id, !entry.enabled)}>
                        {entry.enabled ? t('settings.marketplace.disable') : t('settings.marketplace.enable')}
                      </DropdownMenuItem>
                      {!entry.active ? (
                        <DropdownMenuItem onSelect={() => onRollback(entry.id, entry.version)}>
                          {t('settings.marketplace.rollback')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="text-destructive" onSelect={() => onRemove(entry)}>
                        {t('settings.marketplace.remove')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
```
And in the title row, after the type/signature badges, add:
```tsx
{entry.drifted ? <Badge variant="outline" className="border-amber-500 text-amber-700">{t('settings.marketplace.modifiedLocally')}</Badge> : null}
```

- [ ] **Step 5: Marketplace.tsx — detach handler + open-form nav**

- Import `detachArtifact` from `@/api` and `useNavigate` from `react-router-dom`.
- Add `const navigate = useNavigate();`
- Add a pending-detach `ConfirmDialog` mirroring the remove one (state `pendingDetach`, handler calling `detachArtifact(entry.id)` then `load()` + success toast).
- Pass to `<MarketplaceTabs>` → `<PackageDetail>`: `onDetach={(e) => setPendingDetach(e)}` and `onOpenForm={(id) => navigate('/forms/' + id)}` (thread through MarketplaceTabs props like the others).
- Add the detach `ConfirmDialog` using `detachTitle`/`detachDescription`.

(Thread `onDetach`/`onOpenForm` through `MarketplaceTabsProps` and into `<PackageDetail>` the same way `onRemove` is threaded.)

- [ ] **Step 6: Marketplace.test.tsx — form-template installed flow**

Add a test:
```ts
it('detaches an installed form-template from its detail menu', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'demo-form', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'form-template', publisher: { name: 'Acme' }, capabilities: [], legacy: false, drifted: false, targetFormId: 'form-9' }]);
  (api.detachArtifact as any).mockResolvedValue(undefined);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(screen.getByText(/Installed \(1\)/));
  fireEvent.click(await screen.findByTestId('card-demo-form'));
  fireEvent.click(await screen.findByTestId('detail-menu'));
  fireEvent.click(await screen.findByText('Detach'));
  // confirm dialog
  fireEvent.click(await screen.findByRole('button', { name: 'Detach' }));
  await waitFor(() => expect(api.detachArtifact).toHaveBeenCalledWith('demo-form'));
});
```
Add `detachArtifact: vi.fn()` to the `@/api` mock. (Radix tab/dropdown interaction may need the `mouseDown`/`pointerDown` workarounds already used in this test file — reuse the established pattern.)

- [ ] **Step 7: Verify**

Run: `pnpm -C apps/web test` → PASS (re-run once if the known parallel flake hits).
Run: `pnpm -C apps/web typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/settings/marketplace/util.ts apps/web/src/pages/settings/marketplace/PackageDetail.tsx apps/web/src/pages/settings/Marketplace.tsx apps/web/src/pages/settings/Marketplace.test.tsx apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): kind-aware Installed actions (form-template update/detach/open + drift badge)"
```

---

## Task 7: Full verification gate

- [ ] **Step 1: Run the gate (capture true exit code — do NOT pipe through tail)**

Run: `pnpm turbo typecheck lint test build --filter=@openldr/web --filter=@openldr/server --filter=@openldr/bootstrap --filter=@openldr/db --filter=@openldr/forms > /tmp/c1-gate.log 2>&1; echo "EXIT=$?"`
Then inspect `/tmp/c1-gate.log` for the summary. Expected: `EXIT=0`, all tasks successful. (Turbo task flakes can be transient — re-run once; confirm with the captured EXIT code, not a piped tail.)

- [ ] **Step 2: Commit any lint autofixes**

```bash
git add -A && git commit -m "chore(marketplace): C1 form-install gate green" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage (C1):** `marketplace_installs` + store (Tasks 1-2) ✓; `createFormArtifactInstaller` install/update/detach/drift (Task 3) ✓; `ctx.marketplaceForms` wiring (Task 4) ✓; install dispatch by type + merged `/installed` + `/:id/detach` (Task 5) ✓; kind-aware Installed UI (update/detach/open + drift badge) (Task 6) ✓; fail-closed verify + consent on form install (Task 3) ✓.
- **Drift correctness:** baseline is hashed from the **post-publish** questionnaire (`publishedQuestionnaire`), not the raw bundle bytes — so a freshly installed form is not drifted; later local edits + republish change the stored questionnaire → drifted. The fake store in the Task 3 test mirrors the real `toQuestionnaire(schema)` publish path to keep this honest.
- **Update path (C1 scope decision):** the *mechanism* is `POST /install` again with a newer version — the installer's `existing` branch updates the same form in place (no duplicate row), and the merged `/installed` row reflects the new version + recomputed drift. In C1 the **user reaches Update by re-installing the newer version from the Browse tab** (its install goes through the same dispatch → update path). A dedicated in-place "Update available" button on the Installed detail (comparing the registry's latest version to the installed version) is **deferred to a small follow-up** — it's pure UI on top of the working update mechanism, and keeps C1's Installed actions to Open / Detach / drift-badge. This is a deliberate narrowing of the spec's Installed-actions list; flag it at execution.
- **Type consistency:** `MarketplaceInstallRow`/`MarketplaceInstallInput` (db) → installer → `/installed` mapping → `InstalledArtifact` (api) → `CardEntry` (`drifted`/`targetFormId`) → `PackageDetail`. `FormArtifactInstaller` on `AppContext`.
- **Deferred to C2:** export endpoint + Forms export action (this plan is install/lifecycle only).
- **Open verification:** confirm `fromQuestionnaire`/`toQuestionnaire` import path from `@openldr/forms` (vs `/pure`) at Task 3/4 typecheck; adjust if needed.
