import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createSyncActivityStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAuditStore } from '@openldr/audit';
import { registerNotificationRoutes } from './notification-routes';

const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

async function buildCtx() {
  const internalDb = await makeMigratedDb();
  const syncActivity = createSyncActivityStore(internalDb);
  const audit = createAuditStore(internalDb);
  return { internalDb, syncActivity, audit, logger: nullLogger } as any;
}

function appWithUser(roles: string[], ctx: any) {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => { req.user = { id: 'u1', username: 'analyst', roles }; });
  registerNotificationRoutes(app, ctx);
  return app;
}

function appWithoutUser(ctx: any) {
  const app = Fastify();
  registerNotificationRoutes(app, ctx);
  return app;
}

describe('notification routes', () => {
  it('GET /api/notifications is role-gated: no user -> 401', async () => {
    const ctx = await buildCtx();
    const app = appWithoutUser(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/notifications is role-gated: wrong role -> 403', async () => {
    const ctx = await buildCtx();
    const app = appWithUser(['lab_technician'], ctx);
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/notifications returns { notifications, unreadCount, total } and surfaces a failed sync row', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['data_analyst'], ctx);

    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('unreadCount');
    expect(body).toHaveProperty('total');
    expect(body.total).toBe(1);
    expect(body.unreadCount).toBe(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].type).toBe('sync_failed');
  });

  it('POST /api/notifications/read marks an id read, dropping it from unreadOnly', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['lab_admin'], ctx);

    const before = await app.inject({ method: 'GET', url: '/api/notifications' });
    const id = before.json().notifications[0].id;

    const readRes = await app.inject({ method: 'POST', url: '/api/notifications/read', payload: { ids: [id] } });
    expect(readRes.statusCode).toBe(200);

    const unreadOnly = await app.inject({ method: 'GET', url: '/api/notifications?unreadOnly=true' });
    expect(unreadOnly.statusCode).toBe(200);
    expect(unreadOnly.json().notifications).toHaveLength(0);
  });

  it('POST /api/notifications/read-all sets unreadCount to 0', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['lab_manager'], ctx);

    const readAllRes = await app.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect(readAllRes.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(after.json().unreadCount).toBe(0);
  });

  it('PUT /api/notifications/preferences disabling sync_failed hides it from the list', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['system_auditor'], ctx);

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: { prefs: [{ type: 'sync_failed', enabled: false }] },
    });
    expect(putRes.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(after.statusCode).toBe(200);
    expect(after.json().notifications).toEqual([]);
  });
});
