import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, FileText, BookOpen, Library, FileInput, Users, ShieldCheck,
  ChevronLeft, ChevronRight, Sun, Moon, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from './useTheme';
import { useSidebar } from './useSidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const NAV: { to: string; label: string; end: boolean; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', end: false, icon: FileText },
  { to: '/terminology', label: 'Terminology', end: false, icon: Library },
  { to: '/forms', label: 'Forms', end: false, icon: FileInput },
  { to: '/users', label: 'Users', end: false, icon: Users },
  { to: '/audit', label: 'Audit', end: false, icon: ShieldCheck },
  { to: '/docs', label: 'Docs', end: false, icon: BookOpen },
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
  const { user, signOut } = useAuth();
  const { t } = useTranslation();

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
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {NAV.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : 'px-1')} title={collapsed ? (user?.username ?? '') : undefined}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {(user?.username?.[0] ?? 'O').toUpperCase()}
            </span>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-xs font-medium text-foreground">{user?.username ?? ''}</div>
                <div className="text-[10px] text-muted-foreground">{user?.roles?.[0] ?? ''}</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
          <span className="font-medium">{title}</span>
          <div className="flex items-center gap-2">
            {user ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{user.username}</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={signOut}>{t('common.signOut')}</Button>
              </div>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
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
