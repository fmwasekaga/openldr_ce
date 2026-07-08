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

const fakeCq = {
  get: async (id: string) =>
    id === 'cq_1' ? { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select 1 as n', params: [] } : undefined,
};
const fakeRun = async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }] });
function fakeDeps(runConnectorSql: any = fakeRun): any {
  return { customQueries: fakeCq, runConnectorSql };
}

function appWith(ctx: any, roles: string[] = ['lab_admin'], deps: any = fakeDeps()) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles }; });
  registerReportDesignRoutes(app, ctx, deps);
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

  it('renders a design body to a PDF (bound table resolved)', async () => {
    const app = appWith(fakeCtx(), ['data_analyst']);
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      parameters: [{ key: 'facility', label: 'F', type: 'text', value: 'HQ' }],
      pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('400s an invalid design body', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: { id: 'd' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a non-manager/non-analyst role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician']);
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: { id: 'd', name: 'N' } });
    expect(res.statusCode).toBe(403);
  });

  it('renders a per-table error placeholder when a bound query fails (no 500)', async () => {
    const rejectingRun = async () => { throw new Error('boom'); };
    const app = appWith(fakeCtx(), ['lab_admin'], fakeDeps(rejectingRun));
    const design = { id: 'd', name: 'N', pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    // A valid PDF is still produced (the error becomes an in-PDF placeholder).
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('substitutes a design param into the query SQL that reaches the connector', async () => {
    const cqWithParam = {
      get: async (id: string) => id === 'cq_1'
        ? { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select * from t where f = {{param.facility}}', params: [{ id: 'facility', label: 'F', type: 'text', required: true }] }
        : undefined,
    };
    const calls: { connectorId: string; sql: string }[] = [];
    const spyRun = async (input: { connectorId: string; sql: string }) => {
      calls.push(input);
      return { columns: [{ key: 'f', label: 'f' }], rows: [{ f: 'HQ' }] };
    };
    const app = appWith(fakeCtx(), ['lab_admin'], { customQueries: cqWithParam, runConnectorSql: spyRun });
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      parameters: [{ key: 'facility', label: 'F', type: 'text', value: 'HQ' }],
      pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("'HQ'");
  });

  it('renders a design with no bound tables (static elements) to a PDF', async () => {
    const app = appWith(fakeCtx());
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      pages: [{ id: 'p', elements: [
        { id: 'txt', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 200, h: 40 }, text: 'Hello' },
        { id: 'tbl', kind: 'table', name: 'U', rect: { x: 0, y: 50, w: 200, h: 80 } },
      ] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});
