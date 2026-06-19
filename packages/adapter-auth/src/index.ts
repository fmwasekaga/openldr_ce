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
  let keySet: JWTVerifyGetKey | undefined = deps.keySet;

  async function getKeySet(): Promise<JWTVerifyGetKey> {
    if (keySet) return keySet;
    const res = await fetchFn(discoveryUrl);
    if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
    const doc = (await res.json()) as { jwks_uri?: string };
    if (!doc.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
    keySet = createRemoteJWKSet(new URL(doc.jwks_uri));
    return keySet;
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
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token missing sub claim');
      }
      return payload as TokenClaims;
    },
  };
}
