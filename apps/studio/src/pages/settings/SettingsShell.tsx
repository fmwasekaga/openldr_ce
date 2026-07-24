import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

interface SubNavItem {
  labelKey: string;
  to: string;
  /** Capability gate — missing means visible to everyone who can see /settings. */
  caps?: string[];
}

const SUB_NAV: SubNavItem[] = [
  { labelKey: 'settings.subNav.general', to: '/settings/general', caps: ['settings.view'] },
  { labelKey: 'settings.subNav.notifications', to: '/settings/notifications', caps: ['notifications.view'] },
  { labelKey: 'settings.subNav.sites', to: '/settings/sites', caps: ['sync.manage'] },
  { labelKey: 'settings.subNav.sync', to: '/settings/sync', caps: ['sync.view'] },
  { labelKey: 'settings.subNav.connectors', to: '/settings/connectors', caps: ['connectors.manage'] },
  { labelKey: 'settings.subNav.marketplace', to: '/settings/marketplace', caps: ['marketplace.view'] },
  { labelKey: 'settings.subNav.roles', to: '/settings/roles', caps: ['roles.view'] },
];

/**
 * Default landing page for bare `/settings`. The parent route admits anyone who
 * can reach at least one sub-page (see App.tsx), but not every such user can
 * reach `general` (that one needs `settings.view` specifically) — a hardcoded
 * `Navigate to="general"` would bounce e.g. a notifications-only actor straight
 * back out to "/" via that child route's own RequireCapability. Land on the
 * first sub-nav entry the current user actually has a capability for instead.
 */
export function SettingsIndexRedirect() {
  const { hasCapability } = useAuth();
  const first = SUB_NAV.find((item) => !item.caps || item.caps.some((c) => hasCapability(c)));
  return <Navigate to={first ? first.to : '/settings/general'} replace />;
}

/**
 * Settings shell with a left-hand section selector, mirroring corlix's
 * SettingsPage. The active sub-page renders in the right pane via <Outlet />.
 * New sections slot in by adding one SUB_NAV entry and one nested <Route> in
 * App.tsx — no further plumbing. The Marketplace UI (Phase 3 SP-4) lands here.
 */
export function SettingsShell() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const visible = SUB_NAV.filter((item) => !item.caps || item.caps.some((c) => hasCapability(c)));

  return (
    <AppShell title={t('settings.title')} fullBleed>
      <div className="flex h-full min-h-0">
        <aside className="w-52 shrink-0 border-r border-border">
          <nav className="flex flex-col gap-1 p-3">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm no-underline transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
