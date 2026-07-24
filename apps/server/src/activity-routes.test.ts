import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerActivityRoutes } from './activity-routes';

const RECENT = [
  { correlationId: 'A', workflowId: 'wf-1', source: 'webhook', startedAt: '2026-07-03T00:00:00.000Z', currentStage: 'persist', status: 'ok' },
];
const LIFECYCLE = { correlationId: 'A', runs: [], stages: [] };

function fakeCtx() {
  const calls: { listRecent: any[]; getLifecycle: string[] } = { listRecent: [], getLifecycle: [] };
  return {
    ctx: {
      activity: {
        listRecent: async (opts: any) => { calls.listRecent.push(opts); return RECENT; },
        getLifecycle: async (id: string) => { calls.getLifecycle.push(id); return id === 'A' ? LIFECYCLE : null; },
      },
    } as any,
    calls,
  };
}

function appWithUser(roles: string[], reg: (app: any) => void, capabilities: string[] = []) {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => { req.user = { id: 'u1', username: 'analyst', roles, capabilities }; });
  reg(app);
  return app;
}

describe('activity routes', () => {
  it('GET /api/activity returns the recent list', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWithUser(['data_analyst'], (a) => registerActivityRoutes(a, ctx), ['activity.view']);
    const res = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(RECENT);
    expect(calls.listRecent[0]).toEqual({ limit: 50, offset: 0 });
  });

  it('GET /api/activity honours limit/offset query params', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerActivityRoutes(a, ctx), ['activity.view']);
    const res = await app.inject({ method: 'GET', url: '/api/activity?limit=10&offset=5' });
    expect(res.statusCode).toBe(200);
    expect(calls.listRecent[0]).toEqual({ limit: 10, offset: 5 });
  });

  it('GET /api/activity/:id returns the lifecycle when found', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(['system_auditor'], (a) => registerActivityRoutes(a, ctx), ['activity.view']);
    const res = await app.inject({ method: 'GET', url: '/api/activity/A' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(LIFECYCLE);
  });

  it('GET /api/activity/:id returns 404 when unknown', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(['lab_manager'], (a) => registerActivityRoutes(a, ctx), ['activity.view']);
    const res = await app.inject({ method: 'GET', url: '/api/activity/missing' });
    expect(res.statusCode).toBe(404);
  });

  it('a role without view access is 403', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(['lab_technician'], (a) => registerActivityRoutes(a, ctx), []);
    const res = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(res.statusCode).toBe(403);
  });
});
