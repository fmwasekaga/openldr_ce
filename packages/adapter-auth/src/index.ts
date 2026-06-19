import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims } from '@openldr/ports';

export interface AuthConfig {
  issuerUrl: string;
  /** Expected token audience. When unset, the audience check is skipped. */
  audience?: string;
}

export interface AuthDeps {
  fetchFn?: typeof fetch;
  /** Test seam — supply a local JWKS so verification needs no network. */
  keySet?: JWTVerifyGetKey;
}

export function createAuth(cfg: AuthConfig, deps: AuthDeps = {}): AuthPort {
  const fetchFn = deps.fetchFn ?? fetch;
  const discoveryUrl = `${cfg.issuerUrl}/.well-known/openid-configuration`;
  let keySetPromise: Promise<JWTVerifyGetKey> | undefined = deps.keySet
    ? Promise.resolve(deps.keySet)
    : undefined;

  function getKeySet(): Promise<JWTVerifyGetKey> {
    if (!keySetPromise) {
      keySetPromise = (async () => {
        const res = await fetchFn(discoveryUrl);
        if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
        const doc = (await res.json()) as { jwks_uri?: string };
        if (!doc.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
        return createRemoteJWKSet(new URL(doc.jwks_uri));
      })().catch((e) => {
        keySetPromise = undefined; // allow retry on next call after a failed discovery
        throw e;
      });
    }
    return keySetPromise;
  }

  return {
    async healthCheck() {
      return probe(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetchFn(discoveryUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
          return 'OIDC issuer reachable';
        } finally {
          clearTimeout(timer);
        }
      });
    },
    async verifyToken(token: string): Promise<TokenClaims> {
      const jwks = await getKeySet();
      const { payload } = await jwtVerify(token, jwks, {
        issuer: cfg.issuerUrl,
        audience: cfg.audience,
        algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token missing sub claim');
      }
      return payload as TokenClaims;
    },
  };
}
