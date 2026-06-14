import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerDashboardRoutes } from './dashboards-routes';

function fakeCtx() {
  const data: any[] = [];
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
  } as any;
}

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
});
