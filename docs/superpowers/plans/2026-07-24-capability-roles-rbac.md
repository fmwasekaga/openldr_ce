# Capability-Based Roles (Settings → Roles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenLDR's five hardcoded Keycloak roles with admin-defined roles composed from ~36 fine-grained capabilities, owned in OpenLDR's Postgres and enforced end-to-end (server routes + UI), managed from a new `Settings → Roles` page.

**Architecture:** Keycloak is demoted to pure authentication (proves identity via `sub`). OpenLDR owns `roles`, `role_capabilities`, and `user_roles` tables. On each request, the auth layer resolves the caller's `sub` → assigned roles → union of capabilities and attaches it to `req.user.capabilities`; a `requireCapability(...)` preHandler replaces every `requireRole(...)`. The capability catalog is a pure, browser-safe constant in a new `@openldr/rbac` package shared by server, CLI, and studio.

**Tech Stack:** TypeScript, Fastify, Kysely (Postgres; pg-mem in tests), Vitest, React + shadcn/ui, Commander (CLI). Monorepo built/tested via `turbo`.

## Global Constraints

- **`apps/server` is the only package with real lint** — the `openldr/require-return-reply-send` rule is enforced. Every async Fastify handler that sends a body MUST `return reply.send(...)` (or `return { ... }`); never `reply.send(...)` without `return`. Response compression is global, so a non-returned send drops the body. See [[server-eslint-reply-send-rule]].
- **CLI operator parity** — every new admin capability action must also be an `openldr` CLI command, sharing logic via `@openldr/bootstrap`. See [[cli-operator-parity]].
- **UI conventions** — always shadcn/ui controls, never native `<select>`; edge-to-edge dividers via `@/components/ui/bleed`; `StripedEmpty`/`Spinner` for empty/loading; kebab menus for row actions; `TruncatedText` for clipped labels. See [[use-shadcn-components]], [[corlix-design-source-of-truth]].
- **No hardcoding of vocabularies** — the capability catalog is app-structural config (allowed), but its labels/descriptions are defined once in `@openldr/rbac` and reused; never duplicate cap strings across files.
- **i18n** — user-facing strings go through `react-i18next`; add keys to `en.ts`, `fr.ts`, `pt.ts`.
- **DB tests** use pg-mem via the existing `packages/db/src/migrations/internal/test-helpers.ts` harness; run all migrations then assert.
- **Migrations** are append-only, numbered; next free number is **062**. Register in `packages/db/src/migrations/internal/index.ts` AND add the table interface to `packages/db/src/schema/internal.ts`.
- **Verification gate** (run before declaring any slice done): `pnpm turbo typecheck test` (repo convention — see [[repo-conventions]]). Lint only runs meaningfully in `apps/server`.

## Key identifiers (locked — use these exact names across tasks)

- Package: `@openldr/rbac`. Exports: `CAPABILITIES`, `CAPABILITY_KEYS`, `CAPABILITY_GROUPS`, `SYSTEM_ROLES`, `slugify`, and types `CapabilityKey`, `CapabilityMeta`, `CapabilityGroup`, `SystemRoleDef`.
- Store: `createRoleStore(db)` → `RoleStore` in `packages/db/src/role-store.ts`.
- Guard: `requireCapability(cap: CapabilityKey)` in `apps/server/src/rbac.ts` (alongside the retained `requireRole`).
- Request field: `req.user.capabilities: string[]` (added to `RequestActor`).
- Route file: `apps/server/src/roles-routes.ts` → `registerRolesRoutes(app, ctx)`.
- AppContext field: `ctx.roles: RoleStore`.
- Frontend: `useAuth().hasCapability(cap)`, `<RequireCapability cap="…">`, page `apps/studio/src/pages/Roles.tsx`, sheet `apps/studio/src/roles/RoleSheet.tsx`.
- **`user_roles.user_id` = the Keycloak subject** (the directory/`user_profiles` id), NOT the local `users.id`. Capability resolution keys off the token `sub`. This mirrors how `user_profiles` is already keyed.

---

## Slice 1 — Model, catalog, store, migration

### Task 1: `@openldr/rbac` package — capability catalog, presets, slugify

**Files:**
- Create: `packages/rbac/package.json`
- Create: `packages/rbac/tsconfig.json`
- Create: `packages/rbac/src/index.ts`
- Create: `packages/rbac/src/catalog.ts`
- Create: `packages/rbac/src/presets.ts`
- Create: `packages/rbac/src/slug.ts`
- Test: `packages/rbac/src/catalog.test.ts`
- Test: `packages/rbac/src/presets.test.ts`
- Test: `packages/rbac/src/slug.test.ts`

**Interfaces:**
- Produces: `CAPABILITIES: CapabilityMeta[]`, `CAPABILITY_KEYS: readonly string[]`, `CAPABILITY_GROUPS: CapabilityGroup[]`, `SYSTEM_ROLES: SystemRoleDef[]`, `slugify(input: string): string`.
- Types: `CapabilityKey = string`; `CapabilityMeta = { key: string; group: string; label: string; description: string }`; `CapabilityGroup = { key: string; label: string; capabilities: CapabilityMeta[] }`; `SystemRoleDef = { slug: string; name: string; description: string; locked: boolean; capabilities: string[] }`.

This is a pure package — **no Node built-ins, no imports** — so the browser bundle can import it (mirrors `@openldr/dashboards` / `@openldr/forms/pure`, the packages studio already imports).

- [ ] **Step 1: Create `packages/rbac/package.json`**

```json
{
  "name": "@openldr/rbac",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Confirm the exact `typescript`/`vitest` versions match a sibling pure package (`cat packages/dashboards/package.json`) and copy those version strings so the workspace stays consistent.

- [ ] **Step 2: Create `packages/rbac/tsconfig.json`**

Copy `packages/dashboards/tsconfig.json` verbatim (same compiler settings; it is a pure library). Run `cat packages/dashboards/tsconfig.json` and reproduce it.

- [ ] **Step 3: Write the failing catalog test**

`packages/rbac/src/catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS, CAPABILITY_GROUPS } from './catalog';

describe('capability catalog', () => {
  it('exposes 36 unique capability keys', () => {
    expect(CAPABILITY_KEYS.length).toBe(36);
    expect(new Set(CAPABILITY_KEYS).size).toBe(36);
  });

  it('every capability belongs to a declared group', () => {
    const groupKeys = new Set(CAPABILITY_GROUPS.map((g) => g.key));
    for (const c of CAPABILITIES) expect(groupKeys.has(c.group)).toBe(true);
  });

  it('every capability has a non-empty label and description', () => {
    for (const c of CAPABILITIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('groups partition the catalog with no orphan or duplicate', () => {
    const flat = CAPABILITY_GROUPS.flatMap((g) => g.capabilities.map((c) => c.key));
    expect(flat.sort()).toEqual([...CAPABILITY_KEYS].sort());
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (`vitest run` in `packages/rbac`) — "Cannot find module './catalog'".

- [ ] **Step 5: Implement `packages/rbac/src/catalog.ts`**

```ts
export interface CapabilityMeta {
  key: string;
  group: string;
  label: string;
  description: string;
}
export interface CapabilityGroup {
  key: string;
  label: string;
  capabilities: CapabilityMeta[];
}

// One row per capability. `group` matches a CAPABILITY_GROUPS key. Order within a
// group is the display order in the builder grid. Keep keys stable — they are
// persisted in role_capabilities and referenced by requireCapability(...).
const RAW: Omit<CapabilityMeta, never>[] = [
  // Dashboards
  { key: 'dashboards.view', group: 'dashboards', label: 'View dashboards', description: 'Open the Dashboards workspace and see activity widgets.' },
  { key: 'dashboards.create', group: 'dashboards', label: 'Create dashboards', description: 'Add new dashboards.' },
  { key: 'dashboards.edit', group: 'dashboards', label: 'Edit dashboards', description: 'Modify dashboard layout and widgets.' },
  { key: 'dashboards.delete', group: 'dashboards', label: 'Delete dashboards', description: 'Remove dashboards.' },
  // Reports
  { key: 'reports.view', group: 'reports', label: 'View reports', description: 'Open the Reports workspace and see report definitions.' },
  { key: 'reports.run', group: 'reports', label: 'Run reports', description: 'Execute and preview reports.' },
  { key: 'reports.export', group: 'reports', label: 'Export reports', description: 'Download report output (PDF/data).' },
  { key: 'reports.edit_templates', group: 'reports', label: 'Edit report templates', description: 'Create and edit report definitions, categories, and designs.' },
  // Forms
  { key: 'forms.view', group: 'forms', label: 'Use forms', description: 'Open and submit forms (data entry).' },
  { key: 'forms.edit', group: 'forms', label: 'Edit forms', description: 'Create and modify form definitions; export form bundles.' },
  { key: 'forms.publish', group: 'forms', label: 'Publish forms', description: 'Publish new form versions.' },
  // Workflows
  { key: 'workflows.view', group: 'workflows', label: 'View workflows', description: 'Open the Workflows workspace and see definitions and runs.' },
  { key: 'workflows.edit', group: 'workflows', label: 'Edit workflows', description: 'Create and modify workflow definitions.' },
  { key: 'workflows.run', group: 'workflows', label: 'Run workflows', description: 'Trigger workflow executions.' },
  { key: 'workflows.manage_secrets', group: 'workflows', label: 'Manage workflow secrets', description: 'View and set encrypted workflow secrets.' },
  // Query
  { key: 'query.run', group: 'query', label: 'Use query workbench', description: 'Run ad-hoc SQL queries against analytics data.' },
  // Users
  { key: 'users.view', group: 'users', label: 'View users', description: 'Open the Users workspace and see accounts.' },
  { key: 'users.manage', group: 'users', label: 'Manage users', description: 'Create, edit, enable, and disable user accounts.' },
  { key: 'users.reset_password', group: 'users', label: 'Reset passwords', description: "Reset a user's password or send a reset email." },
  { key: 'users.force_logout', group: 'users', label: 'Force logout', description: 'End all of a user’s active sessions.' },
  // Roles
  { key: 'roles.view', group: 'roles', label: 'View roles', description: 'Open the Roles workspace and see roles and their capabilities.' },
  { key: 'roles.manage', group: 'roles', label: 'Manage roles', description: 'Create, edit, delete roles and assign them to users.' },
  // Terminology
  { key: 'terminology.view', group: 'terminology', label: 'Browse terminology', description: 'Browse coding systems, value sets, and mappings.' },
  { key: 'terminology.manage', group: 'terminology', label: 'Manage terminology', description: 'Import, edit, and build terminology and ontologies.' },
  // Marketplace
  { key: 'marketplace.view', group: 'marketplace', label: 'View marketplace', description: 'Browse available and installed plugins.' },
  { key: 'marketplace.manage', group: 'marketplace', label: 'Manage marketplace', description: 'Install, publish, enable, disable, and remove plugins and registries.' },
  // Connectors
  { key: 'connectors.manage', group: 'connectors', label: 'Manage connectors', description: 'Configure external database and service connectors.' },
  // Sync
  { key: 'sync.view', group: 'sync', label: 'View sync', description: 'See lab⇄central sync status and activity.' },
  { key: 'sync.manage', group: 'sync', label: 'Manage sync', description: 'Configure sync, enroll sites, and resolve divergences.' },
  // Settings
  { key: 'settings.view', group: 'settings', label: 'View settings', description: 'Open the Settings workspace.' },
  { key: 'settings.edit_general', group: 'settings', label: 'Edit general settings', description: 'Change general, number, and validation settings.' },
  { key: 'settings.feature_flags', group: 'settings', label: 'Manage feature flags', description: 'Toggle feature flags.' },
  { key: 'settings.danger_zone', group: 'settings', label: 'Danger zone', description: 'Run destructive maintenance actions.' },
  // Observability
  { key: 'activity.view', group: 'observability', label: 'View activity', description: 'See the payload-lifecycle activity feed.' },
  { key: 'notifications.view', group: 'observability', label: 'View notifications', description: 'Receive notifications and set preferences.' },
  // Audit
  { key: 'audit.view', group: 'audit', label: 'View audit log', description: 'Read the audit event log.' },
];

const GROUP_LABELS: Record<string, string> = {
  dashboards: 'Dashboards',
  reports: 'Reports',
  forms: 'Forms',
  workflows: 'Workflows',
  query: 'Query',
  users: 'Users',
  roles: 'Roles',
  terminology: 'Terminology',
  marketplace: 'Marketplace',
  connectors: 'Connectors',
  sync: 'Sync',
  settings: 'Settings',
  observability: 'Observability',
  audit: 'Audit',
};

export const CAPABILITIES: CapabilityMeta[] = RAW;
export const CAPABILITY_KEYS: readonly string[] = RAW.map((c) => c.key);

// Preserve first-seen group order from RAW.
const _order: string[] = [];
for (const c of RAW) if (!_order.includes(c.group)) _order.push(c.group);
export const CAPABILITY_GROUPS: CapabilityGroup[] = _order.map((g) => ({
  key: g,
  label: GROUP_LABELS[g] ?? g,
  capabilities: RAW.filter((c) => c.group === g),
}));

export function isCapabilityKey(k: string): boolean {
  return CAPABILITY_KEYS.includes(k);
}
```

- [ ] **Step 6: Run catalog test — expect PASS.**

- [ ] **Step 7: Write the failing slug test**

`packages/rbac/src/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Content Editor')).toBe('content-editor');
  });
  it('strips unsafe characters and collapses separators', () => {
    expect(slugify('  Lab  Manager!! ')).toBe('lab-manager');
    expect(slugify('a__b--c')).toBe('a-b-c');
  });
  it('returns empty string for all-unsafe input', () => {
    expect(slugify('!!!')).toBe('');
  });
});
```

- [ ] **Step 8: Run — expect FAIL.**

- [ ] **Step 9: Implement `packages/rbac/src/slug.ts`**

```ts
/** Alias-safe slug: lowercase, [a-z0-9-] only, no leading/trailing/repeated hyphens. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
```

- [ ] **Step 10: Run slug test — expect PASS.**

- [ ] **Step 11: Write the failing presets test**

`packages/rbac/src/presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES } from './presets';
import { CAPABILITY_KEYS } from './catalog';

describe('system role presets', () => {
  it('defines the five system roles by slug', () => {
    expect(SYSTEM_ROLES.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'],
    );
  });

  it('administrator (lab_admin) holds every capability and is locked', () => {
    const admin = SYSTEM_ROLES.find((r) => r.slug === 'lab_admin')!;
    expect(admin.locked).toBe(true);
    expect(admin.capabilities.sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it('technician is data-entry-only', () => {
    const tech = SYSTEM_ROLES.find((r) => r.slug === 'lab_technician')!;
    expect(tech.capabilities).toEqual(['forms.view']);
  });

  it('only administrator is locked', () => {
    expect(SYSTEM_ROLES.filter((r) => r.locked).map((r) => r.slug)).toEqual(['lab_admin']);
  });

  it('every preset capability is a real catalog key', () => {
    const keys = new Set(CAPABILITY_KEYS);
    for (const r of SYSTEM_ROLES) for (const c of r.capabilities) expect(keys.has(c)).toBe(true);
  });
});
```

- [ ] **Step 12: Run — expect FAIL.**

- [ ] **Step 13: Implement `packages/rbac/src/presets.ts`**

The presets encode the exact matrix from the design spec (`docs/superpowers/specs/2026-07-24-capability-roles-rbac-design.md`), derived from today's real guards so the cutover changes nobody's access.

```ts
import { CAPABILITY_KEYS } from './catalog';

export interface SystemRoleDef {
  slug: string;
  name: string;
  description: string;
  locked: boolean;
  capabilities: string[];
}

const MANAGER = [
  'dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.delete',
  'reports.view', 'reports.run', 'reports.export', 'reports.edit_templates',
  'forms.view', 'forms.edit', 'forms.publish',
  'workflows.view', 'workflows.edit', 'workflows.run', 'workflows.manage_secrets',
  'query.run',
  'terminology.view', 'terminology.manage',
  'activity.view', 'notifications.view',
];

const ANALYST = [
  'dashboards.view',
  'reports.view', 'reports.run', 'reports.export',
  'forms.view',
  'query.run',
  'terminology.view',
  'activity.view', 'notifications.view',
];

const AUDITOR = [
  'dashboards.view',
  'reports.view',
  'forms.view',
  'terminology.view',
  'activity.view', 'notifications.view',
  'audit.view',
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { slug: 'lab_admin', name: 'Administrator', description: 'Full access to every capability.', locked: true, capabilities: [...CAPABILITY_KEYS] },
  { slug: 'lab_manager', name: 'Lab Manager', description: 'Manage content and analytics; no admin, users, or settings.', locked: false, capabilities: MANAGER },
  { slug: 'data_analyst', name: 'Data Analyst', description: 'View dashboards, run and export reports, use the query workbench.', locked: false, capabilities: ANALYST },
  { slug: 'system_auditor', name: 'System Auditor', description: 'Read-only oversight plus the audit log.', locked: false, capabilities: AUDITOR },
  { slug: 'lab_technician', name: 'Lab Technician', description: 'Bench data entry — fill and submit forms only.', locked: false, capabilities: ['forms.view'] },
];
```

- [ ] **Step 14: Run presets test — expect PASS.**

- [ ] **Step 15: Implement `packages/rbac/src/index.ts`**

```ts
export * from './catalog';
export * from './presets';
export * from './slug';
```

- [ ] **Step 16: Register the package in the workspace and verify build**

Add `@openldr/rbac` to the consuming packages' deps as they are wired later. For now confirm the package typechecks and tests pass in isolation.

Run: `pnpm --filter @openldr/rbac typecheck && pnpm --filter @openldr/rbac test`
Expected: typecheck clean, all three test files PASS.

- [ ] **Step 17: Commit**

```bash
git add packages/rbac
git commit -m "feat(rbac): capability catalog, system-role presets, slugify (pure @openldr/rbac)"
```

---

### Task 2: Migration 062 — `roles`, `role_capabilities`, `user_roles`, `users.rbac_initialized`

**Files:**
- Create: `packages/db/src/migrations/internal/062_rbac.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (import + register `062_rbac`)
- Modify: `packages/db/src/schema/internal.ts` (add table interfaces + `InternalSchema` entries)
- Test: `packages/db/src/migrations/internal/062_rbac.test.ts`

**Interfaces:**
- Produces tables: `roles(id, slug UNIQUE, name, description, is_system, created_at, updated_at)`, `role_capabilities(role_id, capability)` PK both, `user_roles(user_id, role_id)` PK both; and column `users.rbac_initialized boolean NOT NULL DEFAULT false`.

- [ ] **Step 1: Write the failing migration test**

`062_rbac.test.ts` (follow the harness in a sibling test, e.g. `056_sync_divergences.test.ts`, for how to spin up pg-mem + run migrations):

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

describe('062_rbac', () => {
  it('creates rbac tables and the users.rbac_initialized column', async () => {
    const db = await makeMigratedDb();
    // insert a role + capability + assignment round-trips
    await db.insertInto('roles').values({ id: 'r1', slug: 'content-editor', name: 'Content editor', description: null, is_system: false }).execute();
    await db.insertInto('role_capabilities').values({ role_id: 'r1', capability: 'dashboards.edit' }).execute();
    await db.insertInto('user_roles').values({ user_id: 'sub-1', role_id: 'r1' }).execute();

    const caps = await db.selectFrom('user_roles')
      .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
      .select('role_capabilities.capability')
      .where('user_roles.user_id', '=', 'sub-1')
      .execute();
    expect(caps.map((c) => c.capability)).toEqual(['dashboards.edit']);

    // rbac_initialized defaults false
    await db.insertInto('users').values({ id: 'u1', username: 'bob', roles: JSON.stringify([]) as never }).execute();
    const u = await db.selectFrom('users').select(['rbac_initialized']).where('id', '=', 'u1').executeTakeFirstOrThrow();
    expect(Boolean(u.rbac_initialized)).toBe(false);
  });

  it('slug is unique', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('roles').values({ id: 'a', slug: 'dup', name: 'A', description: null, is_system: false }).execute();
    await expect(
      db.insertInto('roles').values({ id: 'b', slug: 'dup', name: 'B', description: null, is_system: false }).execute(),
    ).rejects.toThrow();
  });
});
```

> Check `test-helpers.ts` for the actual exported helper name; if it is not `makeMigratedDb`, use whatever the sibling migration tests import.

- [ ] **Step 2: Run — expect FAIL** (no `roles` table / unknown column).

- [ ] **Step 3: Write the migration `062_rbac.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('roles')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('role_capabilities')
    .ifNotExists()
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addColumn('capability', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('role_capabilities_pk', ['role_id', 'capability'])
    .execute();

  await db.schema
    .createTable('user_roles')
    .ifNotExists()
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('user_roles_pk', ['user_id', 'role_id'])
    .execute();

  await db.schema
    .createIndex('role_capabilities_role_idx').ifNotExists()
    .on('role_capabilities').column('role_id').execute();
  await db.schema
    .createIndex('user_roles_user_idx').ifNotExists()
    .on('user_roles').column('user_id').execute();

  // One-time backfill guard (see auth-plugin login backfill). Default false so
  // existing users get their token roles mapped to system roles on next login.
  await db.schema
    .alterTable('users')
    .addColumn('rbac_initialized', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('rbac_initialized').execute();
  await db.schema.dropTable('user_roles').ifExists().execute();
  await db.schema.dropTable('role_capabilities').ifExists().execute();
  await db.schema.dropTable('roles').ifExists().execute();
}
```

- [ ] **Step 4: Add table interfaces to `schema/internal.ts`**

Add near `UsersTable` and register in `InternalSchema`:

```ts
export interface RolesTable {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export interface RoleCapabilitiesTable {
  role_id: string;
  capability: string;
}
export interface UserRolesTable {
  user_id: string; // Keycloak subject (directory id), NOT local users.id
  role_id: string;
}
```

Add `rbac_initialized: Generated<boolean>;` to `UsersTable`. Add to `InternalSchema`:

```ts
  roles: RolesTable;
  role_capabilities: RoleCapabilitiesTable;
  user_roles: UserRolesTable;
```

- [ ] **Step 5: Register the migration in `migrations/internal/index.ts`**

Add `import * as m062 from './062_rbac';` with the others, and in `internalMigrations`:

```ts
  '062_rbac': { up: m062.up, down: m062.down },
```

- [ ] **Step 6: Run — expect PASS.**

Run: `pnpm --filter @openldr/db test -- 062_rbac`
Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/062_rbac.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/internal/062_rbac.test.ts
git commit -m "feat(rbac): migration 062 — roles, role_capabilities, user_roles, users.rbac_initialized"
```

---

### Task 3: `RoleStore` — CRUD, capability resolution, assignment, lockout invariants, backfill

**Files:**
- Create: `packages/db/src/role-store.ts`
- Modify: `packages/db/src/index.ts` (export `createRoleStore`, `RoleStore`, role types)
- Test: `packages/db/src/role-store.test.ts`

**Interfaces:**
- Consumes: `InternalSchema` (Kysely), `@openldr/rbac` (`SYSTEM_ROLES`, `CAPABILITY_KEYS`, `slugify`).
- Produces `RoleStore`:
  - `list(): Promise<RoleRecord[]>` (each with `capabilities: string[]` and `memberCount: number`)
  - `get(id): Promise<RoleRecord | null>`
  - `getBySlug(slug): Promise<RoleRecord | null>`
  - `create(input: { name; slug?; description?; capabilities: string[] }): Promise<RoleRecord>`
  - `update(id, patch: { name?; description?; capabilities?: string[] }): Promise<RoleRecord>`
  - `remove(id): Promise<void>`
  - `resolveCapabilities(subject: string): Promise<string[]>` (union across assigned roles)
  - `assignRole(subject, roleId): Promise<void>` / `unassignRole(subject, roleId): Promise<void>`
  - `rolesForUser(subject): Promise<RoleRecord[]>`
  - `seedSystemRoles(): Promise<void>` (idempotent)
  - `backfillUserFromRoleNames(subject, roleNames: string[]): Promise<void>`
- `RoleRecord = { id; slug; name; description: string|null; isSystem: boolean; locked: boolean; capabilities: string[]; memberCount: number }`. `locked` is true only for the `lab_admin` system role.

Invariants enforced (throw `OpenLdrError` from `@openldr/core`):
- `create`/`update` reject unknown capability keys (not in `CAPABILITY_KEYS`).
- `update` on the locked `lab_admin` role rejects capability/name changes.
- `remove` rejects a system role, and rejects removing the last role that grants `roles.manage`.
- `unassignRole` rejects if it would leave zero users holding `roles.manage`.

- [ ] **Step 1: Write failing tests** `role-store.test.ts` (use pg-mem harness like other db store tests, e.g. `connector-store.test.ts`). Cover:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createRoleStore } from './role-store';

describe('RoleStore', () => {
  it('seedSystemRoles is idempotent and creates 5 roles with preset caps', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    await store.seedSystemRoles(); // twice — no duplicates
    const roles = await store.list();
    expect(roles.length).toBe(5);
    const admin = roles.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
    expect(admin.capabilities).toContain('roles.manage');
  });

  it('resolveCapabilities returns the union across assigned roles', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const analyst = (await store.getBySlug('data_analyst'))!;
    const auditor = (await store.getBySlug('system_auditor'))!;
    await store.assignRole('sub-x', analyst.id);
    await store.assignRole('sub-x', auditor.id);
    const caps = await store.resolveCapabilities('sub-x');
    expect(caps).toContain('query.run');   // from analyst
    expect(caps).toContain('audit.view');  // from auditor
    expect(new Set(caps).size).toBe(caps.length); // deduped
  });

  it('create rejects unknown capability', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await expect(store.create({ name: 'X', capabilities: ['not.a.cap'] })).rejects.toThrow();
  });

  it('cannot edit or delete the locked administrator role', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    await expect(store.update(admin.id, { capabilities: ['forms.view'] })).rejects.toThrow();
    await expect(store.remove(admin.id)).rejects.toThrow();
  });

  it('cannot unassign the last roles.manage holder', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    await store.assignRole('sub-admin', admin.id);
    await expect(store.unassignRole('sub-admin', admin.id)).rejects.toThrow();
  });

  it('backfillUserFromRoleNames maps token role names to system roles once', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    await store.backfillUserFromRoleNames('sub-y', ['lab_manager', 'unknown_role']);
    const caps = await store.resolveCapabilities('sub-y');
    expect(caps).toContain('workflows.edit');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no `role-store`).

- [ ] **Step 3: Implement `role-store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { OpenLdrError } from '@openldr/core';
import { CAPABILITY_KEYS, SYSTEM_ROLES, slugify } from '@openldr/rbac';
import type { InternalSchema } from './schema/internal';

export interface RoleRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  locked: boolean;
  capabilities: string[];
  memberCount: number;
}

export interface CreateRoleInput { name: string; slug?: string; description?: string | null; capabilities: string[]; }
export interface UpdateRoleInput { name?: string; description?: string | null; capabilities?: string[]; }

export interface RoleStore {
  list(): Promise<RoleRecord[]>;
  get(id: string): Promise<RoleRecord | null>;
  getBySlug(slug: string): Promise<RoleRecord | null>;
  create(input: CreateRoleInput): Promise<RoleRecord>;
  update(id: string, patch: UpdateRoleInput): Promise<RoleRecord>;
  remove(id: string): Promise<void>;
  resolveCapabilities(subject: string): Promise<string[]>;
  rolesForUser(subject: string): Promise<RoleRecord[]>;
  assignRole(subject: string, roleId: string): Promise<void>;
  unassignRole(subject: string, roleId: string): Promise<void>;
  setUserRoles(subject: string, roleIds: string[]): Promise<void>;
  seedSystemRoles(): Promise<void>;
  backfillUserFromRoleNames(subject: string, roleNames: string[]): Promise<void>;
}

const LOCKED_SLUG = 'lab_admin';

function validateCaps(caps: string[]): void {
  const known = new Set(CAPABILITY_KEYS);
  for (const c of caps) if (!known.has(c)) throw new OpenLdrError(`unknown capability: ${c}`);
}

export function createRoleStore(db: Kysely<InternalSchema>): RoleStore {
  async function capsFor(roleId: string): Promise<string[]> {
    const rows = await db.selectFrom('role_capabilities').select('capability').where('role_id', '=', roleId).execute();
    return rows.map((r) => r.capability);
  }
  async function memberCount(roleId: string): Promise<number> {
    const r = await db.selectFrom('user_roles').select(db.fn.countAll<string>().as('n')).where('role_id', '=', roleId).executeTakeFirst();
    return Number(r?.n ?? 0);
  }
  async function toRecord(row: { id: string; slug: string; name: string; description: string | null; is_system: boolean }): Promise<RoleRecord> {
    return {
      id: row.id, slug: row.slug, name: row.name, description: row.description,
      isSystem: Boolean(row.is_system), locked: row.slug === LOCKED_SLUG,
      capabilities: await capsFor(row.id), memberCount: await memberCount(row.id),
    };
  }
  async function getRow(id: string) {
    return db.selectFrom('roles').select(['id', 'slug', 'name', 'description', 'is_system']).where('id', '=', id).executeTakeFirst();
  }

  // Count distinct users whose union of role caps includes `roles.manage`.
  async function manageHolderCount(): Promise<number> {
    const rows = await db.selectFrom('user_roles')
      .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
      .select('user_roles.user_id')
      .where('role_capabilities.capability', '=', 'roles.manage')
      .groupBy('user_roles.user_id')
      .execute();
    return rows.length;
  }
  async function userHasManageWithout(subject: string, excludeRoleId: string): Promise<boolean> {
    const rows = await db.selectFrom('user_roles')
      .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
      .select('role_capabilities.capability')
      .where('user_roles.user_id', '=', subject)
      .where('user_roles.role_id', '!=', excludeRoleId)
      .where('role_capabilities.capability', '=', 'roles.manage')
      .execute();
    return rows.length > 0;
  }

  async function writeCaps(roleId: string, caps: string[]): Promise<void> {
    await db.deleteFrom('role_capabilities').where('role_id', '=', roleId).execute();
    if (caps.length) {
      await db.insertInto('role_capabilities').values(caps.map((c) => ({ role_id: roleId, capability: c }))).execute();
    }
  }

  return {
    async list() {
      const rows = await db.selectFrom('roles').select(['id', 'slug', 'name', 'description', 'is_system']).orderBy('is_system', 'desc').orderBy('name').execute();
      return Promise.all(rows.map(toRecord));
    },
    async get(id) { const r = await getRow(id); return r ? toRecord(r) : null; },
    async getBySlug(slug) {
      const r = await db.selectFrom('roles').select(['id', 'slug', 'name', 'description', 'is_system']).where('slug', '=', slug).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async create(input) {
      validateCaps(input.capabilities);
      const slug = (input.slug && slugify(input.slug)) || slugify(input.name);
      if (!slug) throw new OpenLdrError('role slug cannot be empty');
      const id = randomUUID();
      await db.insertInto('roles').values({ id, slug, name: input.name, description: input.description ?? null, is_system: false }).execute();
      await writeCaps(id, input.capabilities);
      return (await this.get(id))!;
    },
    async update(id, patch) {
      const row = await getRow(id);
      if (!row) throw new OpenLdrError(`role ${id} not found`);
      if (row.slug === LOCKED_SLUG) throw new OpenLdrError('the Administrator role cannot be modified');
      if (patch.capabilities) validateCaps(patch.capabilities);
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      await db.updateTable('roles').set(set).where('id', '=', id).execute();
      if (patch.capabilities) await writeCaps(id, patch.capabilities);
      return (await this.get(id))!;
    },
    async remove(id) {
      const row = await getRow(id);
      if (!row) return;
      if (row.is_system) throw new OpenLdrError('system roles cannot be deleted');
      // Guard: don't orphan roles.manage globally.
      const caps = await capsFor(id);
      if (caps.includes('roles.manage')) {
        const others = await db.selectFrom('role_capabilities').select('role_id')
          .where('capability', '=', 'roles.manage').where('role_id', '!=', id).execute();
        if (others.length === 0) throw new OpenLdrError('cannot delete the last role granting roles.manage');
      }
      await db.deleteFrom('role_capabilities').where('role_id', '=', id).execute();
      await db.deleteFrom('user_roles').where('role_id', '=', id).execute();
      await db.deleteFrom('roles').where('id', '=', id).execute();
    },
    async resolveCapabilities(subject) {
      const rows = await db.selectFrom('user_roles')
        .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
        .select('role_capabilities.capability')
        .where('user_roles.user_id', '=', subject).execute();
      return [...new Set(rows.map((r) => r.capability))];
    },
    async rolesForUser(subject) {
      const rows = await db.selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select(['roles.id', 'roles.slug', 'roles.name', 'roles.description', 'roles.is_system'])
        .where('user_roles.user_id', '=', subject).execute();
      return Promise.all(rows.map(toRecord));
    },
    async assignRole(subject, roleId) {
      await db.insertInto('user_roles').values({ user_id: subject, role_id: roleId })
        .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing()).execute();
    },
    async unassignRole(subject, roleId) {
      const caps = await capsFor(roleId);
      if (caps.includes('roles.manage')) {
        const stillHasViaOther = await userHasManageWithout(subject, roleId);
        if (!stillHasViaOther && (await manageHolderCount()) <= 1) {
          throw new OpenLdrError('cannot remove the last user holding roles.manage');
        }
      }
      await db.deleteFrom('user_roles').where('user_id', '=', subject).where('role_id', '=', roleId).execute();
    },
    async setUserRoles(subject, roleIds) {
      await db.deleteFrom('user_roles').where('user_id', '=', subject).execute();
      if (roleIds.length) {
        await db.insertInto('user_roles').values(roleIds.map((r) => ({ user_id: subject, role_id: r }))).execute();
      }
    },
    async seedSystemRoles() {
      for (const def of SYSTEM_ROLES) {
        const existing = await this.getBySlug(def.slug);
        if (existing) continue;
        const id = randomUUID();
        await db.insertInto('roles').values({ id, slug: def.slug, name: def.name, description: def.description, is_system: true }).execute();
        await writeCaps(id, def.capabilities);
      }
    },
    async backfillUserFromRoleNames(subject, roleNames) {
      for (const name of roleNames) {
        const role = await this.getBySlug(name);
        if (role) await this.assignRole(subject, role.id);
      }
    },
  };
}
```

> Note the `setUserRoles` bulk setter is used by the User dialog; `unassignRole`'s last-admin guard applies to the granular unassign path (CLI/route). The dialog path (`setUserRoles`) is guarded at the route layer (Task 7) which re-checks `manageHolderCount` after the write and rolls back if it hit zero.

- [ ] **Step 4: Export from `packages/db/src/index.ts`**

Add: `export { createRoleStore } from './role-store'; export type { RoleStore, RoleRecord, CreateRoleInput, UpdateRoleInput } from './role-store';`

- [ ] **Step 5: Run — expect PASS.** `pnpm --filter @openldr/db test -- role-store`

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/role-store.ts packages/db/src/role-store.test.ts packages/db/src/index.ts
git commit -m "feat(rbac): RoleStore — CRUD, capability resolution, assignment, lockout guards, seed/backfill"
```

---

### Task 4: Wire `RoleStore` into `AppContext` + seed system roles at startup

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (import `createRoleStore`, add `roles` to `AppContext`, construct it, call `seedSystemRoles()` in the seed path)
- Test: `packages/bootstrap/src/*.test.ts` (add a focused test that a built context exposes `ctx.roles` and that seeding produces 5 roles) — follow an existing bootstrap test for harness shape.

**Interfaces:**
- Consumes: `createRoleStore` (Task 3), `@openldr/rbac`.
- Produces: `ctx.roles: RoleStore` on `AppContext`.

- [ ] **Step 1: Add the import** next to the users import (`packages/bootstrap/src/index.ts:16` area):

```ts
import { createRoleStore, type RoleStore } from '@openldr/db';
```

- [ ] **Step 2: Add to the `AppContext` interface** (near line 275, beside `users`):

```ts
  roles: RoleStore;
```

- [ ] **Step 3: Construct it** (near line 370, beside `const users = createUserStore(...)`):

```ts
  const roles = createRoleStore(internal.db);
```

- [ ] **Step 4: Add `roles` to the returned context object** (near line 1202, beside `users,`):

```ts
    roles,
```

- [ ] **Step 5: Seed system roles in the seed path**

Find where fresh-install seeding runs (search `seed` in bootstrap — the same place feature flags / default data get seeded; see [[fresh-install-defaults]]). Add an idempotent call:

```ts
  await roles.seedSystemRoles();
```

Ensure it runs on both fresh install and existing-DB upgrade (idempotent, so calling on every boot's seed step is safe).

- [ ] **Step 6: Add `@openldr/rbac` + confirm `@openldr/db` deps**

Add `"@openldr/rbac": "workspace:*"` to `packages/db/package.json` and `packages/bootstrap/package.json` dependencies (db imports it in role-store; bootstrap transitively). Run `pnpm install`.

- [ ] **Step 7: Write/extend a bootstrap test** asserting `ctx.roles.list()` returns 5 seeded roles after the seed path runs. Run it — expect PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --filter @openldr/bootstrap typecheck
git add packages/bootstrap/src/index.ts packages/db/package.json packages/bootstrap/package.json pnpm-lock.yaml packages/bootstrap/src/*.test.ts
git commit -m "feat(rbac): wire RoleStore into AppContext and seed system roles at startup"
```

---

## Slice 2 — Server enforcement

### Task 5: Resolve capabilities per request in the auth plugin (+ one-time login backfill)

**Files:**
- Modify: `apps/server/src/auth-plugin.ts` (extend `RequestActor`, attach `capabilities`, run login backfill)
- Test: `apps/server/src/auth-plugin.test.ts`

**Interfaces:**
- Consumes: `ctx.roles.resolveCapabilities`, `ctx.roles.backfillUserFromRoleNames`, `realmRolesFromClaims` (existing).
- Produces: `req.user.capabilities: string[]` populated on every authenticated request; `RequestActor.capabilities`.

- [ ] **Step 1: Write failing tests** in `auth-plugin.test.ts`:
  - A request from a user with an assigned role exposes that role's caps on `req.user.capabilities` (assert via a probe route that returns `req.user`).
  - The dev-bypass actor gets **all** capabilities (`CAPABILITY_KEYS.length`).
  - First login of an un-initialized user with token realm role `lab_manager` backfills `user_roles` (second request resolves manager caps); `rbac_initialized` flips true and a later token change does NOT re-backfill.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Extend `RequestActor`** (`auth-plugin.ts:6`):

```ts
export interface RequestActor {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
  capabilities: string[];
}
```

- [ ] **Step 4: Dev actor gets all caps** — in `devActor`, import `CAPABILITY_KEYS` from `@openldr/rbac` and set `capabilities: [...CAPABILITY_KEYS]` on both return paths.

- [ ] **Step 5: Backfill + resolve in the authenticated branch** — after the existing `syncFromClaims` success (`auth-plugin.ts:117-123`), replace the `req.user = {...}` assignment with:

```ts
      // One-time migration: map the token's realm roles to system roles the first
      // time we see this user. After that, user_roles (DB) is authoritative.
      if (!u.rbacInitialized) {
        await ctx.roles.backfillUserFromRoleNames(u.subject ?? u.id, realmRolesFromClaims(claims));
        await ctx.users.markRbacInitialized(u.id);
      }
      const subject = u.subject ?? (claims as { sub?: string }).sub ?? u.id;
      const capabilities = await ctx.roles.resolveCapabilities(subject);
      req.user = { id: u.id, username: u.username, displayName: u.displayName, roles: realmRolesFromClaims(claims), capabilities };
```

- [ ] **Step 6: Extend `UserStore`** (`packages/users/src/store.ts`) with `rbacInitialized` on `User` (read from row) and a `markRbacInitialized(id)` method:

```ts
  async markRbacInitialized(id: string) {
    await db.updateTable('users').set({ rbac_initialized: true, updated_at: new Date() }).where('id', '=', id).execute();
  },
```

Add `rbacInitialized: boolean` to the `User` interface + `toUser` (`r.rbac_initialized === true`), add `rbac_initialized` to `COLS`, and add `markRbacInitialized(id: string): Promise<void>` to the `UserStore` interface. Add a store test for `markRbacInitialized`.

- [ ] **Step 7: Run — expect PASS.** (`pnpm --filter @openldr/server test -- auth-plugin`, `pnpm --filter @openldr/users test`)

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/auth-plugin.ts apps/server/src/auth-plugin.test.ts packages/users/src/store.ts packages/users/src/store.test.ts
git commit -m "feat(rbac): resolve per-request capabilities + one-time login backfill of token roles"
```

---

### Task 6: `requireCapability` guard + `GET /api/me/capabilities`

**Files:**
- Modify: `apps/server/src/rbac.ts` (add `requireCapability`, keep `requireRole`)
- Modify: `apps/server/src/app.ts` (add `/api/me/capabilities`; also include `capabilities` in `/api/me`)
- Test: `apps/server/src/rbac.test.ts`, `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: `req.user.capabilities` (Task 5).
- Produces: `requireCapability(cap: string)` preHandler; `GET /api/me/capabilities` → `{ capabilities: string[] }`.

- [ ] **Step 1: Write failing tests** in `rbac.test.ts`: a route guarded by `requireCapability('roles.manage')` returns 403 when `req.user.capabilities` lacks it, 200 when present, 401 when unauthenticated. In `app.test.ts`: `GET /api/me/capabilities` returns the caller's set.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Add `requireCapability` to `rbac.ts`**

```ts
/** preHandler guard: requires the request actor to hold `cap`. */
export function requireCapability(cap: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!req.user.capabilities.includes(cap)) {
      reply.code(403);
      return reply.send({ error: 'insufficient capability' });
    }
  };
}
```

- [ ] **Step 4: Add the route** in `app.ts` after `/api/me` (mind the `return reply`/return-object lint rule):

```ts
  app.get('/api/me/capabilities', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { error: 'authentication required' };
    }
    return { capabilities: req.user.capabilities };
  });
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/rbac.ts apps/server/src/rbac.test.ts apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "feat(rbac): requireCapability guard + GET /api/me/capabilities"
```

---

### Task 7: `roles-routes.ts` — role CRUD + user-role assignment (audited)

**Files:**
- Create: `apps/server/src/roles-routes.ts` → `registerRolesRoutes(app, ctx)`
- Modify: `apps/server/src/app.ts` (call `registerRolesRoutes(app, ctx)`)
- Test: `apps/server/src/roles-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.roles` (RoleStore), `requireCapability`, `recordAudit` (`audit-helper`).
- Produces routes (all mind the return-reply lint rule):
  - `GET /api/roles` (`roles.view`) → `RoleRecord[]`
  - `GET /api/roles/catalog` (`roles.view`) → `{ groups: CapabilityGroup[] }` (from `@openldr/rbac`)
  - `GET /api/roles/:id` (`roles.view`)
  - `POST /api/roles` (`roles.manage`) → 201 RoleRecord; audit `role.create`
  - `PUT /api/roles/:id` (`roles.manage`) → RoleRecord; audit `role.update`
  - `DELETE /api/roles/:id` (`roles.manage`) → 204; audit `role.delete`
  - `GET /api/users/:id/roles` (`roles.view` OR `users.view`) → `RoleRecord[]`
  - `PUT /api/users/:id/roles` (`roles.manage`) body `{ roleIds: string[] }` → applies via `setUserRoles`, re-checks the last-admin invariant, audits `user.assign_role`.

- [ ] **Step 1: Write failing tests** covering: create/list/update/delete happy paths; 403 without `roles.manage`; store invariant errors (locked role edit, last-admin) surface as HTTP 4xx (map `OpenLdrError` → 400/409); `PUT /api/users/:id/roles` writes assignments and rejects a set that would zero-out `roles.manage`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `roles-routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact, OpenLdrError } from '@openldr/core';
import { CAPABILITY_GROUPS } from '@openldr/rbac';
import { z } from 'zod';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const roleInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().nullish(),
  capabilities: z.array(z.string()).default([]),
});
const assignInput = z.object({ roleIds: z.array(z.string()) });

function isInvariant(e: unknown): e is OpenLdrError { return e instanceof OpenLdrError; }

export function registerRolesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const VIEW = { preHandler: requireCapability('roles.view') };
  const MANAGE = { preHandler: requireCapability('roles.manage') };

  app.get('/api/roles', VIEW, async () => ctx.roles.list());
  app.get('/api/roles/catalog', VIEW, async () => ({ groups: CAPABILITY_GROUPS }));

  app.get('/api/roles/:id', VIEW, async (req, reply) => {
    const r = await ctx.roles.get((req.params as { id: string }).id);
    if (!r) { reply.code(404); return { error: 'not found' }; }
    return r;
  });

  app.post('/api/roles', MANAGE, async (req, reply) => {
    const p = roleInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    try {
      const created = await ctx.roles.create(p.data);
      await recordAudit(ctx, req, { action: 'role.create', entityType: 'role', entityId: created.id, before: null, after: created as unknown as Record<string, unknown> });
      reply.code(201); return created;
    } catch (e) {
      if (isInvariant(e)) { reply.code(400); return { error: e.message }; }
      reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/roles/:id', MANAGE, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const p = roleInput.partial().safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.roles.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    try {
      const after = await ctx.roles.update(id, p.data);
      await recordAudit(ctx, req, { action: 'role.update', entityType: 'role', entityId: id, before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> });
      return after;
    } catch (e) {
      if (isInvariant(e)) { reply.code(400); return { error: e.message }; }
      reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.delete('/api/roles/:id', MANAGE, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await ctx.roles.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    try {
      await ctx.roles.remove(id);
      await recordAudit(ctx, req, { action: 'role.delete', entityType: 'role', entityId: id, before: before as unknown as Record<string, unknown>, after: null });
      reply.code(204); return null;
    } catch (e) {
      if (isInvariant(e)) { reply.code(409); return { error: e.message }; }
      reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.get('/api/users/:id/roles', VIEW, async (req) => ctx.roles.rolesForUser((req.params as { id: string }).id));

  app.put('/api/users/:id/roles', MANAGE, async (req, reply) => {
    const subject = (req.params as { id: string }).id;
    const p = assignInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.roles.rolesForUser(subject);
    try {
      await ctx.roles.setUserRoles(subject, p.data.roleIds);
      const after = await ctx.roles.rolesForUser(subject);
      await recordAudit(ctx, req, { action: 'user.assign_role', entityType: 'user', entityId: subject, before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> });
      return after;
    } catch (e) {
      if (isInvariant(e)) { reply.code(400); return { error: e.message }; }
      reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
```

> `setUserRoles` does not itself run the last-admin guard (it is a bulk replace). Add that check to the store's `setUserRoles` OR here before writing: if the removed set drops the caller's own `roles.manage` or drops the global last holder, throw `OpenLdrError`. Implement the guard in `setUserRoles` for a single source of truth: after the delete+insert, `manageHolderCount()` must be ≥ 1 (run inside a transaction; roll back + throw if it hits 0). Add a store test for this.

- [ ] **Step 4: Register in `app.ts`** — add `registerRolesRoutes(app, ctx);` beside `registerUsersRoutes(app, ctx);` and import it.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/roles-routes.ts apps/server/src/roles-routes.test.ts apps/server/src/app.ts packages/db/src/role-store.ts packages/db/src/role-store.test.ts
git commit -m "feat(rbac): role CRUD + user-role assignment routes with audit and last-admin guard"
```

---

### Task 8: Enforcement sweep — replace every `requireRole(...)` with `requireCapability(...)`

This task mechanically migrates each guarded route to its capability. **Do one route file per commit**, running that file's tests each time. For each file: import `requireCapability` from `./rbac`, replace the guard, and update the file's test to stub `req.user.capabilities` instead of `roles`.

**Mapping table (route file → guard → capability):**

| File | Current guard | New capability |
|---|---|---|
| `users-routes.ts` | `GET /api/users`, `GET /api/users/:id` | `users.view` |
| | `POST /api/users`, `PUT /api/users/:id`, `POST /api/users/:id/status` | `users.manage` |
| | `POST /api/users/:id/reset-password`, `.../send-reset-email` | `users.reset_password` |
| | `POST /api/users/:id/force-logout` | `users.force_logout` |
| `connectors-routes.ts` | all routes | `connectors.manage` |
| `activity-routes.ts` | `VIEW` | `activity.view` |
| `audit-routes.ts` | `VIEW` | `audit.view` |
| `notification-routes.ts` | `VIEW` | `notifications.view` |
| `query-routes.ts` | `GUARD` | `query.run` |
| `ontology-routes.ts` | `MANAGE` | `terminology.manage` |
| `terminology-admin-routes.ts` | `MANAGE`, `UPLOAD` | `terminology.manage` |
| `dashboards-routes.ts` | `VIEW` (get/list) | `dashboards.view` |
| | create route | `dashboards.create` |
| | update route | `dashboards.edit` |
| | delete route | `dashboards.delete` |
| `workflows-routes.ts` | list/get | `workflows.view` |
| | create/update/delete (`MANAGE`) | `workflows.edit` |
| | run/execute/trigger route | `workflows.run` |
| | secret get/set routes | `workflows.manage_secrets` |
| `forms-routes.ts` | read/list/published routes (currently ungated) | `forms.view` |
| | create/update routes (currently ungated) | `forms.edit` |
| | `GET /api/forms/:id/export-bundle` | `forms.edit` |
| | publish route (currently ungated) | `forms.publish` |
| `reports-routes.ts` | read/list routes | `reports.view` |
| | run/execute route | `reports.run` |
| | export/download route | `reports.export` |
| | `MANAGE` | `reports.edit_templates` |
| `report-categories-routes.ts` | `MANAGE` | `reports.edit_templates` |
| `report-defs-routes.ts` | `MANAGE` | `reports.edit_templates` |
| `report-designs-routes.ts` | `MANAGE` | `reports.edit_templates` |
| | `PREVIEW` | `reports.run` |
| `marketplace-routes.ts` | GET/list/available/installed routes | `marketplace.view` |
| | install/publish/registries write/enable/disable/rollback/detach/delete | `marketplace.manage` |
| `settings-routes.ts` | `GET/PUT /api/settings/flags*` | `settings.feature_flags` |
| | `numbers`, `validation` (get+put) | `settings.edit_general` |
| | `danger/:action` | `settings.danger_zone` |
| | `sync/status`, `sync/activity`, `sync/quarantine` (read) | `sync.view` |
| | all other `sync/*` (set/enroll/sites/rotate/revoke/amend/merge/divergences clear) | `sync.manage` |

> For **forms-routes** and **reports-routes**, the exact per-route split depends on the handlers present — open each file, and for any route not obviously read vs write, prefer the *view* capability for GET and the *edit/run* capability for mutating/executing routes. Any route that currently had **no** guard and now gets one is a deliberate tightening; because `forms.view` is in every system-role preset except technician-plus-forms, and technician keeps `forms.view`, no system role loses form access. If a specific ungated route would remove access a preset needs, note it in the commit message.

**Per-file loop (repeat for each row):**

- [ ] **Step A:** Open the route file; change `import { requireRole } from './rbac';` → `import { requireCapability } from './rbac';`.
- [ ] **Step B:** Replace each guard per the table. Example — `audit-routes.ts`:

```ts
// before
const VIEW = { preHandler: requireRole('lab_admin', 'system_auditor') };
// after
const VIEW = { preHandler: requireCapability('audit.view') };
```

Worked example — `dashboards-routes.ts` (guard splits by verb):

```ts
const VIEW = { preHandler: requireCapability('dashboards.view') };
const CREATE = { preHandler: requireCapability('dashboards.create') };
const EDIT = { preHandler: requireCapability('dashboards.edit') };
const DELETE = { preHandler: requireCapability('dashboards.delete') };
// apply VIEW to GET list/detail, CREATE to POST, EDIT to PUT/PATCH, DELETE to DELETE.
```

- [ ] **Step C:** Update that file's test: wherever the test sets a fake `req.user` with `roles: [...]`, set `capabilities: [...]` with the mapped caps (and keep `roles` for identity). If tests use a shared helper in `test-helpers.ts`, extend that helper to accept `capabilities` and default it to all caps for admin-context tests.
- [ ] **Step D:** Run the file's tests — expect PASS.
- [ ] **Step E:** Commit, e.g. `git commit -m "refactor(rbac): gate audit routes on audit.view capability"`.

- [ ] **Final step: full server suite + lint**

Run: `pnpm --filter @openldr/server lint && pnpm --filter @openldr/server test`
Expected: lint clean (return-reply rule satisfied), all tests PASS. Grep to confirm no stray `requireRole(` remains in route files: `grep -rn "requireRole(" apps/server/src` should show only `rbac.ts` (definition) and `rbac.test.ts`.

---

## Slice 3 — Studio UI

### Task 9: API client + `useAuth().hasCapability`

**Files:**
- Modify: `apps/studio/src/api.ts` (add role client fns + `getMyCapabilities`; extend `CurrentUser`? — no, capabilities come from a separate endpoint)
- Modify: `apps/studio/src/auth/AuthProvider.tsx` (fetch capabilities, expose `hasCapability`)
- Test: `apps/studio/src/auth/AuthProvider.test.tsx`

**Interfaces:**
- Produces (api.ts): `getMyCapabilities(): Promise<string[]>`, `listRoles()`, `getRoleCatalog()`, `getRole(id)`, `createRole(input)`, `updateRole(id, input)`, `deleteRole(id)`, `getUserRoles(id)`, `setUserRoles(id, roleIds)`, and types `RoleRecord`, `CapabilityGroup`.
- Produces (AuthProvider): `hasCapability(cap: string): boolean` on `AuthState`.

- [ ] **Step 1: Add types + client fns to `api.ts`**

```ts
export interface RoleRecord {
  id: string; slug: string; name: string; description: string | null;
  isSystem: boolean; locked: boolean; capabilities: string[]; memberCount: number;
}
export interface CapabilityMeta { key: string; group: string; label: string; description: string; }
export interface CapabilityGroup { key: string; label: string; capabilities: CapabilityMeta[]; }

export const getMyCapabilities = (): Promise<string[]> =>
  authFetch('/api/me/capabilities').then((r) => okJson<{ capabilities: string[] }>(r, 'get capabilities')).then((x) => x.capabilities);
export const listRoles = (): Promise<RoleRecord[]> => apiGet('/api/roles', 'list roles');
export const getRoleCatalog = (): Promise<{ groups: CapabilityGroup[] }> => apiGet('/api/roles/catalog', 'role catalog');
export const getRole = (id: string): Promise<RoleRecord> => apiGet(`/api/roles/${id}`, 'get role');
export const createRole = (input: { name: string; slug?: string; description?: string | null; capabilities: string[] }): Promise<RoleRecord> =>
  authFetch('/api/roles', jbody(input, 'POST')).then((r) => okJson<RoleRecord>(r, 'create role'));
export const updateRole = (id: string, input: { name?: string; description?: string | null; capabilities?: string[] }): Promise<RoleRecord> =>
  authFetch(`/api/roles/${id}`, jbody(input, 'PUT')).then((r) => okJson<RoleRecord>(r, 'update role'));
export const deleteRole = (id: string): Promise<void> =>
  authFetch(`/api/roles/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error(`delete role failed: ${r.status}`); });
export const getUserRoles = (id: string): Promise<RoleRecord[]> => apiGet(`/api/users/${id}/roles`, 'get user roles');
export const setUserRoles = (id: string, roleIds: string[]): Promise<RoleRecord[]> =>
  authFetch(`/api/users/${id}/roles`, jbody({ roleIds }, 'PUT')).then((r) => okJson<RoleRecord[]>(r, 'set user roles'));
```

> Match the exact helper names in `api.ts` (`apiGet`, `jbody`, `okJson`) — confirm by reading the top of the file; adjust if the helpers differ.

- [ ] **Step 2: Fetch capabilities in AuthProvider** — add `const [capabilities, setCapabilities] = useState<string[]>([])`, fetch `getMyCapabilities()` in the same place `getMe()` is called (both enforced and dev-bypass branches), and define `const hasCapability = (cap: string) => capabilities.includes(cap);`. Add `hasCapability` to `AuthState`, the default context, and the provider value. Keep `hasRole` for now (removed after Task 10 swaps all callers).

- [ ] **Step 3: Update `AuthProvider.test.tsx`** to stub `/api/me/capabilities` and assert `hasCapability` reflects it.

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @openldr/studio test -- AuthProvider`

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/auth/AuthProvider.tsx apps/studio/src/auth/AuthProvider.test.tsx
git commit -m "feat(rbac): studio API client for roles + hasCapability in AuthProvider"
```

---

### Task 10: `RequireCapability` + swap route gates and nav filters

**Files:**
- Create: `apps/studio/src/auth/RequireCapability.tsx`
- Modify: `apps/studio/src/App.tsx` (swap `RequireRole` → `RequireCapability`; add `/settings/roles` route)
- Modify: `apps/studio/src/shell/AppShell.tsx` (nav filter by capability; `NotificationBell` gate; admin-only nav)
- Modify: `apps/studio/src/pages/settings/SettingsShell.tsx` (sub-nav filter by capability)
- Modify: `apps/studio/src/pages/Reports.tsx`, `apps/studio/src/reports/NewReportSheet.tsx`, `apps/studio/src/pages/settings/General.tsx` (swap `hasRole(...)` checks to `hasCapability(...)`)
- Create: `apps/studio/src/auth/RequireCapability.test.tsx`

**Interfaces:**
- Consumes: `useAuth().hasCapability`.
- Produces: `<RequireCapability cap="…">` (single) / `caps={[...]}` (OR-list) gate.

- [ ] **Step 1: Write `RequireCapability.tsx`** (mirror `RequireRole.tsx`):

```tsx
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireCapability({ cap, caps, children }: { cap?: string; caps?: string[]; children: ReactNode }) {
  const { user, loading, hasCapability } = useAuth();
  if (loading) return null;
  const allowed = [...(cap ? [cap] : []), ...(caps ?? [])];
  const ok = allowed.length === 0 || allowed.some((c) => hasCapability(c));
  if (!user || !ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 2: Test it** (copy `RequireRole.test.tsx`, assert cap-gated redirect vs render).

- [ ] **Step 3: Swap route gates in `App.tsx`** per this mapping:

| Route | New gate |
|---|---|
| `/workflows`, `/workflows/new`, `/workflows/:id` | `cap="workflows.view"` |
| `/query` | `cap="query.run"` |
| `/users` | `cap="users.view"` |
| `/report-designer`, `/report-designer/:id` | `cap="reports.edit_templates"` |
| `/settings` (shell) | `cap="settings.view"` |
| `/settings/general` | `cap="settings.view"` |
| `/settings/notifications` | `cap="notifications.view"` |
| `/settings/sites` | `cap="sync.manage"` |
| `/settings/sync` | `cap="sync.view"` |
| `/settings/marketplace` | `cap="marketplace.view"` |
| `/settings/connectors` | `cap="connectors.manage"` |
| `/settings/roles` (NEW) | `cap="roles.view"` → `<Roles />` |
| `/x/:pluginId` | leave `<RequireRole>` with no role → replace with `<RequireCapability>` no cap (authed-only) |

Add the roles route and lazy-import `Roles` (Task 11).

- [ ] **Step 4: AppShell nav** — the `NAV` array items carry `roles?: string[]`; change to `caps?: string[]` and filter with `hasCapability`. Map each nav entry to its view cap (Dashboards→`dashboards.view`, Reports→`reports.view`, Workflows→`workflows.view`, Query→`query.run`, Users→`users.view`, Settings→`settings.view`). Replace the `hasRole('lab_admin')` block (AppShell.tsx:186) with the appropriate capability (e.g. Settings entry → `settings.view`). `NOTIFICATION_ROLES.some(...)` gate for `NotificationBell` → `hasCapability('notifications.view')`.

- [ ] **Step 5: SettingsShell sub-nav** — `SUB_NAV` items `roles` → `caps`; filter by `hasCapability`. Add a **Roles** sub-nav entry (`caps: ['roles.view']`). Map: General→`settings.view`, Notifications→`notifications.view`, Sites→`sync.manage`, Sync→`sync.view`, Marketplace→`marketplace.view`, Connectors→`connectors.manage`.

- [ ] **Step 6: Swap in-page `hasRole` checks:**
  - `Reports.tsx:34` `canManageSchedules = hasRole('lab_admin') || hasRole('lab_manager')` → `hasCapability('reports.edit_templates')`.
  - `NewReportSheet.tsx:51` `canManageCategories` → `hasCapability('reports.edit_templates')`.
  - `General.tsx:27` `isAdmin = hasRole('lab_admin')` → gate each control by its specific cap: general edits → `hasCapability('settings.edit_general')`, feature flags → `hasCapability('settings.feature_flags')`, danger zone → `hasCapability('settings.danger_zone')`.

- [ ] **Step 7: Remove `hasRole`/`RequireRole`** once no callers remain. `grep -rn "hasRole\|RequireRole" apps/studio/src` should return only test files you intend to delete/rename. Delete `RequireRole.tsx` + its test.

- [ ] **Step 8: Run studio tests** — fix any that referenced roles. `pnpm --filter @openldr/studio test`

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src
git commit -m "feat(rbac): capability-gated routes, nav, and in-page controls in studio"
```

---

### Task 11: `Settings → Roles` page + role builder sheet

**Files:**
- Create: `apps/studio/src/pages/Roles.tsx` (list)
- Create: `apps/studio/src/roles/RoleSheet.tsx` (create/edit with capability grid)
- Create: `apps/studio/src/roles/CapabilityGrid.tsx` (grouped checkboxes + select-all)
- Test: `apps/studio/src/roles/RoleSheet.test.tsx`, `apps/studio/src/pages/Roles.test.tsx`

**Interfaces:**
- Consumes: `listRoles`, `getRoleCatalog`, `createRole`, `updateRole`, `deleteRole`, `useAuth().hasCapability`.

- [ ] **Step 1: `Roles.tsx`** — a page listing roles (name, description via `TruncatedText`, `is_system` badge, member count, kebab menu with Edit / Delete). "Create role" button (shown only when `hasCapability('roles.manage')`). Use the same table/empty-state patterns as `Users.tsx` (read it first). Delete/edit disabled for `locked` roles; delete disabled for `isSystem`. Deleting prompts a confirm dialog (shadcn `AlertDialog`).

- [ ] **Step 2: `CapabilityGrid.tsx`** — given `groups: CapabilityGroup[]` and a `Set<string>` of selected keys + `onChange`, render one card per group with a per-group "Select all", a global "Select all" + "N of M selected" counter, and shadcn `Checkbox` per capability (label + description). Mirror the instatic layout in the reference screenshot. All controls disabled when `readOnly` (used for the locked Administrator role and when the user only has `roles.view`).

- [ ] **Step 3: `RoleSheet.tsx`** — shadcn `Sheet` with Name, Slug (auto-derived from name via `@openldr/rbac` `slugify`, editable; disabled for system roles), Description, and `<CapabilityGrid>`. On save, `createRole`/`updateRole`; surface server invariant errors inline. Fetch the catalog once via `getRoleCatalog`.

- [ ] **Step 4: Tests** — `RoleSheet.test.tsx`: selecting a group's "select all" checks all its caps; counter updates; save posts the selected capability keys. `Roles.test.tsx`: list renders, locked role's delete is disabled, create hidden without `roles.manage`.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: i18n** — add `roles.*` keys used by the page/sheet to `en.ts`, `fr.ts`, `pt.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/pages/Roles.tsx apps/studio/src/roles apps/studio/src/i18n
git commit -m "feat(rbac): Settings→Roles page + instatic-style capability builder sheet"
```

---

### Task 12: User dialog — role multi-select (replaces raw Keycloak roles field)

**Files:**
- Modify: `apps/studio/src/users/UserDialog.tsx` (role multi-select bound to `getUserRoles`/`setUserRoles`)
- Modify: `apps/studio/src/pages/Users.tsx` if it passes role data
- Test: `apps/studio/src/users/UserDialog.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `listRoles`, `getUserRoles`, `setUserRoles`.

- [ ] **Step 1:** In `UserDialog.tsx`, the user form currently maps a `roles` apiProperty to Keycloak roles (`CORE_KEYS` has `roles`, `splitAnswers` writes `identity.roles`). Replace that path: render a **role multi-select** (shadcn multi-select / checkbox list of `listRoles()` results) instead of the raw roles field, seeded from `getUserRoles(user.id)` when editing.
- [ ] **Step 2:** On save, after the identity create/update succeeds, call `setUserRoles(savedUser.id, selectedRoleIds)`. Remove `roles` from the `CORE_KEYS` identity path so it no longer writes Keycloak roles.
- [ ] **Step 3:** Handle the create case: the user id needed for `setUserRoles` is the returned directory id (`saved.id`) — call `setUserRoles(saved.id, ...)` after `createUser`.
- [ ] **Step 4: Test** the dialog seeds current roles on edit and calls `setUserRoles` with the selected ids on save.
- [ ] **Step 5: Run — expect PASS. Commit.**

```bash
git add apps/studio/src/users/UserDialog.tsx apps/studio/src/pages/Users.tsx apps/studio/src/users/UserDialog.test.tsx
git commit -m "feat(rbac): assign OpenLDR roles to users from the user dialog"
```

---

## Slice 4 — CLI + docs

### Task 13: CLI `roles` commands + `user assign-role`

**Files:**
- Create: `packages/cli/src/roles.ts`
- Modify: `packages/cli/src/index.ts` (register the `roles` command group + `user` role subcommands)
- Test: `packages/cli/src/roles.test.ts`

**Interfaces:**
- Consumes: `AppContext.roles` via the bootstrap context the CLI already builds (see how `settings.ts` obtains `ctx`).
- Produces commands:
  - `openldr roles list [--json]`
  - `openldr roles show <slug> [--json]`
  - `openldr roles create <name> [--slug <slug>] [--desc <text>] [--caps <c1,c2,...>]`
  - `openldr roles edit <slug> [--name <n>] [--desc <text>] [--caps <c1,c2,...>]`
  - `openldr roles delete <slug>`
  - `openldr roles grant <slug> <capability>` / `openldr roles revoke <slug> <capability>`
  - `openldr user assign-role <subject> <slug>` / `openldr user unassign-role <subject> <slug>`

- [ ] **Step 1: Write failing tests** (follow `settings.test.ts` for the harness that builds a ctx over pg-mem and invokes command actions). Cover: `roles list` prints seeded roles; `roles create` with `--caps` persists; `roles grant` adds a cap and rejects unknown caps; `user assign-role` writes an assignment; invariant errors exit non-zero with the message.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `roles.ts`** — export functions that take `(ctx, args, opts)` and call `ctx.roles.*`, mirroring the structure of `settings.ts`. `grant`/`revoke` read the current role, mutate the capability array, and call `ctx.roles.update`. Reuse `@openldr/rbac` `CAPABILITY_KEYS` to validate `--caps` before hitting the store (fail fast with a clear message). Print via the shared `format.ts` helpers; honor `--json`.

- [ ] **Step 4: Register in `index.ts`** — add a `const rolesCmd = program.command('roles')...` group beside `settings`, wiring each subcommand to the `roles.ts` functions; add `assign-role`/`unassign-role` under the existing `user` command group (find where `user` is registered — the `packages/cli/src/user.ts` group).

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/roles.ts packages/cli/src/roles.test.ts packages/cli/src/index.ts
git commit -m "feat(rbac): openldr CLI roles CRUD + grant/revoke + user role assignment"
```

---

### Task 14: Docs + memory + final verification

**Files:**
- Modify: relevant in-app docs page (search `apps/studio/src/docs` for the users/admin doc) to document Roles.
- Modify: memory (`MEMORY.md` + a new `roles-capabilities-workstream.md`).

- [ ] **Step 1: Add an in-app docs section** describing Settings → Roles: what capabilities are, the system roles, and how to assign roles to users. Follow the existing docs registry pattern.

- [ ] **Step 2: Run the FULL gate**

Run: `pnpm turbo typecheck test`
Expected: all packages green. Investigate any failure before proceeding. (Known flakes: see [[repo-conventions]].)

Run: `pnpm --filter @openldr/server lint`
Expected: clean.

- [ ] **Step 3: Grep guards** — confirm the sweep is complete:

```bash
grep -rn "requireRole(" apps/server/src        # only rbac.ts + rbac.test.ts
grep -rn "hasRole\|RequireRole" apps/studio/src # empty (or only intentionally-kept)
```

- [ ] **Step 4: Write a workstream memory** `roles-capabilities-workstream.md` summarizing: capability model (KC=auth, DB owns roles/caps/assignments), `@openldr/rbac` catalog, `user_roles` keyed by subject, one-time login backfill, lockout invariants, and status. Add a one-line pointer to `MEMORY.md`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/docs docs C:/Users/Fredrick/.claude/projects/D--Projects-Repositories-openldr-ce/memory
git commit -m "docs(rbac): document Settings→Roles + capability model"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- Data model (`roles`/`role_capabilities`/`user_roles`) → Task 2. ✔
- Capability catalog as `@openldr/core` constant → **moved to a new pure `@openldr/rbac` package** (Task 1) because `@openldr/core` pulls Node built-ins and the studio browser bundle must import the catalog for the builder UI. This is a deliberate, documented deviation from the spec's "constant in `@openldr/core`". ✔
- ~36 caps / 14 domains → Task 1 catalog (asserted = 36). ✔
- System roles + presets + Administrator locked → Task 1 presets, Task 3 seed, Task 4 startup seed. ✔
- Migration of existing users (auto-map by slug, nobody loses access) → Task 5 login backfill + `rbac_initialized` guard; system-role slugs equal the old KC role names so the map is exact. ✔
- Server enforcement (`requireCapability`, per-request resolution, `/api/me/capabilities`, replace all `requireRole`) → Tasks 5, 6, 8. ✔
- Frontend (`hasCapability`, `RequireCapability`, hide controls) → Tasks 9, 10. ✔
- Dev bypass = all caps → Task 5. ✔
- Lockout invariants → Task 3 (store) + Task 7 (route re-check). ✔
- Builder UI (grouped grid, select-all, counter, user assignment) → Tasks 11, 12. ✔
- CLI parity → Task 13. ✔
- Audit actions (`role.create/update/delete`, `user.assign_role`) → Task 7. ✔ (`user.unassign_role` is covered by the same `user.assign_role` audit on the bulk `PUT /users/:id/roles`; the granular CLI unassign audits as `user.assign_role` too — acceptable, single action name for assignment changes.)

**Placeholder scan:** No TBD/TODO; every code step carries complete code or an exact mapping table. The two "confirm the helper name" notes (test-helpers, api.ts helpers) are verification instructions, not placeholders — the surrounding code is complete.

**Type consistency:** `RoleRecord` shape is identical in `role-store.ts`, `api.ts`, and consumers. `req.user.capabilities: string[]` defined in Task 5, consumed in Tasks 6/8. `resolveCapabilities(subject)`, `backfillUserFromRoleNames`, `setUserRoles`, `markRbacInitialized` names are consistent across store/auth/route tasks. `user_roles.user_id = subject` invariant stated once and honored in store + auth + routes.

**One open deviation to flag to the reviewer at execution time:** the spec said the catalog lives in `@openldr/core`; the plan puts it in a new pure `@openldr/rbac` package for browser-safety. If the team prefers, it could instead be a `@openldr/core/rbac` subpath export with a guaranteed-pure module — but a dedicated package matches the existing `@openldr/dashboards` / `@openldr/forms/pure` precedent.
