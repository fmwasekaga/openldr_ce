import { describe, it, expect } from 'vitest';
import { buildApp } from './app';
import type { AppContext } from '@openldr/bootstrap';
import { HealthRegistry, createLogger } from '@openldr/core';

function ctxWith(status: 'up' | 'down'): AppContext {
  const health = new HealthRegistry();
  health.register({ name: 'auth', check: async () => ({ status, latencyMs: 1 }) });
  return {
    logger: createLogger({ level: 'silent' }),
    auth: {} as never,
    blob: {} as never,
    eventing: {} as never,
    store: {} as never,
    health,
    reporting: {} as never,
    audit: {} as never,
    users: {} as never,
    terminology: {} as never,
    dashboards: {} as never,
    cfg: {} as never,
    async close() {},
  };
}

describe('GET /health', () => {
  it('returns 200 and overall up when all checks pass', async () => {
    const app = buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('up');
    await app.close();
  });

  it('returns 503 when any check is down', async () => {
    const app = buildApp(ctxWith('down'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('down');
    await app.close();
  });
});
