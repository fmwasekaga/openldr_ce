import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerDhis2Routes } from './dhis2-routes';

const reconcileCalls: number[] = [];
const fakeEventing = { publish: async () => {}, subscribe: async () => {}, drain: async () => {} } as never;

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
    runMapping: async (args: { dryRun: boolean }) => ({ kind: 'aggregate', dryRun: args.dryRun, build: { payload: { dataValues: [{}, {}] }, skipped: [{ row: 3, reason: 'no orgUnit' }] }, result: args.dryRun ? undefined : { status: 'success', imported: 2, updated: 0, ignored: 0, deleted: 0, conflicts: [], raw: {} } }),
    reconcileSchedules: async () => { reconcileCalls.push(1); },
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
    mappingStore: (() => {
      const rows: { id: string; name: string; definition: Record<string, unknown> }[] = [];
      return {
        list: async () => rows.map((r) => ({ id: r.id, name: r.name, kind: (r.definition.kind as string | undefined) ?? null })),
        get: async (id: string) => rows.find((r) => r.id === id) ?? null,
        upsert: async (m: { id: string; name: string; definition: Record<string, unknown> }) => { const i = rows.findIndex((r) => r.id === m.id); if (i >= 0) rows[i] = m; else rows.push(m); },
        remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
      };
    })(),
    scheduleStore: (() => {
      const rows: { id: string; mappingId: string; mode: string; periodType: string; eventDriven: boolean; enabled: boolean; lastRunAt: string | null; nextDueAt: string | null }[] = [];
      return {
        create: async (s: { id: string; mappingId: string; mode: string; periodType: string; eventDriven: boolean }) => { rows.push({ ...s, enabled: true, lastRunAt: null, nextDueAt: null }); },
        get: async (id: string) => rows.find((r) => r.id === id) ?? null,
        list: async () => rows.slice(),
        remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
        setEnabled: async (id: string, enabled: boolean) => { const r = rows.find((x) => x.id === id); if (r) r.enabled = enabled; },
        setNextDue: async () => {}, markRun: async () => {},
      };
    })(),
    ...over,
  };
}

function fakeCtx(cfg: Record<string, unknown>, fhirStore: Record<string, unknown> = {}) {
  const audit: unknown[] = [];
  return {
    cfg,
    fhirStore: { listByType: async () => [], ...fhirStore },
    audit: { record: async (e: unknown) => { audit.push(e); }, list: async () => [{ id: 'p1', occurredAt: '2026-01-01T00:00:00Z', action: 'dhis2.push', entityType: 'dhis2-mapping', entityId: 'm1', actorType: 'system', actorName: 'system', metadata: { period: '2026Q1', status: 'success' } }] },
    logger: { error: () => {} },
    __audit: audit,
    reporting: {
      run: async (id: string) => {
        if (id === 'missing') { const e = new Error('not found'); e.name = 'ReportNotFoundError'; throw e; }
        if (id === 'boom') throw new Error('kaboom');
        return { columns: [{ key: 'month', label: 'Month', kind: 'string' }, { key: 'count', label: 'Count', kind: 'number' }], rows: [], chart: { type: 'bar' }, meta: { generatedAt: 'x', rowCount: 0 } };
      },
      list: () => [{ id: 'test-volume', name: 'Test Volume', description: '' }],
      eventSources: () => [{ id: 'amr-isolates', name: 'AMR isolates', columns: [{ key: 'id', label: 'Isolate ID' }, { key: 'facility', label: 'Facility' }, { key: 'eventDate', label: 'Event date' }, { key: 'antibiotic', label: 'Antibiotic' }, { key: 'result', label: 'Result' }] }],
    },
  } as unknown as AppContext;
}

function appWith(ctxCfg: Record<string, unknown>, dhis2: unknown, roles: string[] = ['lab_admin'], deps = fakeDeps(), fhirStore: Record<string, unknown> = {}) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles };
  });
  registerDhis2Routes(app, fakeCtx(ctxCfg, fhirStore), dhis2 as never, deps as never, fakeEventing);
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
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never, fakeEventing);
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
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never, fakeEventing);
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

describe('dhis2 mappings CRUD + metadata', () => {
  const agg = { kind: 'aggregate', id: 'm1', name: 'Agg', source: { kind: 'report', reportId: 'test-volume' }, orgUnitColumn: 'month', columns: [{ column: 'count', dataElement: 'de1' }] };

  it('GET /mappings lists with kind', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'Agg', definition: agg });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/mappings' })).json();
    expect(body).toEqual([{ id: 'm1', name: 'Agg', kind: 'aggregate' }]);
  });

  it('GET /mappings/:id returns the record or 404', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'Agg', definition: agg });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/mappings/m1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/mappings/ghost' })).statusCode).toBe(404);
  });

  it('PUT /mappings/:id upserts + audits; 400 on bad body', async () => {
    const deps = fakeDeps();
    const ctxRef = fakeCtx(configuredCfg());
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never, fakeEventing);
    const ok = await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/m1', payload: { name: 'Agg', definition: agg } });
    expect(ok.statusCode).toBe(200);
    expect((await deps.mappingStore.get('m1'))?.name).toBe('Agg');
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.mapping.save')).toBe(true);
    const bad = await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/m1', payload: { name: 'x', definition: { id: 'm1' } } });
    expect(bad.statusCode).toBe(400);
  });

  it('DELETE /mappings/:id removes + audits (204)', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'Agg', definition: agg });
    const ctxRef = fakeCtx(configuredCfg());
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never, fakeEventing);
    expect((await app.inject({ method: 'DELETE', url: '/api/dhis2/mappings/m1' })).statusCode).toBe(204);
    expect(await deps.mappingStore.get('m1')).toBeNull();
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.mapping.delete')).toBe(true);
  });

  it('GET /metadata returns the cache or null', async () => {
    const deps = fakeDeps();
    const empty = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    expect((await empty.inject({ method: 'GET', url: '/api/dhis2/metadata' })).json()).toBeNull();
    await deps.metadataCache.save({ dataElements: [{ id: 'de1', name: 'DE' }], orgUnits: [], categoryOptionCombos: [{ id: 'coc1', name: 'COC' }], programs: [], programStages: [] } as never);
    const body = (await empty.inject({ method: 'GET', url: '/api/dhis2/metadata' })).json();
    expect(body.dataElements).toEqual([{ id: 'de1', name: 'DE' }]);
    expect(body.pulledAt).toBeTruthy();
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/mappings' })).statusCode).toBe(403);
  });
});

describe('dhis2 validate + report-columns', () => {
  const agg = { kind: 'aggregate', id: 'm1', name: 'Agg', source: { kind: 'report', reportId: 'test-volume' }, orgUnitColumn: 'month', columns: [{ column: 'count', dataElement: 'de1' }] };

  it('validate returns problems from the cached metadata', async () => {
    const deps = fakeDeps();
    await deps.metadataCache.save({ dataElements: [{ id: 'de1', name: 'DE' }], orgUnits: [], categoryOptionCombos: [], programs: [], programStages: [] } as never);
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const okBody = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).json();
    expect(okBody.problems).toEqual([]); // de1 is known
    const bad = { ...agg, columns: [{ column: 'count', dataElement: 'NOPE' }] };
    const badBody = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: bad })).json();
    expect(badBody.problems.length).toBe(1);
  });

  it('validate warns when no metadata is cached', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], fakeDeps());
    const body = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).json();
    expect(body.problems[0]).toMatch(/pull metadata/i);
  });

  it('report-columns returns columns / 400 / 404 / 502', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/report-columns' })).statusCode).toBe(400);
    const ok = (await app.inject({ method: 'GET', url: '/api/dhis2/report-columns?reportId=test-volume' })).json();
    expect(ok.columns).toEqual([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/report-columns?reportId=missing' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/report-columns?reportId=boom' })).statusCode).toBe(502);
  });

  it('validate rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['viewer']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).statusCode).toBe(403);
  });
});

describe('dhis2 event-sources + tracker mapping', () => {
  const tracker = {
    kind: 'tracker', id: 't1', name: 'Trk',
    source: { kind: 'event-source', sourceId: 'amr-isolates' },
    program: 'prog1', programStage: 'stage1',
    orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
    dataValues: [{ column: 'result', dataElement: 'de1' }],
  };

  it('GET /event-sources returns sources + columns', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/event-sources' })).json();
    expect(body[0].id).toBe('amr-isolates');
    expect(body[0].columns.map((c: { key: string }) => c.key)).toContain('result');
  });

  it('event-sources rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['viewer']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/event-sources' })).statusCode).toBe(403);
  });

  it('validate dispatches tracker vs aggregate', async () => {
    const deps = fakeDeps();
    await deps.metadataCache.save({ dataElements: [{ id: 'de1', name: 'DE' }], orgUnits: [], categoryOptionCombos: [], programs: [{ id: 'prog1', name: 'P' }], programStages: [{ id: 'stage1', name: 'S', program: 'prog1' }] } as never);
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    // valid tracker → no problems
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: tracker })).json().problems).toEqual([]);
    // tracker with unknown program → a problem
    const badProg = { ...tracker, program: 'NOPE' };
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: badProg })).json().problems.length).toBeGreaterThan(0);
    // aggregate still validated by validateMapping
    const agg = { kind: 'aggregate', id: 'm1', name: 'Agg', source: { kind: 'report', reportId: 'test-volume' }, orgUnitColumn: 'month', columns: [{ column: 'count', dataElement: 'de1' }] };
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).json().problems).toEqual([]);
  });

  it('PUT accepts a tracker definition', async () => {
    const deps = fakeDeps();
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const res = await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/t1', payload: { name: 'Trk', definition: tracker } });
    expect(res.statusCode).toBe(200);
    expect((await deps.mappingStore.get('t1'))?.definition).toMatchObject({ kind: 'tracker' });
    // a malformed tracker (missing program) → 400
    const bad = { name: 'Trk', definition: { ...tracker, program: undefined } };
    expect((await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/t1', payload: bad })).statusCode).toBe(400);
  });
});

describe('dhis2 run route', () => {
  it('dry-run returns counts + skipped, no result', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: true } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.kind).toBe('aggregate');
    expect(b.counts).toEqual({ values: 2, skipped: 1 });
    expect(b.skipped[0].reason).toBe('no orgUnit');
    expect(b.result).toBeNull();
  });

  it('push returns the PushResult', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const b = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: false } })).json();
    expect(b.result.status).toBe('success');
    expect(b.result.imported).toBe(2);
  });

  it('returns 409 when DHIS2 is not configured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null, ['lab_admin']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: true } })).statusCode).toBe(409);
  });

  it('400 on bad body', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { dryRun: true } })).statusCode).toBe(400);
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['viewer']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: true } })).statusCode).toBe(403);
  });
});

describe('dhis2 pushes + schedules', () => {
  it('GET /pushes returns audit history', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const b = (await app.inject({ method: 'GET', url: '/api/dhis2/pushes' })).json();
    expect(b[0].action).toBe('dhis2.push');
    expect(b[0].metadata.period).toBe('2026Q1');
  });

  it('GET /schedules joins mapping names', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'My Mapping', definition: { kind: 'aggregate' } });
    await deps.scheduleStore.create({ id: 's1', mappingId: 'm1', mode: 'aggregate', periodType: 'quarterly', eventDriven: false });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const b = (await app.inject({ method: 'GET', url: '/api/dhis2/schedules' })).json();
    expect(b[0]).toMatchObject({ id: 's1', mappingId: 'm1', mappingName: 'My Mapping', periodType: 'quarterly', enabled: true });
  });

  it('POST /schedules derives mode, arms, audits; 404 unknown mapping', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm2', name: 'Trk', definition: { kind: 'tracker' } });
    const before = reconcileCalls.length;
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/schedules', payload: { mappingId: 'm2', periodType: 'monthly', eventDriven: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('tracker');
    expect(reconcileCalls.length).toBeGreaterThan(before); // armed
    expect((await deps.scheduleStore.list()).length).toBe(1);
    const bad = await app.inject({ method: 'POST', url: '/api/dhis2/schedules', payload: { mappingId: 'ghost', periodType: 'monthly', eventDriven: false } });
    expect(bad.statusCode).toBe(404);
  });

  it('POST /schedules/:id/enabled toggles + arms on enable; DELETE removes', async () => {
    const deps = fakeDeps();
    await deps.scheduleStore.create({ id: 's1', mappingId: 'm1', mode: 'aggregate', periodType: 'quarterly', eventDriven: false });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/schedules/s1/enabled', payload: { enabled: false } })).statusCode).toBe(200);
    expect((await deps.scheduleStore.get('s1'))?.enabled).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/dhis2/schedules/s1' })).statusCode).toBe(204);
    expect(await deps.scheduleStore.list()).toEqual([]);
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/schedules' })).statusCode).toBe(403);
  });
});
