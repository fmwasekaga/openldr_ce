# DHIS2 Sink Plugin — SP-3: Connector Store + Secret Encryption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the generic **Connector** persistence layer (L3): AES-256-GCM secret-at-rest encryption in `@openldr/core`, a `SECRETS_ENCRYPTION_KEY` config var, a `connectors` table (migration 033), and `createConnectorStore` in `@openldr/db` with `create/get/list/update/delete/getDecryptedConfig` — `list()`/`get()` never return secrets, and using a secret-bearing connector with the key unset fails closed.

**Architecture:** Connectors are **generic** (bound to any sink `pluginId`), so the store/crypto are reused by every future sink — only DHIS2-specific wiring lives elsewhere. The whole secret config object (`{baseUrl, username, password}`) is sealed into one `config_encrypted` text column; `allowed_host` (derived from the baseUrl) is kept in clear so the host can pin egress without decrypting. Crypto is zero-dep (`node:crypto`) and key-as-argument, so the store stays decoupled from config — the caller (SP-4 bootstrap) passes the key in.

**Tech Stack:** TypeScript, `node:crypto` (AES-256-GCM), zod (config), Kysely + Postgres (migration + store), `pg-mem` + vitest (tests).

---

## Context for the implementer (read first)

This is **SP-3 of 6** in the DHIS2-sink-plugin workstream. Design: `docs/superpowers/specs/2026-06-23-dhis2-sink-plugin-connectors-design.md` (§L3). **SP-1 (sink ABI) + SP-2 (`wasm/dhis2-sink`) are merged; the live wasm HTTP egress blocker is resolved.** SP-3 is **independent of SP-2** (no egress, no wasm) — it's pure TS persistence + crypto. **SP-4** (the next sub-project) consumes this store to resolve a connector → decrypt config → `loadSink` → bind `{config, allowedHosts}`; SP-3 does NOT wire anything into the bootstrap or routes (that's SP-4/SP-5).

**Established patterns to mirror (read for exact style):**
- `packages/core/src/index.ts` + `errors.ts` — barrel export; `OpenLdrError`/`ConfigError` (subclass) already exported. Core is **zero-runtime-dep** beyond pino/ports — `node:crypto` is built-in, so crypto adds no dependency.
- `packages/config/src/schema.ts` — the `ConfigSchema` zod object; add the new var alongside the marketplace/security vars.
- `packages/db/src/migrations/internal/031_workflow_datasets.ts` — migration shape (Kysely `createTable().ifNotExists()...`).
- `packages/db/src/migrations/internal/index.ts` — every migration is imported + registered in `internalMigrations`.
- `packages/db/src/schema/internal.ts` — the `InternalSchema` table-type map; add `ConnectorsTable` + register it.
- `packages/db/src/dhis2-schedule-store.ts` + `.test.ts` — the store CRUD idiom (snake_case row → camelCase record `toRecord`, `Kysely<InternalSchema>`) and the `pg-mem` test via `makeMigratedDb()` (`migrations/internal/test-helpers.ts`, which runs every migration's `up()` including the new 033).
- `packages/db/src/index.ts` — db barrel; add the new store export.

`@openldr/db` already depends on + imports `@openldr/core`, so the store importing `seal`/`open` introduces no new package edge (depcruise stays clean).

---

## File Structure

**Created:**
- `packages/core/src/crypto.ts` — `seal`/`open` (AES-256-GCM) + `parseSecretKey`. Zero-dep.
- `packages/core/src/crypto.test.ts` — round-trip, wrong-key, tamper, key-length tests.
- `packages/db/src/migrations/internal/033_connectors.ts` — the `connectors` table.
- `packages/db/src/connector-store.ts` — `createConnectorStore` + types.
- `packages/db/src/connector-store.test.ts` — pg-mem CRUD + masking + fail-closed tests.

**Modified:**
- `packages/core/src/index.ts` — export `./crypto`.
- `packages/config/src/schema.ts` — add `SECRETS_ENCRYPTION_KEY`.
- `packages/db/src/migrations/internal/index.ts` — import + register `033_connectors`.
- `packages/db/src/schema/internal.ts` — add `ConnectorsTable` + `connectors:` entry.
- `packages/db/src/index.ts` — export `./connector-store`.

---

## Task 1: AES-256-GCM crypto in `@openldr/core`

**Files:**
- Create: `packages/core/src/crypto.ts`, `packages/core/src/crypto.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/crypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, open, parseSecretKey } from './crypto';

const key = randomBytes(32);
const b64Key = key.toString('base64');

describe('crypto (AES-256-GCM)', () => {
  it('round-trips plaintext through seal/open', () => {
    const secret = JSON.stringify({ baseUrl: 'https://dhis2.example', username: 'admin', password: 'p@ss' });
    const blob = seal(secret, key);
    expect(blob).not.toContain('admin'); // ciphertext, not plaintext
    expect(open(blob, key)).toBe(secret);
  });

  it('produces a different blob each time (random IV) but opens to the same plaintext', () => {
    const a = seal('x', key);
    const b = seal('x', key);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe('x');
    expect(open(b, key)).toBe('x');
  });

  it('fails closed on a wrong key', () => {
    const blob = seal('secret', key);
    expect(() => open(blob, randomBytes(32))).toThrow(/decrypt/i);
  });

  it('fails closed on a tampered blob', () => {
    const blob = seal('secret', key);
    const raw = Buffer.from(blob, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip a bit in the auth tag
    expect(() => open(raw.toString('base64'), key)).toThrow(/decrypt/i);
  });

  it('rejects a too-short blob', () => {
    expect(() => open(Buffer.from('short').toString('base64'), key)).toThrow(/too short/i);
  });

  it('parseSecretKey accepts a 32-byte base64 key', () => {
    expect(parseSecretKey(b64Key)).toEqual(key);
  });

  it('parseSecretKey rejects a wrong-length key', () => {
    expect(() => parseSecretKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/core test crypto`
Expected: FAIL — cannot import `./crypto`.

- [ ] **Step 3: Implement `crypto.ts`**

Create `packages/core/src/crypto.ts`:

```ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ConfigError, OpenLdrError } from './errors';

// AES-256-GCM. Packed sealed blob = base64(iv ‖ ciphertext ‖ authTag).
const IV_LEN = 12; // GCM standard 96-bit nonce
const TAG_LEN = 16;

/** Parse a base64-encoded 32-byte AES-256 key. Throws a clear ConfigError otherwise. */
export function parseSecretKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new ConfigError(`SECRETS_ENCRYPTION_KEY must decode to 32 bytes for AES-256 (got ${key.length})`);
  }
  return key;
}

/** Encrypt `plaintext` with AES-256-GCM under `key`; returns base64(iv ‖ ciphertext ‖ tag). */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

/** Inverse of `seal`. Throws on a wrong key or tampered blob (GCM auth failure) — never
 *  returns partial/garbage plaintext. */
export function open(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new OpenLdrError('sealed secret is too short to be valid');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new OpenLdrError('failed to decrypt sealed secret (wrong key or corrupted data)');
  }
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, add after `export * from './errors';`:

```ts
export * from './crypto';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C packages/core test crypto && pnpm -C packages/core typecheck`
Expected: PASS (7 tests), typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/crypto.ts packages/core/src/crypto.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): AES-256-GCM seal/open + parseSecretKey for secrets at rest

Zero-dep (node:crypto). Sealed blob = base64(iv ‖ ciphertext ‖ authTag); open()
fails closed on a wrong key or tampered data. Used by the connector store to
encrypt connection secrets at rest.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `connectors` table (migration 033) + schema type + config var

**Files:**
- Create: `packages/db/src/migrations/internal/033_connectors.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/config/src/schema.ts`

- [ ] **Step 1: Create the migration**

Create `packages/db/src/migrations/internal/033_connectors.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('connectors')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('plugin_id', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull()) // the bound sink plugin's flavor, e.g. 'sink'
    // AES-256-GCM sealed JSON of the secret connection config (baseUrl/username/password).
    .addColumn('config_encrypted', 'text', (c) => c.notNull())
    // Derived from baseUrl, kept in clear so the host can pin egress without decrypting.
    .addColumn('allowed_host', 'text')
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('connectors').ifExists().execute();
}
```

- [ ] **Step 2: Register the migration**

In `packages/db/src/migrations/internal/index.ts`:

(a) Add the import after the `m032` import line:

```ts
import * as m033 from './033_connectors';
```

(b) Add the registry entry after the `'032_workflow_dataset_published'` line (before the closing `};`):

```ts
  '033_connectors': { up: m033.up, down: m033.down },
```

- [ ] **Step 3: Add the schema table type**

In `packages/db/src/schema/internal.ts`:

(a) Add the interface (place it after `WorkflowDatasetsTable`, before `export interface InternalSchema`):

```ts
export interface ConnectorsTable {
  id: string;
  name: string;
  plugin_id: string;
  kind: string;
  config_encrypted: string;
  allowed_host: string | null;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

(b) Register it in `InternalSchema` (add after the `workflow_datasets:` line):

```ts
  connectors: ConnectorsTable;
```

- [ ] **Step 4: Add the config var**

In `packages/config/src/schema.ts`, add inside the `ConfigSchema` object after the `MARKETPLACE_PUBLISH_BRANCH` line (the end of the marketplace block, before the closing `})`):

```ts
    // Secret-at-rest encryption key for dynamic Connectors (base64, decodes to 32 bytes /
    // AES-256). Optional at boot; required only when a secret-bearing connector is
    // created/updated/decrypted — the connector store fails closed with a clear error if
    // it's unset at that point. Never logged (covered by the secrets-redaction boundary).
    SECRETS_ENCRYPTION_KEY: z.string().optional(),
```

- [ ] **Step 5: Verify migration + schema + config compile and the migration runs**

Run: `pnpm -C packages/db typecheck && pnpm -C packages/config typecheck && pnpm -C packages/db test migrations`
Expected: typecheck exit 0 for both; the `migrations` test suite passes (it applies all migrations including 033 and verifies the chain). If `pnpm -C packages/db test migrations` matches no file, run `pnpm -C packages/db test migrations.test` (the suite is `packages/db/src/migrations/migrations.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/033_connectors.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/config/src/schema.ts
git commit -m "$(cat <<'EOF'
feat(db,config): connectors table (migration 033) + SECRETS_ENCRYPTION_KEY

Generic connector persistence: encrypted secret config + clear allowed_host so
egress can be pinned without decrypting. SECRETS_ENCRYPTION_KEY is optional at
boot (fail-closed only when a secret connector is actually used).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `createConnectorStore` in `@openldr/db`

**Files:**
- Create: `packages/db/src/connector-store.ts`, `packages/db/src/connector-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/connector-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createConnectorStore } from './connector-store';

const key = randomBytes(32).toString('base64');
const cfg = { baseUrl: 'https://dhis2.example/dhis', username: 'admin', password: 'district' };

describe('connector store', () => {
  it('creates, lists (masking secrets), and getDecryptedConfig round-trips', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'DHIS2 Demo', pluginId: 'dhis2-sink', kind: 'sink', config: cfg, allowedHost: 'dhis2.example' }, key);

    const list = await store.list();
    expect(list.map((c) => c.id)).toEqual(['c1']);
    // list/get never expose the secret config or the ciphertext.
    expect(list[0]).not.toHaveProperty('config');
    expect(JSON.stringify(list[0])).not.toContain('district');
    expect(list[0]).toMatchObject({ name: 'DHIS2 Demo', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis2.example', enabled: true });

    expect(await store.getDecryptedConfig('c1', key)).toEqual(cfg);
    await db.destroy();
  });

  it('update replaces the sealed config + toggles enabled', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);

    const next = { ...cfg, password: 'rotated' };
    await store.update('c1', { config: next, enabled: false, name: 'renamed' }, key);
    expect(await store.getDecryptedConfig('c1', key)).toEqual(next);
    const r = await store.get('c1');
    expect(r).toMatchObject({ name: 'renamed', enabled: false });
    await db.destroy();
  });

  it('fails closed when the encryption key is unset on create', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await expect(store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, undefined)).rejects.toThrow(/SECRETS_ENCRYPTION_KEY/);
    await db.destroy();
  });

  it('getDecryptedConfig throws on a wrong key', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    await expect(store.getDecryptedConfig('c1', randomBytes(32).toString('base64'))).rejects.toThrow(/decrypt/i);
    await db.destroy();
  });

  it('getDecryptedConfig throws for an unknown connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await expect(store.getDecryptedConfig('nope', key)).rejects.toThrow(/not found/i);
    await db.destroy();
  });

  it('update without a config patch does not require the key', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    await store.update('c1', { enabled: false }, undefined); // no secret touched ⇒ no key needed
    expect((await store.get('c1'))?.enabled).toBe(false);
    await db.destroy();
  });

  it('removes a connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    await store.remove('c1');
    expect(await store.list()).toEqual([]);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/db test connector-store`
Expected: FAIL — cannot import `./connector-store`.

- [ ] **Step 3: Implement `connector-store.ts`**

Create `packages/db/src/connector-store.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import { seal, open, parseSecretKey, ConfigError, OpenLdrError } from '@openldr/core';
import type { InternalSchema } from './schema/internal';

/** A connector as exposed to callers — NEVER carries the secret config. */
export interface ConnectorRecord {
  id: string;
  name: string;
  pluginId: string;
  kind: string;
  allowedHost: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConnector {
  id: string;
  name: string;
  pluginId: string;
  kind: string;
  /** Secret connection config (e.g. { baseUrl, username, password }) — sealed at rest. */
  config: Record<string, string>;
  /** Derived from baseUrl; kept in clear so egress can be pinned without decrypting. */
  allowedHost?: string | null;
}

export interface ConnectorPatch {
  name?: string;
  config?: Record<string, string>;
  allowedHost?: string | null;
  enabled?: boolean;
}

export interface ConnectorStore {
  create(input: NewConnector, key: string | undefined): Promise<void>;
  get(id: string): Promise<ConnectorRecord | null>;
  list(): Promise<ConnectorRecord[]>;
  update(id: string, patch: ConnectorPatch, key: string | undefined): Promise<void>;
  remove(id: string): Promise<void>;
  getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
}

// Columns returned to callers — config_encrypted is deliberately excluded so secrets
// (even ciphertext) never leave the store except via getDecryptedConfig.
const SAFE_COLUMNS = ['id', 'name', 'plugin_id', 'kind', 'allowed_host', 'enabled', 'created_at', 'updated_at'] as const;

function keyOf(key: string | undefined): Buffer {
  if (!key) {
    throw new ConfigError('SECRETS_ENCRYPTION_KEY is required to use secret-bearing connectors but is not set');
  }
  return parseSecretKey(key);
}

function toRecord(r: {
  id: string; name: string; plugin_id: string; kind: string;
  allowed_host: string | null; enabled: boolean; created_at: Date; updated_at: Date;
}): ConnectorRecord {
  return {
    id: r.id, name: r.name, pluginId: r.plugin_id, kind: r.kind,
    allowedHost: r.allowed_host, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createConnectorStore(db: Kysely<InternalSchema>): ConnectorStore {
  return {
    async create(input, key) {
      const sealed = seal(JSON.stringify(input.config), keyOf(key));
      await db.insertInto('connectors').values({
        id: input.id, name: input.name, plugin_id: input.pluginId, kind: input.kind,
        config_encrypted: sealed, allowed_host: input.allowedHost ?? null,
      }).execute();
    },

    async get(id) {
      const r = await db.selectFrom('connectors').select(SAFE_COLUMNS).where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r) : null;
    },

    async list() {
      const rows = await db.selectFrom('connectors').select(SAFE_COLUMNS).orderBy('name').execute();
      return rows.map(toRecord);
    },

    async update(id, patch, key) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.allowedHost !== undefined) set.allowed_host = patch.allowedHost;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      // Only the secret path needs the key — a non-secret patch must not fail closed.
      if (patch.config !== undefined) set.config_encrypted = seal(JSON.stringify(patch.config), keyOf(key));
      await db.updateTable('connectors').set(set).where('id', '=', id).execute();
    },

    async remove(id) {
      await db.deleteFrom('connectors').where('id', '=', id).execute();
    },

    async getDecryptedConfig(id, key) {
      const r = await db.selectFrom('connectors').select('config_encrypted').where('id', '=', id).executeTakeFirst();
      if (!r) throw new OpenLdrError(`connector ${id} not found`);
      return JSON.parse(open(r.config_encrypted, keyOf(key))) as Record<string, string>;
    },
  };
}
```

- [ ] **Step 4: Export from the db barrel**

In `packages/db/src/index.ts`, add at the end:

```ts
export * from './connector-store';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C packages/db test connector-store && pnpm -C packages/db typecheck`
Expected: PASS (7 tests), typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/connector-store.ts packages/db/src/connector-store.test.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(db): createConnectorStore — encrypted connection config, masked reads

create/get/list/update/remove + getDecryptedConfig. list()/get() never return the
secret config (or its ciphertext); the key is required only on the seal/open paths
(fail-closed). Generic across sink plugins.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Turbo gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. If `@openldr/web#test` flakes under turbo concurrency, re-run it isolated (`pnpm -C apps/web test`) and trust that. Never pipe turbo through `tail`.

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: clean. No new cross-package edges (db→core already exists; config gains no import).

- [ ] **Step 3: Final commit (only if anything was adjusted)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(connectors): SP-3 connector store + crypto — gate green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (SP-3 = L3: migration, AES-GCM in core, config var, store):**
- AES-256-GCM `seal`/`open` in `@openldr/core` (zero-dep), packed `iv ‖ ciphertext ‖ authTag`, fail-closed open → Task 1. ✓
- `SECRETS_ENCRYPTION_KEY` config var (base64/32 bytes), optional at boot, fail-closed on use → Task 2 (var) + Task 3 (`keyOf` enforcement). ✓
- `connectors` migration: `{id, name, plugin_id, kind, config_encrypted, allowed_host, enabled, created_at, updated_at}`; whole secret config encrypted; `allowed_host` in clear → Task 2. ✓
- `createConnectorStore` in `@openldr/db`: `create/get/list/update/delete` + `getDecryptedConfig(id, key)`; `list()` masks secrets → Task 3. ✓
- Tests: crypto round-trip; connector store via pg-mem; secret-masking → Tasks 1 + 3. ✓

**Correctly NOT in SP-3 (deferred):** per-connector target resolution / `runMapping` `connectorId` / deleting `adapter-dhis2` = **SP-4**. Connectors UI + `/api/connectors` routes = **SP-5**. SP-3 wires nothing into bootstrap/routes — the store takes the key as an argument, so the SP-4 bootstrap passes `cfg.SECRETS_ENCRYPTION_KEY` in.

**Placeholder scan:** every code block is complete. No TBD/"handle errors"/"similar to".

**Type consistency:** `seal(plaintext, key: Buffer)` / `open(blob, key: Buffer)` / `parseSecretKey(b64): Buffer` are used consistently — the store's `keyOf(key: string|undefined): Buffer` calls `parseSecretKey`, and `seal`/`open` receive that Buffer. `ConnectorRecord` (camelCase, no `config`) ↔ the snake_case row via `toRecord`; `SAFE_COLUMNS` excludes `config_encrypted` so `toRecord`'s input type matches the selected columns. `NewConnector`/`ConnectorPatch`/`ConnectorStore` names are consistent across the store + tests. `ConnectorsTable` columns match the migration columns exactly (`config_encrypted` text, `allowed_host` nullable, `enabled`/`created_at`/`updated_at` Generated).

---

## Notes for execution

- Work on an isolated branch `feat/dhis2-sink-sp3` (merge to local `main`, not pushed — per workstream discipline).
- After SP-3 merges, update the `dhis2-sink-plugin-workstream` memory: SP-3 done (connector store + crypto landed); next is **SP-4** (host rewiring) which resolves a connector → `getDecryptedConfig(cfg.SECRETS_ENCRYPTION_KEY)` → `loadSink(pluginId)` → bind `{config, allowedHosts:[allowed_host]}`, changes `ReportingTargetPort.pushAggregate` to `({rows,mapping,orgUnitMap,period,dryRun})`, threads `connectorId`, and deletes `@openldr/adapter-dhis2`.
- A real `SECRETS_ENCRYPTION_KEY` for dev/prod is generated with `openssl rand -base64 32` (32 raw bytes → base64). Document this when SP-4/SP-5 surface it operationally; SP-3 only needs the var to exist.
