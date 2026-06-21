import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { OidcConfig } from '@/api';
import { setAccessToken } from './token';

export interface OidcClient {
  signinRedirect(): Promise<void>;
  handleCallback(): Promise<User | null>;
  signoutRedirect(): Promise<void>;
  getStoredUser(): Promise<User | null>;
}

export function createOidc(cfg: OidcConfig): OidcClient {
  const mgr = new UserManager({
    authority: cfg.issuerUrl,
    client_id: cfg.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: window.location.origin,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    extraQueryParams: cfg.audience ? { audience: cfg.audience } : undefined,
  });

  // Keep the token seam in sync on load + silent renew + expiry.
  mgr.events.addUserLoaded((u: User) => setAccessToken(u.access_token));
  mgr.events.addAccessTokenExpired(() => setAccessToken(null));

  return {
    async signinRedirect() { await mgr.signinRedirect(); },
    async handleCallback() {
      const u = await mgr.signinCallback();
      if (u?.access_token) setAccessToken(u.access_token);
      return u ?? null;
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
