import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWTVerifyGetKey } from 'jose';
import { createAuth } from './index';

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
});
