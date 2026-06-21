# SP1b — Interactive Browser Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OIDC Authorization Code + PKCE browser login (via oidc-client-ts) against the realm — token wired into the SP1 `setAccessToken` seam, silent renew, sign-out, and the EventSource token fix — without breaking the `AUTH_DEV_BYPASS` dev/e2e path.

**Architecture:** `/api/config` (made public) exposes the OIDC settings + `authEnforced`. A thin `auth/oidc.ts` wraps an oidc-client-ts `UserManager` configured from that, writing tokens into `setAccessToken()`. `AuthProvider` requires a session (redirect to Keycloak) when enforced, stays anonymous under dev-bypass. A `/auth/callback` route completes the exchange. The ontology SSE passes the token as a query param, which the server accepts for those two routes only.

**Tech Stack:** oidc-client-ts, React + react-router, Fastify, Vitest/RTL.

**Spec:** `docs/superpowers/specs/2026-06-20-sp1b-browser-login-design.md`

**Conventions:** pnpm + turbo. Full gate: `pnpm turbo typecheck lint test build` then `pnpm depcruise`. Web tests init i18n via `import '@/i18n'` and mock `@/api`/`oidc-client-ts`. Commit per task. Live login validation is a manual laptop step (Task 6 checklist).

**Verified facts:**
- `apps/server/src/app.ts`: `registerConfigRoute(app, ctx)` (lines 18–26) returns `{ dashboardSqlEnabled }`; registered AFTER `registerAuth` (so it goes through the auth hook). `buildApp` wires health → registerAuth → /api/me → registerConfigRoute → routes.
- `apps/server/src/auth-plugin.ts`: the global `onRequest` hook guards `/api/*` (query-safe split: `url !== '/api' && !url.startsWith('/api/')` returns early for public). `bearer(req)` reads the `Authorization` header. `ctx.auth.verifyToken` + `syncFromClaims` set `req.user`.
- `apps/web/src/api.ts`: `ClientConfig { dashboardSqlEnabled }` + `fetchClientConfig()` (line 99–102, via `authFetch('/api/config')`); `buildOntology` (line 508) does `new EventSource(url)`; `getAccessToken` is exported from `./auth/token`.
- `apps/web/src/auth/{token.ts,AuthProvider.tsx,RequireRole.tsx}` from SP1; `main.tsx` wraps `<BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter>`; `App.tsx` holds the routes.
- Config already has `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `AUTH_DEV_BYPASS`.

---

## File Structure

- `packages/config/src/schema.ts` — `OIDC_WEB_CLIENT_ID` (modify)
- `apps/server/src/app.ts` — `/api/config` oidc + authEnforced (modify)
- `apps/server/src/app.test.ts` — config-route assertions (modify)
- `apps/server/src/auth-plugin.ts` — public `/api/config` + SSE query-token (modify)
- `apps/server/src/auth-plugin.test.ts` — allow-list + SSE-token tests (modify)
- `apps/web/src/api.ts` — `ClientConfig` extend + `buildOntology` query token (modify)
- `apps/web/package.json` — add `oidc-client-ts` (modify)
- `apps/web/src/auth/oidc.ts` — UserManager wrapper (create)
- `apps/web/src/auth/oidc.test.ts` — wrapper test (create)
- `apps/web/src/auth/AuthProvider.tsx` — enforced/anonymous session logic (modify)
- `apps/web/src/auth/AuthProvider.test.tsx` — branches (modify)
- `apps/web/src/auth/CallbackPage.tsx` — callback route (create)
- `apps/web/src/App.tsx` — `/auth/callback` route (modify)
- `apps/web/src/shell/AppShell.tsx` — sign-out affordance (modify)
- `apps/web/src/i18n/index.ts` — sign-in/out keys (modify)

---

## Task 1: Server — `/api/config` exposes OIDC + becomes public; SSE query-token

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `apps/server/src/auth-plugin.ts`
- Modify: `apps/server/src/auth-plugin.test.ts`

- [ ] **Step 1: Config field**

In `packages/config/src/schema.ts`, near the OIDC fields, add:
```ts
    OIDC_WEB_CLIENT_ID: z.string().min(1).default('openldr-web'),
```

- [ ] **Step 2: Extend `/api/config`**

In `apps/server/src/app.ts`, widen `registerConfigRoute`'s ctx type + response:
```ts
export function registerConfigRoute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: FastifyInstance<any, any, any, any>,
  ctx: { cfg: { DASHBOARD_SQL_ENABLED: boolean; TARGET_STORE_ADAPTER: string; AUTH_DEV_BYPASS: boolean; OIDC_ISSUER_URL: string; OIDC_WEB_CLIENT_ID: string; OIDC_AUDIENCE?: string } },
): void {
  app.get('/api/config', async () => ({
    dashboardSqlEnabled: ctx.cfg.DASHBOARD_SQL_ENABLED && ctx.cfg.TARGET_STORE_ADAPTER === 'pg',
    authEnforced: !ctx.cfg.AUTH_DEV_BYPASS,
    oidc: {
      issuerUrl: ctx.cfg.OIDC_ISSUER_URL,
      clientId: ctx.cfg.OIDC_WEB_CLIENT_ID,
      audience: ctx.cfg.OIDC_AUDIENCE ?? null,
    },
  }));
}
```

- [ ] **Step 3: Make `/api/config` public + accept the SSE query-token**

In `apps/server/src/auth-plugin.ts`, update the `onRequest` hook + `bearer()`:
1. Public allow-list — after computing the path, return early for `/api/config`. Find the existing public-path early-return and add `/api/config`:
```ts
    const path = (req.raw.url ?? '').split('?')[0];
    if (path === '/api/config') return; // public: the SPA reads OIDC settings before it has a token
    if (path !== '/api' && !path.startsWith('/api/')) return; // /health + static SPA
```
(Adapt to the existing variable; the key change is the `/api/config` public exemption.)
2. `bearer()` — accept `?access_token=` for the two ontology SSE GET routes only (EventSource can't send a header):
```ts
function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) { const t = h.slice('Bearer '.length).trim(); if (t) return t; }
  const url = req.raw.url ?? '';
  const path = url.split('?')[0];
  // Server-Sent Events streams (ontology build/rebuild) cannot set an Authorization header,
  // so accept the access token from the query string for THOSE routes only. It is verified
  // identically to a header token — no weakening of auth.
  if (/^\/api\/terminology\/ontology\/[^/]+\/(build|rebuild)$/.test(path)) {
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const tok = new URLSearchParams(qs).get('access_token');
    if (tok && tok.trim()) return tok.trim();
  }
  return null;
}
```

- [ ] **Step 4: Tests**

In `apps/server/src/auth-plugin.test.ts`, add tests (build the app with the fake ctx pattern already there + a fake verifyToken):
- `/api/config` is reachable with NO token even when bypass is off (200). Register a `GET /api/config` handler in the test app (or assert the hook does not 401 it).
- An ontology `build` request with no header but a valid `?access_token=good` resolves `req.user` (200); an invalid `?access_token=bad` → 401; a NON-SSE route with `?access_token=good` and no header still → 401 (query token is SSE-only).

Concretely (mirror the existing `appWith`/`ctx` helpers in the file):
```ts
  it('allows /api/config with no token when bypass is off', async () => {
    const app = await appWith(ctx({ bypass: false }));
    app.get('/api/config', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
  });
  it('accepts an access_token query param on the ontology SSE routes only', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1' }) }));
    app.get('/api/terminology/ontology/:id/build', async (req) => ({ user: req.user ?? null }));
    app.get('/api/probe', async (req) => ({ user: req.user ?? null }));
    const ok = await app.inject({ method: 'GET', url: '/api/terminology/ontology/x/build?path=p&access_token=good' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.username).toBeTruthy();
    const nonSse = await app.inject({ method: 'GET', url: '/api/probe?access_token=good' });
    expect(nonSse.statusCode).toBe(401); // query token not honoured off the SSE routes
  });
```
In `app.test.ts`, update the `/api/config` assertion (if any) to expect the new `authEnforced` + `oidc` fields; the fake `ctxWith` cfg already has `AUTH_DEV_BYPASS: true` — add `OIDC_ISSUER_URL`, `OIDC_WEB_CLIENT_ID`, `OIDC_AUDIENCE` to its `cfg` so `registerConfigRoute` types/returns are satisfied.

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @openldr/config test` and `pnpm --filter @openldr/server test`, then `pnpm --filter @openldr/server typecheck` → all green / EXIT 0.
```bash
git add packages/config/src/schema.ts apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/auth-plugin.ts apps/server/src/auth-plugin.test.ts
git commit -m "feat(auth): public /api/config exposes OIDC settings; SSE access_token query-token"
```

---

## Task 2: Web — extend ClientConfig + SSE token on buildOntology

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Extend `ClientConfig` + `fetchClientConfig`**

In `apps/web/src/api.ts`:
```ts
export interface OidcConfig { issuerUrl: string; clientId: string; audience: string | null }
export interface ClientConfig { dashboardSqlEnabled: boolean; authEnforced: boolean; oidc: OidcConfig | null }
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await authFetch('/api/config');
  if (!r.ok) return { dashboardSqlEnabled: false, authEnforced: false, oidc: null };
  return r.json();
}
```

- [ ] **Step 2: SSE token on `buildOntology`**

In `buildOntology` (line ~513), append the token when present:
```ts
  const token = getAccessToken();
  const tokenParam = token ? `${opts.rebuild ? '?' : '&'}access_token=${encodeURIComponent(token)}` : '';
  const url = (opts.rebuild
    ? `/api/terminology/ontology/${id}/rebuild`
    : `/api/terminology/ontology/${id}/build?path=${encodeURIComponent(opts.path ?? '')}`) + tokenParam;
  const eventSource = new EventSource(url);
```
Ensure `getAccessToken` is imported at the top of `api.ts` (it already imports from `./auth/token` for `authFetch`; add `getAccessToken` to that import if not present).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0. (Existing web tests that read `fetchClientConfig` still pass — the extra fields are additive; if a dashboard test asserts the exact `ClientConfig` shape, update it.)
Run: `pnpm --filter @openldr/web test -- api` (or the dashboard config test) to confirm.
```bash
git add apps/web/src/api.ts
git commit -m "feat(web): ClientConfig exposes authEnforced+oidc; buildOntology sends SSE access_token"
```

---

## Task 3: Web OIDC client wrapper

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/auth/oidc.ts`
- Create: `apps/web/src/auth/oidc.test.ts`

- [ ] **Step 1: Add the dependency**

In `apps/web/package.json` dependencies add `"oidc-client-ts": "^3.1.0"`. Run `pnpm install`.

- [ ] **Step 2: Failing test** — create `apps/web/src/auth/oidc.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const signinRedirect = vi.fn();
const signoutRedirect = vi.fn();
const signinCallback = vi.fn();
const getUser = vi.fn();
const addUserLoaded = vi.fn();
const addAccessTokenExpired = vi.fn();
vi.mock('oidc-client-ts', () => ({
  UserManager: vi.fn().mockImplementation(() => ({
    signinRedirect, signoutRedirect, signinCallback, getUser,
    events: { addUserLoaded, addAccessTokenExpired },
  })),
  WebStorageStateStore: vi.fn(),
}));
vi.mock('./token', () => ({ setAccessToken: vi.fn(), getAccessToken: vi.fn() }));
import { UserManager } from 'oidc-client-ts';
import { setAccessToken } from './token';
import { createOidc } from './oidc';

const oidcCfg = { issuerUrl: 'https://kc/realms/openldr', clientId: 'openldr-web', audience: 'openldr-api' };

beforeEach(() => vi.clearAllMocks());

describe('createOidc', () => {
  it('configures UserManager with authority/client/redirect/pkce', () => {
    createOidc(oidcCfg);
    const settings = (UserManager as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(settings.authority).toBe('https://kc/realms/openldr');
    expect(settings.client_id).toBe('openldr-web');
    expect(settings.redirect_uri).toContain('/auth/callback');
    expect(settings.response_type).toBe('code');
  });
  it('handleCallback stores the access token', async () => {
    signinCallback.mockResolvedValue({ access_token: 'tok', expired: false });
    const oidc = createOidc(oidcCfg);
    const u = await oidc.handleCallback();
    expect(setAccessToken).toHaveBeenCalledWith('tok');
    expect(u?.access_token).toBe('tok');
  });
  it('getStoredUser returns null when expired', async () => {
    getUser.mockResolvedValue({ access_token: 'tok', expired: true });
    const oidc = createOidc(oidcCfg);
    expect(await oidc.getStoredUser()).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** `pnpm --filter @openldr/web test -- oidc`

- [ ] **Step 4: Implement** — create `apps/web/src/auth/oidc.ts`:
```ts
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
```

- [ ] **Step 5: Run — expect PASS** (3). `pnpm --filter @openldr/web test -- oidc` ; typecheck EXIT 0.

- [ ] **Step 6: Commit**
```bash
git add apps/web/package.json apps/web/src/auth/oidc.ts apps/web/src/auth/oidc.test.ts pnpm-lock.yaml
git commit -m "feat(web): oidc-client-ts wrapper wired to the token seam"
```

---

## Task 4: AuthProvider rework + callback route

**Files:**
- Modify: `apps/web/src/auth/AuthProvider.tsx`
- Modify: `apps/web/src/auth/AuthProvider.test.tsx`
- Create: `apps/web/src/auth/CallbackPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/i18n/index.ts`

- [ ] **Step 1: i18n keys**

In `apps/web/src/i18n/index.ts` add under a new `auth` namespace (or `common`):
```ts
    signIn: 'Sign in',
    signOut: 'Sign out',
    signingIn: 'Signing in…',
    callbackError: 'Sign-in failed. Please try again.',
```

- [ ] **Step 2: Failing AuthProvider tests**

Update `apps/web/src/auth/AuthProvider.test.tsx` to cover the three branches (mock `@/api` `fetchClientConfig`/`getMe` + `./oidc` `createOidc`):
```tsx
vi.mock('@/api', () => ({ fetchClientConfig: vi.fn(), getMe: vi.fn() }));
vi.mock('./oidc', () => ({ createOidc: vi.fn() }));
import { fetchClientConfig, getMe } from '@/api';
import { createOidc } from './oidc';
// ... helpers ...

it('dev-bypass (not enforced): loads /api/me anonymously, no OIDC', async () => {
  (fetchClientConfig as any).mockResolvedValue({ authEnforced: false, oidc: null, dashboardSqlEnabled: false });
  (getMe as any).mockResolvedValue({ id: 'dev', username: 'dev-admin', displayName: null, roles: ['lab_admin'] });
  render(<AuthProvider><Probe/></AuthProvider>);
  await waitFor(() => expect(screen.getByText('dev-admin:true')).toBeTruthy());
  expect(createOidc).not.toHaveBeenCalled();
});
it('enforced + no stored session: triggers signinRedirect', async () => {
  (fetchClientConfig as any).mockResolvedValue({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
  const signinRedirect = vi.fn();
  (createOidc as any).mockReturnValue({ getStoredUser: vi.fn().mockResolvedValue(null), signinRedirect, handleCallback: vi.fn(), signoutRedirect: vi.fn() });
  render(<MemoryRouter><AuthProvider><Probe/></AuthProvider></MemoryRouter>);
  await waitFor(() => expect(signinRedirect).toHaveBeenCalled());
});
it('enforced + stored session: loads /api/me', async () => {
  (fetchClientConfig as any).mockResolvedValue({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
  (createOidc as any).mockReturnValue({ getStoredUser: vi.fn().mockResolvedValue({ access_token: 't', expired: false }), signinRedirect: vi.fn(), handleCallback: vi.fn(), signoutRedirect: vi.fn() });
  (getMe as any).mockResolvedValue({ id: 'u', username: 'ada', displayName: null, roles: ['lab_admin'] });
  render(<MemoryRouter><AuthProvider><Probe/></AuthProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('ada:true')).toBeTruthy());
});
```
(`Probe` renders `user ? \`${user.username}:${hasRole('lab_admin')}\` : 'anon'`. Wrap enforced cases in `MemoryRouter` since the provider reads the path. Adapt to the existing test scaffold.)

- [ ] **Step 3: Implement the AuthProvider** — replace `apps/web/src/auth/AuthProvider.tsx`:
```tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchClientConfig, getMe, type CurrentUser } from '@/api';
import { createOidc, type OidcClient } from './oidc';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  hasRole: (role: string) => boolean;
  signOut: () => void;
}
const AuthContext = createContext<AuthState>({ user: null, loading: true, hasRole: () => false, signOut: () => {} });
export function useAuth(): AuthState { return useContext(AuthContext); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const oidcRef = useRef<OidcClient | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await fetchClientConfig();
        if (!cfg.authEnforced || !cfg.oidc) {
          // Dev-bypass: server injects the dev actor; no interactive login.
          const u = await getMe().catch(() => null);
          if (active) { setUser(u); setLoading(false); }
          return;
        }
        // Enforced. The callback route handles its own exchange — don't double-redirect.
        if (window.location.pathname === '/auth/callback') { if (active) setLoading(false); return; }
        const oidc = createOidc(cfg.oidc);
        oidcRef.current = oidc;
        const stored = await oidc.getStoredUser();
        if (!stored) { await oidc.signinRedirect(); return; } // leaves loading=true through the redirect
        const u = await getMe().catch(() => null);
        if (active) { setUser(u); setLoading(false); }
      } catch {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const hasRole = (role: string) => user?.roles.includes(role) ?? false;
  const signOut = () => { void oidcRef.current?.signoutRedirect(); };

  return <AuthContext.Provider value={{ user, loading, hasRole, signOut }}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 4: Callback page + route**

Create `apps/web/src/auth/CallbackPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchClientConfig } from '@/api';
import { createOidc } from './oidc';
import { Button } from '@/components/ui/button';

export function CallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await fetchClientConfig();
        if (!cfg.oidc) { navigate('/', { replace: true }); return; }
        await createOidc(cfg.oidc).handleCallback();
        if (active) navigate('/', { replace: true });
      } catch { if (active) setError(true); }
    })();
    return () => { active = false; };
  }, [navigate]);
  const retry = async () => { const cfg = await fetchClientConfig(); if (cfg.oidc) await createOidc(cfg.oidc).signinRedirect(); };
  return (
    <div className="flex min-h-screen items-center justify-center">
      {error
        ? <div className="space-y-3 text-center"><p className="text-sm text-destructive">{t('common.callbackError')}</p><Button onClick={() => void retry()}>{t('common.signIn')}</Button></div>
        : <p className="text-sm text-muted-foreground">{t('common.signingIn')}</p>}
    </div>
  );
}
```
In `apps/web/src/App.tsx`, add the route (OUTSIDE any admin guard), e.g. with the other routes:
```tsx
      <Route path="/auth/callback" element={<CallbackPage />} />
```
and `import { CallbackPage } from './auth/CallbackPage';`.

- [ ] **Step 5: Run — expect PASS.** `pnpm --filter @openldr/web test -- AuthProvider` and `-- CallbackPage` (if you add one) then `pnpm --filter @openldr/web test`. typecheck EXIT 0.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/auth/AuthProvider.tsx apps/web/src/auth/AuthProvider.test.tsx apps/web/src/auth/CallbackPage.tsx apps/web/src/App.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): AuthProvider enforced-login flow + /auth/callback; anonymous under dev-bypass"
```

---

## Task 5: Sign-out UI in the AppShell

**Files:**
- Modify: `apps/web/src/shell/AppShell.tsx`

- [ ] **Step 1: Add the sign-out affordance**

Read `apps/web/src/shell/AppShell.tsx`. In the header area, add a small user indicator + sign-out, shown only when there is a user (so dev-bypass-anonymous or pre-login shows nothing):
```tsx
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
// inside the component:
const { user, signOut } = useAuth();
const { t } = useTranslation();
// in the header JSX (right side):
{user ? (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <span>{user.username}</span>
    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={signOut}>{t('common.signOut')}</Button>
  </div>
) : null}
```
Place it consistently with the shell's existing header layout (adapt to the real markup). If the shell has no header slot, add a minimal right-aligned element.

- [ ] **Step 2: Run + commit**

Run: `pnpm --filter @openldr/web test` (the shell renders in many page tests — ensure the `useAuth` usage doesn't break them; the AuthProvider default context provides `user:null,signOut:noop`, so the indicator is hidden). typecheck EXIT 0.
```bash
git add apps/web/src/shell/AppShell.tsx
git commit -m "feat(web): sign-out affordance in the app shell header"
```

---

## Task 6: Full gate + final review + live checklist

- [ ] **Step 1: Full gate.** `pnpm turbo typecheck lint test build` → all PASS.
- [ ] **Step 2: depcruise.** `pnpm depcruise` → no violations.
- [ ] **Step 3: Append the SP1b live-acceptance steps to `infra/keycloak/README.md`** deferred checklist:
```markdown
- [ ] (SP1b) With `AUTH_DEV_BYPASS` OFF + the realm up + the web dev server: loading the app redirects to Keycloak; sign in as `labadmin`/`labadmin`; lands back via `/auth/callback`; `/api/me` resolves; API calls carry the token; the access token silently renews; sign-out ends the session; the ontology build/rebuild SSE streams (token via `?access_token=`).
- [ ] (SP1b) With `AUTH_DEV_BYPASS` ON: no redirect; the app works anonymously (dev actor) — existing e2e unchanged.
```
- [ ] **Step 4: Commit any fixups** (skip if clean).

---

## Self-Review notes (coverage vs spec)

- §a config OIDC + public /api/config + OIDC_WEB_CLIENT_ID → Task 1. SSE query-token (server) → Task 1; (web) → Task 2.
- §b oidc.ts wrapper → Task 3. §c callback route → Task 4. §d AuthProvider rework (enforced/anonymous/callback-path) → Task 4. §e sign-out UI → Task 5. §f EventSource fix → Task 1 (server) + Task 2 (web).
- §Testing: server config-public + SSE-token (Task 1); oidc wrapper (Task 3); AuthProvider three branches (Task 4); live checklist (Task 6).
- Dev-bypass anonymous path preserved (Task 4) → existing Playwright e2e unchanged.
- Type consistency: `OidcConfig`/`ClientConfig` (Task 2) consumed by `createOidc`/`AuthProvider`/`CallbackPage` (Tasks 3–4); `OidcClient` shape (Task 3) used by AuthProvider (Task 4); `setAccessToken`/`getAccessToken` seam unchanged.
- ⚠️ Highest-uncertainty: the live redirect/callback round-trip is only provable against a running Keycloak (Task 6 manual). The automated suite mocks `oidc-client-ts`.
