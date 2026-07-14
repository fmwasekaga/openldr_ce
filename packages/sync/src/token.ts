// Client-credentials token provider for the sync push worker. Mirrors adapter-auth's `getAdminToken`
// request shape exactly (POST `${issuerUrl}/protocol/openid-connect/token`, urlencoded
// `grant_type=client_credentials` + client_id/client_secret, read `access_token`/`expires_in` from the
// JSON body) but is reimplemented inline here so this package takes no dependency on @openldr/adapter-auth
// just to reuse a ~15-line fetch. Task 3's push runner injects the resulting `getToken` as its `getToken`
// dep.

export interface SyncTokenProviderOptions {
  /** Keycloak realm issuer URL, e.g. https://kc.example/realms/openldr */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable monotonic clock for the expiry cache; defaults to Date.now. Tests stub this for
   *  deterministic cache/refresh assertions without real sleeps. */
  now?: () => number;
}

export interface SyncTokenProvider {
  getToken(): Promise<string>;
}

/** Thrown when the token endpoint responds non-2xx. Carries the HTTP status; the message never includes
 *  the client_secret. */
export class SyncTokenError extends Error {
  constructor(public status: number) {
    super(`sync token request failed: identity provider responded ${status}`);
    this.name = 'SyncTokenError';
  }
}

// Safety margin subtracted from the token lifetime so a token is refetched slightly before it actually
// expires (avoids racing an in-flight request against server-side expiry). Matches getAdminToken's 30s.
const EXPIRY_SAFETY_MARGIN_SECONDS = 30;
// Fallback lifetime when the provider omits expires_in, matching getAdminToken's default.
const DEFAULT_EXPIRES_IN_SECONDS = 300;

export function createSyncTokenProvider(opts: SyncTokenProviderOptions): SyncTokenProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  const tokenEndpoint = `${opts.issuerUrl}/protocol/openid-connect/token`;

  let cached: { token: string; expiresAt: number } | undefined;
  // Coalesce concurrent first/refresh calls onto one in-flight request so a burst of callers issues a
  // single token fetch rather than a stampede.
  let inFlight: Promise<string> | undefined;

  async function fetchFresh(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    });
    const res = await fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) throw new SyncTokenError(res.status);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    const lifetime = (body.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS) - EXPIRY_SAFETY_MARGIN_SECONDS;
    cached = { token: body.access_token, expiresAt: now() + lifetime * 1000 };
    return body.access_token;
  }

  return {
    async getToken(): Promise<string> {
      if (cached && now() < cached.expiresAt) return cached.token;
      if (!inFlight) {
        inFlight = fetchFresh().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
  };
}
