import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authFetch, getMe, getMyCapabilities, type ClientConfig, type CurrentUser } from '@/api';
import { getOidc, type OidcClient } from './oidc';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';

/** Module-level guard: prevents StrictMode double-invocation from issuing two signinRedirects. */
let redirecting = false;

/** Test-only: reset module-level state between tests. */
export function __resetAuthProviderState(): void { redirecting = false; }

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  /** Capability-based authorization check. */
  hasCapability: (cap: string) => boolean;
  signOut: () => void;
  /** Whether the server enforces auth. False when AUTH_DEV_BYPASS is on (dev only). Defaults true (fail-safe). */
  authEnforced: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  hasCapability: () => false,
  signOut: () => {},
  authEnforced: true,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [authEnforced, setAuthEnforced] = useState(true);
  const oidcRef = useRef<OidcClient | null>(null);
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Fail-closed: fetch config strictly — a non-OK response is an error, not a bypass.
        const r = await authFetch('/api/config');
        if (!r.ok) throw new Error('config');
        const cfg = await r.json() as ClientConfig;
        if (active) setAuthEnforced(cfg.authEnforced);

        if (!cfg.authEnforced || !cfg.oidc) {
          // Dev-bypass: server injects the dev actor; no interactive login. The server's dev actor
          // is granted all capabilities, so fetch /api/me/capabilities here too.
          const [u, caps] = await Promise.all([
            getMe().catch(() => null),
            getMyCapabilities().catch(() => []),
          ]);
          if (active) { setUser(u); setCapabilities(caps); setLoading(false); }
          return;
        }
        // Enforced. The callback route handles its own exchange — don't double-redirect.
        if (location.pathname === '/auth/callback') { if (active) setLoading(false); return; }
        const oidc = getOidc(cfg.oidc);
        oidcRef.current = oidc;
        const stored = await oidc.getStoredUser();
        if (!stored) {
          try {
            if (redirecting) return;
            redirecting = true;
            await oidc.signinRedirect();
          } catch {
            redirecting = false;
            if (active) { setConfigError(true); setLoading(false); }
          }
          return; // leaves loading=true through the redirect (or error path above resets it)
        }
        const [u, caps] = await Promise.all([
          getMe().catch(() => null),
          getMyCapabilities().catch(() => []),
        ]);
        if (active) { setUser(u); setCapabilities(caps); setLoading(false); }
      } catch {
        if (active) { setConfigError(true); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [location.pathname]);

  const hasCapability = (cap: string) => capabilities.includes(cap);
  const signOut = () => { void oidcRef.current?.signoutRedirect(); };

  if (configError) {
    return (
      <StripedEmpty className="h-screen">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{t('common.configUnreachable')}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </StripedEmpty>
    );
  }

  // Hold children until auth resolves so no API call fires before the access token is
  // restored into the in-memory holder (otherwise the first requests race to a 401).
  // The /auth/callback effect sets loading=false itself, so CallbackPage still renders.
  if (loading) {
    return (
      <StripedEmpty className="h-screen">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{t('common.signingIn')}</p>
        </div>
      </StripedEmpty>
    );
  }

  return <AuthContext.Provider value={{ user, loading, hasCapability, signOut, authEnforced }}>{children}</AuthContext.Provider>;
}
