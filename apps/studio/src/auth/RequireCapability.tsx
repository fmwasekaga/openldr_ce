import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Gate children behind one or more capabilities. Pass `cap` for a single capability, or
 * `caps` for an OR-list (the user passes if they hold *any* of them). Capabilities are
 * flat (not hierarchical), so a route open to multiple roles' worth of access must list
 * every capability that should admit it. Passing neither `cap` nor `caps` is authed-only
 * (any signed-in user passes).
 */
export function RequireCapability({
  cap,
  caps,
  children,
}: {
  cap?: string;
  caps?: string[];
  children: ReactNode;
}) {
  const { user, loading, hasCapability } = useAuth();
  if (loading) return null;
  const allowed = [...(cap ? [cap] : []), ...(caps ?? [])];
  const ok = allowed.length === 0 || allowed.some((c) => hasCapability(c));
  if (!user || !ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}
