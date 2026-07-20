import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null; before?: unknown; after?: unknown; metadata?: unknown }> = [];
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
      delete: async () => {},
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
    terminology: { admin },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, auditEvents };
}

function appWith(ctx: AppContext, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles }; });
  registerTerminologyAdminRoutes(app, ctx);
  return app;
}

describe('terminology admin RBAC', () => {
  it('a lab_technician cannot mutate terminology (create/import) — 403', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['lab_technician']);
    expect((await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/terminology/import/loinc', payload: { path: '/x', acceptLicense: true } })).statusCode).toBe(403);
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
