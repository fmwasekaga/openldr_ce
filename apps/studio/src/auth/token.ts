// In-memory access-token holder. SP1b's login flow will call setAccessToken().
// Until then it stays null and the server's AUTH_DEV_BYPASS provides the actor.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// A callback the auth layer registers to re-trigger login when an authenticated request comes
// back 401 (expired SSO session / failed silent-renew). Kept here (not in oidc.ts) so the api.ts
// fetch wrapper can notify it without importing the OIDC client.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
