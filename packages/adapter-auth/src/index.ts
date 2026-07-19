import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims, DirectoryUser } from '@openldr/ports';
import { IdentityAdminNotConfiguredError } from '@openldr/ports';

export interface AuthConfig {
  issuerUrl: string;
  /** Expected token audience. When unset, the audience check is skipped. */
  audience?: string;
  adminClientId?: string;
  adminClientSecret?: string;
  /** When set, fetch JWKS directly from this URL (internal/back-channel) instead of via
   *  OIDC discovery on the public issuer. The issuer CLAIM is still validated against issuerUrl. */
  internalJwksUrl?: string;
  /** Internal (back-channel) realm base URL, e.g. http://keycloak:8080/auth/realms/openldr.
   *  When set, the token endpoint, admin REST base, and (absent an explicit internalJwksUrl)
   *  the JWKS URL are derived from it instead of the public issuer. The issuer CLAIM is still
   *  validated against issuerUrl. */
  internalIssuerUrl?: string;
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
  /** Test seam — override the JWKS set factory (defaults to createRemoteJWKSet). */
  remoteJwksFactory?: (url: URL) => JWTVerifyGetKey;
}

export function createAuth(cfg: AuthConfig, deps: AuthDeps = {}): AuthPort {
  const fetchFn = deps.fetchFn ?? fetch;
  const jwksFactory = deps.remoteJwksFactory ?? ((url: URL) => createRemoteJWKSet(url));
  const discoveryUrl = `${cfg.issuerUrl}/.well-known/openid-configuration`;
  // Server-side calls to Keycloak (token, admin REST, JWKS) must use the internal docker-network
  // URL when configured — the public issuer resolves to the app container itself. Token CLAIM
  // validation still uses the public issuerUrl (see verifyToken).
  const backChannelIssuer = cfg.internalIssuerUrl ?? cfg.issuerUrl;
  const effectiveJwksUrl = cfg.internalJwksUrl
    ?? (cfg.internalIssuerUrl ? `${cfg.internalIssuerUrl}/protocol/openid-connect/certs` : undefined);
  let keySetPromise: Promise<JWTVerifyGetKey> | undefined = deps.keySet
    ? Promise.resolve(deps.keySet)
    : undefined;

  function getKeySet(): Promise<JWTVerifyGetKey> {
    if (!keySetPromise) {
      keySetPromise = (async () => {
        if (effectiveJwksUrl) {
          return jwksFactory(new URL(effectiveJwksUrl));
        }
        const res = await fetchFn(discoveryUrl);
        if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
        const doc = (await res.json()) as { jwks_uri?: string };
        if (!doc.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
        return jwksFactory(new URL(doc.jwks_uri));
      })().catch((e) => {
        keySetPromise = undefined; // allow retry on next call after a failed discovery
        throw e;
      });
    }
    return keySetPromise;
  }

  const tokenEndpoint = `${backChannelIssuer}/protocol/openid-connect/token`;
  const adminBase = backChannelIssuer.replace('/realms/', '/admin/realms/');
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
  const PROVIDER_DEFAULT_ROLE = (name: string) => name.startsWith('default-roles') || name === 'offline_access' || name === 'uma_authorization';

  async function adminFetchRaw(path: string, init: RequestInit): Promise<Response> {
    if (!adminConfigured) throw new IdentityAdminNotConfiguredError();
    if (!backChannelIssuer.includes('/realms/')) {
      throw new Error('OIDC_ISSUER_URL/OIDC_INTERNAL_ISSUER_URL must be a Keycloak realm URL (containing /realms/) to use identity-admin actions');
    }
    const doFetch = async (tok: string) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${tok}`);
      if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return fetchFn(`${adminBase}${path}`, { ...init, headers });
    };
    let res = await doFetch(await getAdminToken());
    if (res.status === 401) { adminTokenPromise = undefined; res = await doFetch(await getAdminToken()); }
    return res;
  }
  async function adminVoid(path: string, init: RequestInit): Promise<void> {
    const res = await adminFetchRaw(path, init);
    if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
  }
  async function adminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await adminFetchRaw(path, init);
    if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  interface KcUser { id: string; username: string; email?: string; firstName?: string; lastName?: string; enabled: boolean; createdTimestamp?: number }
  interface KcRole { id: string; name: string }
  const toDirectoryUser = (u: KcUser, roleNames: string[]): DirectoryUser => ({
    id: u.id, username: u.username, email: u.email ?? null, firstName: u.firstName ?? null, lastName: u.lastName ?? null,
    enabled: u.enabled, roles: roleNames.filter((n) => !PROVIDER_DEFAULT_ROLE(n)),
    createdAt: typeof u.createdTimestamp === 'number' ? new Date(u.createdTimestamp).toISOString() : null,
  });
  async function userRoleNames(id: string): Promise<string[]> {
    const roles = await adminJson<KcRole[]>(`/users/${encodeURIComponent(id)}/role-mappings/realm`);
    return roles.map((r) => r.name);
  }

  return {
    async healthCheck() {
      return probe(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          // Probe the SAME endpoint token validation actually depends on: when an internal
          // (back-channel) JWKS URL is configured, the public issuer is only reachable via the
          // gateway — NOT from inside the app container (where its host resolves to itself). Use
          // the internal JWKS URL so the probe reflects real auth readiness over the private network.
          const probeUrl = effectiveJwksUrl ?? discoveryUrl;
          const res = await fetchFn(probeUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC ${effectiveJwksUrl ? 'JWKS' : 'discovery'} returned ${res.status}`);
          return effectiveJwksUrl ? 'OIDC JWKS reachable (internal)' : 'OIDC issuer reachable';
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
    directory: {
      async list(opts = {}) {
        const params = new URLSearchParams({ first: '0', max: String(opts.max ?? 100), briefRepresentation: 'false' });
        if (opts.search) params.set('search', opts.search);
        const users = await adminJson<KcUser[]>(`/users?${params.toString()}`);
        return Promise.all(users.map(async (u) => toDirectoryUser(u, await userRoleNames(u.id))));
      },
      async get(id) {
        const res = await adminFetchRaw(`/users/${encodeURIComponent(id)}`, {});
        if (res.status === 404 || res.status === 204) return null;
        if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
        const u = (await res.json()) as KcUser;
        return toDirectoryUser(u, await userRoleNames(id));
      },
      async create(input) {
        const res = await adminFetchRaw(`/users`, { method: 'POST', body: JSON.stringify({ username: input.username, email: input.email ?? undefined, firstName: input.firstName ?? undefined, lastName: input.lastName ?? undefined, enabled: input.enabled ?? true }) });
        if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
        const loc = res.headers.get('Location');
        const id = loc ? (loc.split('/').filter(Boolean).pop() ?? '') : '';
        if (!id) throw new KcError(500, 'provider did not return a user id');
        if (input.roles && input.roles.length > 0) await this.setRoles(id, input.roles);
        if (input.password) await adminVoid(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: input.password, temporary: input.temporaryPassword ?? true }) });
        // Try a GET for the canonical representation; if Keycloak returns nothing (e.g. test stubs), build from input.
        const fetched = await this.get(id);
        if (fetched) return fetched;
        return toDirectoryUser(
          { id, username: input.username, email: input.email ?? undefined, firstName: input.firstName ?? undefined, lastName: input.lastName ?? undefined, enabled: input.enabled ?? true },
          input.roles ?? [],
        );
      },
      async update(id, patch) {
        await adminVoid(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ email: patch.email ?? undefined, firstName: patch.firstName ?? undefined, lastName: patch.lastName ?? undefined, enabled: patch.enabled }) });
      },
      async setRoles(id, roles) {
        const all = await adminJson<KcRole[]>(`/roles`);
        const currentRaw = (await adminJson<KcRole[] | undefined>(`/users/${encodeURIComponent(id)}/role-mappings/realm`)) ?? [];
        const current = currentRaw.filter((r) => !PROVIDER_DEFAULT_ROLE(r.name));
        const want = new Set(roles);
        const toAdd = all.filter((r) => want.has(r.name) && !current.some((c) => c.name === r.name));
        const toRemove = current.filter((c) => !want.has(c.name));
        // Add wanted roles before removing unwanted ones: if the second call fails,
        // the user keeps a superset rather than being left under-privileged. Re-saving converges.
        if (toAdd.length) await adminVoid(`/users/${encodeURIComponent(id)}/role-mappings/realm`, { method: 'POST', body: JSON.stringify(toAdd.map((r) => ({ id: r.id, name: r.name }))) });
        if (toRemove.length) await adminVoid(`/users/${encodeURIComponent(id)}/role-mappings/realm`, { method: 'DELETE', body: JSON.stringify(toRemove.map((r) => ({ id: r.id, name: r.name }))) });
      },
    },
    clients: {
      async findUuidByClientId(clientId) {
        const arr = await adminJson<{ id: string }[]>(`/clients?clientId=${encodeURIComponent(clientId)}`);
        return arr.length > 0 ? arr[0].id : null;
      },
      async createConfidentialClient(clientId) {
        const res = await adminFetchRaw(`/clients`, { method: 'POST', body: JSON.stringify({
          clientId, protocol: 'openid-connect', publicClient: false, serviceAccountsEnabled: true,
          standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false, enabled: true,
        }) });
        if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
        const loc = res.headers.get('Location');
        const uuid = loc ? (loc.split('/').filter(Boolean).pop() ?? '') : '';
        if (!uuid) throw new KcError(500, 'provider did not return a client id');
        return uuid;
      },
      async addSiteIdMapper(uuid, siteId) {
        await adminVoid(`/clients/${encodeURIComponent(uuid)}/protocol-mappers/models`, { method: 'POST', body: JSON.stringify({
          name: 'sync-site-id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
          config: { 'claim.name': 'site_id', 'claim.value': siteId, 'claim.value.type': 'String',
            'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false' },
        }) });
      },
      async addAudienceMapper(uuid, audience) {
        await adminVoid(`/clients/${encodeURIComponent(uuid)}/protocol-mappers/models`, { method: 'POST', body: JSON.stringify({
          name: 'sync-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
          config: { 'included.client.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false' },
        }) });
      },
      async getClientSecret(uuid) {
        const body = (await adminJson<{ value?: string } | undefined>(`/clients/${encodeURIComponent(uuid)}/client-secret`)) ?? {};
        if (!body.value) throw new KcError(500, 'provider did not return a client secret');
        return body.value;
      },
      async regenerateClientSecret(uuid) {
        const body = (await adminJson<{ value?: string } | undefined>(`/clients/${encodeURIComponent(uuid)}/client-secret`, { method: 'POST' })) ?? {};
        if (!body.value) throw new KcError(500, 'provider did not return a client secret');
        return body.value;
      },
      async deleteClient(uuid) {
        await adminVoid(`/clients/${encodeURIComponent(uuid)}`, { method: 'DELETE' });
      },
    },
  };
}
