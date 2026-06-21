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

function fakeDeps(over: Record<string, unknown> = {}) {
  const orgUnitRows: { facilityId: string; orgUnitId: string; orgUnitName: string | null }[] = [];
  let saved: unknown = null;
  return {
    metadataCache: {
      get: async () => (saved ? { metadata: saved, pulledAt: '2026-01-01T00:00:00.000Z' } : null),
      save: async (m: unknown) => { saved = m; },
    },
    orgUnitStore: {
      list: async () => orgUnitRows.slice(),
      upsert: async (entries: typeof orgUnitRows) => { for (const e of entries) { const i = orgUnitRows.findIndex((r) => r.facilityId === e.facilityId); if (i >= 0) orgUnitRows[i] = e; else orgUnitRows.push(e); } },
      remove: async (facilityId: string) => { const i = orgUnitRows.findIndex((r) => r.facilityId === facilityId); if (i >= 0) orgUnitRows.splice(i, 1); },
      getMap: async () => new Map(),
    },
    ...over,
  };
}

function fakeCtx(cfg: Record<string, unknown>, fhirStore: Record<string, unknown> = {}) {
  const audit: unknown[] = [];
  return {
    cfg,
    fhirStore: { listByType: async () => [], ...fhirStore },
    audit: { record: async (e: unknown) => { audit.push(e); }, list: async () => [] },
    logger: { error: () => {} },
    __audit: audit,
  } as unknown as AppContext;
}

function appWith(ctxCfg: Record<string, unknown>, dhis2: unknown, roles: string[] = ['lab_admin'], deps = fakeDeps(), fhirStore: Record<string, unknown> = {}) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles };
  });
  registerDhis2Routes(app, fakeCtx(ctxCfg, fhirStore), dhis2 as never, deps as never);
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

  it('reports configured:true but no live data when the context is null', async () => {
    // Env says configured, but the context could not be built (e.g. createDhis2Context failed).
    const app = appWith(configuredCfg(), null);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/status' })).json();
    expect(body.configured).toBe(true);
    expect(body.reachable).toBeNull();
    expect(body.counts).toBeNull();
    expect(body.recentPushes).toEqual([]);
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

  it('persists the snapshot to the cache and returns pulledAt', async () => {
    const deps = fakeDeps();
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pulledAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await deps.metadataCache.get()).not.toBeNull(); // save was called
  });
});

describe('dhis2 orgunit-mappings routes', () => {
  const locations = { listByType: async () => [
    { id: 'loc-1', resource: { resourceType: 'Location', id: 'loc-1', name: 'Clinic A' } },
    { id: 'loc-2', resource: { resourceType: 'Location', id: 'loc-2' } }, // no name → falls back to id
  ] };

  it('GET composes facilities + mappings + cached orgUnits', async () => {
    const deps = fakeDeps();
    await deps.orgUnitStore.upsert([{ facilityId: 'loc-1', orgUnitId: 'ou1', orgUnitName: 'Clinic A OU' }]);
    await deps.metadataCache.save({ dataElements: [], orgUnits: [{ id: 'ou1', name: 'Clinic A OU' }], categoryOptionCombos: [], programs: [], programStages: [] } as never);
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps, locations);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/orgunit-mappings' })).json();
    expect(body.facilities).toEqual([
      { facilityId: 'loc-1', facilityName: 'Clinic A', orgUnitId: 'ou1', orgUnitName: 'Clinic A OU' },
      { facilityId: 'loc-2', facilityName: 'loc-2', orgUnitId: null, orgUnitName: null },
    ]);
    expect(body.orgUnits).toEqual([{ id: 'ou1', name: 'Clinic A OU' }]);
    expect(body.metadataPulledAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('GET works (empty catalog) when DHIS2 unconfigured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null, ['lab_admin'], fakeDeps(), locations);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/orgunit-mappings' })).json();
    expect(body.facilities).toHaveLength(2);
    expect(body.orgUnits).toEqual([]);
    expect(body.metadataPulledAt).toBeNull();
  });

  it('PUT upserts a mapping and records an audit event', async () => {
    const deps = fakeDeps();
    const ctxRef = fakeCtx(configuredCfg(), locations);
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never);
    const res = await app.inject({ method: 'PUT', url: '/api/dhis2/orgunit-mappings/loc-1', payload: { orgUnitId: 'ou9', orgUnitName: 'New OU' } });
    expect(res.statusCode).toBe(200);
    expect(await deps.orgUnitStore.list()).toEqual([{ facilityId: 'loc-1', orgUnitId: 'ou9', orgUnitName: 'New OU' }]);
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.orgunit.map' && e.entityId === 'loc-1')).toBe(true);
  });

  it('PUT rejects a bad body with 400', async () => {
    const app = appWith(configuredCfg(), fakeDhis2());
    const res = await app.inject({ method: 'PUT', url: '/api/dhis2/orgunit-mappings/loc-1', payload: { orgUnitName: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE removes a mapping (204) and audits', async () => {
    const deps = fakeDeps();
    await deps.orgUnitStore.upsert([{ facilityId: 'loc-1', orgUnitId: 'ou1', orgUnitName: 'A' }]);
    const ctxRef = fakeCtx(configuredCfg(), locations);
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never);
    const res = await app.inject({ method: 'DELETE', url: '/api/dhis2/orgunit-mappings/loc-1' });
    expect(res.statusCode).toBe(204);
    expect(await deps.orgUnitStore.list()).toEqual([]);
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.orgunit.unmap')).toBe(true);
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/orgunit-mappings' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/dhis2/orgunit-mappings/loc-1', payload: { orgUnitId: 'x', orgUnitName: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/dhis2/orgunit-mappings/loc-1' })).statusCode).toBe(403);
  });
});
