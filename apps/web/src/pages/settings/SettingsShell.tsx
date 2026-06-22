import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

interface SubNavItem {
  labelKey: string;
  to: string;
  /** Role gate — missing means visible to everyone. */
  roles?: string[];
}

const SUB_NAV: SubNavItem[] = [
  { labelKey: 'settings.subNav.dhis2', to: '/settings/dhis2', roles: ['lab_admin'] },
];

/**
 * Settings shell with a left-hand section selector, mirroring corlix's
 * SettingsPage. The active sub-page renders in the right pane via <Outlet />.
 * New sections slot in by adding one SUB_NAV entry and one nested <Route> in
 * App.tsx — no further plumbing. The Marketplace UI (Phase 3 SP-4) lands here.
 */
export function SettingsShell() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const visible = SUB_NAV.filter((item) => !item.roles || item.roles.some((r) => hasRole(r)));

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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
