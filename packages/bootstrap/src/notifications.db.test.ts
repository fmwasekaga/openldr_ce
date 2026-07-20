import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createSyncActivityStore } from '@openldr/db';
import type { InternalSchema } from '@openldr/db';
import { createAuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import {
  listNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  saveNotificationPrefs,
  type NotificationCtx,
} from './notifications';

const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

async function buildCtx(): Promise<NotificationCtx> {
  const internalDb = (await makeMigratedDb()) as Kysely<InternalSchema>;
  const syncActivity = createSyncActivityStore(internalDb);
  const audit = createAuditStore(internalDb);
  return { internalDb, syncActivity, audit, logger: nullLogger };
}

describe('notifications DB store', () => {
  let ctx: NotificationCtx;

  beforeEach(async () => {
    ctx = await buildCtx();
    // Seed: one sync_activity 'failed' row + one 'synced' row (the synced row must never surface
    // as a notification), and one audit 'auth.failed' row.
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    await ctx.syncActivity.record({ direction: 'push', event: 'synced', records: 3 });
    await ctx.audit.record({
      actorType: 'system',
      actorName: 'system',
      action: 'auth.failed',
      entityType: 'user',
      entityId: 'bob',
    });
  });

  it('lists the failed sync + auth.failed audit rows, but never the synced row', async () => {
    const { notifications, unreadCount, total } = await listNotifications(ctx, 'user1', {});
    expect(total).toBe(2);
    expect(unreadCount).toBe(2);
    const types = notifications.map((n) => n.type).sort();
    expect(types).toEqual(['auth_failed', 'sync_failed']);
    expect(notifications.some((n) => n.id.startsWith('sync:'))).toBe(true);
    expect(notifications.some((n) => n.id.startsWith('audit:'))).toBe(true);
  });

  it('markNotificationsRead marks a single id read, dropping it from unreadOnly + unreadCount', async () => {
    const before = await listNotifications(ctx, 'user1', {});
    const failed = before.notifications.find((n) => n.type === 'sync_failed');
    expect(failed).toBeTruthy();

    await markNotificationsRead(ctx, 'user1', [failed!.id]);

    const after = await listNotifications(ctx, 'user1', {});
    expect(after.unreadCount).toBe(1);
    expect(after.total).toBe(2); // still visible, just read

    const unreadOnly = await listNotifications(ctx, 'user1', { unreadOnly: true });
    expect(unreadOnly.notifications).toHaveLength(1);
    expect(unreadOnly.notifications[0].type).toBe('auth_failed');
  });

  it('markAllNotificationsRead drops unreadCount to 0', async () => {
    await markAllNotificationsRead(ctx, 'user1');
    const { unreadCount, total } = await listNotifications(ctx, 'user1', {});
    expect(unreadCount).toBe(0);
    expect(total).toBe(2);
  });

  it('saveNotificationPrefs disabling auth_failed removes it from the list', async () => {
    await saveNotificationPrefs(ctx, 'user1', [{ type: 'auth_failed', enabled: false }]);
    const { notifications, total } = await listNotifications(ctx, 'user1', {});
    expect(total).toBe(1);
    expect(notifications.every((n) => n.type !== 'auth_failed')).toBe(true);
    expect(notifications[0].type).toBe('sync_failed');
  });

  it('saveNotificationPrefs with minPriority critical hides the remaining warning-level rows', async () => {
    await saveNotificationPrefs(ctx, 'user1', [{ type: 'auth_failed', enabled: false }]);
    await saveNotificationPrefs(ctx, 'user1', [], 'critical');
    const { notifications, total, unreadCount } = await listNotifications(ctx, 'user1', {});
    expect(total).toBe(0);
    expect(unreadCount).toBe(0);
    expect(notifications).toEqual([]);
  });

  it('excludes sync_activity rows older than the 30-day window, includes an in-window row', async () => {
    // Older than the window: seeded by inserting straight into the table, since the store always
    // stamps occurred_at via now().
    const oldDate = new Date(Date.now() - 40 * 86_400_000);
    await ctx.internalDb
      .insertInto('sync_activity')
      .values({
        id: randomUUID(),
        occurred_at: oldDate,
        direction: 'push',
        event: 'failed',
        records: 0,
        error: 'stale beyond window',
        metadata: null,
      })
      .execute();
    // Inside the window: a fresh row via the normal store path (occurred_at = now()).
    await ctx.syncActivity.record({ direction: 'push', event: 'quarantined', records: 1 });

    const { notifications } = await listNotifications(ctx, 'user1', {});
    expect(notifications.some((n) => n.body === 'stale beyond window')).toBe(false);
    expect(notifications.some((n) => n.type === 'sync_quarantined')).toBe(true);
  });

  it('markNotificationsRead sets readAt to the actual mark-read timestamp, not createdAt', async () => {
    const before = await listNotifications(ctx, 'user1', {});
    const failed = before.notifications.find((n) => n.type === 'sync_failed');
    expect(failed).toBeTruthy();
    expect(failed!.readAt).toBeNull();

    const beforeMark = Date.now();
    await markNotificationsRead(ctx, 'user1', [failed!.id]);
    const afterMark = Date.now();

    const after = await listNotifications(ctx, 'user1', {});
    const stillFailed = after.notifications.find((n) => n.id === failed!.id);
    expect(stillFailed).toBeTruthy();
    expect(stillFailed!.readAt).not.toBeNull();
    // The bug this guards against: readAt falling back to createdAt instead of the real mark-read time.
    expect(stillFailed!.readAt).not.toBe(stillFailed!.createdAt);
    const readAtMs = new Date(stillFailed!.readAt!).getTime();
    expect(readAtMs).toBeGreaterThanOrEqual(beforeMark - 1000);
    expect(readAtMs).toBeLessThanOrEqual(afterMark + 1000);
  });
});
