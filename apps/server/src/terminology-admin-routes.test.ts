import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null; before?: unknown; after?: unknown; metadata?: unknown }> = [];
  const ctxState = { active: false, enqueued: [] as any[], latest: null as any, put: [] as string[], deleted: [] as string[], codingSystem: null as any, upserts: [] as any[], jobsForSystem: [] as any[], deleteThrows: null as any, unlinked: [] as string[] };
  const admin = {
    publishers: {
      create: async (d: any) => ({ id: 'pub1', ...d }),
      update: async (id: string, d: any) => ({ id, ...d }),
      delete: async () => {},
    },
    codingSystems: {
      list: async () => [],
      create: async (d: any) => ({ id: 'sys1', ...d }),
      update: async (id: string, d: any) => ({ id, ...d }),
      delete: async (_id: string, _opts?: any) => { if (ctxState.deleteThrows) throw ctxState.deleteThrows; },
      getByUrl: async (_url: string) => ctxState.codingSystem,
      upsertByUrl: async (input: any) => { ctxState.codingSystem = { id: 'cs-url-LOINC', url: input.url, systemCode: input.systemCode, systemName: input.systemName, publisherId: input.publisherId, systemVersion: input.systemVersion ?? null, active: true, seeded: true, description: null }; ctxState.upserts.push(input); },
    },
    valueSets: {
      get: async (id: string) => ({ id, url: 'u' }),
      save: async (d: any) => ({ id: 'vs1', ...d }),
      delete: async () => {},
      duplicate: async (id: string) => ({ id: 'vs2', sourceId: id }),
      importFhir: async (r: any) => ({ id: 'vs9', url: 'http://imported' }),
    },
  };
  const ctx = {
    terminology: { admin, ontology: { unlink: async (id: string) => { ctxState.unlinked.push(id); } } },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    terminologyJobs: {
      hasActive: async () => ctxState.active,
      enqueue: async (input: any) => { ctxState.enqueued.push(input); return { id: 'tij_1', status: 'queued', ...input }; },
      latestForSystem: async () => ctxState.latest,
      listForCodingSystem: async (_id: string) => ctxState.jobsForSystem,
      get: async () => ctxState.latest,
    },
    blob: {
      putStream: async (key: string) => { ctxState.put.push(key); },
      delete: async (key: string) => { ctxState.deleted.push(key); },
    },
  } as unknown as AppContext;
  return { ctx, auditEvents, ctxState };
}

function appWith(ctx: AppContext, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles, capabilities: [] }; });
  registerTerminologyAdminRoutes(app, ctx);
  return app;
}

describe('terminology admin RBAC', () => {
  it('a lab_technician cannot mutate terminology (create/import) — 403', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['lab_technician']);
    expect((await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/terminology/systems/sys9' })).statusCode).toBe(403);
  });

  it('read-only terminology GETs are NOT role-gated (a lab_technician is not rejected)', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['lab_technician']);
    // The handler runs (no 401/403 from the guard); the fake ctx's list is not fully stubbed, so the
    // status itself is not asserted — only that RBAC did not block the read.
    const res = await app.inject({ method: 'GET', url: '/api/terminology/publishers' });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe('terminology admin audit', () => {
  it('audits publisher create with the request actor', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
    expect(auditEvents[0]).toMatchObject({ action: 'publisher.create', entityType: 'publisher', entityId: 'pub1', actorId: 'admin1' });
  });

  it('audits coding system delete', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/sys9' });
    expect(res.statusCode).toBe(204);
    expect(auditEvents[0]).toMatchObject({ action: 'coding_system.delete', entityType: 'coding_system', entityId: 'sys9' });
  });

  it('audits value set update with a before snapshot', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'PUT', url: '/api/terminology/valuesets/vs1', payload: { url: 'u', status: 'active', compose: {} } });
    expect(res.statusCode).toBe(200);
    expect(auditEvents[0]).toMatchObject({ action: 'value_set.update', entityType: 'value_set', entityId: 'vs1' });
    expect(auditEvents[0].before).toEqual({ id: 'vs1', url: 'u' });
  });

  it('audits a value-set import with counts, not the full entity', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/valuesets/import', headers: { 'content-type': 'application/fhir+json' }, payload: JSON.stringify({ resourceType: 'ValueSet', url: 'http://imported', status: 'active' }) });
    expect(res.statusCode).toBe(201);
    const ev = auditEvents.find((e) => e.action === 'value_set.import');
    expect(ev).toBeTruthy();
    expect((ev as any).after).toBeNull();
    expect((ev as any).metadata).toMatchObject({ id: 'vs9' });
  });

  it('best-effort: a failing audit recorder does not break the route', async () => {
    const { ctx } = fakeCtx();
    (ctx as any).audit.record = async () => { throw new Error('db down'); };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
  });
});

describe('terminology admin: coding system cascade delete', () => {
  it('deletes an upload-created system (has an ingest job): 204, unlinks ontology, deletes its blob', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.jobsForSystem = [{ id: 'tij_1', blobKey: 'terminology-dist/loinc/tij_1.zip' }];
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/cs-url-LOINC' });
    expect(res.statusCode).toBe(204);
    expect(ctxState.deleted).toEqual(['terminology-dist/loinc/tij_1.zip']);
    expect(ctxState.unlinked).toEqual(['cs-url-LOINC']);
  });

  it('a protected (system-managed) coding system returns 409 with the guard message', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.deleteThrows = Object.assign(new Error('This is a system-managed coding system and cannot be deleted.'), { name: 'TerminologyAdminError', kind: 'conflict' });
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/cs-fhir' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/system-managed coding system/i);
    expect(ctxState.deleted).toEqual([]);
  });
});

describe('terminology distribution upload/status/purge (publisher-scoped)', () => {
  it('resolve-or-CREATES the coding system then enqueues (201) when none exists', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = null;
    const app = appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true&version=2.82',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('PK-fake-zip'),
    });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts[0]).toMatchObject({ url: 'http://loinc.org', systemCode: 'LOINC', publisherId: 'pub-loinc' });
    expect(ctxState.enqueued[0]).toMatchObject({ systemType: 'loinc', codingSystemId: 'cs-url-LOINC', version: '2.82' });
    expect(res.json().jobId).toBe('tij_1');
  });

  it('REUSES an existing coding system (no upsert) and enqueues', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = { id: 'cs-existing', url: 'http://loinc.org', systemCode: 'LOINC' };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts.length).toBe(0);
    expect(ctxState.enqueued[0].codingSystemId).toBe('cs-existing');
  });

  it('rejects a missing license (400) and never stores', async () => {
    const { ctx, ctxState } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=false', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
    expect(ctxState.put.length).toBe(0);
  });

  it('accepts a snomed upload (resolve-or-create + enqueue)', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = null;
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-snomed-ct/distribution?systemType=snomed&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts[0]).toMatchObject({ url: 'http://snomed.info/sct' });
    expect(ctxState.enqueued[0].systemType).toBe('snomed');
  });

  it('reingest re-enqueues from the retained blob (202) for an upload-managed system', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.jobsForSystem = [{ id: 'tij_old', systemType: 'loinc', codingSystemId: 'cs-url-LOINC', blobKey: 'terminology-dist/loinc/cs-url-LOINC-1.zip', version: '2.82' }];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/systems/cs-url-LOINC/distribution/reingest' });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toBe('tij_1');
    expect(ctxState.enqueued[0]).toMatchObject({ systemType: 'loinc', codingSystemId: 'cs-url-LOINC', blobKey: 'terminology-dist/loinc/cs-url-LOINC-1.zip', version: '2.82' });
  });

  it('reingest returns 409 when there is no retained distribution', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.jobsForSystem = [];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/systems/cs-url-LOINC/distribution/reingest' });
    expect(res.statusCode).toBe(409);
    expect(ctxState.enqueued.length).toBe(0);
  });

  it('still rejects a genuinely unknown systemType (400)', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-x/distribution?systemType=nope&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when a job is already active (409)', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.active = true;
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(409);
  });

  it('GET job returns the latest job', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', phase: null, processed: 5, total: 5, error: null, version: '2.82', finishedAt: 'now' };
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/terminology/publishers/pub-loinc/distribution/job?systemType=loinc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', processed: 5 });
  });

  it('DELETE purges the retained blob', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', blobKey: 'terminology-dist/loinc/tij_1.zip', codingSystemId: 'cs-existing' };
    const res = await appWith(ctx).inject({ method: 'DELETE', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc' });
    expect(res.statusCode).toBe(204);
    expect(ctxState.deleted).toEqual(['terminology-dist/loinc/tij_1.zip']);
  });

  it('a lab_technician is rejected (403) on upload', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['lab_technician']).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(403);
  });
});
