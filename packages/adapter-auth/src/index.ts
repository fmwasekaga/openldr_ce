import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims } from '@openldr/ports';
import { IdentityAdminNotConfiguredError } from '@openldr/ports';

export interface AuthConfig {
  issuerUrl: string;
  /** Expected token audience. When unset, the audience check is skipped. */
  audience?: string;
  adminClientId?: string;
  adminClientSecret?: string;
}

export class KcError extends Error {
  constructor(public status: number, public detail: string) {
    super(`identity provider responded ${status}`);
    this.name = 'KcError';
  }
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

  const tokenEndpoint = `${cfg.issuerUrl}/protocol/openid-connect/token`;
  const adminBase = cfg.issuerUrl.replace('/realms/', '/admin/realms/');
  const adminConfigured = Boolean(cfg.adminClientId && cfg.adminClientSecret);
  const adminClientId = cfg.adminClientId ?? '';
  const adminClientSecret = cfg.adminClientSecret ?? '';
  let adminTokenPromise: Promise<{ token: string; expiresAt: number }> | undefined;

  async function getAdminToken(): Promise<string> {
    const cached = adminTokenPromise ? await adminTokenPromise.catch(() => undefined) : undefined;
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    adminTokenPromise = (async () => {
      const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: adminClientId, client_secret: adminClientSecret });
      const res = await fetchFn(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      if (!res.ok) throw new KcError(res.status, 'admin token request failed');
      const body = (await res.json()) as { access_token: string; expires_in?: number };
      return { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 300) - 30) * 1000 };
    })().catch((e) => { adminTokenPromise = undefined; throw e; });
    return (await adminTokenPromise).token;
  }
  async function adminVoid(path: string, init: RequestInit): Promise<void> {
    if (!adminConfigured) throw new IdentityAdminNotConfiguredError();
    if (!cfg.issuerUrl.includes('/realms/')) {
      throw new Error('OIDC_ISSUER_URL must be a Keycloak realm URL (containing /realms/) to use identity-admin actions');
    }
    const doFetch = async (tok: string) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${tok}`);
      if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return fetchFn(`${adminBase}${path}`, { ...init, headers });
    };
    let res = await doFetch(await getAdminToken());
    if (res.status === 401) { adminTokenPromise = undefined; res = await doFetch(await getAdminToken()); }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new KcError(res.status, detail.slice(0, 500));
    }
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
    async resetPassword(userId: string, password: string, temporary: boolean): Promise<void> {
      await adminVoid(`/users/${encodeURIComponent(userId)}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: password, temporary }) });
    },
    async sendPasswordResetEmail(userId: string): Promise<void> {
      await adminVoid(`/users/${encodeURIComponent(userId)}/execute-actions-email`, { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD']) });
    },
    async forceLogout(userId: string): Promise<void> {
      await adminVoid(`/users/${encodeURIComponent(userId)}/logout`, { method: 'POST' });
    },
  };
}
