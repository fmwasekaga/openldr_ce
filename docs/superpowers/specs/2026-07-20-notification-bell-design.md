# Notification Bell + Sheet — Design

**Date:** 2026-07-20
**Status:** Approved (brainstorm)
**Author:** Fredrick Lusako Mwasekaga

## Goal

Bring corlix desktop's notification experience to openldr_ce **studio** (the web SPA),
copying the corlix **look** exactly while sourcing content from openldr's own
operational feeds. Full parity with corlix's four UI pieces: header bell + popover,
corner toast, full history page, and a preferences card in Settings.

corlix reference (read-only, do not modify):
- `corlix/apps/desktop/src/renderer/components/NotificationBell.tsx`
- `corlix/apps/desktop/src/renderer/components/NotificationToaster.tsx`
- `corlix/apps/desktop/src/renderer/components/NotificationPreferencesCard.tsx`
- `corlix/apps/desktop/src/renderer/pages/NotificationsPage.tsx`
- `corlix/apps/desktop/src/renderer/stores/notifications-store.ts`

## Fundamental difference from corlix

corlix is **Electron** and reads notifications over IPC (`window.api.notifications`,
with a live `onNew` push) from a dedicated `notifications` table populated by
producers at each clinical event.

openldr_ce studio is a **browser SPA** talking to the Fastify server over HTTP, and it
is a central/lab **data repository**, not a clinical LIS — so corlix's clinical triggers
(panic value, Westgard, TAT breach, referral returned) do not apply. openldr already
records the equivalent operational events in existing tables. We therefore **derive** the
notification feed from those tables rather than adding a new producer everywhere.

## Decisions (from brainstorm)

1. **Scope:** full parity — bell + popover, toast, history page, preferences card.
2. **Backing:** real data, reuse existing feeds.
3. **Backend model:** **Approach A — derived feed + per-user read cursor.** No new
   producers, no double-writes. One small new table for read-state.
4. **Preferences:** per-type on/off + a minimum-priority floor. No SMS/email channel
   matrix (openldr has no such transport); a single in-app "channel".
5. **Liveness:** client **polling** (~45s) + refetch on popover-open and window-focus.
   No SSE (YAGNI for this feature).

## Content taxonomy

Notification-worthy rows are pulled from two existing tables and mapped to a
corlix-shaped `Notification`. Successful syncs are intentionally excluded (too noisy —
they live on `/activity`).

| Type              | Source                                                      | Priority | linkTo                    |
|-------------------|-------------------------------------------------------------|----------|---------------------------|
| `sync_diverged`   | `sync_activity` where `event='diverged'`                    | critical | `/settings/sync`          |
| `sync_failed`     | `sync_activity` where `event='failed'`                      | warning  | `/activity`               |
| `sync_quarantined`| `sync_activity` where `event='quarantined'`                 | warning  | `/activity`               |
| `plugin_crashed`  | `audit_events` where `action IN ('plugin.crash','system.crash','system.crash_loop')` | critical | `/activity` |
| `auth_failed`     | `audit_events` where `action='auth.failed'`                 | warning  | `/audit`                  |
| `site_changed`    | `audit_events` where `action IN ('settings.sync.enroll','settings.sync.rotate','settings.sync.revoke')` | info | `/settings/sites` |

Confirmed action/event strings (grep-verified, 2026-07-20):
- `sync_activity.event`: `synced` | `failed` | `quarantined` | `diverged`
  (`packages/db/src/migrations/internal/059_sync_activity.ts`).
- `auth.failed` / entityType `auth` (`apps/server/src/auth-plugin.ts:75`).
- `plugin.crash` / `system.crash` / `system.crash_loop`
  (`packages/bootstrap/src/crash-audit.ts:38`).
- `settings.sync.enroll` / `.rotate` / `.revoke`, entityType `sync_site`
  (`apps/server/src/settings-routes.ts`).

Priority → tone (identical to corlix): `info`→`border-l-primary`,
`warning`→`border-l-warning`, `critical`→`border-l-destructive`.

## Data model

The wire type mirrors corlix's `Notification` exactly so the ported components need no
field renames:

```ts
type NotificationPriority = 'info' | 'warning' | 'critical';
type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'auth_failed' | 'site_changed';

interface Notification {
  id: string;            // `sync:{rowId}` | `audit:{rowId}` — stable, source-qualified
  type: NotificationType;
  priority: NotificationPriority;
  title: string;         // English fallback; client re-resolves via `type` + `metadata`
                         //   (see "i18n"). Non-null so the type stays corlix-compatible.
  body: string | null;
  metadata: Record<string, unknown> | null; // source row's metadata, for client-side
                                             //   title/body composition (records count,
                                             //   site id, fail reason, etc.)
  linkTo: string | null; // route (no leading '#')
  createdAt: string;     // ISO, from occurred_at
  readAt: string | null; // per-user, from the read model
}
```

### Read-state (new table)

One migration adds `notification_reads`:

```
notification_reads(
  user_id          text        not null,
  notification_id  text        not null,   -- composite `sync:{id}` / `audit:{id}`
  read_at          timestamptz not null default now(),
  primary key (user_id, notification_id)
)
```

Plus a per-user **read-through cursor** for cheap "mark all read". Rather than a second
table, store it as one reserved row: `notification_reads(user_id, '__cursor__', read_at)`.
`read_at` on that row = the timestamp through which everything is considered read.

Read/unread resolution for a candidate row with `createdAt = C` and id `N`, user `U`:
- **read** iff `C <= cursor(U)` OR a `(U, N)` row exists.
- **unread** otherwise.

Operations:
- **markRead([ids])** — upsert `(U, id, now())` for each.
- **markAllRead()** — set the cursor row to `now()`, and (optional) prune individual
  rows older than the cursor.
- **unreadCount / list** — computed by the derived query with the rules above.

### Retention horizon

The derived query only considers source rows from the **last 30 days** (bounded scan;
keeps the union cheap and the inbox relevant). History page paginates within that window.

## Backend

New file `apps/server/src/notification-routes.ts`, registered in `app.ts` alongside the
other `register*Routes` calls. Role gate mirrors `/api/activity`
(`lab_admin, lab_manager, data_analyst, system_auditor`).

Endpoints:
- `GET  /api/notifications?limit&offset&unreadOnly&type&priority&from&to`
  → `{ notifications: Notification[], unreadCount: number, total: number }`
  (matches corlix's `notifications.list` return shape).
- `POST /api/notifications/read` `{ ids: string[] }` → `{ ok: true }`.
- `POST /api/notifications/read-all` → `{ ok: true }`.
- `GET  /api/notifications/preferences` → `NotificationPreference[]`.
- `PUT  /api/notifications/preferences` `{ prefs: {type, enabled}[] }` → `{ ok: true }`.

The derivation (union of the two source queries → map → filter by prefs → sort by
`createdAt` desc → paginate) lives in a small pure module so it is unit-testable without
HTTP: `packages/bootstrap/src/notifications.ts` (or co-located in the route file with an
exported pure `deriveNotifications()` — decided at plan time; prefer bootstrap so the CLI
could reuse it later).

### Preferences storage

Per-user, per-type enable flag plus a per-user minimum-priority floor, in one table.
Absence of a `(user_id, type)` row = enabled (mirrors corlix's "absent row = on"
semantics). The min-priority floor is stored as a single reserved row per user with
`type = '__min_priority__'` and the floor in `value`:

```
notification_prefs(
  user_id  text not null,
  type     text not null,     -- a NotificationType, or '__min_priority__'
  enabled  boolean,           -- meaningful for a NotificationType row
  value    text,              -- meaningful for the '__min_priority__' row: 'info'|'warning'|'critical'
  primary key (user_id, type)
)
```

Applied in the derivation: drop a candidate if its type has an explicit `enabled=false`
row, or if its priority is below the user's `__min_priority__` floor (default floor =
`info`, i.e. nothing filtered).

## Frontend (studio)

All four components ported from corlix with **look preserved**; only imports, the API
layer (`window.api.*` → `@/api` fetch calls), i18n namespace, and theme tokens change.

- **Store** — `apps/studio/src/shell/notifications-store.ts`. Direct port of corlix's
  zustand store (studio already depends on `zustand@^5`). Drop the Electron `onNew`
  assumption; `latest` is still set by `prepend` for the toaster.
- **Bell** — `apps/studio/src/shell/NotificationBell.tsx`. Port of `NotificationBell.tsx`.
  `window.api.notifications.list/onNew` → `listNotifications()` + a **polling hook**
  (`setInterval` 45s, `visibilitychange`/`focus` refetch). Mounted in
  `AppShell.tsx` header, immediately left of the theme-toggle button.
- **Toaster** — `apps/studio/src/shell/NotificationToaster.tsx`. Direct port of corlix's
  bespoke corner-toast card (NOT sonner — sonner's look differs; parity requires the
  custom component). Mounted once in `AppShell`.
- **History page** — `apps/studio/src/pages/Notifications.tsx`. Port of
  `NotificationsPage.tsx` onto studio's own `data-table` toolkit
  (`@/components/data-table`, `TablePagination`) — studio already has the equivalents.
  New top-level route `/notifications` in `App.tsx`; it is the "View all" target.
- **Preferences** — `apps/studio/src/pages/settings/NotificationPreferences.tsx`.
  Adapted from `NotificationPreferencesCard.tsx`: single in-app column of per-type
  checkboxes + a min-priority select. New Settings tab.

### Wiring points

- `AppShell.tsx` header (`:198`): insert `<NotificationBell />` before the theme
  `<Tooltip>`; render `<NotificationToaster />` once inside the shell.
- `App.tsx`: add `<Route path="/notifications" element={<Notifications />} />` and a
  nested `<Route path="notifications" .../>` under `/settings`.
- `SettingsShell.tsx` `SUB_NAV`: add `{ labelKey: 'settings.subNav.notifications',
  to: '/settings/notifications' }` (no role gate — every authenticated user has prefs).
- `api.ts`: add `Notification` type + `listNotifications`, `markNotificationsRead`,
  `markAllNotificationsRead`, `listNotificationPrefs`, `saveNotificationPrefs`.

### i18n

New `notifications.*` namespace in `apps/studio/src/i18n/{en,fr,pt}.ts`, plus
`settings.subNav.notifications` and `nav`/a11y strings. **The client resolves
titles/bodies** from `type` + `metadata` via i18n keys (`notifications.triggers.<type>`
for the title, `notifications.body.<type>` with interpolation for the body). The server
returns structured fields (`type`, `metadata`, plus an English `title`/`body` as a
fallback for unknown types). Client-resolve is chosen over server-resolve so text follows
the viewer's locale, and it matches how corlix's history page already renders
`t(\`notifications.triggers.\${n.type}\`)`.

## Error handling

- All new endpoints are best-effort reads; a source-table failure returns an empty feed
  with a logged error rather than a 500 (the bell must never break the header).
- `markRead`/`markAllRead` are idempotent upserts; a failure is toasted client-side but
  optimistic local state already updated (corlix pattern).
- Polling failures are swallowed (keep last-known feed); no error spam.
- Unknown `type` in a stored pref row is ignored by the derivation.

## Testing

- **Pure derivation** (`deriveNotifications`) — unit tests: source rows + read cursor +
  prefs → expected feed, unread counts, priority floor, 30-day horizon, id stability.
- **Routes** — integration tests mirroring `activity-routes.test.ts` / `audit-routes.test.ts`:
  role gating, list shape, mark-read persistence, mark-all cursor bump, prefs round-trip.
- **Migration** — extend `migrations.test.ts` coverage for the two new tables.
- **Components** — studio vitest for the store (port corlix store tests), and a light
  render test for the bell (badge shows/hides, empty state, mark-all clears).
- **Live** — drive the running studio: trigger a `sync_activity` failed row and an
  `auth.failed`, confirm the bell badges, popover lists them, toast fires, history
  paginates, mark-all clears, and a disabled pref suppresses a type.

## Out of scope (v1)

- `report_ready` notifications (report-job feed is minimal; add later once jobs emit rows).
- SSE / websocket push (polling is sufficient).
- SMS/email delivery (no transport exists).
- Bespoke notifications with no underlying feed row (would need Approach B's table).

## Files

New:
- `packages/db/src/migrations/internal/NNN_notification_reads_prefs.ts`
- `packages/bootstrap/src/notifications.ts` (pure `deriveNotifications` + store helpers)
- `apps/server/src/notification-routes.ts` (+ test)
- `apps/studio/src/shell/notifications-store.ts` (+ test)
- `apps/studio/src/shell/NotificationBell.tsx`
- `apps/studio/src/shell/NotificationToaster.tsx`
- `apps/studio/src/pages/Notifications.tsx`
- `apps/studio/src/pages/settings/NotificationPreferences.tsx`

Modified:
- `packages/db/src/migrations/internal/index.ts` (register migration)
- `apps/server/src/app.ts` (register routes)
- `apps/studio/src/shell/AppShell.tsx` (mount bell + toaster)
- `apps/studio/src/App.tsx` (routes)
- `apps/studio/src/pages/settings/SettingsShell.tsx` (sub-nav)
- `apps/studio/src/api.ts` (client methods + type)
- `apps/studio/src/i18n/{en,fr,pt}.ts` (strings)
- In-app docs (`apps/studio/src/docs/0.1.0/...`) — a short notifications page (optional).
