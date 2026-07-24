import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { CAPABILITY_KEYS } from '@openldr/rbac';
import { registerAuth } from './auth-plugin';

type Claims = { sub: string; [k: string]: unknown };

function ctx(opts: {
  bypass?: boolean;
  verify?: (t: string) => Promise<Claims>;
  user?: {
    id: string;
    username: string;
    displayName: string | null;
    roles: string[];
    status: 'active' | 'disabled';
    subject?: string | null;
    rbacInitialized?: boolean;
  };
  roles?: {
    resolveCapabilities?: (subject: string) => Promise<string[]>;
    backfillUserFromRoleNames?: (subject: string, roleNames: string[]) => Promise<void>;
  };
  markRbacInitialized?: (id: string) => Promise<void>;
}): AppContext {
  const providedUser = opts.user ?? { id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_manager'], status: 'active' as const };
  // Default already-initialized so pre-existing tests (which don't care about RBAC backfill)
  // don't trip the once-only migration path.
  const u = { subject: null as string | null, rbacInitialized: true, ...providedUser };
  return {
    cfg: { AUTH_DEV_BYPASS: opts.bypass ?? false, AUTH_DEV_USERNAME: 'dev-admin', AUTH_DEV_ROLES: 'lab_admin' },
    logger: { warn() {}, error() {}, info() {} },
    auth: { verifyToken: opts.verify ?? (async () => { throw new Error('bad'); }) },
    audit: { record: vi.fn(async (e: unknown) => ({ ...(e as object), id: 'x', occurredAt: 't' })) },
    roles: {
      resolveCapabilities: opts.roles?.resolveCapabilities ?? (async () => []),
      backfillUserFromRoleNames: opts.roles?.backfillUserFromRoleNames ?? (async () => {}),
    },
    users: {
      syncFromClaims: async () => u,
      getByUsername: async () => undefined,
      create: async () => ({ id: 'dev1', username: 'dev-admin', displayName: 'Dev Admin', roles: ['lab_admin'], status: 'active' }),
      markRbacInitialized: opts.markRbacInitialized ?? (async () => {}),
    },
  } as unknown as AppContext;
}

async function appWith(c: AppContext) {
  const app = Fastify();
  registerAuth(app, c);
  app.get('/api/probe', async (req) => ({ user: req.user ?? null }));
  app.get('/health', async () => ({ ok: true }));
  return app;
}

describe('registerAuth', () => {
  it('leaves /health public (no actor required)', async () => {
    const app = await appWith(ctx({ bypass: false }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('401s an /api request with no token when bypass is off', async () => {
    const app = await appWith(ctx({ bypass: false }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(401);
  });

  it('injects a dev actor when bypass is on and no token', async () => {
    const app = await appWith(ctx({ bypass: true }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.roles).toContain('lab_admin');
  });

  it('resolves req.user from a valid token', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1' }) }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada');
  });

  it('sources req.user.roles from the token realm_access (not the local record), filtering provider defaults', async () => {
    const c = ctx({
      verify: async () => ({ sub: 's1', realm_access: { roles: ['lab_admin', 'offline_access', 'default-roles-openldr'] } }),
      user: { id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active' },
    });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.roles).toEqual(['lab_admin']);
  });

  it('401s on an invalid token', async () => {
    const app = await appWith(ctx({ verify: async () => { throw new Error('bad'); } }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    expect(res.statusCode).toBe(401);
  });

  it('403s a disabled user', async () => {
    const c = ctx({ verify: async () => ({ sub: 's1' }), user: { id: 'u2', username: 'x', displayName: null, roles: [], status: 'disabled' } });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(403);
  });

  it('401s when syncFromClaims throws', async () => {
    const c = ctx({ verify: async () => ({ sub: 's1' }) });
    // override users.syncFromClaims to throw
    (c.users as unknown as { syncFromClaims: () => Promise<unknown> }).syncFromClaims = async () => { throw new Error('db down'); };
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(401);
  });

  it('does not downgrade a credentialed request when bypass is on', async () => {
    const app = await appWith(ctx({ bypass: true, verify: async () => ({ sub: 's1' }) }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada'); // resolved via verifyToken+syncFromClaims, NOT the dev actor
  });

  it('allows /api/config with no token when bypass is off', async () => {
    const app = await appWith(ctx({ bypass: false }));
    app.get('/api/config', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts an access_token query param on the ontology SSE routes only', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1' }) }));
    app.get('/api/terminology/ontology/:id/build', async (req) => ({ user: req.user ?? null }));
    app.get('/api/probe2', async (req) => ({ user: req.user ?? null }));
    const ok = await app.inject({ method: 'GET', url: '/api/terminology/ontology/x/build?path=p&access_token=good' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.username).toBeTruthy();
    const nonSse = await app.inject({ method: 'GET', url: '/api/probe2?access_token=good' });
    expect(nonSse.statusCode).toBe(401); // query token not honoured off the SSE routes
  });

  it('records one throttled auth.failed on an invalid token', async () => {
    const c = ctx({ verify: async () => { const e: any = new Error('bad'); e.code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'; throw e; } });
    const app = await appWith(c);
    await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    const calls = (c.audit.record as any).mock.calls.filter((a: any[]) => a[0].action === 'auth.failed');
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toMatchObject({ action: 'auth.failed', entityType: 'auth', metadata: expect.objectContaining({ reason: 'bad-signature' }) });
  });

  it('does NOT record auth.failed for a dev-bypass request', async () => {
    const c = ctx({ bypass: true });
    const app = await appWith(c);
    await app.inject({ method: 'GET', url: '/api/probe' });
    expect((c.audit.record as any).mock.calls.filter((a: any[]) => a[0].action === 'auth.failed')).toHaveLength(0);
  });

  it('never includes the token string in the audit row', async () => {
    const c = ctx({ verify: async () => { throw new Error('bad'); } });
    const app = await appWith(c);
    await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer super-secret-token-value' } });
    const calls = (c.audit.record as any).mock.calls;
    expect(JSON.stringify(calls)).not.toContain('super-secret-token-value');
  });

  it("resolves req.user.capabilities from the user's assigned-role capabilities", async () => {
    const c = ctx({
      verify: async () => ({ sub: 's1' }),
      user: { id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active', subject: 's1', rbacInitialized: true },
      roles: { resolveCapabilities: async (subject) => (subject === 's1' ? ['patients.read', 'reports.view'] : []) },
    });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.capabilities).toEqual(['patients.read', 'reports.view']);
  });

  it('gives the dev-bypass actor every capability', async () => {
    const app = await appWith(ctx({ bypass: true }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.capabilities).toHaveLength(CAPABILITY_KEYS.length);
    expect(new Set(res.json().user.capabilities as string[])).toEqual(new Set(CAPABILITY_KEYS));
  });

  it('backfills token realm roles into user_roles exactly once, on first login', async () => {
    let rbacInitialized = false;
    let assignedRoles: string[] = [];
    const backfillUserFromRoleNames = vi.fn(async (_subject: string, roleNames: string[]) => {
      assignedRoles = [...assignedRoles, ...roleNames];
    });
    const resolveCapabilities = vi.fn(async () => (assignedRoles.includes('lab_manager') ? ['reports.manage'] : []));
    const markRbacInitialized = vi.fn(async () => {
      rbacInitialized = true;
    });
    let realmRoles = ['lab_manager'];
    const c: AppContext = {
      cfg: { AUTH_DEV_BYPASS: false, AUTH_DEV_USERNAME: 'dev-admin', AUTH_DEV_ROLES: 'lab_admin' },
      logger: { warn() {}, error() {}, info() {} },
      auth: { verifyToken: async () => ({ sub: 's1', realm_access: { roles: realmRoles } }) },
      audit: { record: vi.fn(async (e: unknown) => ({ ...(e as object), id: 'x', occurredAt: 't' })) },
      roles: { resolveCapabilities, backfillUserFromRoleNames },
      users: {
        syncFromClaims: async () => ({ id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active', subject: 's1', rbacInitialized }),
        getByUsername: async () => undefined,
        create: async () => ({ id: 'dev1', username: 'dev-admin', displayName: 'Dev Admin', roles: ['lab_admin'], status: 'active' }),
        markRbacInitialized,
      },
    } as unknown as AppContext;
    const app = await appWith(c);

    const first = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(first.statusCode).toBe(200);
    expect(backfillUserFromRoleNames).toHaveBeenCalledTimes(1);
    expect(backfillUserFromRoleNames).toHaveBeenCalledWith('s1', ['lab_manager']);
    expect(markRbacInitialized).toHaveBeenCalledTimes(1);
    expect(markRbacInitialized).toHaveBeenCalledWith('u1');
    expect(first.json().user.capabilities).toEqual(['reports.manage']);

    // Second login: token now carries a different realm role. Since rbac_initialized is
    // already true, the backfill must NOT run again — the DB role assignment stays authoritative.
    realmRoles = ['lab_tech'];
    const second = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(second.statusCode).toBe(200);
    expect(backfillUserFromRoleNames).toHaveBeenCalledTimes(1); // still 1 — not re-invoked
    expect(second.json().user.capabilities).toEqual(['reports.manage']); // unaffected by the new token roles
  });
});
