import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerAuditRoutes } from './audit-routes';

type AuditEventInput = Parameters<AppContext['audit']['record']>[0];

function fakeCtx() {
  const events = [
    { id: 'a1', occurredAt: '2026-01-01T00:00:00.000Z', actorType: 'system' as const, actorId: null, actorName: 'system', action: 'form.create', entityType: 'form', entityId: 'form-1' },
    { id: 'a2', occurredAt: '2026-01-01T00:01:00.000Z', actorType: 'user' as const, actorId: 'u1', actorName: 'Ada', action: 'user.disable', entityType: 'user', entityId: 'u1' },
  ];
  return {
    audit: {
      record: async (event: AuditEventInput) => ({ id: 'new', occurredAt: 'now', ...event }),
      list: async (filter = {}) => {
        const f = filter as { action?: string; limit?: number; offset?: number };
        const rows = f.action ? events.filter((event) => event.action === f.action) : events;
        return rows.slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? rows.length));
      },
      count: async (filter = {}) => {
        const f = filter as { action?: string };
        return f.action ? events.filter((event) => event.action === f.action).length : events.length;
      },
      get: async (id: string) => events.find((event) => event.id === id),
    },
  } as AppContext;
}

// Audit reads are RBAC-gated on the audit.view capability. Inject an authorized actor by default.
function appWith(ctx: AppContext = fakeCtx(), roles: string[] = ['system_auditor'], capabilities: string[] = ['audit.view']) {
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'auditor', username: 'auditor', displayName: null, roles, capabilities }; });
  registerAuditRoutes(app, ctx);
  return app;
}

describe('audit routes', () => {
  it('returns paged events with a total and narrows by filter', async () => {
    const app = appWith();

    const all = await app.inject({ method: 'GET', url: '/api/audit?limit=1&offset=1' });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ total: 2, events: [{ id: 'a2' }] });

    const filtered = await app.inject({ method: 'GET', url: '/api/audit?action=form.create' });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({ total: 1, events: [{ id: 'a1' }] });
  });

  it('returns an event by id and 404 for a missing event', async () => {
    const app = appWith();

    const found = await app.inject({ method: 'GET', url: '/api/audit/a1' });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ id: 'a1', action: 'form.create' });

    const missing = await app.inject({ method: 'GET', url: '/api/audit/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not found' });
  });

  it('lab_admin may also read the audit log', async () => {
    const app = appWith(fakeCtx(), ['lab_admin'], ['audit.view']);
    expect((await app.inject({ method: 'GET', url: '/api/audit' })).statusCode).toBe(200);
  });

  it('a non-privileged role (lab_technician) is rejected with 403', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], []);
    expect((await app.inject({ method: 'GET', url: '/api/audit' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/audit/a1' })).statusCode).toBe(403);
  });
});
