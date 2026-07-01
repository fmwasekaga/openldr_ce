import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerDashboardRoutes } from './dashboards-routes';
import './auth-plugin';

function fakeCtx(cfg: { DASHBOARD_SQL_ENABLED?: boolean } = {}) {
  const data: any[] = [];
  const auditEvents: any[] = [];
  const sqlEnabled = cfg.DASHBOARD_SQL_ENABLED ?? false;
  return {
    dashboards: {
      store: {
        list: async () => data,
        get: async (id: string) => data.find((d) => d.id === id),
        create: async (d: any) => { data.push(d); return d; },
        update: async (_id: string, d: any) => d,
        remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
      },
      models: () => [{ id: 'service_requests', label: 'Test Orders', dimensions: [], metrics: [] }],
      query: async (q: any) => {
        if (q.mode === 'sql') { const e: any = new Error('raw SQL widgets are disabled'); e.name = 'DashboardQueryError'; throw e; }
        return { columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'now', rowCount: 0 } };
      },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    featureFlags: { get: async (_id: string) => sqlEnabled },
    cfg: {},
    __auditEvents: auditEvents,
  } as any;
}

const sqlWidget = { id: 'w1', type: 'kpi', title: 'K', refreshIntervalSec: 0, visual: {}, query: { mode: 'sql', sql: 'select 1 as value' } };
const dashWithSql = { id: 'd1', name: 'M', layout: [], widgets: [sqlWidget], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null };

describe('dashboard routes', () => {
  it('lists models', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/dashboards/models' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe('service_requests');
  });
  it('runs a builder query', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } });
    expect(res.statusCode).toBe(200);
  });
  it('rejects a disabled sql query with 400', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'sql', sql: 'select 1' } });
    expect(res.statusCode).toBe(400);
  });
  it('creates and lists a dashboard', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: { id: 'd1', name: 'M', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null } });
    const res = await app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(res.json().length).toBe(1);
  });

  it('authoring gate: rejects creating a dashboard with an sql widget when the flag is off', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx({ DASHBOARD_SQL_ENABLED: false }));
    const res = await app.inject({ method: 'POST', url: '/api/dashboards', payload: dashWithSql });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/raw SQL widgets are disabled/);
  });

  it('authoring gate: rejects updating a dashboard to add a NEW sql widget when the flag is off', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx({ DASHBOARD_SQL_ENABLED: false }));
    const res = await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: dashWithSql });
    expect(res.statusCode).toBe(400);
  });

  it('authoring gate: allows updating an existing all-SQL dashboard with UNCHANGED sql (layout/chart edit) when the flag is off', async () => {
    const ctx = fakeCtx({ DASHBOARD_SQL_ENABLED: false });
    // Seed the store directly (bypasses the authoring route, like the server-seeded sample).
    await ctx.dashboards.store.create(dashWithSql);
    const app = Fastify(); registerDashboardRoutes(app, ctx);
    // Same SQL, but the widget's chart type changed and layout was edited — must save.
    const edited = { ...dashWithSql, layout: [{ i: 'w1', x: 1, y: 1, w: 4, h: 3 }], widgets: [{ ...sqlWidget, type: 'bar-chart', visual: { xAxisKey: 'a' } }] };
    const res = await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: edited });
    expect(res.statusCode).toBe(200);
  });

  it('authoring gate: rejects updating an existing sql dashboard when a widget’s sql is CHANGED when the flag is off', async () => {
    const ctx = fakeCtx({ DASHBOARD_SQL_ENABLED: false });
    await ctx.dashboards.store.create(dashWithSql);
    const app = Fastify(); registerDashboardRoutes(app, ctx);
    const changed = { ...dashWithSql, widgets: [{ ...sqlWidget, query: { mode: 'sql', sql: 'select 2 as value' } }] };
    const res = await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: changed });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/raw SQL widgets are disabled/);
  });

  it('authoring gate: allows persisting an sql widget when the flag is on', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx({ DASHBOARD_SQL_ENABLED: true }));
    const res = await app.inject({ method: 'POST', url: '/api/dashboards', payload: dashWithSql });
    expect(res.statusCode).toBe(200);
  });

  it('audits create/update/delete with the request actor', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerDashboardRoutes(app, ctx);
    const d = { id: 'd1', name: 'M', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null };
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: d });
    await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: d });
    await app.inject({ method: 'DELETE', url: '/api/dashboards/d1' });
    const events = (ctx as any).__auditEvents as Array<{ action: string; entityType: string; actorId: string }>;
    expect(events.map((e) => e.action)).toEqual(['dashboard.create', 'dashboard.update', 'dashboard.delete']);
    expect(events.every((e) => e.entityType === 'dashboard' && e.actorId === 'admin1')).toBe(true);

    // no-op delete (non-existent id) must not emit an extra audit event
    const before = events.length;
    await app.inject({ method: 'DELETE', url: '/api/dashboards/does-not-exist' });
    expect(events.length).toBe(before);
  });
});
