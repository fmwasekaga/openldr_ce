import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FileText, BookOpen, Library, FileInput, Users, ShieldCheck, Settings,
  Workflow, Activity, Database, PanelLeftClose, PanelLeftOpen, Menu, X, Sun, Moon, LogOut, PencilRuler, ShieldAlert, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, setLanguage } from '@/i18n/language';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from './useTheme';
import { useSidebar } from './useSidebar';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { pluginIcon } from '@/plugins/icons';
import { NotificationBell } from './NotificationBell';
import { NotificationToaster } from './NotificationToaster';

const NAV: { to: string; labelKey: string; end: boolean; icon: LucideIcon; caps?: string[] }[] = [
  { to: '/', labelKey: 'nav.dashboard', end: true, icon: LayoutDashboard, caps: ['dashboards.view'] },
  { to: '/reports', labelKey: 'nav.reports', end: false, icon: FileText, caps: ['reports.view'] },
  { to: '/report-designer', labelKey: 'nav.reportDesigner', end: false, icon: PencilRuler, caps: ['reports.edit_templates'] },
  { to: '/query', labelKey: 'nav.query', end: false, icon: Database, caps: ['query.run'] },
  { to: '/workflows', labelKey: 'nav.workflows', end: false, icon: Workflow, caps: ['workflows.view'] },
  { to: '/terminology', labelKey: 'nav.terminology', end: false, icon: Library },
  { to: '/forms', labelKey: 'nav.forms', end: false, icon: FileInput },
  { to: '/users', labelKey: 'nav.users', end: false, icon: Users, caps: ['users.view'] },
  // Sites lives under Settings → Sites (not a top-level nav item) so it isn't mistaken for a
  // Facilities / master facility list.
  { to: '/audit', labelKey: 'nav.audit', end: false, icon: ShieldCheck },
  { to: '/activity', labelKey: 'nav.activity', end: false, icon: Activity, caps: ['activity.view'] },
  { to: '/docs', labelKey: 'nav.docs', end: false, icon: BookOpen },
];

// One sidebar entry. Active state is computed with useMatch and passed to NavLink as a
// STRING className. When collapsed the item is wrapped in a Tooltip via `asChild`, and
// Radix's Slot stringifies a FUNCTION className (dumping BOTH color classes into the class
// list → every icon rendered primary/blue). A resolved string className avoids that.
function SidebarNavItem({
  to, end, icon: Icon, label, collapsed, onNavigate,
}: { to: string; end?: boolean; icon: LucideIcon; label: string; collapsed: boolean; onNavigate?: () => void }) {
  const active = useMatch({ path: to, end: Boolean(end) }) != null;
  // `collapsed` is a desktop-only affordance: on mobile the sidebar is a full-width drawer that
  // always shows labels, so every collapse-driven style is scoped to `md:` and the label is kept
  // in the DOM (hidden only on the desktop-collapsed rail) rather than conditionally rendered.
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={cn(
        'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors',
        collapsed && 'md:justify-center md:px-0',
        active ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>
    </NavLink>
  );
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="hidden md:block">{label}</TooltipContent>
    </Tooltip>
  ) : link;
}

export function AppShell({
  title,
  children,
  fullBleed = false,
}: {
  title: string;
  children: ReactNode;
  fullBleed?: boolean;
}) {
  const [theme, toggleTheme] = useTheme();
  const [collapsed, toggleSidebar] = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut, hasCapability, authEnforced } = useAuth();
  const [pluginUis, setPluginUis] = useState<PluginUiEntry[]>([]);
  const location = useLocation();
  // Close the mobile drawer whenever the route changes (covers nav links, the user-menu
  // Settings item, and any programmatic navigation) so it never lingers over a new page.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    let cancelled = false;
    void listPluginUis()
      .then((list) => { if (!cancelled) setPluginUis(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setPluginUis([]); });
    return () => { cancelled = true; };
  }, []);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const userTrigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={user?.username ? t('common.openUserMenuFor', { username: user.username }) : t('common.openUserMenu')}
        className={cn(
          'flex w-full items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed && 'md:justify-center',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {(user?.username?.[0] ?? 'O').toUpperCase()}
        </span>
        <div className={cn('min-w-0 leading-tight', collapsed && 'md:hidden')}>
          <TruncatedText as="div" text={user?.username ?? ''} className="text-xs font-medium text-foreground" />
          <TruncatedText as="div" text={user?.roles?.[0] ?? ''} className="text-[10px] text-muted-foreground" />
        </div>
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <TooltipProvider delayDuration={300}>
    <div className="ui-scope flex h-screen overflow-hidden">
      <NotificationToaster />
      {/* Scrim behind the mobile drawer; tapping it closes the menu. Desktop never shows it. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          'z-50 flex flex-col border-r border-border',
          // Mobile: off-canvas drawer sliding in from the left.
          'fixed inset-y-0 left-0 w-64 max-w-[82vw] transform transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static column whose width toggles with the collapse control.
          'md:static md:z-auto md:max-w-none md:translate-x-0 md:transition-[width]',
          collapsed ? 'md:w-14' : 'md:w-60',
        )}
        style={{ background: 'var(--sidebar)' }}
      >
        <div className={cn('flex h-12 shrink-0 items-center justify-between border-b border-border px-3', collapsed && 'md:justify-center md:px-0')}>
          <span className={cn('font-semibold text-primary', collapsed && 'md:hidden')}>OpenLDR</span>
          {/* Desktop collapse toggle (hidden on mobile). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:inline-flex"
                onClick={toggleSidebar}
                aria-label={collapsed ? t('a11y.expandSidebar') : t('a11y.collapseSidebar')}
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="hidden md:block">{collapsed ? t('a11y.expandSidebar') : t('a11y.collapseSidebar')}</TooltipContent>
          </Tooltip>
          {/* Mobile drawer close button. */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label={t('a11y.closeMenu')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {NAV.filter((n) => !n.caps || n.caps.some((c) => hasCapability(c))).map(({ to, labelKey, end, icon: Icon }) => (
            <SidebarNavItem key={to} to={to} end={end} icon={Icon} label={t(labelKey)} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
          ))}
          {pluginUis.map((p) => (
            <SidebarNavItem key={p.id} to={`/x/${p.id}`} icon={pluginIcon(p.nav.icon)} label={p.nav.label} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <DropdownMenu>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{userTrigger}</TooltipTrigger>
                <TooltipContent side="right">{user?.username ?? ''}</TooltipContent>
              </Tooltip>
            ) : userTrigger}
            <DropdownMenuContent side="top" align="start" className="w-52">
              <div className="px-2 py-1.5 leading-tight">
                <TruncatedText as="div" text={user?.username ?? ''} className="text-sm font-medium text-foreground" />
                {user?.roles?.[0] && (
                  <TruncatedText as="div" text={user.roles[0].replace(/_/g, ' ')} className="text-xs text-muted-foreground" />
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t('layout.language')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <DropdownMenuItem
                      key={l.code}
                      onClick={() => void setLanguage(l.code)}
                      disabled={i18n.language === l.code}
                    >
                      {l.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              {/* TODO(phase3): generalize to "user can see >=1 Settings sub-nav section" once
                  General/Marketplace (broader-role) sections land; for SP-0 DHIS2 is admin-only. */}
              {hasCapability('settings.view') && (
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t('layout.settings')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('common.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t('a11y.openMenu')}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="truncate font-medium">{title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {!authEnforced && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="status"
                    aria-label={t('a11y.devBypassLabel')}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-amber-500 dark:text-amber-400"
                  >
                    <ShieldAlert className="h-[18px] w-[18px]" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">{t('a11y.devBypassTooltip')}</TooltipContent>
              </Tooltip>
            )}
            {hasCapability('notifications.view') && <NotificationBell />}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                  aria-label={theme === 'dark' ? t('a11y.switchToLight') : t('a11y.switchToDark')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{theme === 'dark' ? t('a11y.lightMode') : t('a11y.darkMode')}</TooltipContent>
            </Tooltip>
          </div>
        </header>
        <main className={fullBleed ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto p-6'}>{children}</main>
      </div>
    </div>
    </TooltipProvider>
  );
}
