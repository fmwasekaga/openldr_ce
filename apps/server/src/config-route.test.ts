import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerConfigRoute } from './app';

describe('GET /api/config', () => {
  it('reports dashboardSqlEnabled', async () => {
    const app = Fastify();
    registerConfigRoute(app, { cfg: { DASHBOARD_SQL_ENABLED: true, TARGET_STORE_ADAPTER: 'pg' } } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(true);
  });
});
