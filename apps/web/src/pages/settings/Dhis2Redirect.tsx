import { Navigate, useLocation } from 'react-router-dom';

/**
 * Back-compat: rewrites any legacy /dhis2/* URL to its /settings/dhis2/*
 * equivalent so old bookmarks and docs links keep working after the
 * relocation into the Settings shell.
 */
export function Dhis2Redirect() {
  const { pathname, search, hash } = useLocation();
  const to = pathname.replace(/^\/dhis2/, '/settings/dhis2') + search + hash;
  return <Navigate to={to} replace />;
}
