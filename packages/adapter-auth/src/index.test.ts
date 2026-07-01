import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWTVerifyGetKey } from 'jose';
import { createAuth, KcError } from './index';
import { IdentityAdminNotConfiguredError } from '@openldr/ports';

const cfg = { issuerUrl: 'http://localhost:8080/realms/master' };

describe('createAuth', () => {
  it('reports up when the discovery doc returns 200', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const auth = createAuth(cfg, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('up');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:8080/realms/master/.well-known/openid-configuration',
      expect.anything(),
    );
  });

  it('reports down when discovery returns non-200', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    const auth = createAuth(cfg, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('404');
  });
});

async function localKeySet(): Promise<{ sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string; sub?: string | null }) => Promise<string>; keySet: JWTVerifyGetKey }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const sign = async (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string; sub?: string | null } = {}) => {
    let b = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt();
    if (opts.sub !== null) b = b.setSubject(opts.sub ?? 'user-123');
    b = b.setIssuer(opts.iss ?? 'https://kc/realms/openldr');
    if (opts.aud) b = b.setAudience(opts.aud);
    b = b.setExpirationTime(opts.exp ?? '5m');
    return b.sign(privateKey);
  };
  return { sign, keySet };
}

describe('verifyToken', () => {
  const issuer = 'https://kc/realms/openldr';

  it('accepts a valid token and returns claims', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer, audience: 'openldr-api' }, { keySet });
    const token = await sign({ preferred_username: 'ada' }, { aud: 'openldr-api' });
    const claims = await auth.verifyToken(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.preferred_username).toBe('ada');
  });

  it('rejects a wrong issuer', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer }, { keySet });
    const token = await sign({}, { iss: 'https://evil/realms/x' });
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer }, { keySet });
    const token = await sign({}, { exp: '-1m' });
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('rejects a wrong audience', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer, audience: 'openldr-api' }, { keySet });
    const token = await sign({}, { aud: 'someone-else' });
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('rejects a token without a sub claim', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer }, { keySet });
    const token = await sign({}, { sub: null });
    await expect(auth.verifyToken(token)).rejects.toThrow(/sub/);
  });

  it('rejects a token with no audience when audience is configured', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer, audience: 'openldr-api' }, { keySet });
    const token = await sign({}); // no aud claim
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('with internalJwksUrl: skips discovery, fetches JWKS from the internal url, validates the public issuer', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key'; jwk.alg = 'RS256';
    const publicIssuer = 'https://host/auth/realms/openldr';
    const internalJwks = 'http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs';
    let discoveryCalls = 0;
    let jwksFactoryCalls: string[] = [];
    // fetchFn: asserts discovery is never called (all traffic through fetchFn goes here).
    const fetchFn = (async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('.well-known')) { discoveryCalls++; throw new Error('discovery must not be called'); }
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;
    // remoteJwksFactory: seam that replaces createRemoteJWKSet; records which URL was requested
    // and returns a local key set so no real network call is needed.
    const remoteJwksFactory = (url: URL): JWTVerifyGetKey => {
      jwksFactoryCalls.push(url.href);
      return createLocalJWKSet({ keys: [jwk] });
    };
    const auth = createAuth(
      { issuerUrl: publicIssuer, audience: 'openldr-api', internalJwksUrl: internalJwks },
      { fetchFn, remoteJwksFactory },
    );
    const token = await new SignJWT({ preferred_username: 'ada' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt()
      .setSubject('user-123').setIssuer(publicIssuer).setAudience('openldr-api').setExpirationTime('5m')
      .sign(privateKey);
    const claims = await auth.verifyToken(token);
    expect(claims.sub).toBe('user-123');
    expect(discoveryCalls).toBe(0);
    expect(jwksFactoryCalls).toHaveLength(1);
    expect(jwksFactoryCalls[0]).toBe(internalJwks);
  });
});

function adminFetchMock() {
  const calls: Array<{ url: string; method: string; body?: string; headers: Headers }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = new Headers(init?.headers);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body as string | undefined, headers });
    if (u.endsWith('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'admin-tok', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const adminCfg = { issuerUrl: 'https://kc/realms/openldr', adminClientId: 'svc', adminClientSecret: 'sek' };

describe('identity admin actions', () => {
  it('throws IdentityAdminNotConfiguredError (no network) when creds are absent', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth({ issuerUrl: 'https://kc/realms/openldr' }, { fetchFn });
    await expect(auth.resetPassword('u1', 'pw', true)).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it('resetPassword fetches a client_credentials token then PUTs reset-password', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.resetPassword('u1', 'secretpw', true);
    const token = calls.find((c) => c.url.endsWith('/protocol/openid-connect/token'))!;
    expect(token.method).toBe('POST');
    expect(token.body).toContain('grant_type=client_credentials');
    const reset = calls.find((c) => c.url.includes('/admin/realms/openldr/users/u1/reset-password'))!;
    expect(reset.method).toBe('PUT');
    expect(reset.headers.get('authorization')).toBe('Bearer admin-tok');
    expect(JSON.parse(reset.body!)).toEqual({ type: 'password', value: 'secretpw', temporary: true });
  });

  it('caches the admin token across calls', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.resetPassword('u1', 'pw', true);
    await auth.forceLogout('u1');
    expect(calls.filter((c) => c.url.endsWith('/protocol/openid-connect/token'))).toHaveLength(1);
  });

  it('sendPasswordResetEmail PUTs execute-actions-email with UPDATE_PASSWORD', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.sendPasswordResetEmail('u1');
    const c = calls.find((x) => x.url.includes('/users/u1/execute-actions-email'))!;
    expect(c.method).toBe('PUT');
    expect(JSON.parse(c.body!)).toEqual(['UPDATE_PASSWORD']);
  });

  it('forceLogout POSTs logout', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.forceLogout('u1');
    const c = calls.find((x) => x.url.includes('/users/u1/logout'))!;
    expect(c.method).toBe('POST');
  });

  it('refreshes the token once on a 401 from an admin call', async () => {
    let adminCalls = 0;
    const tokenCalls: number[] = [];
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/protocol/openid-connect/token')) { tokenCalls.push(1); return new Response(JSON.stringify({ access_token: `t${tokenCalls.length}`, expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      adminCalls++;
      return new Response(null, { status: adminCalls === 1 ? 401 : 204 });
    }) as unknown as typeof fetch;
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.forceLogout('u1');
    expect(tokenCalls.length).toBe(2); // initial + refresh after 401
    expect(adminCalls).toBe(2);
  });

  it('throws on a non-2xx admin response', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    const auth = createAuth(adminCfg, { fetchFn });
    await expect(auth.forceLogout('u1')).rejects.toBeInstanceOf(KcError);
  });
});

function dirMock() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const kcUser = { id: 'u1', username: 'ada', email: 'a@x', firstName: 'Ada', lastName: 'L', enabled: true, createdTimestamp: 1700000000000 };
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body as string | undefined });
    if (u.endsWith('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users\/u1\/role-mappings\/realm$/.test(u) && method === 'GET') return new Response(JSON.stringify([{ id: 'r1', name: 'lab_admin' }, { id: 'rd', name: 'default-roles-openldr' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users\/u1$/.test(u) && method === 'GET') return new Response(JSON.stringify(kcUser), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users(\?|$)/.test(u) && method === 'GET') return new Response(JSON.stringify([kcUser]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/roles$/.test(u) && method === 'GET') return new Response(JSON.stringify([{ id: 'r1', name: 'lab_admin' }, { id: 'r2', name: 'lab_manager' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users$/.test(u) && method === 'POST') return new Response(null, { status: 201, headers: { Location: 'http://kc/admin/realms/openldr/users/new-id' } });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const dcfg = { issuerUrl: 'https://kc/realms/openldr', adminClientId: 'svc', adminClientSecret: 'sek' };

describe('directory', () => {
  it('list maps users + filters provider-default roles', async () => {
    const { fetchFn } = dirMock();
    const auth = createAuth(dcfg, { fetchFn });
    const users = await auth.directory.list();
    expect(users[0]).toMatchObject({ id: 'u1', username: 'ada', firstName: 'Ada', enabled: true });
    expect(users[0].roles).toEqual(['lab_admin']); // default-roles-* filtered out
    expect(users[0].createdAt).toContain('20'); // ISO
  });
  it('get returns null on 404', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => String(url).endsWith('/protocol/openid-connect/token')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(null, { status: 404 })) as unknown as typeof fetch;
    const auth = createAuth(dcfg, { fetchFn });
    expect(await auth.directory.get('missing')).toBeNull();
  });
  it('create posts the user, reads Location id, assigns roles', async () => {
    const { calls, fetchFn } = dirMock();
    const auth = createAuth(dcfg, { fetchFn });
    const created = await auth.directory.create({ username: 'bob', firstName: 'Bob', email: 'b@x', roles: ['lab_manager'], password: 'pw' });
    expect(created.id).toBe('new-id');
    expect(calls.some((c) => c.method === 'POST' && /\/users$/.test(c.url))).toBe(true);
    expect(calls.some((c) => /\/users\/new-id\/role-mappings\/realm$/.test(c.url) && c.method === 'POST')).toBe(true);
    expect(calls.some((c) => /\/users\/new-id\/reset-password$/.test(c.url))).toBe(true);
  });
  it('not configured → throws with no network', async () => {
    const { calls, fetchFn } = dirMock();
    const auth = createAuth({ issuerUrl: 'https://kc/realms/openldr' }, { fetchFn });
    await expect(auth.directory.list()).rejects.toBeInstanceOf((await import('@openldr/ports')).IdentityAdminNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
  it('setRoles adds the wanted role and removes the unwanted one', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url); const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body as string | undefined });
      if (u.endsWith('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (/\/users\/u1\/role-mappings\/realm$/.test(u) && method === 'GET') return new Response(JSON.stringify([{ id: 'r1', name: 'lab_admin' }, { id: 'rd', name: 'default-roles-openldr' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      if (/\/roles$/.test(u) && method === 'GET') return new Response(JSON.stringify([{ id: 'r1', name: 'lab_admin' }, { id: 'r2', name: 'lab_manager' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const auth = createAuth({ issuerUrl: 'https://kc/realms/openldr', adminClientId: 'svc', adminClientSecret: 'sek' }, { fetchFn });
    await auth.directory.setRoles('u1', ['lab_manager']);
    const add = calls.find((c) => /\/users\/u1\/role-mappings\/realm$/.test(c.url) && c.method === 'POST');
    const del = calls.find((c) => /\/users\/u1\/role-mappings\/realm$/.test(c.url) && c.method === 'DELETE');
    expect(add).toBeTruthy(); expect(add!.body).toContain('lab_manager');
    expect(del).toBeTruthy(); expect(del!.body).toContain('lab_admin');
  });
});
