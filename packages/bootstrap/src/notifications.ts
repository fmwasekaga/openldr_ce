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
