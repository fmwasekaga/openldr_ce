# Notification Bell + Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring corlix desktop's notification bell + sheet + toast + history + preferences to openldr_ce studio, copying the corlix look exactly, sourced from openldr's own `sync_activity` and `audit_events` feeds.

**Architecture:** A **derived** read model — notifications are computed at request time by mapping notification-worthy rows from `sync_activity` and `audit_events` into a corlix-shaped `Notification`, filtered by per-user preferences, with per-user read-state held in one small `notification_reads` table (plus a reserved cursor row for mark-all-read). No new producers. The browser SPA polls for liveness (no Electron IPC). Frontend components are near-verbatim ports of the corlix originals, retheming imports/API/i18n only.

**Tech Stack:** Fastify + Kysely (Postgres internal DB) on the server; React + zustand + date-fns + shadcn/ui + react-i18next in studio.

## Global Constraints

- **No `Co-Authored-By: Claude` / `Codex` trailer** on any commit.
- **corlix is read-only reference** — never modify anything under `D:\Projects\Repositories\corlix`.
- Notification wire type mirrors corlix `Notification` exactly (fields: `id, type, priority, title, body, linkTo, createdAt, readAt`) plus an added `metadata` field for client-side i18n composition.
- Priority tones (identical to corlix): `info`→`border-l-primary`, `warning`→`border-l-warning`, `critical`→`border-l-destructive`.
- Derivation only considers source rows from the **last 30 days**.
- Successful syncs (`event='synced'`) are **not** notifications.
- Site notifications fire on **revoke only** (`settings.sync.revoke`), priority `warning`. Enroll/rotate excluded.
- Titles/bodies are **resolved client-side** from `type` + `metadata` via i18n keys; the server sends an English fallback in `title`/`body`.
- Confirmed source strings (grep-verified 2026-07-20):
  - `sync_activity.event` ∈ `synced|failed|quarantined|diverged`.
  - `audit_events.action`: `auth.failed`, `plugin.crash`, `system.crash`, `system.crash_loop`, `settings.sync.revoke`.
- Data handles: `ctx.internalDb: Kysely<InternalSchema>`, `ctx.syncActivity.list({direction?,limit?}): Promise<SyncActivityRow[]>`, `ctx.audit.list({action?,from?,to?,limit?,offset?}): Promise<AuditEvent[]>`.
- `SyncActivityRow = { id, occurredAt(ISO string), direction, event, records, error, metadata }`.
- `AuditEvent = { id, occurredAt(ISO), actorType, actorId, actorName, action, entityType, entityId, before, after, metadata }`.

---

## File Structure

New:
- `packages/db/src/migrations/internal/060_notifications.ts` — the two tables.
- `packages/bootstrap/src/notifications.ts` — types + pure mappers/filters + DB-backed store functions.
- `apps/server/src/notification-routes.ts` — HTTP endpoints.
- `apps/studio/src/shell/notifications-store.ts` — zustand store (port).
- `apps/studio/src/shell/NotificationBell.tsx` — bell + popover + polling (port).
- `apps/studio/src/shell/NotificationToaster.tsx` — corner toast (port).
- `apps/studio/src/pages/Notifications.tsx` — history page (port onto studio data-table).
- `apps/studio/src/pages/settings/NotificationPreferences.tsx` — preferences tab.

Modified:
- `packages/db/src/schema/internal.ts` — add table interfaces + map entries.
- `packages/db/src/migrations/internal/index.ts` — register migration.
- `apps/server/src/app.ts` — register routes.
- `apps/studio/src/api.ts` — client methods + `Notification` type.
- `apps/studio/src/shell/AppShell.tsx` — mount bell + toaster.
- `apps/studio/src/App.tsx` — `/notifications` route + nested settings route.
- `apps/studio/src/pages/settings/SettingsShell.tsx` — sub-nav entry.
- `apps/studio/src/i18n/{en,fr,pt}.ts` — strings.

---

### Task 1: DB migration + schema types

**Files:**
- Create: `packages/db/src/migrations/internal/060_notifications.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts:642` (add interfaces + map entries)
- Test: `packages/db/src/migrations/migrations.test.ts` (extend)

**Interfaces:**
- Produces tables `notification_reads(user_id, notification_id, read_at)` and `notification_prefs(user_id, type, enabled, value)`, both used by Task 3.

- [ ] **Step 1: Read the sibling migration to copy the exact style**

Read `packages/db/src/migrations/internal/059_sync_activity.ts` and `packages/db/src/migrations/internal/index.ts` to see how migrations are named, exported, and registered.

- [ ] **Step 2: Write the migration**

Create `packages/db/src/migrations/internal/060_notifications.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Per-user read state. The reserved id '__cursor__' holds the mark-all-read
  // watermark: any notification with created_at <= its read_at is read.
  await db.schema
    .createTable('notification_reads')
    .ifNotExists()
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('notification_id', 'text', (c) => c.notNull())
    .addColumn('read_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('notification_reads_pk', ['user_id', 'notification_id'])
    .execute();

  // Per-user preferences. Absence of a (user_id, type) row = enabled. The reserved
  // type '__min_priority__' stores the floor in `value` ('info'|'warning'|'critical').
  await db.schema
    .createTable('notification_prefs')
    .ifNotExists()
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean')
    .addColumn('value', 'text')
    .addPrimaryKeyConstraint('notification_prefs_pk', ['user_id', 'type'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('notification_prefs').ifExists().execute();
  await db.schema.dropTable('notification_reads').ifExists().execute();
}
```

- [ ] **Step 3: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, import `060_notifications` and add it to the migrations map/array following the exact pattern of the `059` entry.

- [ ] **Step 4: Add schema table interfaces**

In `packages/db/src/schema/internal.ts`, add near the other table interfaces (e.g. after `SyncActivityTable`):

```ts
export interface NotificationReadsTable {
  user_id: string;
  notification_id: string;
  read_at: unknown;
}

export interface NotificationPrefsTable {
  user_id: string;
  type: string;
  enabled: boolean | null;
  value: string | null;
}
```

And in the `InternalSchema` interface (line ~642, the table map at ~655) add:

```ts
  notification_reads: NotificationReadsTable;
  notification_prefs: NotificationPrefsTable;
```

- [ ] **Step 5: Extend the migrations test**

In `packages/db/src/migrations/migrations.test.ts`, follow the existing pattern that asserts a migrated internal DB has the expected tables; add assertions that `notification_reads` and `notification_prefs` exist after `internalMigrations` run. (Read the file first; mirror how it currently checks another table such as `sync_activity`.)

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @openldr/db test -- migrations`
Expected: PASS (new table assertions green).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/060_notifications.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): notification_reads + notification_prefs tables"
```

---

### Task 2: Pure notification mapping + filtering

**Files:**
- Create: `packages/bootstrap/src/notifications.ts`
- Test: `packages/bootstrap/src/notifications.test.ts`

**Interfaces:**
- Produces (used by Task 3 and re-exported to the server/studio for shared shape):
  - `type NotificationPriority = 'info' | 'warning' | 'critical'`
  - `type NotificationType = 'sync_diverged' | 'sync_failed' | 'sync_quarantined' | 'plugin_crashed' | 'auth_failed' | 'site_revoked'`
  - `interface Notification { id; type; priority; title; body; linkTo; createdAt; readAt; metadata }`
  - `syncRowToNotification(row: SyncActivityRow): Notification | null`
  - `auditRowToNotification(row: AuditEvent): Notification | null`
  - `interface NotificationPreference { type: string; enabled: boolean }` and `type MinPriority = NotificationPriority`
  - `passesPrefs(n: Notification, disabled: Set<string>, minPriority: NotificationPriority): boolean`
  - `PRIORITY_RANK: Record<NotificationPriority, number>`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/notifications.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  syncRowToNotification,
  auditRowToNotification,
  passesPrefs,
  PRIORITY_RANK,
} from './notifications';

describe('syncRowToNotification', () => {
  const base = { id: 's1', occurredAt: '2026-07-20T10:00:00.000Z', direction: 'push' as const, records: 3, error: 'boom', metadata: null };

  it('maps diverged → critical, links to sync settings', () => {
    const n = syncRowToNotification({ ...base, event: 'diverged' })!;
    expect(n).toMatchObject({ id: 'sync:s1', type: 'sync_diverged', priority: 'critical', linkTo: '/settings/sync', createdAt: base.occurredAt });
  });

  it('maps failed → warning → /activity, carries error into body', () => {
    const n = syncRowToNotification({ ...base, event: 'failed' })!;
    expect(n).toMatchObject({ type: 'sync_failed', priority: 'warning', linkTo: '/activity' });
    expect(n.body).toContain('boom');
  });

  it('maps quarantined → warning', () => {
    expect(syncRowToNotification({ ...base, event: 'quarantined' })!.type).toBe('sync_quarantined');
  });

  it('drops successful syncs', () => {
    expect(syncRowToNotification({ ...base, event: 'synced' })).toBeNull();
  });
});

describe('auditRowToNotification', () => {
  const base = { id: 'a1', occurredAt: '2026-07-20T11:00:00.000Z', actorType: 'system' as const, actorId: null, actorName: 'System', entityType: 'auth', entityId: 'expired', before: null, after: null, metadata: null };

  it('maps auth.failed → warning → /audit', () => {
    const n = auditRowToNotification({ ...base, action: 'auth.failed' })!;
    expect(n).toMatchObject({ id: 'audit:a1', type: 'auth_failed', priority: 'warning', linkTo: '/audit' });
  });

  it('maps plugin.crash → critical → /activity', () => {
    expect(auditRowToNotification({ ...base, action: 'plugin.crash', entityType: 'plugin' })!).toMatchObject({ type: 'plugin_crashed', priority: 'critical', linkTo: '/activity' });
  });

  it('maps system.crash and system.crash_loop → plugin_crashed/critical', () => {
    expect(auditRowToNotification({ ...base, action: 'system.crash' })!.priority).toBe('critical');
    expect(auditRowToNotification({ ...base, action: 'system.crash_loop' })!.type).toBe('plugin_crashed');
  });

  it('maps settings.sync.revoke → site_revoked/warning → /settings/sites', () => {
    expect(auditRowToNotification({ ...base, action: 'settings.sync.revoke', entityType: 'sync_site', entityId: 'lab-7' })!).toMatchObject({ type: 'site_revoked', priority: 'warning', linkTo: '/settings/sites' });
  });

  it('drops unrelated audit actions', () => {
    expect(auditRowToNotification({ ...base, action: 'settings.sync.enroll' })).toBeNull();
    expect(auditRowToNotification({ ...base, action: 'report.run' })).toBeNull();
  });
});

describe('passesPrefs', () => {
  const n = { id: 'x', type: 'sync_failed', priority: 'warning', title: '', body: null, linkTo: null, createdAt: '', readAt: null, metadata: null } as const;

  it('drops a type that is explicitly disabled', () => {
    expect(passesPrefs(n, new Set(['sync_failed']), 'info')).toBe(false);
    expect(passesPrefs(n, new Set(), 'info')).toBe(true);
  });

  it('drops priorities below the floor', () => {
    expect(passesPrefs(n, new Set(), 'critical')).toBe(false); // warning < critical
    expect(passesPrefs(n, new Set(), 'warning')).toBe(true);
  });

  it('PRIORITY_RANK orders info < warning < critical', () => {
    expect(PRIORITY_RANK.info).toBeLessThan(PRIORITY_RANK.warning);
    expect(PRIORITY_RANK.warning).toBeLessThan(PRIORITY_RANK.critical);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- notifications`
Expected: FAIL — module `./notifications` not found.

- [ ] **Step 3: Write the module (pure part)**

Create `packages/bootstrap/src/notifications.ts`:

```ts
import type { SyncActivityRow } from '@openldr/db';
import type { AuditEvent } from '@openldr/audit';

export type NotificationPriority = 'info' | 'warning' | 'critical';
export type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'auth_failed' | 'site_revoked';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  linkTo: string | null;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface NotificationPreference { type: string; enabled: boolean }

export const PRIORITY_RANK: Record<NotificationPriority, number> = { info: 0, warning: 1, critical: 2 };

const SYNC_MAP: Record<string, { type: NotificationType; priority: NotificationPriority; linkTo: string } | undefined> = {
  diverged: { type: 'sync_diverged', priority: 'critical', linkTo: '/settings/sync' },
  failed: { type: 'sync_failed', priority: 'warning', linkTo: '/activity' },
  quarantined: { type: 'sync_quarantined', priority: 'warning', linkTo: '/activity' },
};

/** English fallbacks. The client re-resolves via i18n from `type` + `metadata`. */
export function syncRowToNotification(row: SyncActivityRow): Notification | null {
  const m = SYNC_MAP[row.event];
  if (!m) return null;
  const titleByType: Record<string, string> = {
    sync_diverged: 'Sync divergence detected',
    sync_failed: 'Sync failed',
    sync_quarantined: 'Records quarantined during sync',
  };
  return {
    id: `sync:${row.id}`,
    type: m.type,
    priority: m.priority,
    title: titleByType[m.type],
    body: row.error ?? (row.records ? `${row.records} record(s), ${row.direction}` : null),
    linkTo: m.linkTo,
    createdAt: row.occurredAt,
    readAt: null,
    metadata: { direction: row.direction, records: row.records, error: row.error, ...(row.metadata ?? {}) },
  };
}

const AUDIT_MAP: Record<string, { type: NotificationType; priority: NotificationPriority; linkTo: string; title: string } | undefined> = {
  'auth.failed': { type: 'auth_failed', priority: 'warning', linkTo: '/audit', title: 'Authentication failure' },
  'plugin.crash': { type: 'plugin_crashed', priority: 'critical', linkTo: '/activity', title: 'Plugin crashed' },
  'system.crash': { type: 'plugin_crashed', priority: 'critical', linkTo: '/activity', title: 'System crash' },
  'system.crash_loop': { type: 'plugin_crashed', priority: 'critical', linkTo: '/activity', title: 'Crash loop detected' },
  'settings.sync.revoke': { type: 'site_revoked', priority: 'warning', linkTo: '/settings/sites', title: 'Site access revoked' },
};

export function auditRowToNotification(row: AuditEvent): Notification | null {
  const m = AUDIT_MAP[row.action];
  if (!m) return null;
  return {
    id: `audit:${row.id}`,
    type: m.type,
    priority: m.priority,
    title: m.title,
    body: `${row.entityType}: ${row.entityId}`,
    linkTo: m.linkTo,
    createdAt: row.occurredAt,
    readAt: null,
    metadata: { entityType: row.entityType, entityId: row.entityId, actorName: row.actorName, ...(typeof row.metadata === 'object' && row.metadata ? row.metadata as Record<string, unknown> : {}) },
  };
}

export function passesPrefs(n: Notification, disabled: Set<string>, minPriority: NotificationPriority): boolean {
  if (disabled.has(n.type)) return false;
  if (PRIORITY_RANK[n.priority] < PRIORITY_RANK[minPriority]) return false;
  return true;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- notifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/notifications.ts packages/bootstrap/src/notifications.test.ts
git commit -m "feat(notifications): pure mapping + pref filtering"
```

---

### Task 3: DB-backed store functions

**Files:**
- Modify: `packages/bootstrap/src/notifications.ts` (append DB functions)
- Modify: `packages/bootstrap/src/index.ts` (re-export the public API)
- Test: `packages/bootstrap/src/notifications.db.test.ts`

**Interfaces:**
- Consumes: Task 2 pure functions; `ctx.internalDb`, `ctx.syncActivity`, `ctx.audit`.
- Produces (used by Task 4 routes):
  - `listNotifications(ctx, userId, params): Promise<{ notifications: Notification[]; unreadCount: number; total: number }>`
    where `params = { limit?; offset?; unreadOnly?; type?; priority? }`.
  - `markNotificationsRead(ctx, userId, ids: string[]): Promise<void>`
  - `markAllNotificationsRead(ctx, userId): Promise<void>`
  - `getNotificationPrefs(ctx, userId): Promise<{ disabled: string[]; minPriority: NotificationPriority }>`
  - `saveNotificationPrefs(ctx, userId, prefs: NotificationPreference[], minPriority?: NotificationPriority): Promise<void>`
  - `type NotificationCtx = Pick<AppContext, 'internalDb' | 'syncActivity' | 'audit' | 'logger'>`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/notifications.db.test.ts`. Model DB setup on an existing bootstrap store test that builds a migrated internal DB (read `packages/bootstrap/src/sync-activity-tracker.test.ts` for the `createInternalDb` + `internalMigrations` pattern). The test must:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createInternalDb, internalMigrations, createSyncActivityStore, createAuditStore } from '@openldr/db';
// ^ adjust imports to match what sync-activity-tracker.test.ts actually uses.
import { listNotifications, markNotificationsRead, markAllNotificationsRead, getNotificationPrefs, saveNotificationPrefs } from './notifications';

// Build a ctx-like object: { internalDb, syncActivity, audit, logger }.
// Seed: one sync_activity 'failed' row + one 'synced' row; one audit 'auth.failed' row.
// Assert:
//  - listNotifications returns 2 (failed + auth.failed), NOT the synced one; unreadCount = 2.
//  - markNotificationsRead([<one id>]) drops unreadCount to 1; unreadOnly list has 1.
//  - markAllNotificationsRead sets unreadCount to 0.
//  - saveNotificationPrefs disabling 'auth_failed' removes it from the list.
//  - saveNotificationPrefs minPriority='critical' hides the warning-level rows.
```

Write concrete assertions (real seed values, real expected counts) — no comments-as-tests.

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- notifications.db`
Expected: FAIL — the DB functions are not exported yet.

- [ ] **Step 3: Append the DB functions**

Add to `packages/bootstrap/src/notifications.ts`:

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema, SyncActivityStore } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';

export interface NotificationCtx {
  internalDb: Kysely<InternalSchema>;
  syncActivity: SyncActivityStore;
  audit: AuditStore;
  logger: Logger;
}

const AUDIT_ACTIONS = ['auth.failed', 'plugin.crash', 'system.crash', 'system.crash_loop', 'settings.sync.revoke'];
const WINDOW_DAYS = 30;
const CURSOR_ID = '__cursor__';
const MIN_PRIORITY_TYPE = '__min_priority__';

function windowStart(): string {
  return new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
}

/** All notification-worthy source rows in the window, newest first, before read-state/prefs.
 *  Audit rows are queried PER-ACTION so a high-volume unrelated action can never starve a
 *  target action out of a single shared LIMIT. */
async function gather(ctx: NotificationCtx): Promise<Notification[]> {
  const since = windowStart();
  const [syncRows, auditResults] = await Promise.all([
    ctx.syncActivity.list({ limit: 200 }),
    Promise.all(AUDIT_ACTIONS.map((action) => ctx.audit.list({ action, from: since, limit: 100 }))),
  ]);
  const out: Notification[] = [];
  for (const r of syncRows) {
    if (r.occurredAt < since) continue;
    const n = syncRowToNotification(r);
    if (n) out.push(n);
  }
  for (const rows of auditResults) {
    for (const r of rows) {
      const n = auditRowToNotification(r);
      if (n) out.push(n);
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

async function readState(ctx: NotificationCtx, userId: string): Promise<{ cursor: string | null; ids: Set<string> }> {
  const rows = await ctx.internalDb.selectFrom('notification_reads')
    .select(['notification_id', 'read_at']).where('user_id', '=', userId).execute();
  let cursor: string | null = null;
  const ids = new Set<string>();
  for (const r of rows) {
    const readAt = r.read_at instanceof Date ? r.read_at.toISOString() : String(r.read_at);
    if (r.notification_id === CURSOR_ID) cursor = readAt;
    else ids.add(r.notification_id);
  }
  return { cursor, ids };
}

export async function getNotificationPrefs(ctx: NotificationCtx, userId: string): Promise<{ disabled: string[]; minPriority: NotificationPriority }> {
  const rows = await ctx.internalDb.selectFrom('notification_prefs')
    .select(['type', 'enabled', 'value']).where('user_id', '=', userId).execute();
  const disabled: string[] = [];
  let minPriority: NotificationPriority = 'info';
  for (const r of rows) {
    if (r.type === MIN_PRIORITY_TYPE) {
      if (r.value === 'warning' || r.value === 'critical' || r.value === 'info') minPriority = r.value;
    } else if (r.enabled === false) {
      disabled.push(r.type);
    }
  }
  return { disabled, minPriority };
}

export async function listNotifications(
  ctx: NotificationCtx,
  userId: string,
  params: { limit?: number; offset?: number; unreadOnly?: boolean; type?: string; priority?: string } = {},
): Promise<{ notifications: Notification[]; unreadCount: number; total: number }> {
  const [all, prefs, reads] = await Promise.all([gather(ctx), getNotificationPrefs(ctx, userId), readState(ctx, userId)]);
  const disabled = new Set(prefs.disabled);
  const visible = all.filter((n) => passesPrefs(n, disabled, prefs.minPriority));
  // apply read-state
  const withRead = visible.map((n) => {
    const readByCursor = reads.cursor != null && n.createdAt <= reads.cursor;
    const readById = reads.ids.has(n.id);
    return readById || readByCursor ? { ...n, readAt: reads.cursor ?? n.createdAt } : n;
  });
  const unreadCount = withRead.filter((n) => !n.readAt).length;
  let filtered = withRead;
  if (params.type) filtered = filtered.filter((n) => n.type === params.type);
  if (params.priority) filtered = filtered.filter((n) => n.priority === params.priority);
  if (params.unreadOnly) filtered = filtered.filter((n) => !n.readAt);
  const total = filtered.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 50;
  return { notifications: filtered.slice(offset, offset + limit), unreadCount, total };
}

export async function markNotificationsRead(ctx: NotificationCtx, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date();
  for (const id of ids) {
    await ctx.internalDb.insertInto('notification_reads')
      .values({ user_id: userId, notification_id: id, read_at: now })
      .onConflict((oc) => oc.columns(['user_id', 'notification_id']).doUpdateSet({ read_at: now }))
      .execute();
  }
}

export async function markAllNotificationsRead(ctx: NotificationCtx, userId: string): Promise<void> {
  const now = new Date();
  await ctx.internalDb.insertInto('notification_reads')
    .values({ user_id: userId, notification_id: CURSOR_ID, read_at: now })
    .onConflict((oc) => oc.columns(['user_id', 'notification_id']).doUpdateSet({ read_at: now }))
    .execute();
  // Prune per-id rows older than the cursor to keep the table small.
  await ctx.internalDb.deleteFrom('notification_reads')
    .where('user_id', '=', userId)
    .where('notification_id', '!=', CURSOR_ID)
    .where('read_at', '<=', now)
    .execute();
}

export async function saveNotificationPrefs(
  ctx: NotificationCtx, userId: string, prefs: NotificationPreference[], minPriority?: NotificationPriority,
): Promise<void> {
  for (const p of prefs) {
    await ctx.internalDb.insertInto('notification_prefs')
      .values({ user_id: userId, type: p.type, enabled: p.enabled, value: null })
      .onConflict((oc) => oc.columns(['user_id', 'type']).doUpdateSet({ enabled: p.enabled }))
      .execute();
  }
  if (minPriority) {
    await ctx.internalDb.insertInto('notification_prefs')
      .values({ user_id: userId, type: MIN_PRIORITY_TYPE, enabled: null, value: minPriority })
      .onConflict((oc) => oc.columns(['user_id', 'type']).doUpdateSet({ value: minPriority }))
      .execute();
  }
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/bootstrap/src/index.ts`, add (near the other `export { ... } from './...'` lines):

```ts
export {
  listNotifications, markNotificationsRead, markAllNotificationsRead,
  getNotificationPrefs, saveNotificationPrefs,
  syncRowToNotification, auditRowToNotification, passesPrefs, PRIORITY_RANK,
} from './notifications';
export type { Notification, NotificationType, NotificationPriority, NotificationPreference, NotificationCtx } from './notifications';
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- notifications.db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/notifications.ts packages/bootstrap/src/notifications.db.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(notifications): derived list + read-state + prefs store"
```

---

### Task 4: HTTP routes

**Files:**
- Create: `apps/server/src/notification-routes.ts`
- Modify: `apps/server/src/app.ts` (import + register)
- Test: `apps/server/src/notification-routes.test.ts`

**Interfaces:**
- Consumes: Task 3 functions; `requireRole` from `./rbac`; `req.user.id`.
- Produces the HTTP surface used by Task 5.

- [ ] **Step 1: Read the sibling route + its test for the exact patterns**

Read `apps/server/src/activity-routes.ts` (role gate + registration shape) and `apps/server/src/audit-routes.test.ts` (how a test builds an app + asserts). Read how `req.user` is shaped in `apps/server/src/rbac.ts`.

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/notification-routes.test.ts` mirroring `audit-routes.test.ts`'s harness. Assert:
- `GET /api/notifications` returns `{ notifications, unreadCount, total }` and is gated to the analyst roles (a role-less request is rejected the same way the audit/activity tests assert).
- After seeding a `sync_activity` failed row, the list contains one `sync_failed`.
- `POST /api/notifications/read` with its id, then `GET ...?unreadOnly=true` returns 0.
- `POST /api/notifications/read-all` sets `unreadCount` to 0.
- `PUT /api/notifications/preferences` with `{ prefs:[{type:'sync_failed',enabled:false}] }` then `GET` returns an empty list.

- [ ] **Step 3: Run it, verify it fails**

Run: `pnpm --filter @openldr/server test -- notification-routes`
Expected: FAIL — route module not found.

- [ ] **Step 4: Write the routes**

Create `apps/server/src/notification-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import {
  listNotifications, markNotificationsRead, markAllNotificationsRead,
  getNotificationPrefs, saveNotificationPrefs, type NotificationPreference, type NotificationPriority,
} from '@openldr/bootstrap';
import { requireRole } from './rbac';

const VIEW = { preHandler: requireRole('lab_admin', 'lab_manager', 'data_analyst', 'system_auditor') };

function userId(req: { user?: { id?: string } }): string {
  return req.user?.id ?? 'anonymous';
}

export function registerNotificationRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/notifications', VIEW, async (req) => {
    const q = req.query as Record<string, string>;
    try {
      return await listNotifications(ctx, userId(req), {
        limit: q.limit ? Number(q.limit) : 50,
        offset: q.offset ? Number(q.offset) : 0,
        unreadOnly: q.unreadOnly === 'true',
        type: q.type || undefined,
        priority: q.priority || undefined,
      });
    } catch (e) {
      ctx.logger.error({ err: e }, 'notifications list failed');
      return { notifications: [], unreadCount: 0, total: 0 };
    }
  });

  app.post('/api/notifications/read', VIEW, async (req) => {
    const body = (req.body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    await markNotificationsRead(ctx, userId(req), ids);
    return { ok: true };
  });

  app.post('/api/notifications/read-all', VIEW, async (req) => {
    await markAllNotificationsRead(ctx, userId(req));
    return { ok: true };
  });

  app.get('/api/notifications/preferences', VIEW, async (req) => {
    return getNotificationPrefs(ctx, userId(req));
  });

  app.put('/api/notifications/preferences', VIEW, async (req) => {
    const body = (req.body ?? {}) as { prefs?: NotificationPreference[]; minPriority?: NotificationPriority };
    await saveNotificationPrefs(ctx, userId(req), Array.isArray(body.prefs) ? body.prefs : [], body.minPriority);
    return { ok: true };
  });
}
```

- [ ] **Step 5: Register in app.ts**

In `apps/server/src/app.ts`, add the import beside the others (line ~27) and call `registerNotificationRoutes(app, ctx);` beside the other `register*Routes(app, ctx)` calls (line ~131).

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm --filter @openldr/server test -- notification-routes`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/notification-routes.ts apps/server/src/notification-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): notification HTTP routes"
```

---

### Task 5: studio api client + Notification type

**Files:**
- Modify: `apps/studio/src/api.ts` (append type + functions)
- Test: `apps/studio/src/api.notifications.test.ts`

**Interfaces:**
- Consumes: Task 4 endpoints; `authFetch` from `api.ts`.
- Produces (used by Tasks 6-10):
  - `type Notification` (same fields as backend), `type NotificationPriority`, `type NotificationType`.
  - `listNotifications(params?): Promise<{ notifications: Notification[]; unreadCount: number; total: number }>`
  - `markNotificationsRead(ids: string[]): Promise<void>`
  - `markAllNotificationsRead(): Promise<void>`
  - `getNotificationPrefs(): Promise<{ disabled: string[]; minPriority: NotificationPriority }>`
  - `saveNotificationPrefs(prefs: {type: string; enabled: boolean}[], minPriority?: NotificationPriority): Promise<void>`

- [ ] **Step 1: Read an existing api.ts pair to copy the pattern**

Read how `api.ts` defines an existing GET+POST family and its test (`api.audit.test.ts`) — copy the `authFetch` + JSON handling exactly.

- [ ] **Step 2: Write the failing test**

Create `apps/studio/src/api.notifications.test.ts` mirroring `api.audit.test.ts` (mock `authFetch`/`fetch`, assert the URL, query string, and parsed return for `listNotifications`, and the POST body for `markNotificationsRead`).

- [ ] **Step 3: Run it, verify it fails**

Run: `pnpm --filter @openldr/studio test -- api.notifications`
Expected: FAIL.

- [ ] **Step 4: Append to api.ts**

```ts
export type NotificationPriority = 'info' | 'warning' | 'critical';
export type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'auth_failed' | 'site_revoked';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  linkTo: string | null;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface NotificationListParams {
  limit?: number; offset?: number; unreadOnly?: boolean; type?: string; priority?: string;
}

export async function listNotifications(
  params: NotificationListParams = {},
): Promise<{ notifications: Notification[]; unreadCount: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.unreadOnly) qs.set('unreadOnly', 'true');
  if (params.type) qs.set('type', params.type);
  if (params.priority) qs.set('priority', params.priority);
  const res = await authFetch(`/api/notifications?${qs.toString()}`);
  if (!res.ok) throw new Error(`notifications list failed: ${res.status}`);
  return res.json() as Promise<{ notifications: Notification[]; unreadCount: number; total: number }>;
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  await authFetch('/api/notifications/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await authFetch('/api/notifications/read-all', { method: 'POST' });
}

export async function getNotificationPrefs(): Promise<{ disabled: string[]; minPriority: NotificationPriority }> {
  const res = await authFetch('/api/notifications/preferences');
  if (!res.ok) return { disabled: [], minPriority: 'info' };
  return res.json() as Promise<{ disabled: string[]; minPriority: NotificationPriority }>;
}

export async function saveNotificationPrefs(
  prefs: { type: string; enabled: boolean }[], minPriority?: NotificationPriority,
): Promise<void> {
  await authFetch('/api/notifications/preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs, minPriority }),
  });
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @openldr/studio test -- api.notifications`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.notifications.test.ts
git commit -m "feat(studio): notifications api client"
```

---

### Task 6: zustand store

**Files:**
- Create: `apps/studio/src/shell/notifications-store.ts`
- Test: `apps/studio/src/shell/notifications-store.test.ts`

**Interfaces:**
- Consumes: `Notification` type from `@/api`.
- Produces `useNotificationsStore` with `{ notifications, unreadCount, latest, setAll, prepend, markRead, markAllRead, clearLatest }` (identical to corlix's store).

- [ ] **Step 1: Write the failing test**

Port corlix's store test intent. Create `apps/studio/src/shell/notifications-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationsStore } from './notifications-store';

const mk = (id: string, readAt: string | null = null) => ({
  id, type: 'sync_failed', priority: 'warning', title: id, body: null, linkTo: null,
  createdAt: '2026-07-20T00:00:00Z', readAt, metadata: null,
} as const);

describe('notifications-store', () => {
  beforeEach(() => useNotificationsStore.setState({ notifications: [], unreadCount: 0, latest: null }));

  it('setAll replaces contents', () => {
    useNotificationsStore.getState().setAll([mk('a')], 1);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
  });

  it('prepend adds unread + sets latest, dedupes by id', () => {
    const s = useNotificationsStore.getState();
    s.prepend(mk('a'));
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(useNotificationsStore.getState().latest?.id).toBe('a');
    useNotificationsStore.getState().prepend(mk('a'));
    expect(useNotificationsStore.getState().notifications).toHaveLength(1);
  });

  it('markRead removes ids + decrements', () => {
    useNotificationsStore.getState().setAll([mk('a'), mk('b')], 2);
    useNotificationsStore.getState().markRead(['a']);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(useNotificationsStore.getState().notifications.map((n) => n.id)).toEqual(['b']);
  });

  it('markAllRead clears', () => {
    useNotificationsStore.getState().setAll([mk('a')], 1);
    useNotificationsStore.getState().markAllRead();
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @openldr/studio test -- notifications-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Port the store**

Create `apps/studio/src/shell/notifications-store.ts` — copy `corlix/apps/desktop/src/renderer/stores/notifications-store.ts` verbatim, changing only the import line from `@corlix/shared-types` to `import type { Notification } from '@/api'`. (The state logic is identical; do not alter it.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @openldr/studio test -- notifications-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/shell/notifications-store.ts apps/studio/src/shell/notifications-store.test.ts
git commit -m "feat(studio): notifications zustand store"
```

---

### Task 7: NotificationBell (port + polling) + mount

**Files:**
- Create: `apps/studio/src/shell/NotificationBell.tsx`
- Modify: `apps/studio/src/shell/AppShell.tsx` (mount in header)
- Test: `apps/studio/src/shell/NotificationBell.test.tsx`

**Interfaces:**
- Consumes: `useNotificationsStore` (Task 6); `listNotifications, markNotificationsRead, markAllNotificationsRead` (Task 5); shadcn `Popover`, `Badge`, `Button`.
- Produces `<NotificationBell />`.

- [ ] **Step 1: Confirm shadcn primitives exist**

Verify `apps/studio/src/components/ui/popover.tsx`, `badge.tsx`, `button.tsx` exist (they do — grep to confirm exact export names). Confirm `@/lib/cn` exports `cn`.

- [ ] **Step 2: Write the failing render test**

Create `apps/studio/src/shell/NotificationBell.test.tsx`. Mock `@/api` (`listNotifications` resolving `{ notifications: [], unreadCount: 0, total: 0 }`), render inside a `MemoryRouter` + `I18nextProvider` (mirror an existing studio component test that needs router+i18n — read `apps/studio/src/shell/AppShell.test.tsx` for the harness). Assert the bell button renders with the aria-label and no badge when `unreadCount === 0`.

- [ ] **Step 3: Run it, verify it fails**

Run: `pnpm --filter @openldr/studio test -- NotificationBell`
Expected: FAIL.

- [ ] **Step 4: Port the component**

Create `apps/studio/src/shell/NotificationBell.tsx` by porting `corlix/apps/desktop/src/renderer/components/NotificationBell.tsx` with these exact substitutions (keep ALL className/markup identical for pixel parity):
- Imports: `Notification` from `@/api`; `Popover*` from `@/components/ui/popover`; `Button` from `@/components/ui/button`; `Badge` from `@/components/ui/badge`; `useNotificationsStore` from `./notifications-store`; `cn` from `@/lib/cn`.
- Remove the `useAuthStore` gating (studio's AppShell already only renders when authed) — drop the `isAuthenticated` branch; always load.
- Replace the IPC data layer:
  - initial load + polling instead of `window.api.notifications.onNew`:

```tsx
useEffect(() => {
  let cancelled = false;
  const load = () => {
    void listNotifications({ limit: 50, unreadOnly: true }).then((res) => {
      if (!cancelled) setAll(res.notifications, res.unreadCount);
    }).catch(() => { /* keep last-known feed */ });
  };
  load();
  const interval = setInterval(load, 45_000);
  const onVis = () => { if (document.visibilityState === 'visible') load(); };
  window.addEventListener('focus', load);
  document.addEventListener('visibilitychange', onVis);
  return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', onVis); };
}, [setAll]);
```

  - `handleOpen`: `markRead([n.id]); void markNotificationsRead([n.id]);` then navigate as corlix does (strip a leading `#`).
  - `handleMarkAll`: `markAllRead(); void markAllNotificationsRead();`
- Replace `t("notifications.title")` etc. — keep the same keys; they are added in Task 11.
- Title/body display: keep `n.title`; the i18n re-resolution is added in Task 11 via a small `notifTitle(n,t)` helper — for THIS task render `n.title`/`n.body` directly (English fallback). Task 11 swaps in the helper.

- [ ] **Step 5: Mount in AppShell**

In `apps/studio/src/shell/AppShell.tsx`, import `NotificationBell` and place `<NotificationBell />` inside the header's action `div` (line ~198), immediately before the theme-toggle `<Tooltip>`.

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm --filter @openldr/studio test -- NotificationBell`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/shell/NotificationBell.tsx apps/studio/src/shell/NotificationBell.test.tsx apps/studio/src/shell/AppShell.tsx
git commit -m "feat(studio): notification bell in header with polling"
```

---

### Task 8: NotificationToaster (port) + mount

**Files:**
- Create: `apps/studio/src/shell/NotificationToaster.tsx`
- Modify: `apps/studio/src/shell/AppShell.tsx` (mount once)

**Interfaces:**
- Consumes: `useNotificationsStore` (`latest`, `clearLatest`).
- Produces `<NotificationToaster />`.

- [ ] **Step 1: Port the component**

Create `apps/studio/src/shell/NotificationToaster.tsx` by copying `corlix/apps/desktop/src/renderer/components/NotificationToaster.tsx` verbatim with substitutions: `Notification` from `@/api`; `useNotificationsStore` from `./notifications-store`; `cn` from `@/lib/cn`. Keep ALL markup/classes identical (this is the exact-look requirement). No i18n is needed (it only renders `n.title`/`n.body`); in Task 11 the same `notifTitle` helper is applied here.

- [ ] **Step 2: Mount in AppShell**

In `apps/studio/src/shell/AppShell.tsx`, render `<NotificationToaster />` once — just inside the outer shell `div` (a fixed-position element; placement in the tree does not affect layout). Add the import.

- [ ] **Step 3: Verify build/typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/shell/NotificationToaster.tsx apps/studio/src/shell/AppShell.tsx
git commit -m "feat(studio): notification corner toaster"
```

---

### Task 9: Notifications history page + route

**Files:**
- Create: `apps/studio/src/pages/Notifications.tsx`
- Modify: `apps/studio/src/App.tsx` (add `/notifications` route)

**Interfaces:**
- Consumes: `listNotifications, markNotificationsRead` (Task 5); studio `@/components/data-table` toolkit + `AppShell`.
- Produces the `/notifications` route (the bell's "View all" target).

- [ ] **Step 1: Study the studio data-table on an existing page**

Read `apps/studio/src/pages/Audit.tsx` (it uses the same `@/components/data-table` toolkit — `useTableState`, `DataTableToolbar`, `ColumnDef`, `TablePagination`). This is the studio analogue of corlix's `NotificationsPage`. Mirror its structure: toolbar + filter chips, sticky-header table, pagination, row-click.

- [ ] **Step 2: Write the page**

Create `apps/studio/src/pages/Notifications.tsx`. Wrap the content in `<AppShell title={t('notifications.title')} fullBleed>`. Columns (mirror corlix's `NotificationsPage.tsx` column set, adapted to studio's `ColumnDef`):
- `created_at` — timestamp + relative (`formatDistanceToNow` from `date-fns`), `date` type, filterable.
- `type` — `t(\`notifications.triggers.\${n.type}\`)`, `enum` type, options = the 6 `NotificationType`s.
- `priority` — a `Badge` (variant: critical→destructive, warning→secondary, info→default), `enum` type.
- `status` — read/unread text, `enum` type (unread/read).
- `title` — `n.title` + `n.body` (line-clamped).

Load via `listNotifications({ limit, offset, unreadOnly?, type?, priority? })` translated from the table filters (mirror corlix's `translateFilters`). Row click: `markNotificationsRead([n.id])` then navigate to `n.linkTo` (strip leading `#`) or reload. Use studio's `TablePagination`.

Match the exact JSX shape used in `Audit.tsx` so it renders identically to other studio tables (edge-to-edge, sticky header). Refer to corlix's `NotificationsPage.tsx` only for column semantics, not markup.

- [ ] **Step 3: Add the route**

In `apps/studio/src/App.tsx`, add `<Route path="/notifications" element={<Notifications />} />` (import the page). No extra role gate — the bell is already role-gated at the API; the page reuses the same endpoint.

- [ ] **Step 4: Typecheck + render test**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS. (A light render test mirroring `Audit.test.tsx` is optional but encouraged: mock `@/api`, assert the empty-state row renders.)

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/Notifications.tsx apps/studio/src/App.tsx
git commit -m "feat(studio): notifications history page"
```

---

### Task 10: Preferences tab + sub-nav + route

**Files:**
- Create: `apps/studio/src/pages/settings/NotificationPreferences.tsx`
- Modify: `apps/studio/src/pages/settings/SettingsShell.tsx` (sub-nav)
- Modify: `apps/studio/src/App.tsx` (nested settings route)

**Interfaces:**
- Consumes: `getNotificationPrefs, saveNotificationPrefs` (Task 5); shadcn `Card`, `Checkbox`, `Button`, and studio's `Select` (from `@/components/ui/select`).
- Produces the `/settings/notifications` route.

- [ ] **Step 1: Confirm the primitives + read a sibling settings page**

Read `apps/studio/src/pages/settings/General.tsx` for the studio settings-page conventions (card layout, save button, `toast` from sonner, i18n). Confirm `@/components/ui/{card,checkbox,select}` exist.

- [ ] **Step 2: Write the preferences page**

Create `apps/studio/src/pages/settings/NotificationPreferences.tsx`, adapting `corlix/apps/desktop/src/renderer/components/NotificationPreferencesCard.tsx` to a **single in-app column** + a **min-priority select**:
- Rows = the 6 `NotificationType`s, label = `t(\`notifications.triggers.\${type}\`)`, one `Checkbox` per row (enabled/disabled). Absence of a disabled entry = on.
- Below the table, a `Select` for the minimum-priority floor (`info`/`warning`/`critical`), labelled `t('notifications.minPriority')`.
- Load with `getNotificationPrefs()` → seed checkboxes (`disabled` array) + the select (`minPriority`). Track dirty state.
- Save: `saveNotificationPrefs(prefs, minPriority)` where `prefs` = every type with its `enabled` boolean; `toast.success(t('settings.saved'))` on success (match General.tsx's toast usage).
- Layout/classes: keep corlix's card + table markup where it maps; use studio's `Card`/`Checkbox`/`Button` so it matches other settings cards.

- [ ] **Step 3: Add the sub-nav entry**

In `apps/studio/src/pages/settings/SettingsShell.tsx`, add to `SUB_NAV`:

```ts
  { labelKey: 'settings.subNav.notifications', to: '/settings/notifications' },
```

Place it after `general` (no `roles` gate — every user has personal prefs).

- [ ] **Step 4: Add the nested route**

In `apps/studio/src/App.tsx`, under the `/settings` parent route add:

```tsx
        <Route path="notifications" element={<RequireRole><NotificationPreferences /></RequireRole>} />
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/pages/settings/NotificationPreferences.tsx apps/studio/src/pages/settings/SettingsShell.tsx apps/studio/src/App.tsx
git commit -m "feat(studio): notification preferences settings tab"
```

---

### Task 11: i18n strings (en/fr/pt) + client title resolution

**Files:**
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Create: `apps/studio/src/shell/notif-text.ts` (title/body i18n helper)
- Modify: `NotificationBell.tsx`, `NotificationToaster.tsx`, `Notifications.tsx` (use the helper)

**Interfaces:**
- Produces `notifTitle(n, t): string` and `notifBody(n, t): string | null`.

- [ ] **Step 1: Add the i18n keys**

In each of `en.ts`/`fr.ts`/`pt.ts`, add a `notifications` namespace with (English shown; translate for fr/pt):
- `title: 'Notifications'`, `unread: 'unread'`, `markAllRead: 'Mark all read'`, `empty: 'No notifications'`, `ariaOpen: 'Open notifications'`
- `history: { viewAll: 'View all', time, type, priority, status, title, read: 'Read', unread: 'Unread', empty, totalCount: '{{count}} total', priorityInfo, priorityWarning, priorityCritical }`
- `triggers: { sync_diverged, sync_failed, sync_quarantined, plugin_crashed, auth_failed, site_revoked }` (human labels)
- `body: { sync_diverged, sync_failed, sync_quarantined, plugin_crashed, auth_failed, site_revoked }` (with interpolation, e.g. `site_revoked: 'Site {{entityId}} access revoked'`)
- `preferencesTitle`, `preferencesHint`, `minPriority: 'Minimum priority'`, `eventColumn: 'Event'`
Also add `settings.subNav.notifications: 'Notifications'` under the existing `settings.subNav`, and any `a11y`/`nav` keys the bell references.

- [ ] **Step 2: Add the resolution helper**

Create `apps/studio/src/shell/notif-text.ts`:

```ts
import type { TFunction } from 'i18next';
import type { Notification } from '@/api';

export function notifTitle(n: Notification, t: TFunction): string {
  return t(`notifications.triggers.${n.type}`, { defaultValue: n.title });
}

export function notifBody(n: Notification, t: TFunction): string | null {
  const key = `notifications.body.${n.type}`;
  const resolved = t(key, { ...(n.metadata ?? {}), defaultValue: '' });
  return resolved || n.body;
}
```

- [ ] **Step 3: Wire the helper into the three consumers**

In `NotificationBell.tsx`, `NotificationToaster.tsx`, and `Notifications.tsx`, replace bare `n.title`/`n.body` renders with `notifTitle(n, t)` / `notifBody(n, t)`. (Bell and toaster already have `t` via `useTranslation`; add it to the toaster's import.)

- [ ] **Step 4: Typecheck + existing i18n test**

Run: `pnpm --filter @openldr/studio typecheck`
Then run the repo's i18n parity check if one exists (grep for an `i18n` test under `apps/studio/src/i18n`); ensure en/fr/pt keys match.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/shell/notif-text.ts apps/studio/src/shell/NotificationBell.tsx apps/studio/src/shell/NotificationToaster.tsx apps/studio/src/pages/Notifications.tsx
git commit -m "feat(studio): notification i18n (en/fr/pt) + client title resolution"
```

---

### Task 12: Full gate + live verification + docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/...` (optional short doc)

- [ ] **Step 1: Run the full turbo gate**

Run: `pnpm turbo typecheck test build --filter=@openldr/db --filter=@openldr/bootstrap --filter=@openldr/server --filter=@openldr/studio`
Expected: PASS (account for known flakes per repo conventions — re-run a single flaky suite if it trips).

- [ ] **Step 2: Drive the running app live**

Start the dev servers (per repo conventions / memory) and, in studio:
1. Confirm the bell renders in the header with no badge on a clean DB.
2. Insert a `sync_activity` `failed` row and an `auth.failed` audit row (via the CLI or a direct DB insert against the dev internal DB); wait ≤45s (or refocus the window) and confirm the badge shows `2`, the popover lists both with the correct priority borders, and a toast fired.
3. Click one → it marks read, navigates to its `linkTo`, and the badge decrements.
4. Click "Mark all read" → badge clears.
5. Open `/notifications` via "View all" → both rows appear; filters + pagination work.
6. Settings → Notifications: disable `auth_failed`, save; reload the bell → the auth row is gone. Set min-priority to `critical` → the warning-level rows disappear.

- [ ] **Step 3: (Optional) short in-app doc**

If time permits, add a brief `notifications.md` under the studio docs for the active version and register it in the docs manifest (mirror how an existing small doc is registered). Skip if the docs manifest adds friction — not required for the feature.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs(notifications): in-app notifications guide"
```

---

## Self-Review Notes

- **Spec coverage:** all four UI pieces (Tasks 7-10), derived feed + read cursor (Tasks 2-3), prefs per-type + min-priority (Tasks 3,10), polling liveness (Task 7), taxonomy incl. revoke-only site rule (Task 2), i18n client resolution (Task 11), tests + live verification (all tasks + Task 12).
- **Read-state semantics** are centralized in `listNotifications` (Task 3) — the id/cursor rules match the spec exactly.
- **Type consistency:** `Notification` shape is defined identically in Task 2 (backend) and Task 5 (studio); the 6 `NotificationType` literals and 3 priorities are repeated verbatim in both and in Task 11's i18n keys and Task 9/10's option lists.
- **No new producers** — sources are read via existing `ctx.syncActivity` / `ctx.audit` / `ctx.internalDb`.
