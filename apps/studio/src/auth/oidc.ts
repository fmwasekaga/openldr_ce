import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { OidcConfig } from '@/api';
import { setAccessToken, setUnauthorizedHandler } from './token';

let singleton: OidcClient | null = null;
let singletonKey = '';

/** Returns a process-wide single OidcClient for the given config (one UserManager, shared PKCE state). */
export function getOidc(cfg: OidcConfig): OidcClient {
  const key = `${cfg.issuerUrl}|${cfg.clientId}|${cfg.audience ?? ''}`;
  if (!singleton || singletonKey !== key) { singleton = createOidc(cfg); singletonKey = key; }
  return singleton;
}

/** Test-only: reset the singleton between tests. */
export function __resetOidc(): void { singleton = null; singletonKey = ''; }

export interface OidcClient {
  signinRedirect(): Promise<void>;
  handleCallback(): Promise<User | null>;
  signoutRedirect(): Promise<void>;
  getStoredUser(): Promise<User | null>;
}

/**
 * Keycloak's OIDC endpoints are fully deterministic from the realm issuer URL, so we can supply
 * them to oidc-client-ts directly instead of relying on discovery. This matters behind institutional
 * reverse proxies (e.g. a ministry gateway) that apply a "hide dotfiles" rule — `location ~ /\.` —
 * which 404s any path with a dot-prefixed segment, including `/.well-known/openid-configuration`.
 * Passing `metadata` short-circuits that discovery fetch; every endpoint below is a plain non-dot
 * path that proxies through normally. The issuer value stays exactly `cfg.issuerUrl` so it still
 * matches the `iss` claim on issued tokens.
 */
function keycloakMetadata(issuerUrl: string) {
  const base = issuerUrl.replace(/\/+$/, '');
  const oidc = `${base}/protocol/openid-connect`;
  return {
    issuer: base,
    authorization_endpoint: `${oidc}/auth`,
    token_endpoint: `${oidc}/token`,
    userinfo_endpoint: `${oidc}/userinfo`,
    end_session_endpoint: `${oidc}/logout`,
    jwks_uri: `${oidc}/certs`,
  };
}

export function createOidc(cfg: OidcConfig): OidcClient {
  const mgr = new UserManager({
    authority: cfg.issuerUrl,
    metadata: keycloakMetadata(cfg.issuerUrl),
    client_id: cfg.clientId,
    redirect_uri: `${window.location.origin}/studio/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/studio`,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    extraQueryParams: cfg.audience ? { audience: cfg.audience } : undefined,
  });

  // Keep the token seam in sync on load + silent renew + expiry.
  mgr.events.addUserLoaded((u: User) => setAccessToken(u.access_token));
  mgr.events.addAccessTokenExpired(() => setAccessToken(null));

  // When any API call comes back 401 (silent-renew failed / SSO session ended), redirect to
  // login instead of leaving the UI showing raw "authentication required" errors. Guarded so
  // the many simultaneous 401s a page can emit don't fire multiple redirects, and debounced via
  // sessionStorage so a still-401 state right after login can't become a tight redirect loop.
  let reauthing = false;
  setUnauthorizedHandler(() => {
    if (reauthing) return;
    const last = Number(sessionStorage.getItem('oidc:last-reauth') ?? '0');
    if (Date.now() - last < 5000) return;
    sessionStorage.setItem('oidc:last-reauth', String(Date.now()));
    reauthing = true;
    setAccessToken(null);
    void mgr.signinRedirect().catch(() => { reauthing = false; });
  });

  // The authorization code + PKCE state are single-use. React StrictMode invokes the
  // callback effect twice in dev; dedupe so the second invocation reuses the first
  // exchange instead of re-redeeming a consumed code (which Keycloak rejects).
  let callbackPromise: Promise<User | null> | null = null;

  return {
    async signinRedirect() { await mgr.signinRedirect(); },
    async handleCallback() {
      if (!callbackPromise) {
        callbackPromise = (async () => {
          const u = await mgr.signinCallback();
          if (u?.access_token) setAccessToken(u.access_token);
          return u ?? null;
        })();
      }
      return callbackPromise;
    },
    async signoutRedirect() { setAccessToken(null); await mgr.signoutRedirect(); },
    async getStoredUser() {
      const u = await mgr.getUser();
      if (!u || u.expired) return null;
      setAccessToken(u.access_token);
      return u;
    },
  };
}
