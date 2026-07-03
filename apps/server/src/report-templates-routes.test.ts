import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerReportTemplateRoutes } from './report-templates-routes';
import './auth-plugin';

function fakeCtx() {
  const data: any[] = [];
  const auditEvents: any[] = [];
  return {
    reportTemplates: {
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
  id: 'rt1', name: 'Report', description: '', category: 'operational', status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [], rows: [],
};

function appWith(ctx: any, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles }; });
  registerReportTemplateRoutes(app, ctx);
  return app;
}

describe('report-template routes', () => {
  it('creates then lists a template (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/report-templates', payload: minimal });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/report-templates' });
    expect(list.json().length).toBe(1);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-template.create')).toBe(true);
  });

  it('rejects an invalid payload with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-templates', payload: { id: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a create from a non-manager role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician']);
    const res = await app.inject({ method: 'POST', url: '/api/report-templates', payload: minimal });
    expect(res.statusCode).toBe(403);
  });

  it('404s GET of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/report-templates/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('updates and deletes (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-templates', payload: minimal });
    const upd = await app.inject({ method: 'PUT', url: '/api/report-templates/rt1', payload: { ...minimal, name: 'Renamed' } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().name).toBe('Renamed');
    const del = await app.inject({ method: 'DELETE', url: '/api/report-templates/rt1' });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/report-templates' })).json().length).toBe(0);
  });
});

describe('report-template preview', () => {
  const tpl = {
    id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi {{param.who}}', style: {} } }] }],
  };

  function ctxWith(tplRow: any) {
    return {
      reportTemplates: { get: async (id: string) => (id === tplRow?.id ? tplRow : undefined) },
      dashboards: { query: async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'n', rowCount: 0 } }) },
      logger: { error() {}, warn() {}, info() {} },
    } as any;
  }

  it('returns a PDF for a known template', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles: ['lab_technician'] }; });
    registerReportTemplateRoutes(app, ctxWith(tpl));
    const res = await app.inject({ method: 'POST', url: '/api/report-templates/rt1/preview', payload: { params: { who: 'Ndola' } } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('404s an unknown template', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles: ['lab_technician'] }; });
    registerReportTemplateRoutes(app, ctxWith(tpl));
    const res = await app.inject({ method: 'POST', url: '/api/report-templates/nope/preview', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
