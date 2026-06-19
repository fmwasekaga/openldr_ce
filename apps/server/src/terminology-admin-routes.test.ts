import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null }> = [];
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
    },
  };
  const ctx = {
    terminology: { admin },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, auditEvents };
}

function appWith(ctx: AppContext) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
  registerTerminologyAdminRoutes(app, ctx);
  return app;
}

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
    expect(auditEvents[0]).toHaveProperty('before');
  });

  it('best-effort: a failing audit recorder does not break the route', async () => {
    const { ctx } = fakeCtx();
    (ctx as any).audit.record = async () => { throw new Error('db down'); };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
  });
});
