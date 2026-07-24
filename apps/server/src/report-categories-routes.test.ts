import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerReportCategoryRoutes } from './report-categories-routes';
import './auth-plugin';

function fakeCtx(initial: { id: string; label: string; order: number }[] = []) {
  let data = initial;
  const auditEvents: any[] = [];
  return {
    reportCategories: {
      list: async () => data,
      save: async (list: { id: string; label: string; order: number }[]) => { data = list; },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
  } as any;
}

function appWith(ctx: any, roles: string[] = ['lab_admin'], capabilities: string[] = ['reports.edit_templates']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles, capabilities }; });
  registerReportCategoryRoutes(app, ctx);
  return app;
}

const validList = [
  { id: 'amr', label: 'AMR / Surveillance', order: 0 },
  { id: 'operational', label: 'Operational', order: 1 },
];

describe('report-categories routes', () => {
  it('GET returns the current list', async () => {
    const ctx = fakeCtx(validList);
    const app = appWith(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/report-categories' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(validList);
  });

  it('GET returns [] when unset', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/report-categories' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('PUT validates + saves (admin), returns saved list, and audits', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'PUT', url: '/api/report-categories', payload: validList });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(validList);
    const list = await app.inject({ method: 'GET', url: '/api/report-categories' });
    expect(list.json()).toEqual(validList);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-category.update')).toBe(true);
  });

  it('PUT rejects an invalid body with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'PUT', url: '/api/report-categories', payload: [{ id: '', label: 'X', order: 0 }] });
    expect(res.statusCode).toBe(400);
  });

  it('PUT 403s for a non-manager role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], []);
    const res = await app.inject({ method: 'PUT', url: '/api/report-categories', payload: validList });
    expect(res.statusCode).toBe(403);
  });

  it('GET is open to any authenticated role', async () => {
    const app = appWith(fakeCtx(validList), ['lab_technician'], []);
    const res = await app.inject({ method: 'GET', url: '/api/report-categories' });
    expect(res.statusCode).toBe(200);
  });
});
