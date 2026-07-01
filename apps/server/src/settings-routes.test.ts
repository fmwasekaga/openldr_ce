import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerSettingsRoutes } from './settings-routes';

function fakeCtx() {
  const store = new Map<string, boolean>();
  const audit: any[] = [];
  const ops = { resetDashboards: 0, factoryReset: 0, clearAudit: 0 };
  return {
    ctx: {
      featureFlags: {
        get: async (id: string) => store.get(id) ?? false,
        all: async () => [{ id: 'dashboard.raw_sql', labelKey: 'l', descriptionKey: 'd', value: store.get('dashboard.raw_sql') ?? false }],
        set: async (id: string, v: boolean) => { store.set(id, v); },
        invalidate: () => {},
      },
      audit: { record: async (e: any) => { audit.push(e); return e; } },
      logger: { error() {}, warn() {}, info() {} },
      dashboards: { store: { list: async () => [], remove: async () => {}, create: async () => ({}) } },
      internalDb: {} as any,
      cfg: {},
      __audit: audit,
      __ops: ops,
    } as any,
    deps: {
      resetDashboards: async () => { ops.resetDashboards++; },
      factoryReset: async () => { ops.factoryReset++; },
      clearAudit: async () => { ops.clearAudit++; },
    },
  };
}

function appWithUser(roles: string[], reg: (app: any) => void) {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => { req.user = { id: 'u1', username: 'admin', roles }; });
  reg(app);
  return app;
}

describe('settings routes', () => {
  it('GET /api/settings/flags returns merged flags', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/flags' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe('dashboard.raw_sql');
  });

  it('PUT /api/settings/flags/:key sets the value and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/flags/dashboard.raw_sql', payload: { value: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(true);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.flag.update')).toBe(true);
  });

  it('non-admin PUT is 403', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_technician'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/flags/dashboard.raw_sql', payload: { value: true } });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/settings/danger/factory-reset runs the op and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/factory-reset' });
    expect(res.statusCode).toBe(200);
    expect((ctx as any).__ops.factoryReset).toBe(1);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.danger.factory-reset')).toBe(true);
  });

  it('unknown danger action is 404', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/nuke-everything' });
    expect(res.statusCode).toBe(404);
  });
});
