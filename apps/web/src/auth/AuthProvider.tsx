import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchClientConfig, getMe, type CurrentUser } from '@/api';
import { createOidc, type OidcClient } from './oidc';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  hasRole: (role: string) => boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  hasRole: () => false,
  signOut: () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

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
