import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerConfigRoute } from './app';

describe('GET /api/config', () => {
  it('reports dashboardSqlEnabled from the feature flag (pg target)', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => true },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(true);
    expect(res.json().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('is false when the flag is off even with a pg target', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => false },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(false);
  });
});
