import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileText, BookOpen, Library, FileInput, Users, ShieldCheck, Settings,
  Workflow, ChevronLeft, ChevronRight, Sun, Moon, LogOut, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, setLanguage } from '@/i18n/language';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from './useTheme';
import { useSidebar } from './useSidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { pluginIcon } from '@/plugins/icons';

const NAV: { to: string; labelKey: string; end: boolean; icon: LucideIcon; roles?: string[] }[] = [
  { to: '/', labelKey: 'nav.dashboard', end: true, icon: LayoutDashboard },
  { to: '/reports', labelKey: 'nav.reports', end: false, icon: FileText },
  { to: '/workflows', labelKey: 'nav.workflows', end: false, icon: Workflow, roles: ['lab_admin', 'lab_manager'] },
  { to: '/terminology', labelKey: 'nav.terminology', end: false, icon: Library },
  { to: '/forms', labelKey: 'nav.forms', end: false, icon: FileInput },
  { to: '/users', labelKey: 'nav.users', end: false, icon: Users },
  { to: '/audit', labelKey: 'nav.audit', end: false, icon: ShieldCheck },
  { to: '/docs', labelKey: 'nav.docs', end: false, icon: BookOpen },
];

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
  const { user, signOut, hasRole } = useAuth();
  const [pluginUis, setPluginUis] = useState<PluginUiEntry[]>([]);
  useEffect(() => { void listPluginUis().then(setPluginUis).catch(() => setPluginUis([])); }, []);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  return (
    <div className="ui-scope flex h-screen overflow-hidden">
      <aside
        className={cn('flex flex-col border-r border-border transition-[width] duration-200', collapsed ? 'w-14' : 'w-60')}
        style={{ background: 'var(--sidebar)' }}
      >
        <div className={cn('flex h-12 shrink-0 items-center border-b border-border', collapsed ? 'justify-center px-0' : 'justify-between px-3')}>
          {!collapsed && <span className="font-semibold text-primary">OpenLDR</span>}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? t('a11y.expandSidebar') : t('a11y.collapseSidebar')}
            title={collapsed ? t('a11y.expandSidebar') : t('a11y.collapseSidebar')}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {NAV.filter((n) => !n.roles || n.roles.some((r) => hasRole(r))).map(({ to, labelKey, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? t(labelKey) : undefined}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{t(labelKey)}</span>}
            </NavLink>
          ))}
          {pluginUis.map((p) => {
            const Icon = pluginIcon(p.nav.icon);
            return (
              <NavLink
                key={p.id}
                to={`/x/${p.id}`}
                title={collapsed ? p.nav.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{p.nav.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={collapsed ? (user?.username ?? '') : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed && 'justify-center',
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {(user?.username?.[0] ?? 'O').toUpperCase()}
                </span>
                {!collapsed && (
                  <div className="min-w-0 leading-tight">
                    <div className="truncate text-xs font-medium text-foreground">{user?.username ?? ''}</div>
                    <div className="text-[10px] text-muted-foreground">{user?.roles?.[0] ?? ''}</div>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <div className="px-2 py-1.5 leading-tight">
                <div className="truncate text-sm font-medium text-foreground">{user?.username ?? ''}</div>
                {user?.roles?.[0] && (
                  <div className="truncate text-xs text-muted-foreground">{user.roles[0].replace(/_/g, ' ')}</div>
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
              {hasRole('lab_admin') && (
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
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
          <span className="font-medium">{title}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('a11y.switchToLight') : t('a11y.switchToDark')}
              title={theme === 'dark' ? t('a11y.lightMode') : t('a11y.darkMode')}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>
        <main className={fullBleed ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto p-6'}>{children}</main>
      </div>
    </div>
  );
}
