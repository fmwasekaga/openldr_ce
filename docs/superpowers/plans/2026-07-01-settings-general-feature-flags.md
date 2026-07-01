# Settings → General + Feature-Flags Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic DB-backed feature-flags/app-settings store, move `DASHBOARD_SQL_ENABLED` from an env var to a live admin toggle (default off), and add a Settings → General page (About + Feature Flags + Danger Zone: reset-dashboards, factory-reset, clear-audit).

**Architecture:** A new `app_settings` table + `createAppSettingsStore` (packages/db). A declarative flag registry in `@openldr/config`. A `createFeatureFlags` service (packages/bootstrap) that merges registry defaults + stored overrides behind a tiny invalidate-on-set cache, surfaced on `AppContext.featureFlags`. The 3 SQL-gate read-sites read `await ctx.featureFlags.get('dashboard.raw_sql')` instead of `cfg.DASHBOARD_SQL_ENABLED`. The danger-zone orchestrations (`dangerResetDashboards`/`dangerFactoryReset`/`dangerClearAudit`) live in `@openldr/bootstrap` so the HTTP route AND the CLI run identical code. New `settings-routes.ts` exposes admin flag GET/PUT + 3 danger-zone POSTs (audited); the CLI gains an `openldr settings` group for the same operations (headless operator parity). The Studio `General.tsx` page reads `/config` + `/api/settings/flags`, toggles flags (refetching `/config`), and fires danger actions through the existing `DangerConfirmDialog`.

**Tech Stack:** TypeScript, Fastify, Kysely (Postgres internal DB), Vitest, React + react-i18next + shadcn-style UI (`apps/studio`).

**Source of truth:** [2026-07-01-settings-general-feature-flags-design.md](../specs/2026-07-01-settings-general-feature-flags-design.md).

---

## Key facts (verified against the codebase)

- **Internal DB** = `INTERNAL_DATABASE_URL` (Kysely `InternalSchema`, surfaced as `ctx.internalDb`). **External target store** = `TARGET_DATABASE_URL`. All Danger Zone actions touch the **internal DB only**.
- Latest internal migration is `037_connectors_host_type`; new one is **`038_app_settings`**.
- `AppContext` is defined in `packages/bootstrap/src/index.ts` (interface ~L111-157, built in `createAppContext` ~L159+). `cfg: Config` is on it.
- Server route tests use `Fastify()` + `app.inject()` with an in-memory **fake ctx** (see `apps/server/src/dashboards-routes.test.ts`, `config-route.test.ts`). No live DB in unit tests.
- Typed-confirmation dialog already exists: `apps/studio/src/terminology/DangerConfirmDialog.tsx` (props: `open, onOpenChange, title, confirmName, confirmLabel, summary, onConfirm`).
- Audit: `recordAudit(ctx, req, { action, entityType, entityId, metadata })` from `apps/server/src/audit-helper.ts`. `requireRole('lab_admin')` from `apps/server/src/rbac.ts`.
- `/settings` is already gated `RequireRole role="lab_admin"` in `App.tsx:34`, so the General page is admin-only (see **Deviation from spec** below).
- Seed: `seedDatabase(dbCtx, ctx)` where `dbCtx = await createDbContext(cfg)` and `ctx` is the AppContext (`apps/server/src/index.ts:56-64`). `seedDefaultDashboard(store)` from `@openldr/dashboards`.
- Root `package.json` version = `0.1.0`. `/health` already returns backing-service status via `ctx.health.runAll()`.

## Settings gating (resolved per user)

About must be visible to **all authenticated users** (so any user can report the version they're running); Feature Flags + Danger Zone stay **`lab_admin`-only**, gated in-page. Today the whole `/settings` route + every sub-nav item is `lab_admin`-only, so this plan **relaxes the gating for the General page only**:
- The `/settings` parent route drops the blanket `lab_admin` gate → `<RequireRole>` (authenticated, any role). Its children `connectors`/`marketplace` **keep** their own `RequireRole role="lab_admin"`, so those remain admin-only even by direct URL.
- The `general` sub-nav item has **no `roles`** (visible to everyone); `connectors`/`marketplace` stay `lab_admin` (filtered out of the nav for non-admins).
- In `General.tsx`, the **About** card always renders; the **Feature Flags** + **Danger Zone** cards render only when `hasRole('lab_admin')`, and the admin-only `/api/settings/flags` fetch is skipped for non-admins (it would 403).

---

## Task 1: `app_settings` migration + schema type

**Files:**
- Create: `packages/db/src/migrations/internal/038_app_settings.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the migration**

Create `packages/db/src/migrations/internal/038_app_settings.ts` (mirrors `035_plugin_data.ts`):

```typescript
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_settings')
    .ifNotExists()
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('app_settings').ifExists().execute();
}
```

- [ ] **Step 2: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import after the `m037` import and the entry after the `037_connectors_host_type` entry:

```typescript
import * as m038 from './038_app_settings';
```
```typescript
  '037_connectors_host_type': { up: m037.up, down: m037.down },
  '038_app_settings': { up: m038.up, down: m038.down },
```

- [ ] **Step 3: Add the Kysely table type**

In `packages/db/src/schema/internal.ts`, add the table interface (near the other `*Table` interfaces; `Generated` is already imported by that file — confirm and add to the import if missing):

```typescript
export interface AppSettingsTable {
  key: string;
  value: string;
  updated_at: Generated<Date>;
  updated_by: string | null;
}
```

Then add to the `InternalSchema` interface (with the other table members, e.g. after `plugin_data`):

```typescript
  app_settings: AppSettingsTable;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -C packages/db typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/038_app_settings.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): app_settings table (migration 038) + schema type"
```

---

## Task 2: `createAppSettingsStore`

**Files:**
- Create: `packages/db/src/app-settings-store.ts`
- Modify: `packages/db/src/index.ts` (barrel export)

- [ ] **Step 1: Write the store**

Create `packages/db/src/app-settings-store.ts` (mirrors `plugin-data-store.ts` upsert pattern):

```typescript
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface AppSettingRecord {
  key: string;
  value: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AppSettingStore {
  get(key: string): Promise<AppSettingRecord | null>;
  getAll(): Promise<AppSettingRecord[]>;
  set(key: string, value: string, updatedBy: string | null): Promise<void>;
}

export function createAppSettingsStore(db: Kysely<InternalSchema>): AppSettingStore {
  const toRecord = (r: { key: string; value: string; updated_at: Date; updated_by: string | null }): AppSettingRecord => ({
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  });
  return {
    async get(key) {
      const r = await db.selectFrom('app_settings').selectAll().where('key', '=', key).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async getAll() {
      const rows = await db.selectFrom('app_settings').selectAll().orderBy('key').execute();
      return rows.map(toRecord);
    },
    async set(key, value, updatedBy) {
      await db
        .insertInto('app_settings')
        .values({ key, value, updated_by: updatedBy, updated_at: sql`now()` as never })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_by: updatedBy, updated_at: sql`now()` as never }))
        .execute();
    },
  };
}
```

- [ ] **Step 2: Export from the barrel**

In `packages/db/src/index.ts`, add an export line next to the other `*-store` exports:

```typescript
export * from './app-settings-store';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C packages/db typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/app-settings-store.ts packages/db/src/index.ts
git commit -m "feat(db): createAppSettingsStore (get/getAll/set upsert)"
```

---

## Task 3: Feature-flag registry (`@openldr/config`)

**Files:**
- Create: `packages/config/src/feature-flags.ts`
- Create: `packages/config/src/feature-flags.test.ts`
- Modify: `packages/config/src/index.ts` (barrel export)

- [ ] **Step 1: Write the failing test**

Create `packages/config/src/feature-flags.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, getFlagDefinition, parseFlagValue } from './feature-flags';

describe('feature-flags registry', () => {
  it('includes dashboard.raw_sql defaulting to false', () => {
    const def = getFlagDefinition('dashboard.raw_sql');
    expect(def).toBeDefined();
    expect(def?.default).toBe(false);
  });

  it('every flag has stable id/labelKey/descriptionKey', () => {
    for (const f of FEATURE_FLAGS) {
      expect(typeof f.id).toBe('string');
      expect(f.labelKey.length).toBeGreaterThan(0);
      expect(f.descriptionKey.length).toBeGreaterThan(0);
      expect(typeof f.default).toBe('boolean');
    }
  });

  it('parseFlagValue coerces stored strings and falls back to the default', () => {
    expect(parseFlagValue('true', false)).toBe(true);
    expect(parseFlagValue('false', true)).toBe(false);
    expect(parseFlagValue(undefined, true)).toBe(true);
    expect(parseFlagValue(undefined, false)).toBe(false);
    expect(parseFlagValue('garbage', true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/config test -- feature-flags`
Expected: FAIL ("Cannot find module './feature-flags'").

- [ ] **Step 3: Write the registry**

Create `packages/config/src/feature-flags.ts`:

```typescript
/**
 * Declarative registry of admin-toggleable feature flags. Adding a flag here wires it into
 * both the DB seed (defaults) and the Settings → General Feature-Flags UI (label/description
 * are i18n keys resolved in apps/studio). Values live in the `app_settings` table keyed by id.
 */
export interface FeatureFlagDefinition {
  /** Stable key stored in app_settings.key. */
  id: string;
  /** i18n key for the human label (resolved in apps/studio). */
  labelKey: string;
  /** i18n key for the description of what enabling does. */
  descriptionKey: string;
  /** Default when no stored override exists. */
  default: boolean;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: 'dashboard.raw_sql',
    labelKey: 'settings.general.flags.dashboardRawSql.label',
    descriptionKey: 'settings.general.flags.dashboardRawSql.description',
    default: false,
  },
];

export type FeatureFlagId = (typeof FEATURE_FLAGS)[number]['id'];

export function getFlagDefinition(id: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAGS.find((f) => f.id === id);
}

/** Coerce a stored string value to boolean; unknown/absent falls back to `def`. */
export function parseFlagValue(value: string | undefined | null, def: boolean): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return def;
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/config/src/index.ts`, add:

```typescript
export * from './feature-flags';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/config test -- feature-flags`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/feature-flags.ts packages/config/src/feature-flags.test.ts packages/config/src/index.ts
git commit -m "feat(config): declarative feature-flags registry (dashboard.raw_sql)"
```

---

## Task 4: `createFeatureFlags` service (packages/bootstrap)

**Files:**
- Create: `packages/bootstrap/src/feature-flags.ts`
- Create: `packages/bootstrap/src/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/feature-flags.test.ts` (in-memory fake store — no DB):

```typescript
import { describe, it, expect } from 'vitest';
import { createFeatureFlags } from './feature-flags';
import type { AppSettingStore, AppSettingRecord } from '@openldr/db';

function fakeStore(): AppSettingStore & { calls: number } {
  const map = new Map<string, AppSettingRecord>();
  const s = {
    calls: 0,
    async get(key: string) { s.calls++; return map.get(key) ?? null; },
    async getAll() { return [...map.values()]; },
    async set(key: string, value: string, updatedBy: string | null) {
      map.set(key, { key, value, updatedAt: new Date(0), updatedBy });
    },
  };
  return s as AppSettingStore & { calls: number };
}

describe('createFeatureFlags', () => {
  it('returns the registry default when unset', async () => {
    const ff = createFeatureFlags(fakeStore());
    expect(await ff.get('dashboard.raw_sql')).toBe(false);
  });

  it('reflects a stored override after set + invalidate', async () => {
    const store = fakeStore();
    const ff = createFeatureFlags(store);
    await ff.set('dashboard.raw_sql', true, 'admin');
    expect(await ff.get('dashboard.raw_sql')).toBe(true);
  });

  it('all() merges registry defaults with stored overrides', async () => {
    const store = fakeStore();
    const ff = createFeatureFlags(store);
    await ff.set('dashboard.raw_sql', true, 'admin');
    const all = await ff.all();
    const flag = all.find((f) => f.id === 'dashboard.raw_sql');
    expect(flag?.value).toBe(true);
    expect(flag?.labelKey).toBe('settings.general.flags.dashboardRawSql.label');
  });

  it('caches reads within the TTL and re-reads after set invalidates', async () => {
    const store = fakeStore();
    const ff = createFeatureFlags(store);
    await ff.get('dashboard.raw_sql');
    await ff.get('dashboard.raw_sql');
    expect(store.calls).toBe(1); // second read served from cache
    await ff.set('dashboard.raw_sql', true, 'admin'); // invalidates
    expect(await ff.get('dashboard.raw_sql')).toBe(true);
    expect(store.calls).toBe(2); // re-read after invalidation
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap test -- feature-flags`
Expected: FAIL ("Cannot find module './feature-flags'").

- [ ] **Step 3: Write the service**

Create `packages/bootstrap/src/feature-flags.ts`:

```typescript
import { FEATURE_FLAGS, getFlagDefinition, parseFlagValue } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

export interface ResolvedFlag {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: boolean;
}

export interface FeatureFlags {
  /** Boolean value of a flag: stored override, else registry default. Cached (5s TTL). */
  get(id: string): Promise<boolean>;
  /** All registry flags merged with stored overrides (for the admin UI). */
  all(): Promise<ResolvedFlag[]>;
  /** Persist a flag value (audited by the caller) and invalidate the cache. */
  set(id: string, value: boolean, actor: string | null): Promise<void>;
  /** Force the next read to hit the store. */
  invalidate(): void;
}

const TTL_MS = 5000;

export function createFeatureFlags(store: AppSettingStore): FeatureFlags {
  let cache: Map<string, string> | null = null;
  let loadedAt = 0;

  async function load(now: number): Promise<Map<string, string>> {
    if (cache && now - loadedAt < TTL_MS) return cache;
    const rows = await store.getAll();
    cache = new Map(rows.map((r) => [r.key, r.value]));
    loadedAt = now;
    return cache;
  }

  return {
    async get(id) {
      const def = getFlagDefinition(id);
      const map = await load(Date.now());
      return parseFlagValue(map.get(id), def?.default ?? false);
    },
    async all() {
      const map = await load(Date.now());
      return FEATURE_FLAGS.map((f) => ({
        id: f.id,
        labelKey: f.labelKey,
        descriptionKey: f.descriptionKey,
        value: parseFlagValue(map.get(f.id), f.default),
      }));
    },
    async set(id, value, actor) {
      await store.set(id, value ? 'true' : 'false', actor);
      this.invalidate();
    },
    invalidate() {
      cache = null;
      loadedAt = 0;
    },
  };
}
```

> Note: `store.getAll()` is used (not per-key `get`) so `all()` and `get()` share one cache load. The `calls` test above counts `get` calls; since the service uses `getAll`, adjust the fake to count `getAll` instead. **Correction for Step 1:** change the fake's counter to increment in `getAll` (not `get`), and the assertions `store.calls === 1 / === 2` refer to `getAll` invocations. Update the fake accordingly before running.

- [ ] **Step 4: Apply the Step-1 fake correction and run the test**

Edit the fake so `getAll` increments `calls` (and `get` does not), matching the `getAll`-based cache. Then run:

Run: `pnpm -C packages/bootstrap test -- feature-flags`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/feature-flags.ts packages/bootstrap/src/feature-flags.test.ts
git commit -m "feat(bootstrap): createFeatureFlags service (registry + invalidate-on-set cache)"
```

---

## Task 5: Wire store + featureFlags onto AppContext; seed defaults

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (AppContext interface + `createAppContext` + exports)
- Modify: `packages/bootstrap/src/seed.ts` (seed flag defaults idempotently)

- [ ] **Step 1: Export the new modules from bootstrap**

In `packages/bootstrap/src/index.ts`, near the top re-exports, add:

```typescript
export { createFeatureFlags } from './feature-flags';
export type { FeatureFlags, ResolvedFlag } from './feature-flags';
```

Add an import for the store + service where the other `@openldr/db` imports and local imports live:

```typescript
import { createAppSettingsStore } from '@openldr/db';
import { createFeatureFlags, type FeatureFlags } from './feature-flags';
```

- [ ] **Step 2: Add to the AppContext interface**

In the `AppContext` interface (~L111-157), add after `connectors: ConnectorStore;`:

```typescript
  appSettings: import('@openldr/db').AppSettingStore;
  featureFlags: FeatureFlags;
```

(Or import `AppSettingStore` at the top and reference it directly.)

- [ ] **Step 3: Construct + return them in `createAppContext`**

Where the other stores are built (near `const connectors = createConnectorStore(internal.db);`):

```typescript
const appSettings = createAppSettingsStore(internal.db);
const featureFlags = createFeatureFlags(appSettings);
```

Add to the returned object (near `connectors,`):

```typescript
    appSettings,
    featureFlags,
```

- [ ] **Step 4: Seed flag defaults idempotently**

In `packages/bootstrap/src/seed.ts`, add `FEATURE_FLAGS` to the config import and extend `FormSeedTarget` + `seedDatabase`.

At the top imports add:

```typescript
import { FEATURE_FLAGS } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';
```

Extend `FormSeedTarget` (add a structural member — AppContext satisfies it):

```typescript
  appSettings: Pick<AppSettingStore, 'get' | 'set'>;
```

Add a `settingsSeeded` field to `SeedResult`:

```typescript
  settingsSeeded: number;
```

Inside `seedDatabase`, before the `return`, add the idempotent flag seed:

```typescript
  // Feature-flag defaults — reference config, not demo data. Idempotent: only writes a row
  // when absent, so an operator's later toggle is never clobbered on reseed.
  let settingsSeeded = 0;
  for (const f of FEATURE_FLAGS) {
    const existing = await app.appSettings.get(f.id);
    if (!existing) {
      await app.appSettings.set(f.id, f.default ? 'true' : 'false', 'system');
      settingsSeeded++;
    }
  }
```

Add `settingsSeeded` to the returned object.

- [ ] **Step 5: Log the new count at boot**

In `apps/server/src/index.ts`, add `settingsSeeded` to the destructure + the `logger.info` object at L59-60:

```typescript
      const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology } = await seedDatabase(dbCtx, ctx);
      logger.info({ resources: resources.length, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology }, 'startup seed complete');
```

- [ ] **Step 6: Typecheck bootstrap + server**

Run: `pnpm -C packages/bootstrap typecheck && pnpm -C apps/server typecheck`
Expected: PASS.

- [ ] **Step 7: Run bootstrap tests**

Run: `pnpm -C packages/bootstrap test`
Expected: PASS (existing + feature-flags). If a seed test asserts `SeedResult` shape, update it to include `settingsSeeded: 0`.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/seed.ts apps/server/src/index.ts
git commit -m "feat(bootstrap): surface appSettings + featureFlags on AppContext; seed flag defaults"
```

---

## Task 6: Remove `DASHBOARD_SQL_ENABLED` env var + scrub docs

**Files:**
- Modify: `packages/config/src/schema.ts` (remove the env line)
- Modify: `.env.example`, `.env.prod.example`
- Modify: `docs/CONFIGURATION.md`, `docs/OPERATOR-GUIDE.md`

- [ ] **Step 1: Remove the schema line**

In `packages/config/src/schema.ts` (~L70-71) delete:

```typescript
// Custom dashboards — gated raw-SQL widget escape hatch (Postgres warehouse only).
DASHBOARD_SQL_ENABLED: envBoolean(false),
```

Keep `DASHBOARD_SQL_TIMEOUT_MS` and `DASHBOARD_SQL_ROW_CAP` (still used by the runner). Replace the removed comment with:

```typescript
// Custom dashboards — raw-SQL widget escape hatch is now the `dashboard.raw_sql`
// feature flag (Settings → General), not an env var. Timeout/row-cap remain env-tunable.
```

- [ ] **Step 2: Scrub `.env.example`**

Remove the `DASHBOARD_SQL_ENABLED=...` line (~L11). Add a comment in its place:

```
# Dashboard raw SQL is now a Settings → General feature flag (default off), not an env var.
```

- [ ] **Step 3: Scrub `.env.prod.example`**

Remove the `DASHBOARD_SQL_ENABLED=true` line (~L57) and add the same comment.

- [ ] **Step 4: Scrub the docs**

In `docs/CONFIGURATION.md` remove the `DASHBOARD_SQL_ENABLED` config-table row (~L101) and troubleshooting note (~L162); replace with a sentence: "Dashboard raw SQL is toggled at runtime in **Settings → General → Feature Flags** (admin-only, default off)." Do the same for `docs/OPERATOR-GUIDE.md` (~L53, L64).

- [ ] **Step 5: Typecheck config**

Run: `pnpm -C packages/config typecheck`
Expected: PASS (nothing else in config references the removed key).

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/schema.ts .env.example .env.prod.example docs/CONFIGURATION.md docs/OPERATOR-GUIDE.md
git commit -m "refactor(config): drop DASHBOARD_SQL_ENABLED env var (now a feature flag)"
```

---

## Task 7: Rewire the authoring gate (dashboards-routes)

**Files:**
- Modify: `apps/server/src/dashboards-routes.ts`
- Modify: `apps/server/src/dashboards-routes.test.ts`

- [ ] **Step 1: Update the failing test first (TDD — change the fake to featureFlags)**

In `apps/server/src/dashboards-routes.test.ts`, change `fakeCtx` so the flag comes from a `featureFlags` fake instead of `cfg`:

```typescript
function fakeCtx(cfg: { DASHBOARD_SQL_ENABLED?: boolean } = {}) {
  const data: any[] = [];
  const auditEvents: any[] = [];
  const sqlEnabled = cfg.DASHBOARD_SQL_ENABLED ?? false;
  return {
    dashboards: { /* ...unchanged... */ },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    featureFlags: { get: async (_id: string) => sqlEnabled },
    cfg: {},
    __auditEvents: auditEvents,
  } as any;
}
```

(Leave the rest of the file's assertions unchanged — they still pass `DASHBOARD_SQL_ENABLED` into `fakeCtx`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/server test -- dashboards-routes`
Expected: FAIL (authoring-gate tests fail because the route still reads `ctx.cfg.DASHBOARD_SQL_ENABLED`, now undefined → always gated, so the "allows unchanged SQL" case breaks or the reject cases pass for the wrong reason). Confirm at least one failure tied to the flag source.

- [ ] **Step 3: Change the gate to take a boolean; read the flag in handlers**

In `apps/server/src/dashboards-routes.ts`, change the signature of `assertSqlAuthoringAllowed` from `(cfg: AppContext['cfg'], d, prev)` to `(sqlEnabled: boolean, d, prev)`:

```typescript
function assertSqlAuthoringAllowed(sqlEnabled: boolean, d: Dashboard, prevTemplates: Set<string>): void {
  if (sqlEnabled) return;
  for (const w of d.widgets) {
    if (w.query.mode === 'sql') {
      const sql = typeof w.query.sql === 'string' ? w.query.sql.trim() : '';
      if (!prevTemplates.has(sql)) {
        throw new DashboardQueryError('raw SQL widgets are disabled');
      }
    }
  }
}
```

At each call site (the CREATE handler ~L66 and UPDATE handler ~L80), read the flag first (the handlers are already `async`):

```typescript
const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
assertSqlAuthoringAllowed(sqlEnabled, parsed, new Set());
```
```typescript
const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
assertSqlAuthoringAllowed(sqlEnabled, parsed, persistedSqlTemplates(before));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/server test -- dashboards-routes`
Expected: PASS (all authoring-gate cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dashboards-routes.ts apps/server/src/dashboards-routes.test.ts
git commit -m "refactor(server): dashboard SQL authoring gate reads the dashboard.raw_sql flag"
```

---

## Task 8: Rewire the execution runner (bootstrap)

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (`runDashboardQuery`)

- [ ] **Step 1: Read the flag in the runner**

In `packages/bootstrap/src/index.ts`, inside `runDashboardQuery` (~L256-280), replace the `cfg.DASHBOARD_SQL_ENABLED` read. The runner closure is built inside `createAppContext`, so `featureFlags` is in scope:

```typescript
    const vetted = collectVettedSqlTemplates(await dashboardStore.list());
    const sqlEnabled = await featureFlags.get('dashboard.raw_sql');
    if (!isSqlExecutionAllowed(sqlEnabled, q.sql, vetted)) {
      throw new DashboardQueryError('raw SQL widgets are disabled');
    }
```

Ensure `const featureFlags = createFeatureFlags(appSettings);` (Task 5 Step 3) is declared **before** the dashboards API / `runDashboardQuery` closure is constructed. If the dashboards block is earlier in the function, move the `appSettings`/`featureFlags` construction up so it's in scope.

- [ ] **Step 2: Typecheck**

Run: `pnpm -C packages/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "refactor(bootstrap): dashboard query runner vets SQL via the dashboard.raw_sql flag"
```

---

## Task 9: App-version module + rewire `/config`

**Files:**
- Create: `apps/server/src/version.ts`
- Create: `apps/server/src/version.test.ts`
- Modify: `apps/server/src/app.ts` (`registerConfigRoute` + call site)
- Modify: `apps/server/src/config-route.test.ts`
- Modify: `apps/server/src/app.test.ts` (~L416 mock)

- [ ] **Step 1: Write the failing version test**

Create `apps/server/src/version.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { readAppVersion } from './version';

describe('readAppVersion', () => {
  afterEach(() => { delete process.env.APP_VERSION; });

  it('prefers the APP_VERSION env override', () => {
    process.env.APP_VERSION = '9.9.9-test';
    expect(readAppVersion()).toBe('9.9.9-test');
  });

  it('falls back to the repo package.json version (semver-ish string)', () => {
    delete process.env.APP_VERSION;
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/server test -- version`
Expected: FAIL ("Cannot find module './version'").

- [ ] **Step 3: Write the version module**

Create `apps/server/src/version.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Resolve the app version. Prefers the APP_VERSION env (set at Docker build), else reads the
 * nearest package.json version by walking up from this module — works in dev (apps/server/src)
 * and in the bundled server. Falls back to '0.0.0' if nothing is found.
 */
export function readAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../package.json'), // dev: apps/server/src -> repo root
    resolve(here, '../../package.json'),
    resolve(here, '../package.json'),       // bundled server dir
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string; name?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/server test -- version`
Expected: PASS (2 tests).

- [ ] **Step 5: Update `/config` — read the flag + add version + environment**

In `apps/server/src/app.ts`, rewrite `registerConfigRoute` to take a `featureFlags` accessor and a version, and make the handler async:

```typescript
import { readAppVersion } from './version';

export function registerConfigRoute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: FastifyInstance<any, any, any, any>,
  ctx: {
    cfg: { TARGET_STORE_ADAPTER: string; AUTH_DEV_BYPASS: boolean; OIDC_ISSUER_URL: string; OIDC_WEB_CLIENT_ID: string; OIDC_AUDIENCE?: string };
    featureFlags: { get(id: string): Promise<boolean> };
  },
): void {
  const version = readAppVersion();
  app.get('/api/config', async () => ({
    dashboardSqlEnabled: (await ctx.featureFlags.get('dashboard.raw_sql')) && ctx.cfg.TARGET_STORE_ADAPTER === 'pg',
    authEnforced: !ctx.cfg.AUTH_DEV_BYPASS,
    version,
    environment: process.env.NODE_ENV ?? 'development',
    oidc: {
      issuerUrl: ctx.cfg.OIDC_ISSUER_URL,
      clientId: ctx.cfg.OIDC_WEB_CLIENT_ID,
      audience: ctx.cfg.OIDC_AUDIENCE ?? null,
    },
  }));
}
```

The `registerConfigRoute(app, ctx)` call in `buildApp` needs no change (the full `AppContext` satisfies the narrowed shape).

- [ ] **Step 6: Update `config-route.test.ts`**

Replace the fake so the flag comes from `featureFlags`:

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerConfigRoute } from './app';

describe('GET /api/config', () => {
  it('reports dashboardSqlEnabled from the feature flag (pg target)', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => true },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(true);
    expect(res.json().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('is false when the flag is off even with a pg target', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => false },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(false);
  });
});
```

- [ ] **Step 7: Fix `app.test.ts` mock**

In `apps/server/src/app.test.ts` (~L416) the mocked ctx sets `cfg: { DASHBOARD_SQL_ENABLED: ... }`. Add a `featureFlags: { get: async () => false }` to that mock ctx (and drop the now-unused `DASHBOARD_SQL_ENABLED` from the mock if present). Search the file for other `DASHBOARD_SQL_ENABLED` references and repoint them to the `featureFlags` fake.

- [ ] **Step 8: Run the server test suite**

Run: `pnpm -C apps/server test`
Expected: PASS. Fix any remaining `DASHBOARD_SQL_ENABLED` references surfaced by failures.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/version.ts apps/server/src/version.test.ts apps/server/src/app.ts apps/server/src/config-route.test.ts apps/server/src/app.test.ts
git commit -m "feat(server): /config serves version + environment and reads the dashboard.raw_sql flag"
```

---

## Task 10: Danger-zone operations (bootstrap)

**Files:**
- Create: `packages/bootstrap/src/danger.ts`
- Create: `packages/bootstrap/src/danger.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export)

- [ ] **Step 1: Write the failing test (pure helpers only)**

The truncate/reseed require a live DB, so unit-test only the pure pieces: the reserved-table guard and the SQL builder. Create `packages/bootstrap/src/danger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTruncateSql, RESERVED_TABLES } from './danger';

describe('danger truncate SQL builder', () => {
  it('excludes kysely migration bookkeeping tables', () => {
    expect(RESERVED_TABLES).toContain('kysely_migration');
    expect(RESERVED_TABLES).toContain('kysely_migration_lock');
  });

  it('builds a CASCADE TRUNCATE over the given tables, quoted', () => {
    const sql = buildTruncateSql(['dashboards', 'audit_events']);
    expect(sql).toBe('TRUNCATE "dashboards", "audit_events" RESTART IDENTITY CASCADE');
  });

  it('returns null for an empty table list (nothing to truncate)', () => {
    expect(buildTruncateSql([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/bootstrap test -- danger`
Expected: FAIL ("Cannot find module './danger'").

- [ ] **Step 3: Write the danger module**

Create `packages/bootstrap/src/danger.ts`:

```typescript
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

/** Kysely's own bookkeeping — never truncate these or migration tracking breaks. */
export const RESERVED_TABLES = ['kysely_migration', 'kysely_migration_lock'] as const;

/** Build a single CASCADE TRUNCATE over `tables` (identifiers quoted). Null when empty. */
export function buildTruncateSql(tables: string[]): string | null {
  if (tables.length === 0) return null;
  const list = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  return `TRUNCATE ${list} RESTART IDENTITY CASCADE`;
}

/** Every user/public table in the internal DB except the reserved migration tables. */
export async function listInternalDataTables(db: Kysely<InternalSchema>): Promise<string[]> {
  const rows = await sql<{ tablename: string }>`
    select tablename from pg_tables where schemaname = 'public'
  `.execute(db);
  return rows.rows.map((r) => r.tablename).filter((t) => !RESERVED_TABLES.includes(t as never));
}

/** Truncate the given tables in one CASCADE statement. No-op when the list is empty. */
export async function truncateTables(db: Kysely<InternalSchema>, tables: string[]): Promise<void> {
  const stmt = buildTruncateSql(tables);
  if (!stmt) return;
  await sql.raw(stmt).execute(db);
}

/** Factory reset: wipe ALL internal-DB data (except kysely bookkeeping). Reseed is done by
 *  the caller via seedDatabase(). Does NOT touch the external target store or Keycloak. */
export async function wipeInternalDatabase(db: Kysely<InternalSchema>): Promise<string[]> {
  const tables = await listInternalDataTables(db);
  await truncateTables(db, tables);
  return tables;
}

/** Clear the audit log + workflow run history only. */
export async function clearAuditAndRunHistory(db: Kysely<InternalSchema>): Promise<void> {
  await truncateTables(db, ['audit_events', 'workflow_runs']);
}
```

- [ ] **Step 4: Export primitives from bootstrap**

In `packages/bootstrap/src/index.ts` add:

```typescript
export { wipeInternalDatabase, clearAuditAndRunHistory, listInternalDataTables, buildTruncateSql } from './danger';
```

- [ ] **Step 5: Add the high-level danger orchestrations (shared by server routes AND the CLI)**

These need an `AppContext` (for `seedDatabase`, `seedDefaultDashboard`, `createDbContext`), so they live in `index.ts` where `AppContext` is defined — NOT in `danger.ts` (which stays AppContext-free to avoid a circular import, mirroring how `seed.ts` uses the structural `FormSeedTarget`). Add to `packages/bootstrap/src/index.ts` (near the other exported functions; `seedDefaultDashboard` is imported from `@openldr/dashboards`, `createDbContext`/`seedDatabase` are already in this package):

```typescript
import { seedDefaultDashboard } from '@openldr/dashboards';
import { wipeInternalDatabase, clearAuditAndRunHistory } from './danger';

/** Delete all dashboards and restore the built-in sample. Internal DB only. */
export async function dangerResetDashboards(ctx: AppContext): Promise<void> {
  for (const d of await ctx.dashboards.store.list()) await ctx.dashboards.store.remove(d.id);
  await seedDefaultDashboard(ctx.dashboards.store);
}

/** Empty the audit log + workflow run history. Internal DB only. */
export async function dangerClearAudit(ctx: AppContext): Promise<void> {
  await clearAuditAndRunHistory(ctx.internalDb);
}

/** Wipe ALL internal-DB data and reseed factory defaults. Never touches the external target
 *  store or Keycloak. Reseed uses a fresh DbContext exactly like the SEED_ON_START boot path. */
export async function dangerFactoryReset(ctx: AppContext): Promise<void> {
  const wiped = await wipeInternalDatabase(ctx.internalDb);
  ctx.logger.warn({ tables: wiped.length }, 'factory reset: internal DB wiped, reseeding');
  const dbCtx = await createDbContext(ctx.cfg);
  try {
    await seedDatabase(dbCtx, ctx);
  } finally {
    await dbCtx.close();
  }
  ctx.featureFlags.invalidate();
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm -C packages/bootstrap test -- danger`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck bootstrap**

Run: `pnpm -C packages/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/danger.ts packages/bootstrap/src/danger.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): danger-zone DB ops + shared reset/factory-reset/clear-audit orchestrations"
```

---

## Task 11: Settings routes — flags + danger zone (server)

**Files:**
- Create: `apps/server/src/settings-routes.ts`
- Create: `apps/server/src/settings-routes.test.ts`
- Modify: `apps/server/src/app.ts` (register the routes)

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/settings-routes.test.ts`. It exercises: GET flags, PUT a flag (audited + invalidates), danger actions call the injected ops, and admin gating relies on `requireRole` (tested via a fake auth that sets `req.user`). Since `requireRole` reads `req.user.roles`, register a tiny preHandler in the test to set `req.user`.

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerSettingsRoutes } from './settings-routes';

function fakeCtx() {
  const store = new Map<string, boolean>();
  const audit: any[] = [];
  const ops = { resetDashboards: 0, factoryReset: 0, clearAudit: 0 };
  return {
    ctx: {
      featureFlags: {
        get: async (id: string) => store.get(id) ?? false,
        all: async () => [{ id: 'dashboard.raw_sql', labelKey: 'l', descriptionKey: 'd', value: store.get('dashboard.raw_sql') ?? false }],
        set: async (id: string, v: boolean) => { store.set(id, v); },
        invalidate: () => {},
      },
      audit: { record: async (e: any) => { audit.push(e); return e; } },
      logger: { error() {}, warn() {}, info() {} },
      dashboards: { store: { list: async () => [], remove: async () => {}, create: async () => ({}) } },
      internalDb: {} as any,
      cfg: {},
      __audit: audit,
      __ops: ops,
    } as any,
    // Danger ops are injected so the test doesn't hit a DB:
    deps: {
      resetDashboards: async () => { ops.resetDashboards++; },
      factoryReset: async () => { ops.factoryReset++; },
      clearAudit: async () => { ops.clearAudit++; },
    },
  };
}

function appWithUser(roles: string[], reg: (app: any) => void) {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => { req.user = { id: 'u1', username: 'admin', roles }; });
  reg(app);
  return app;
}

describe('settings routes', () => {
  it('GET /api/settings/flags returns merged flags', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/flags' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe('dashboard.raw_sql');
  });

  it('PUT /api/settings/flags/:key sets the value and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/flags/dashboard.raw_sql', payload: { value: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(true);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.flag.update')).toBe(true);
  });

  it('non-admin PUT is 403', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_technician'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/flags/dashboard.raw_sql', payload: { value: true } });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/settings/danger/factory-reset runs the op and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/factory-reset' });
    expect(res.statusCode).toBe(200);
    expect((ctx as any).__ops.factoryReset).toBe(1);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.danger.factory-reset')).toBe(true);
  });

  it('unknown danger action is 404', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/nuke-everything' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/server test -- settings-routes`
Expected: FAIL ("Cannot find module './settings-routes'").

- [ ] **Step 3: Write the routes**

Create `apps/server/src/settings-routes.ts`. Danger ops are injectable (`deps`) with real defaults so tests can stub them:

```typescript
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { dangerResetDashboards, dangerFactoryReset, dangerClearAudit } from '@openldr/bootstrap';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

export interface DangerDeps {
  resetDashboards: (ctx: AppContext) => Promise<void>;
  factoryReset: (ctx: AppContext) => Promise<void>;
  clearAudit: (ctx: AppContext) => Promise<void>;
}

// Delegate to the shared bootstrap orchestrations so the CLI (`openldr settings danger …`) and
// the HTTP route run identical code. Injectable so settings-routes.test.ts can stub them.
const defaultDeps: DangerDeps = {
  resetDashboards: dangerResetDashboards,
  factoryReset: dangerFactoryReset,
  clearAudit: dangerClearAudit,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSettingsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: DangerDeps = defaultDeps): void {
  app.get('/api/settings/flags', { preHandler: requireRole('lab_admin') }, async () => ctx.featureFlags.all());

  app.put('/api/settings/flags/:key', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { value } = req.body as { value: boolean };
    const before = await ctx.featureFlags.get(key);
    await ctx.featureFlags.set(key, Boolean(value), req.user?.id ?? null);
    await recordAudit(ctx as unknown as AppContext, req, {
      action: 'settings.flag.update', entityType: 'app_setting', entityId: key,
      metadata: { key, before, after: Boolean(value) },
    });
    reply.code(200);
    return { key, value: Boolean(value) };
  });

  const DANGER: Record<string, keyof DangerDeps> = {
    'reset-dashboards': 'resetDashboards',
    'factory-reset': 'factoryReset',
    'clear-audit': 'clearAudit',
  };

  app.post('/api/settings/danger/:action', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { action } = req.params as { action: string };
    const fn = DANGER[action];
    if (!fn) { reply.code(404); return { error: 'unknown action' }; }
    await deps[fn](ctx);
    await recordAudit(ctx, req, {
      action: `settings.danger.${action}`, entityType: 'app_settings', entityId: 'internal-db',
      metadata: { action },
    });
    reply.code(200);
    return { ok: true, action };
  });
}
```

- [ ] **Step 4: Register in the app**

In `apps/server/src/app.ts`, import and register (after `registerConnectorsRoutes` / `registerWorkflowRoutes`):

```typescript
import { registerSettingsRoutes } from './settings-routes';
```
```typescript
  registerSettingsRoutes(app, ctx);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C apps/server test -- settings-routes`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck server**

Run: `pnpm -C apps/server typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): settings routes — feature-flag GET/PUT + danger-zone actions (audited, admin-gated)"
```

---

## Task 12: Client API surface (studio)

**Files:**
- Modify: `apps/studio/src/api.ts`

- [ ] **Step 1: Extend `ClientConfig` + add flag/danger client calls**

In `apps/studio/src/api.ts`, extend `ClientConfig` (near L293) to include the new fields:

```typescript
export interface ClientConfig { dashboardSqlEnabled: boolean; authEnforced: boolean; version: string; environment: string; oidc: OidcConfig | null }
```

Update the `fetchClientConfig` fallback object to include `version: '', environment: ''`:

```typescript
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await authFetch('/api/config');
  if (!r.ok) return { dashboardSqlEnabled: false, authEnforced: false, version: '', environment: '', oidc: null };
  return r.json();
}
```

Add feature-flag + danger API functions near the other exported API calls (use the existing `jbody`/`okJson`/`authFetch` helpers):

```typescript
export interface FeatureFlag { id: string; labelKey: string; descriptionKey: string; value: boolean }

export const fetchFeatureFlags = (): Promise<FeatureFlag[]> =>
  authFetch('/api/settings/flags').then((r) => okJson<FeatureFlag[]>(r, 'list feature flags'));

export const setFeatureFlag = (key: string, value: boolean): Promise<{ key: string; value: boolean }> =>
  authFetch(`/api/settings/flags/${encodeURIComponent(key)}`, jbody({ value }, 'PUT'))
    .then((r) => okJson<{ key: string; value: boolean }>(r, 'set feature flag'));

export type DangerAction = 'reset-dashboards' | 'factory-reset' | 'clear-audit';

export const runDangerAction = (action: DangerAction): Promise<{ ok: boolean; action: string }> =>
  authFetch(`/api/settings/danger/${action}`, jbody({}, 'POST'))
    .then((r) => okJson<{ ok: boolean; action: string }>(r, `danger:${action}`));

export interface HealthReport { status: string; checks?: { name: string; status: string }[] }
export const fetchHealth = (): Promise<HealthReport> =>
  authFetch('/health').then((r) => r.json() as Promise<HealthReport>);
```

> Verify the exact shape of `/health` (`ctx.health.runAll()`) and adjust `HealthReport` to match its real fields before relying on it in the UI; if the shape is uncertain, the About card can omit service status (spec allows this).

- [ ] **Step 2: Typecheck studio**

Run: `pnpm -C apps/studio typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "feat(studio): client API for feature flags + danger actions + config version"
```

---

## Task 13: i18n keys (en/fr/pt)

**Files:**
- Modify: `apps/studio/src/i18n/en.ts`, `apps/studio/src/i18n/fr.ts`, `apps/studio/src/i18n/pt.ts`

- [ ] **Step 1: Add `subNav.general` + `settings.general.*` to `en.ts`**

In `apps/studio/src/i18n/en.ts`, add `general: 'General',` as the FIRST key of `settings.subNav`, and add a `general` block inside `settings` (after `subNav`):

```typescript
    subNav: {
      general: 'General',
      connectors: 'Connectors',
      marketplace: 'Marketplace',
    },
    general: {
      heading: 'General',
      description: 'Application information, feature flags, and administrative actions.',
      about: {
        title: 'About',
        version: 'Version',
        environment: 'Environment',
        license: 'License',
        services: 'Services',
      },
      flags: {
        title: 'Feature Flags',
        description: 'Toggle optional capabilities. Changes take effect immediately.',
        saved: 'Saved',
        saveFailed: 'Could not save: {{error}}',
        dashboardRawSql: {
          label: 'Dashboard raw SQL',
          description: 'Allow authoring and running arbitrary read-only SQL in dashboard widgets (Postgres warehouse only). Off by default.',
        },
      },
      danger: {
        title: 'Danger Zone',
        description: 'Irreversible actions on the internal database. External data and identity are never touched.',
        resetDashboards: { label: 'Reset dashboards', description: 'Delete all dashboards and restore the sample.', button: 'Reset', confirm: 'reset dashboards', title: 'Reset dashboards?', warning: 'This deletes every dashboard and re-creates the built-in sample. This cannot be undone.' },
        clearAudit: { label: 'Clear audit log', description: 'Empty the audit trail and workflow run history.', button: 'Clear', confirm: 'clear audit', title: 'Clear audit log?', warning: 'This permanently deletes all audit events and workflow run history.' },
        factoryReset: { label: 'Factory reset', description: 'Wipe the entire internal database and restore factory defaults.', button: 'Factory reset', confirm: 'factory reset', title: 'Factory reset?', warning: 'This wipes ALL internal data — forms, connectors, dashboards, workflows, terminology, users, audit — and reseeds defaults. External target data and Keycloak are not touched. This cannot be undone.' },
        done: '{{action}} complete',
        failed: '{{action}} failed: {{error}}',
      },
    },
```

- [ ] **Step 2: Mirror the keys in `fr.ts` and `pt.ts`**

Add the same key structure to `fr.ts` and `pt.ts` with translated strings (French, Portuguese). Keep the same nesting and keys — only the string values change. (Reuse existing translations of "Reset/Clear/Version/Environment/License" already present elsewhere in those bundles for consistency.)

- [ ] **Step 3: Typecheck (enforces EnShape key parity)**

Run: `pnpm -C apps/studio typecheck`
Expected: PASS. The `EnShape` type forces fr/pt to have identical keys — fix any missing-key errors it reports.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "i18n(studio): Settings → General strings (en/fr/pt)"
```

---

## Task 14: SettingsShell nav + route

**Files:**
- Modify: `apps/studio/src/pages/settings/SettingsShell.tsx`
- Modify: `apps/studio/src/App.tsx`

- [ ] **Step 1: Add General as the first sub-nav item**

In `apps/studio/src/pages/settings/SettingsShell.tsx`, prepend to `SUB_NAV`. **General has no `roles`** (visible to all authenticated users); connectors/marketplace stay admin-only:

```typescript
const SUB_NAV: SubNavItem[] = [
  { labelKey: 'settings.subNav.general', to: '/settings/general' },
  { labelKey: 'settings.subNav.connectors', to: '/settings/connectors', roles: ['lab_admin'] },
  { labelKey: 'settings.subNav.marketplace', to: '/settings/marketplace', roles: ['lab_admin'] },
];
```

- [ ] **Step 2: Relax the parent gate, add the General route, change the index redirect**

In `apps/studio/src/App.tsx`, import `General` and rewrite the settings route block. The **parent drops the `lab_admin` gate** (any authenticated user); `general` is ungated (auth only); connectors/marketplace **keep** `RequireRole role="lab_admin"`:

```typescript
import { General } from './pages/settings/General';
```
```typescript
      <Route path="/settings" element={<RequireRole><SettingsShell /></RequireRole>}>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<RequireRole><General /></RequireRole>} />
        <Route path="marketplace" element={<RequireRole role="lab_admin"><Marketplace /></RequireRole>} />
        <Route path="connectors" element={<RequireRole role="lab_admin"><Connectors /></RequireRole>} />
      </Route>
```

> `<RequireRole>` with no `role`/`roles` prop requires authentication only (see the existing `/x/:pluginId` route). Verify that's its behavior before relying on it; if `RequireRole` requires a role prop, use whatever "authenticated, any role" guard the app already has (or pass all roles).

- [ ] **Step 3: Typecheck (will fail until Task 15 creates General)**

Run: `pnpm -C apps/studio typecheck`
Expected: FAIL ("Cannot find module './pages/settings/General'") — resolved by Task 15. Do NOT commit yet; proceed to Task 15 and commit them together.

---

## Task 15: General page component

**Files:**
- Create: `apps/studio/src/pages/settings/General.tsx`

- [ ] **Step 1: Write the page**

Create `apps/studio/src/pages/settings/General.tsx`. Reuses `DangerConfirmDialog`, `Card`, `Switch`, `Button`, `toast`. Reads config + flags on mount; toggling a flag calls `setFeatureFlag` then refetches `/config` (so `dashboardSqlEnabled` flips live for anyone who next mounts the dashboard editor).

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { DangerConfirmDialog } from '@/terminology/DangerConfirmDialog';
import {
  fetchClientConfig, fetchFeatureFlags, setFeatureFlag, runDangerAction,
  type ClientConfig, type FeatureFlag, type DangerAction,
} from '@/api';

type PendingDanger = null | 'reset-dashboards' | 'clear-audit' | 'factory-reset';

export function General() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('lab_admin');
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDanger>(null);
  const [dangerBusy, setDangerBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const cfg = await fetchClientConfig();
      setConfig(cfg);
      // Feature flags are an admin-only endpoint (403 otherwise) — only fetch for admins.
      if (isAdmin) setFlags(await fetchFeatureFlags());
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

  const onToggle = useCallback(async (flag: FeatureFlag, value: boolean) => {
    setBusyFlag(flag.id);
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, value } : f)));
    try {
      await setFeatureFlag(flag.id, value);
      await fetchClientConfig().then(setConfig); // live-refresh dashboardSqlEnabled
      toast.success(t('settings.general.flags.saved'));
    } catch (e) {
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, value: !value } : f))); // revert
      toast.error(t('settings.general.flags.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusyFlag(null);
    }
  }, [t]);

  const runDanger = useCallback(async (action: DangerAction) => {
    setDangerBusy(true);
    try {
      await runDangerAction(action);
      toast.success(t('settings.general.danger.done', { action }));
      await load();
    } catch (e) {
      toast.error(t('settings.general.danger.failed', { action, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setDangerBusy(false);
      setPending(null);
    }
  }, [t, load]);

  const dangerMeta: Record<Exclude<PendingDanger, null>, { key: string }> = {
    'reset-dashboards': { key: 'resetDashboards' },
    'clear-audit': { key: 'clearAudit' },
    'factory-reset': { key: 'factoryReset' },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="general-page">
      <div>
        <h1 className="text-lg font-semibold">{t('settings.general.heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.general.description')}</p>
      </div>

      {/* About */}
      <Card>
        <CardHeader><CardTitle>{t('settings.general.about.title')}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-muted-foreground">{t('settings.general.about.version')}</dt>
            <dd className="font-mono">{config?.version || '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.general.about.environment')}</dt>
            <dd className="font-mono">{config?.environment || '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.general.about.license')}</dt>
            <dd>Apache-2.0</dd>
          </dl>
        </CardContent>
      </Card>

      {/* Feature Flags — admin only */}
      {isAdmin && (
      <Card>
        <CardHeader><CardTitle>{t('settings.general.flags.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.flags.description')}</p>
          {flags.map((f) => (
            <div key={f.id} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{t(f.labelKey)}</div>
                <div className="text-xs text-muted-foreground">{t(f.descriptionKey)}</div>
              </div>
              <Switch checked={f.value} disabled={busyFlag === f.id} onCheckedChange={(v) => void onToggle(f, v)} aria-label={t(f.labelKey)} />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Danger Zone — admin only */}
      {isAdmin && (
      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-destructive">{t('settings.general.danger.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.danger.description')}</p>
          {(['reset-dashboards', 'clear-audit', 'factory-reset'] as const).map((action) => {
            const k = dangerMeta[action].key;
            return (
              <div key={action} className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t(`settings.general.danger.${k}.label`)}</div>
                  <div className="text-xs text-muted-foreground">{t(`settings.general.danger.${k}.description`)}</div>
                </div>
                <Button variant="secondary" className="border-destructive/50 text-destructive" disabled={dangerBusy} onClick={() => setPending(action)}>
                  {t(`settings.general.danger.${k}.button`)}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      )}

      {isAdmin && pending && (
        <DangerConfirmDialog
          open={pending !== null}
          onOpenChange={(o) => { if (!o) setPending(null); }}
          title={t(`settings.general.danger.${dangerMeta[pending].key}.title`)}
          confirmName={t(`settings.general.danger.${dangerMeta[pending].key}.confirm`)}
          confirmLabel={t(`settings.general.danger.${dangerMeta[pending].key}.button`)}
          summary={<p>{t(`settings.general.danger.${dangerMeta[pending].key}.warning`)}</p>}
          onConfirm={() => void runDanger(pending)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck studio**

Run: `pnpm -C apps/studio typecheck`
Expected: PASS (Task 14 route now resolves).

- [ ] **Step 3: Build the studio SPA (catches JSX/type-only-import issues the dev server hides)**

Run: `pnpm -C apps/studio build`
Expected: build succeeds.

- [ ] **Step 4: Commit (Tasks 14 + 15 together)**

```bash
git add apps/studio/src/pages/settings/SettingsShell.tsx apps/studio/src/App.tsx apps/studio/src/pages/settings/General.tsx
git commit -m "feat(studio): Settings → General page (About + Feature Flags + Danger Zone)"
```

---

## Task 16: CLI — `settings` command group (flags + danger, headless operator parity)

The CLI (`packages/cli`) is the headless operator surface. Give it parity with the new admin UI so an operator with no browser can list/toggle flags and run danger-zone actions. Reuses the shared bootstrap functions (Tasks 4, 5, 10) — no duplicated logic. Real dependency is `@openldr/bootstrap` only (not the server routes or UI).

**Files:**
- Create: `packages/cli/src/settings.ts`
- Modify: `packages/cli/src/index.ts` (register the `settings` command group)
- Modify: `packages/cli/src/db.ts` (surface `settingsSeeded` in `runDbSeed` output)

- [ ] **Step 1: Write the command module**

Create `packages/cli/src/settings.ts` (mirrors `db.ts`: `createAppContext`, act, close, return exit code; `emit(json, payload, human)`):

```typescript
import { createAppContext, dangerResetDashboards, dangerFactoryReset, dangerClearAudit } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt { json: boolean }

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runSettingsFlagsList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const flags = await ctx.featureFlags.all();
    emit(opts.json, flags, flags.map((f) => `${f.value ? 'on ' : 'off'}  ${f.id}`).join('\n') || '(no flags)');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSettingsFlagsSet(key: string, value: string, opts: JsonOpt): Promise<number> {
  if (value !== 'true' && value !== 'false') {
    process.stderr.write(`value must be "true" or "false" (got "${value}")\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.featureFlags.get(key);
    await ctx.featureFlags.set(key, value === 'true', 'cli');
    await ctx.audit.record({ actorType: 'system', actorName: 'cli', action: 'settings.flag.update', entityType: 'app_setting', entityId: key, metadata: { key, before, after: value === 'true' } });
    emit(opts.json, { ok: true, key, value: value === 'true' }, `set ${key} = ${value}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

const DANGER: Record<string, { run: (ctx: Awaited<ReturnType<typeof createAppContext>>) => Promise<void>; label: string }> = {
  'reset-dashboards': { run: dangerResetDashboards, label: 'dashboards reset to the sample' },
  'clear-audit': { run: dangerClearAudit, label: 'audit log + run history cleared' },
  'factory-reset': { run: dangerFactoryReset, label: 'internal database wiped and reseeded' },
};

export async function runSettingsDanger(action: string, opts: JsonOpt & { force: boolean }): Promise<number> {
  const entry = DANGER[action];
  if (!entry) {
    process.stderr.write(`unknown action "${action}" (expected: ${Object.keys(DANGER).join(' | ')})\n`);
    return 1;
  }
  if (!opts.force) {
    process.stderr.write(`refusing to run "${action}" without --force (destructive, internal DB only)\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    await entry.run(ctx);
    await ctx.audit.record({ actorType: 'system', actorName: 'cli', action: `settings.danger.${action}`, entityType: 'app_settings', entityId: 'internal-db', metadata: { action } });
    emit(opts.json, { ok: true, action }, entry.label);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Register the command group in `index.ts`**

Add the import next to the other command-module imports:

```typescript
import { runSettingsFlagsList, runSettingsFlagsSet, runSettingsDanger } from './settings';
```

Add the command group (after the `db` group, mirroring its `--force` guard):

```typescript
const settings = program.command('settings').description('App settings — feature flags and danger-zone actions');
const flags = settings.command('flags').description('Feature flags');
flags.command('list').description('List all feature flags and their values').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsFlagsList(opts); } catch (err) { process.stderr.write(`settings flags list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
flags.command('set <key> <value>').description('Set a feature flag (value: true|false)').option('--json', 'emit JSON', false)
  .action(async (key: string, value: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsFlagsSet(key, value, opts); } catch (err) { process.stderr.write(`settings flags set failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
settings.command('danger <action>')
  .description('Run a danger-zone action: reset-dashboards | clear-audit | factory-reset (internal DB only)')
  .option('--force', 'required — confirms the destructive action', false)
  .option('--json', 'emit JSON', false)
  .action(async (action: string, opts: { force: boolean; json: boolean }) => {
    try { process.exitCode = await runSettingsDanger(action, opts); } catch (err) { process.stderr.write(`settings danger failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 3: Surface `settingsSeeded` in `runDbSeed`**

In `packages/cli/src/db.ts`, add `settingsSeeded` to the destructure + output of `runDbSeed` (SeedResult gained the field in Task 5):

```typescript
    const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology } = await seedDatabase(ctx, appCtx);
    emit(
      opts.json,
      { ok: true, results: resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology },
      `seeded ${resources.length} resources, ${formsSeeded} forms, ${workflowsSeeded} workflow(s), ${connectorsSeeded} connector(s), ${dashboardsSeeded} dashboard(s), ${settingsSeeded} setting(s), ${terminology.valueSetsImported} value set(s), ${terminology.ucumConceptsImported} UCUM concept(s)`,
    );
```

- [ ] **Step 4: Typecheck the CLI**

Run: `pnpm -C packages/cli typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke the CLI help (no DB needed)**

Run: `node packages/cli/dev.mjs settings --help` and `node packages/cli/dev.mjs settings flags --help`
Expected: the `flags list`, `flags set`, and `danger` subcommands are listed.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/settings.ts packages/cli/src/index.ts packages/cli/src/db.ts
git commit -m "feat(cli): openldr settings — flags list/set + danger reset/clear/factory-reset (--force)"
```

> **Note — the `init` wizard is NOT in this plan.** `pnpm run init` (IP-vs-domain detection, port prompts, Keycloak redirect config) is the **gateway + init-wizard workstream (#2)** and lands in the CLI as its own `openldr init` command there. This task only adds the settings/danger parity that the current workstream's shared bootstrap functions make free.

---

## Task 17: Full gate + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the cross-package typecheck gate (forced — turbo cache hides cross-package breakage)**

Run: `pnpm typecheck --force`
Expected: PASS across config, db, bootstrap, server, studio, **cli**. This is the critical gate: the `AppContext` shape change + `@openldr/config` registry + `@openldr/db` store type + the shared danger exports must line up in server, bootstrap, AND cli — not just their owning packages.

- [ ] **Step 2: Run the affected test suites**

Run: `pnpm -C packages/config test && pnpm -C packages/bootstrap test && pnpm -C apps/server test && pnpm -C packages/cli test`
Then (isolated, per the known studio parallel flake): `pnpm -C apps/studio test`
Expected: all PASS. Never trust a turbo `studio#test` red — re-run isolated.

- [ ] **Step 3: Manual smoke (document, do not automate here)**

Bring up the dev stack. As `lab_admin`:
1. Settings → General renders About (version `0.1.0`, environment), Feature Flags, Danger Zone.
2. Toggle **Dashboard raw SQL** on → open a dashboard widget editor → the SQL editor is now editable; toggle off → it's read-only. Confirms `/config` live-refresh across navigation.
3. **Reset dashboards** (type the phrase) → dashboards reset to the sample only.
4. **Clear audit** → audit page empties.
5. **Factory reset** on a throwaway DB only → app returns to seeded defaults; confirm the external target store is untouched and a server restart cleanly re-arms schedulers.

- [ ] **Step 4: Final commit (if any smoke-fix changes)**

```bash
git add -A
git commit -m "chore(settings-general): gate green + smoke fixes"
```

---

## Self-review notes (author checklist — already applied)

- **Spec coverage:** store (T1-T2), registry (T3), service+seed (T4-T5), env removal (T6), 3 read-site rewires (T7 authoring, T8 runner, T9 /config), danger ops + shared orchestrations (T10), settings API (T11), client (T12), page + i18n + nav (T13-T15), CLI parity (T16), gate (T17). `purge-data` intentionally absent (dropped). ✔
- **CLI parity (user request):** `openldr settings flags list/set` + `openldr settings danger <action> --force` reuse the same bootstrap functions as the route — no duplicated logic. The `init` wizard is explicitly deferred to workstream #2. ✔
- **Danger scope:** factory-reset = internal DB only (`ctx.internalDb`), reseed via `seedDatabase`; never `TARGET_DATABASE_URL`, never Keycloak. ✔
- **Naming consistency:** `createAppSettingsStore` / `AppSettingStore`, `createFeatureFlags` / `FeatureFlags`, flag id `dashboard.raw_sql`, audit actions `settings.flag.update` + `settings.danger.<action>`, routes `/api/settings/flags`, `/api/settings/flags/:key`, `/api/settings/danger/:action`. Used identically across tasks. ✔
- **Known caveat carried from memory:** cross-package tsc gate (`pnpm typecheck --force`) is mandatory here because AppContext + shared config types travel to server/bootstrap; `pnpm install` if a new workspace dep edge appears; do not run `pnpm build` for the server (native-dep esbuild failure) — studio build is fine and is used in T15.
