import type { Kysely } from 'kysely';
import type { SyncActivityRow, InternalSchema, SyncActivityStore } from '@openldr/db';
import type { AuditEvent, AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';

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
export type MinPriority = NotificationPriority;

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
