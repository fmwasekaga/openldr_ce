import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getMe, type CurrentUser } from '../api';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, hasRole: () => false });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getMe()
      .then((u) => { if (active) setUser(u); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const hasRole = (role: string) => user?.roles.includes(role) ?? false;

  return <AuthContext.Provider value={{ user, loading, hasRole }}>{children}</AuthContext.Provider>;
}
