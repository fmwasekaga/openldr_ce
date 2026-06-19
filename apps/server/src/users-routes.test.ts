import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerUsersRoutes } from './users-routes';
import './auth-plugin';

type User = Awaited<ReturnType<AppContext['users']['create']>>;

function fakeCtx() {
  const users: User[] = [];
  let seq = 0;
  const auditEvents: unknown[] = [];
  const authCalls: Array<{ op: string; args: unknown[] }> = [];
  return {
    users: {
      create: async (input: Parameters<AppContext['users']['create']>[0]) => {
        if (users.some((user) => user.username === input.username)) throw new Error('duplicate username');
        const user: User = {
          id: `u${++seq}`,
          subject: null,
          username: input.username,
          displayName: input.displayName ?? null,
          email: input.email ?? null,
          roles: input.roles ?? [],
          status: 'active',
          lastLoginAt: null,
          createdAt: null,
        };
        users.push(user);
        return user;
      },
      get: async (id: string) => users.find((user) => user.id === id),
      getBySubject: async (subject: string) => users.find((user) => user.subject === subject),
      getByUsername: async (username: string) => users.find((user) => user.username === username),
      list: async () => [...users],
      update: async (id: string, input: { displayName?: string | null; email?: string | null }) => {
        const user = users.find((item) => item.id === id);
        if (!user) return;
        if ('displayName' in input) user.displayName = input.displayName ?? null;
        if ('email' in input) user.email = input.email ?? null;
      },
      setRoles: async (id: string, roles: string[]) => {
        const user = users.find((item) => item.id === id);
        if (user) user.roles = roles;
      },
      setStatus: async (id: string, status: 'active' | 'disabled') => {
        const user = users.find((item) => item.id === id);
        if (user) user.status = status;
      },
      syncFromClaims: async () => {
        throw new Error('not used');
      },
    },
    auth: {
      verifyToken: async () => ({ sub: 's' }),
      resetPassword: async (...args: unknown[]) => { authCalls.push({ op: 'resetPassword', args }); },
      sendPasswordResetEmail: async (...args: unknown[]) => { authCalls.push({ op: 'sendPasswordResetEmail', args }); },
      forceLogout: async (...args: unknown[]) => { authCalls.push({ op: 'forceLogout', args }); },
    },
    audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
    __authCalls: authCalls,
    __setSubject: (id: string, subject: string) => {
      const user = users.find((item) => item.id === id);
      if (user) user.subject = subject;
    },
  } as unknown as AppContext;
}

describe('users routes', () => {
  it('creates, lists, updates roles/profile, disables, and gets a user', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] };
    });
    registerUsersRoutes(app, fakeCtx());

    const created = await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'ada', displayName: 'Ada', roles: ['lab_admin'] } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/users' });
    expect(list.json()).toMatchObject([{ username: 'ada', displayName: 'Ada', roles: ['lab_admin'] }]);

    const updated = await app.inject({ method: 'PUT', url: `/api/users/${id}`, payload: { displayName: 'Ada Lovelace', email: 'ada@test.local', roles: ['system_auditor'] } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ displayName: 'Ada Lovelace', email: 'ada@test.local', roles: ['system_auditor'] });

    const disabled = await app.inject({ method: 'POST', url: `/api/users/${id}/status`, payload: { status: 'disabled' } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ status: 'disabled' });

    const got = await app.inject({ method: 'GET', url: `/api/users/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id, username: 'ada', status: 'disabled' });
  });

  it('rejects Users mutations without the lab_admin role', async () => {
    // non-admin actor → 403
    const app1 = Fastify();
    app1.addHook('onRequest', async (req) => {
      req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] };
    });
    registerUsersRoutes(app1, fakeCtx());
    const forbidden = await app1.inject({ method: 'POST', url: '/api/users', payload: { username: 'x' } });
    expect(forbidden.statusCode).toBe(403);

    // no actor → 401
    const app2 = Fastify();
    registerUsersRoutes(app2, fakeCtx());
    const unauth = await app2.inject({ method: 'POST', url: '/api/users', payload: { username: 'x' } });
    expect(unauth.statusCode).toBe(401);
  });

  it('returns 404 for a missing user and 400 for a bad status', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] };
    });
    registerUsersRoutes(app, fakeCtx());

    const missing = await app.inject({ method: 'GET', url: '/api/users/nope' });
    expect(missing.statusCode).toBe(404);

    const badStatus = await app.inject({ method: 'POST', url: '/api/users/nope/status', payload: { status: 'pending' } });
    expect(badStatus.statusCode).toBe(400);
  });

  it('records audit events for create/update/status with the real actor', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] };
    });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const events = () => (ctx as unknown as { __auditEvents: Array<{ action: string; actorId: string; entityType: string }> }).__auditEvents;

    const created = await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob', roles: [] } });
    const id = created.json().id;
    await app.inject({ method: 'PUT', url: `/api/users/${id}`, payload: { displayName: 'Bob', roles: ['lab_technician'] } });
    await app.inject({ method: 'POST', url: `/api/users/${id}/status`, payload: { status: 'disabled' } });

    const actions = events().map((e) => e.action);
    expect(actions).toEqual(['user.create', 'user.update', 'user.status']);
    expect(events().every((e) => e.actorId === 'admin1' && e.entityType === 'user')).toBe(true);
  });

  it('reset-password: 409 without a subject; 204 + audit (no password) with one', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob', roles: [] } })).json().id;

    const noSubj = await app.inject({ method: 'POST', url: `/api/users/${id}/reset-password`, payload: { password: 'pw', temporary: true } });
    expect(noSubj.statusCode).toBe(409);

    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const ok = await app.inject({ method: 'POST', url: `/api/users/${id}/reset-password`, payload: { password: 'pw', temporary: true } });
    expect(ok.statusCode).toBe(204);
    const authCalls = (ctx as unknown as { __authCalls: Array<{ op: string; args: unknown[] }> }).__authCalls;
    expect(authCalls).toContainEqual({ op: 'resetPassword', args: ['kc-sub-1', 'pw', true] });
    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'user.reset_password')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('pw'); // password never audited
  });

  it('send-reset-email: 204 + audit when the user has a subject', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob' } })).json().id;
    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const res = await app.inject({ method: 'POST', url: `/api/users/${id}/send-reset-email` });
    expect(res.statusCode).toBe(204);
    const authCalls = (ctx as unknown as { __authCalls: Array<{ op: string }> }).__authCalls;
    expect(authCalls.some((c) => c.op === 'sendPasswordResetEmail')).toBe(true);
    const events = (ctx as unknown as { __auditEvents: Array<{ action: string }> }).__auditEvents;
    expect(events.some((e) => e.action === 'user.send_reset_email')).toBe(true);
  });

  it('force-logout: 400 on self, 204 on another user with a subject', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const self = await app.inject({ method: 'POST', url: `/api/users/admin/force-logout` });
    expect(self.statusCode).toBe(400);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob' } })).json().id;
    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const ok = await app.inject({ method: 'POST', url: `/api/users/${id}/force-logout` });
    expect(ok.statusCode).toBe(204);
    const events = (ctx as unknown as { __auditEvents: Array<{ action: string }> }).__auditEvents;
    expect(events.some((e) => e.action === 'user.force_logout')).toBe(true);
  });

  it('reset-password: 503 when the provider admin client is not configured', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    (ctx as unknown as { auth: { resetPassword: () => Promise<void> } }).auth.resetPassword = async () => {
      const e = new Error('not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e;
    };
    registerUsersRoutes(app, ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob' } })).json().id;
    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const res = await app.inject({ method: 'POST', url: `/api/users/${id}/reset-password`, payload: { password: 'pw' } });
    expect(res.statusCode).toBe(503);
  });

  it('admin routes require lab_admin (403 for a non-admin actor)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] }; });
    registerUsersRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'POST', url: `/api/users/whatever/reset-password`, payload: { password: 'pw' } });
    expect(res.statusCode).toBe(403);
  });
});
