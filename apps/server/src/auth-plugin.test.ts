import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerAuth } from './auth-plugin';

type Claims = { sub: string; [k: string]: unknown };

function ctx(opts: {
  bypass?: boolean;
  verify?: (t: string) => Promise<Claims>;
  user?: { id: string; username: string; displayName: string | null; roles: string[]; status: 'active' | 'disabled' };
}): AppContext {
  const u = opts.user ?? { id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_manager'], status: 'active' as const };
  return {
    cfg: { AUTH_DEV_BYPASS: opts.bypass ?? false, AUTH_DEV_USERNAME: 'dev-admin', AUTH_DEV_ROLES: 'lab_admin' },
    logger: { warn() {}, error() {}, info() {} },
    auth: { verifyToken: opts.verify ?? (async () => { throw new Error('bad'); }) },
    users: {
      syncFromClaims: async () => u,
      getByUsername: async () => undefined,
      create: async () => ({ id: 'dev1', username: 'dev-admin', displayName: 'Dev Admin', roles: ['lab_admin'], status: 'active' }),
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
});
