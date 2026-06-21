import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerDhis2Routes } from './dhis2-routes';

function configuredCfg(over: Record<string, unknown> = {}) {
  return {
    REPORTING_TARGET_ADAPTER: 'dhis2',
    DHIS2_BASE_URL: 'https://play.dhis2.example/api',
    DHIS2_USERNAME: 'admin',
    DHIS2_PASSWORD: 'secret',
    DHIS2_SYNC_ENABLED: true,
    ...over,
  };
}

function fakeDhis2(over: Record<string, unknown> = {}) {
  return {
    target: { healthCheck: async () => ({ status: 'up' as const, latencyMs: 12 }) },
    mappings: { list: async () => [{ id: 'm1', name: 'A' }] },
    orgUnits: { list: async () => [{ facilityId: 'f1', orgUnit: 'o1' }] },
    schedules: { list: async () => [] },
    recentPushes: async () => [{ id: 'a1', occurredAt: '2026-01-01T00:00:00Z', action: 'dhis2.push', entityType: 'dhis2-mapping', entityId: 'm1', actorType: 'system', actorName: 'system' }],
    pullMetadata: async () => ({ dataElements: [{ id: 'd', name: 'd' }], orgUnits: [], categoryOptionCombos: [], programs: [], programStages: [] }),
    ...over,
  } as never;
}

function appWith(ctxCfg: Record<string, unknown>, dhis2: unknown, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles };
  });
  registerDhis2Routes(app, { cfg: ctxCfg } as unknown as AppContext, dhis2 as never);
  return app;
}

describe('dhis2 status route', () => {
  it('returns live status when configured', async () => {
    const app = appWith(configuredCfg(), fakeDhis2());
    const res = await app.inject({ method: 'GET', url: '/api/dhis2/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.host).toBe('play.dhis2.example');
    expect(body.reachable).toEqual({ status: 'up', latencyMs: 12 });
    expect(body.counts).toEqual({ mappings: 1, orgUnitMappings: 1, schedules: 0 });
    expect(body.recentPushes).toHaveLength(1);
    // Never leak credentials.
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('returns configured:false (no context calls) when unconfigured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null);
    const res = await app.inject({ method: 'GET', url: '/api/dhis2/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.reachable).toBeNull();
    expect(body.counts).toBeNull();
    expect(body.recentPushes).toEqual([]);
  });

  it('reports reachable down when healthCheck throws', async () => {
    const app = appWith(configuredCfg(), fakeDhis2({ target: { healthCheck: async () => { throw new Error('ECONNREFUSED'); } } }));
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/status' })).json();
    expect(body.reachable.status).toBe('down');
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_technician']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/status' })).statusCode).toBe(403);
  });
});

describe('dhis2 metadata pull route', () => {
  it('returns metadata counts when configured', async () => {
    const app = appWith(configuredCfg(), fakeDhis2());
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts).toEqual({ dataElements: 1, orgUnits: 0, categoryOptionCombos: 0, programs: 0, programStages: 0 });
  });

  it('returns 409 when not configured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(409);
  });

  it('returns 502 (redacted) when pull throws', async () => {
    const app = appWith(configuredCfg(), fakeDhis2({ pullMetadata: async () => { throw new Error('boom'); } }));
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBeTruthy();
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' })).statusCode).toBe(403);
  });
});
