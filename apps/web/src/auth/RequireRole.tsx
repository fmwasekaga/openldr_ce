import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireRole({ role, children }: { role: string; children: ReactNode }) {
  const { user, loading, hasRole } = useAuth();
  if (loading) return null;
  if (!user || !hasRole(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
