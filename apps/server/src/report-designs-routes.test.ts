import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerReportDesignRoutes } from './report-designs-routes';
import './auth-plugin';

function fakeCtx() {
  const data: any[] = [];
  const auditEvents: any[] = [];
  return {
    reportDesigns: {
      list: async () => data,
      get: async (id: string) => data.find((d) => d.id === id),
      create: async (d: any) => { data.push(d); return d; },
      update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
      remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
  } as any;
}

const minimal = {
  id: 'rd1', name: 'Design', paper: 'A4', orientation: 'portrait',
  pages: [{ id: 'p1', elements: [] }], parameters: [],
};

function appWith(ctx: any, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles }; });
  registerReportDesignRoutes(app, ctx);
  return app;
}

describe('report-design routes', () => {
  it('creates then lists a design (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/report-designs' });
    expect(list.json().length).toBe(1);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.create')).toBe(true);
  });

  it('gets a design by id (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Design');
  });

  it('rejects an invalid payload with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: { id: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a create from a non-manager role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician']);
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    expect(res.statusCode).toBe(403);
  });

  it('404s GET of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('404s a PUT of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'PUT', url: '/api/report-designs/nope', payload: minimal });
    expect(res.statusCode).toBe(404);
  });

  it('updates and deletes (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const upd = await app.inject({ method: 'PUT', url: '/api/report-designs/rd1', payload: { ...minimal, name: 'Renamed' } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().name).toBe('Renamed');
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.update')).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: '/api/report-designs/rd1' });
    expect(del.statusCode).toBe(204);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.delete')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/report-designs' })).json().length).toBe(0);
  });
});
