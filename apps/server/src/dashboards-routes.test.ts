import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { modelsForClient } from '@openldr/dashboards';
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
      models: () => modelsForClient(),
      query: async (q: any) => {
        if (q.mode === 'sql') { const e: any = new Error('raw SQL widgets are disabled'); e.name = 'DashboardQueryError'; throw e; }
        return { columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'now', rowCount: 0 } };
      },
      compileSql: async (q: any) => `select count(*) as value from lab_requests where status = 'active' -- model:${q.model}`,
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

// Dashboard routes are RBAC-gated (VIEW: reporting roles; MANAGE: admin/manager). Inject an authorized
// actor so tests exercise the handlers, not the role guard. `id:'admin1'` matches the audit assertion.
function appWith(ctx: any = fakeCtx(), roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles }; });
  registerDashboardRoutes(app, ctx);
  return app;
}

describe('dashboard routes', () => {
  it('lists models', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/dashboards/models' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe('service_requests');
  });
  it('GET /api/dashboards/models returns optionalJoins with denylist-filtered columns and no raw joins', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/dashboards/models' });
    expect(res.statusCode).toBe(200);
    const models = res.json() as Array<Record<string, any>>;
    const sr = models.find((m) => m.id === 'service_requests')!;
    expect(sr.joins).toBeUndefined();
    const jp = sr.optionalJoins.find((j: any) => j.alias === 'jp');
    expect(jp.label).toBe('Patient');
    expect(jp.exposableColumns).toContain('managing_organization');
    expect(jp.exposableColumns).not.toContain('surname');
  });
  it('runs a builder query', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } });
    expect(res.statusCode).toBe(200);
  });
  it('rejects a disabled sql query with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'sql', sql: 'select 1' } });
    expect(res.statusCode).toBe(400);
  });

  it('compile-sql returns SQL text for a builder query', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST',
      url: '/api/dashboards/compile-sql',
      payload: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sql).toMatch(/select count\(\*\)/i);
  });

  it('compile-sql rejects a sql-mode body', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/compile-sql', payload: { mode: 'sql', sql: 'select 1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/builder-mode/i);
  });
  it('creates and lists a dashboard', async () => {
    const app = appWith(fakeCtx());
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: { id: 'd1', name: 'M', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null } });
    const res = await app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(res.json().length).toBe(1);
  });

  it('authoring gate: rejects creating a dashboard with an sql widget when the flag is off', async () => {
    const app = appWith(fakeCtx({ DASHBOARD_SQL_ENABLED: false }));
    const res = await app.inject({ method: 'POST', url: '/api/dashboards', payload: dashWithSql });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/raw SQL widgets are disabled/);
  });

  it('authoring gate: rejects updating a dashboard to add a NEW sql widget when the flag is off', async () => {
    const app = appWith(fakeCtx({ DASHBOARD_SQL_ENABLED: false }));
    const res = await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: dashWithSql });
    expect(res.statusCode).toBe(400);
  });

  it('authoring gate: allows updating an existing all-SQL dashboard with UNCHANGED sql (layout/chart edit) when the flag is off', async () => {
    const ctx = fakeCtx({ DASHBOARD_SQL_ENABLED: false });
    // Seed the store directly (bypasses the authoring route, like the server-seeded sample).
    await ctx.dashboards.store.create(dashWithSql);
    const app = appWith(ctx);
    // Same SQL, but the widget's chart type changed and layout was edited — must save.
    const edited = { ...dashWithSql, layout: [{ i: 'w1', x: 1, y: 1, w: 4, h: 3 }], widgets: [{ ...sqlWidget, type: 'bar-chart', visual: { xAxisKey: 'a' } }] };
    const res = await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: edited });
    expect(res.statusCode).toBe(200);
  });

  it('authoring gate: rejects updating an existing sql dashboard when a widget’s sql is CHANGED when the flag is off', async () => {
    const ctx = fakeCtx({ DASHBOARD_SQL_ENABLED: false });
    await ctx.dashboards.store.create(dashWithSql);
    const app = appWith(ctx);
    const changed = { ...dashWithSql, widgets: [{ ...sqlWidget, query: { mode: 'sql', sql: 'select 2 as value' } }] };
    const res = await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: changed });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/raw SQL widgets are disabled/);
  });

  it('authoring gate: allows persisting an sql widget when the flag is on', async () => {
    const app = appWith(fakeCtx({ DASHBOARD_SQL_ENABLED: true }));
    const res = await app.inject({ method: 'POST', url: '/api/dashboards', payload: dashWithSql });
    expect(res.statusCode).toBe(200);
  });

  it('RBAC: a lab_technician cannot author dashboards but a data_analyst may view/query', async () => {
    // Writes are MANAGE (admin/manager); a technician is rejected.
    const tech = appWith(fakeCtx(), ['lab_technician']);
    expect((await tech.inject({ method: 'POST', url: '/api/dashboards', payload: { id: 'd1', name: 'M', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null } })).statusCode).toBe(403);
    expect((await tech.inject({ method: 'GET', url: '/api/dashboards' })).statusCode).toBe(403);
    // Reads/query are VIEW (reporting roles); a data_analyst is allowed.
    const analyst = appWith(fakeCtx(), ['data_analyst']);
    expect((await analyst.inject({ method: 'GET', url: '/api/dashboards' })).statusCode).toBe(200);
    expect((await analyst.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } })).statusCode).toBe(200);
  });

  it('audits create/update/delete with the request actor', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
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
