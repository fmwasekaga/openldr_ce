import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerUsersRoutes } from './users-routes';
import './auth-plugin';

// ---------------------------------------------------------------------------
// Minimal types mirrored from @openldr/ports so we don't add a dep
// ---------------------------------------------------------------------------
interface DirectoryUser {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: string | null;
}

interface UserProfile {
  userId: string;
  formSchemaId: string | null;
  formVersion: number | null;
  extras: Record<string, { value: string; fhirPath: string | null }>;
}

// Local user row type (fallback mirror)
type LocalUser = Awaited<ReturnType<AppContext['users']['create']>>;

// ---------------------------------------------------------------------------
// fakeCtx — directory + userProfiles + local users (fallback)
// ---------------------------------------------------------------------------
function fakeCtx() {
  // Local users mirror (for the fallback path and SP4 routes that still use ctx.users.get)
  const localUsers: LocalUser[] = [];
  let localSeq = 0;

  // Directory in-memory store
  const directoryMap = new Map<string, DirectoryUser>();
  let dirSeq = 0;

  // UserProfiles in-memory store
  const profilesMap = new Map<string, UserProfile>();

  const auditEvents: unknown[] = [];
  const authCalls: Array<{ op: string; args: unknown[] }> = [];

  const notConfiguredError = () => {
    const e = new Error('admin not configured');
    e.name = 'IdentityAdminNotConfiguredError';
    return e;
  };

  // Whether directory throws NotConfigured
  let directoryUnconfigured = false;

  return {
    users: {
      create: async (input: Parameters<AppContext['users']['create']>[0]) => {
        if (localUsers.some((u) => u.username === input.username)) throw new Error('duplicate username');
        const user: LocalUser = {
          id: `lu${++localSeq}`,
          subject: null,
          username: input.username,
          displayName: input.displayName ?? null,
          email: input.email ?? null,
          roles: input.roles ?? [],
          status: 'active',
          lastLoginAt: null,
          createdAt: new Date().toISOString(),
        };
        localUsers.push(user);
        return user;
      },
      get: async (id: string) => localUsers.find((u) => u.id === id),
      getBySubject: async (subject: string) => localUsers.find((u) => u.subject === subject),
      getByUsername: async (username: string) => localUsers.find((u) => u.username === username),
      list: async () => [...localUsers],
      update: async (id: string, input: { displayName?: string | null; email?: string | null }) => {
        const u = localUsers.find((x) => x.id === id);
        if (!u) return;
        if ('displayName' in input) u.displayName = input.displayName ?? null;
        if ('email' in input) u.email = input.email ?? null;
      },
      setRoles: async (id: string, roles: string[]) => {
        const u = localUsers.find((x) => x.id === id);
        if (u) u.roles = roles;
      },
      setStatus: async (id: string, status: 'active' | 'disabled') => {
        const u = localUsers.find((x) => x.id === id);
        if (u) u.status = status;
      },
      syncFromClaims: async () => { throw new Error('not used'); },
    },

    auth: {
      verifyToken: async () => ({ sub: 's' }),
      resetPassword: async (...args: unknown[]) => { authCalls.push({ op: 'resetPassword', args }); },
      sendPasswordResetEmail: async (...args: unknown[]) => { authCalls.push({ op: 'sendPasswordResetEmail', args }); },
      forceLogout: async (...args: unknown[]) => { authCalls.push({ op: 'forceLogout', args }); },
      directory: {
        async list() {
          if (directoryUnconfigured) throw notConfiguredError();
          return [...directoryMap.values()];
        },
        async get(id: string) {
          if (directoryUnconfigured) throw notConfiguredError();
          return directoryMap.get(id) ?? null;
        },
        async create(input: { username: string; email?: string | null; firstName?: string | null; lastName?: string | null; enabled?: boolean; roles?: string[]; password?: string }) {
          if (directoryUnconfigured) throw notConfiguredError();
          const id = `du${++dirSeq}`;
          const user: DirectoryUser = {
            id,
            username: input.username,
            email: input.email ?? null,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            enabled: input.enabled ?? true,
            roles: input.roles ?? [],
            createdAt: new Date().toISOString(),
          };
          directoryMap.set(id, user);
          return user;
        },
        async update(id: string, patch: { email?: string | null; firstName?: string | null; lastName?: string | null; enabled?: boolean }) {
          if (directoryUnconfigured) throw notConfiguredError();
          const u = directoryMap.get(id);
          if (!u) return;
          if ('email' in patch) u.email = patch.email ?? null;
          if ('firstName' in patch) u.firstName = patch.firstName ?? null;
          if ('lastName' in patch) u.lastName = patch.lastName ?? null;
          if ('enabled' in patch && patch.enabled !== undefined) u.enabled = patch.enabled;
        },
        async setRoles(id: string, roles: string[]) {
          if (directoryUnconfigured) throw notConfiguredError();
          const u = directoryMap.get(id);
          if (u) u.roles = roles;
        },
      },
    },

    userProfiles: {
      async get(userId: string) {
        return profilesMap.get(userId);
      },
      async list(userIds: string[]) {
        const map = new Map<string, UserProfile>();
        for (const id of userIds) {
          const p = profilesMap.get(id);
          if (p) map.set(id, p);
        }
        return map;
      },
      async upsert(userId: string, input: { formSchemaId?: string | null; formVersion?: number | null; extras?: Record<string, { value: string; fhirPath: string | null }> }) {
        const existing = profilesMap.get(userId);
        profilesMap.set(userId, {
          userId,
          formSchemaId: input.formSchemaId ?? existing?.formSchemaId ?? null,
          formVersion: input.formVersion ?? existing?.formVersion ?? null,
          extras: input.extras ?? existing?.extras ?? {},
        });
      },
    },

    audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },

    __auditEvents: auditEvents,
    __authCalls: authCalls,
    __directory: directoryMap,
    __profiles: profilesMap,
    __setDirectoryUnconfigured: (v: boolean) => { directoryUnconfigured = v; },
    // Legacy helper: seed a local user's subject for SP4 routes
    __setSubject: (id: string, subject: string) => {
      const u = localUsers.find((x) => x.id === id);
      if (u) u.subject = subject;
    },
  } as unknown as AppContext & {
    __auditEvents: unknown[];
    __authCalls: Array<{ op: string; args: unknown[] }>;
    __directory: Map<string, DirectoryUser>;
    __profiles: Map<string, UserProfile>;
    __setDirectoryUnconfigured: (v: boolean) => void;
    __setSubject: (id: string, subject: string) => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function adminApp(ctx: AppContext) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] };
  });
  registerUsersRoutes(app, ctx);
  return app;
}

// ---------------------------------------------------------------------------
// Composed-directory path tests
// ---------------------------------------------------------------------------
describe('users routes — composed directory + profiles', () => {
  it('GET /api/users composes directory.list + userProfiles into UserSummary', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    // Seed a directory user
    const du = await (ctx as unknown as { auth: { directory: { create: (...a: unknown[]) => Promise<DirectoryUser> } } }).auth.directory.create({
      username: 'ada', email: 'ada@lab.org', firstName: 'Ada', lastName: 'Lovelace',
      enabled: true, roles: ['lab_admin'],
    });
    // Seed a profile with extras
    await ctx.userProfiles.upsert(du.id, {
      formSchemaId: 'f1', formVersion: 2,
      extras: { phone: { value: '123', fhirPath: null } },
    });

    const res = await app.inject({ method: 'GET', url: '/api/users' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: du.id, username: 'ada', email: 'ada@lab.org',
      firstName: 'Ada', lastName: 'Lovelace',
      enabled: true, roles: ['lab_admin'],
      extras: { phone: '123' },
      formSchemaId: 'f1', formVersion: 2,
    });
    expect(typeof body[0].createdAt).toBe('string');
  });

  it('GET /api/users/:id composes a single directory user + profile', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const du = await (ctx as unknown as { auth: { directory: { create: (...a: unknown[]) => Promise<DirectoryUser> } } }).auth.directory.create({
      username: 'bob', email: 'bob@lab.org', firstName: 'Bob', lastName: 'Smith',
      enabled: true, roles: [],
    });
    await ctx.userProfiles.upsert(du.id, { extras: { ward: { value: 'ICU', fhirPath: null } } });

    const res = await app.inject({ method: 'GET', url: `/api/users/${du.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: du.id, username: 'bob', firstName: 'Bob', extras: { ward: 'ICU' },
    });
  });

  it('GET /api/users/:id → 404 when not in directory', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/users/ghost' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/users (lab_admin) calls directory.create + userProfiles.upsert; audit user.create; 201; no password in audit', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/users',
      payload: {
        username: 'charlie', email: 'c@lab.org',
        firstName: 'Charlie', lastName: 'Day',
        roles: ['lab_technician'], password: 'secret123',
        extras: { ward: { value: 'ED', fhirPath: null } },
        formSchemaId: 'f2', formVersion: 1,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ username: 'charlie', firstName: 'Charlie', lastName: 'Day', roles: ['lab_technician'] });
    expect(body.extras).toMatchObject({ ward: 'ED' });
    expect(body.formSchemaId).toBe('f2');
    expect(body.formVersion).toBe(1);

    // Directory was populated
    const dir = (ctx as unknown as { __directory: Map<string, DirectoryUser> }).__directory;
    expect(dir.size).toBe(1);
    const du = [...dir.values()][0];
    expect(du.username).toBe('charlie');

    // Profile was upserted
    const profiles = (ctx as unknown as { __profiles: Map<string, UserProfile> }).__profiles;
    expect(profiles.has(du.id)).toBe(true);
    expect(profiles.get(du.id)!.formSchemaId).toBe('f2');

    // Audit: user.create present, no password
    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'user.create')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret123');
  });

  it('POST /api/users → 502 with "profile" in error when directory.create succeeds but userProfiles.upsert throws (partial-state)', async () => {
    const ctx = fakeCtx();
    // Override userProfiles.upsert to throw only during this test
    const originalUpsert = ctx.userProfiles.upsert.bind(ctx.userProfiles);
    let upsertCallCount = 0;
    (ctx.userProfiles as unknown as { upsert: typeof originalUpsert }).upsert = async (...args) => {
      upsertCallCount++;
      throw new Error('DB write failed');
    };

    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/users',
      payload: { username: 'partial-user', email: 'p@lab.org', roles: [] },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/profile/i);

    // The directory user WAS created despite profile failure
    const dir = (ctx as unknown as { __directory: Map<string, DirectoryUser> }).__directory;
    expect(dir.size).toBe(1);
    expect([...dir.values()][0].username).toBe('partial-user');
  });

  it('PUT /api/users/:id calls directory.update + setRoles + userProfiles.upsert; audit user.update', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    // Create a user first
    const created = await app.inject({
      method: 'POST', url: '/api/users',
      payload: { username: 'diana', email: 'd@lab.org', firstName: 'Diana', roles: ['lab_technician'] },
    });
    const id = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'PUT', url: `/api/users/${id}`,
      payload: {
        email: 'diana2@lab.org', firstName: 'Diana', lastName: 'Prince',
        roles: ['lab_admin'],
        extras: { site: { value: 'HQ', fhirPath: null } },
        formSchemaId: 'f3', formVersion: 3,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ email: 'diana2@lab.org', lastName: 'Prince', roles: ['lab_admin'] });
    expect(body.extras).toMatchObject({ site: 'HQ' });

    const dir = (ctx as unknown as { __directory: Map<string, DirectoryUser> }).__directory;
    expect(dir.get(id)!.email).toBe('diana2@lab.org');
    expect(dir.get(id)!.roles).toEqual(['lab_admin']);

    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'user.update')).toBe(true);
  });

  it('POST /api/users/:id/status { enabled: false } calls directory.update; audit user.status', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const created = await app.inject({
      method: 'POST', url: '/api/users',
      payload: { username: 'eve', email: 'e@lab.org', roles: [] },
    });
    const id = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'POST', url: `/api/users/${id}/status`,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.enabled).toBe(false);

    const dir = (ctx as unknown as { __directory: Map<string, DirectoryUser> }).__directory;
    expect(dir.get(id)!.enabled).toBe(false);

    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'user.status')).toBe(true);
  });

  it('POST /api/users/:id/status also accepts legacy { status: "disabled" }', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const created = await app.inject({
      method: 'POST', url: '/api/users',
      payload: { username: 'frank', roles: [] },
    });
    const id = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'POST', url: `/api/users/${id}/status`,
      payload: { status: 'disabled' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { enabled: boolean }).enabled).toBe(false);
  });

  it('non-admin → 403 on mutations', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] };
    });
    registerUsersRoutes(app, ctx);

    expect((await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/users/x', payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/users/x/status', payload: { enabled: true } })).statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Fallback path: directory unconfigured → GET falls back to local, mutations 503
// ---------------------------------------------------------------------------
describe('users routes — fallback when directory unconfigured', () => {
  it('GET /api/users returns local users mapped to UserSummary when directory throws NotConfigured', async () => {
    const ctx = fakeCtx();
    // Seed a local user
    await ctx.users.create({ username: 'local-alice', displayName: 'Local Alice', email: 'la@lab.org', roles: ['lab_technician'] });
    // Make directory throw NotConfigured
    (ctx as unknown as { __setDirectoryUnconfigured: (v: boolean) => void }).__setDirectoryUnconfigured(true);

    const app = adminApp(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/users' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      username: 'local-alice',
      email: 'la@lab.org',
      firstName: null,
      lastName: null,
      extras: {},
    });
    // enabled derived from status
    expect(typeof body[0].enabled).toBe('boolean');
  });

  it('GET /api/users/:id falls back to local user when unconfigured', async () => {
    const ctx = fakeCtx();
    const lu = await ctx.users.create({ username: 'local-bob', roles: [] });
    (ctx as unknown as { __setDirectoryUnconfigured: (v: boolean) => void }).__setDirectoryUnconfigured(true);

    const app = adminApp(ctx);
    const res = await app.inject({ method: 'GET', url: `/api/users/${lu.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { username: string }).username).toBe('local-bob');
  });

  it('GET /api/users/:id → 404 when unconfigured and not in local either', async () => {
    const ctx = fakeCtx();
    (ctx as unknown as { __setDirectoryUnconfigured: (v: boolean) => void }).__setDirectoryUnconfigured(true);
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/users/ghost' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/users → 503 when directory unconfigured', async () => {
    const ctx = fakeCtx();
    (ctx as unknown as { __setDirectoryUnconfigured: (v: boolean) => void }).__setDirectoryUnconfigured(true);
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'x' } });
    expect(res.statusCode).toBe(503);
  });

  it('PUT /api/users/:id → 503 when directory unconfigured', async () => {
    const ctx = fakeCtx();
    (ctx as unknown as { __setDirectoryUnconfigured: (v: boolean) => void }).__setDirectoryUnconfigured(true);
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'PUT', url: '/api/users/x', payload: { email: 'x@x.com' } });
    expect(res.statusCode).toBe(503);
  });

  it('POST /api/users/:id/status → 503 when directory unconfigured', async () => {
    const ctx = fakeCtx();
    (ctx as unknown as { __setDirectoryUnconfigured: (v: boolean) => void }).__setDirectoryUnconfigured(true);
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/users/x/status', payload: { enabled: true } });
    expect(res.statusCode).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// SP4 routes: id IS the directory subject; no local lookup
// ---------------------------------------------------------------------------
describe('users routes — SP4 admin actions (reset-password / send-reset-email / force-logout)', () => {
  it('reset-password: calls ctx.auth.resetPassword(id, ...) directly; 204 + audit (no password)', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/users/kc-sub-1/reset-password',
      payload: { password: 'pw123', temporary: true },
    });
    expect(res.statusCode).toBe(204);

    const authCalls = (ctx as unknown as { __authCalls: Array<{ op: string; args: unknown[] }> }).__authCalls;
    expect(authCalls).toContainEqual({ op: 'resetPassword', args: ['kc-sub-1', 'pw123', true] });

    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'user.reset_password')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('pw123');
  });

  it('send-reset-email: calls ctx.auth.sendPasswordResetEmail(id) directly; 204 + audit', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/users/kc-sub-2/send-reset-email' });
    expect(res.statusCode).toBe(204);

    const authCalls = (ctx as unknown as { __authCalls: Array<{ op: string }> }).__authCalls;
    expect(authCalls.some((c) => c.op === 'sendPasswordResetEmail')).toBe(true);

    const events = (ctx as unknown as { __auditEvents: Array<{ action: string }> }).__auditEvents;
    expect(events.some((e) => e.action === 'user.send_reset_email')).toBe(true);
  });

  it('force-logout: 400 on self, 204 on another user', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    // Self-guard: req.user.id = 'admin', param = 'admin'
    const self = await app.inject({ method: 'POST', url: '/api/users/admin/force-logout' });
    expect(self.statusCode).toBe(400);

    // Another user
    const ok = await app.inject({ method: 'POST', url: '/api/users/kc-sub-3/force-logout' });
    expect(ok.statusCode).toBe(204);

    const events = (ctx as unknown as { __auditEvents: Array<{ action: string }> }).__auditEvents;
    expect(events.some((e) => e.action === 'user.force_logout')).toBe(true);
  });

  it('reset-password: 503 when op throws IdentityAdminNotConfiguredError', async () => {
    const ctx = fakeCtx();
    (ctx as unknown as { auth: { resetPassword: () => Promise<void> } }).auth.resetPassword = async () => {
      const e = new Error('not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e;
    };
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/users/kc-sub-1/reset-password',
      payload: { password: 'pw' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('admin routes require lab_admin (403 for a non-admin actor)', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] };
    });
    registerUsersRoutes(app, ctx);
    const res = await app.inject({ method: 'POST', url: '/api/users/whatever/reset-password', payload: { password: 'pw' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated (no actor) → 401', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    registerUsersRoutes(app, ctx);
    const res = await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('records audit events for create/update/status with the real actor', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin1', username: 'admin1', displayName: null, roles: ['lab_admin'] };
    });
    registerUsersRoutes(app, ctx);

    const created = await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob', roles: [] } });
    const id = (created.json() as { id: string }).id;
    await app.inject({ method: 'PUT', url: `/api/users/${id}`, payload: { firstName: 'Bob', roles: ['lab_technician'] } });
    await app.inject({ method: 'POST', url: `/api/users/${id}/status`, payload: { enabled: false } });

    const events = (ctx as unknown as { __auditEvents: Array<{ action: string; actorId: string; entityType: string }> }).__auditEvents;
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(['user.create', 'user.update', 'user.status']);
    expect(events.every((e) => e.actorId === 'admin1' && e.entityType === 'user')).toBe(true);
  });
});
