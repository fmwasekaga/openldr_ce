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
