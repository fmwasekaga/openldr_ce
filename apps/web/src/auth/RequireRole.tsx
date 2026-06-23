import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Gate children behind one or more roles. Pass `role` for a single role, or
 * `roles` for an OR-list (the user passes if they hold *any* of them). Roles
 * are flat (not hierarchical), so a route open to both managers and admins must
 * list both explicitly.
 */
export function RequireRole({
  role,
  roles,
  children,
}: {
  role?: string;
  roles?: string[];
  children: ReactNode;
}) {
  const { user, loading, hasRole } = useAuth();
  if (loading) return null;
  const allowed = [...(role ? [role] : []), ...(roles ?? [])];
  const ok = allowed.length === 0 || allowed.some((r) => hasRole(r));
  if (!user || !ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}
