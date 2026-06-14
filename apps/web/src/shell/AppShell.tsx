import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, FileText, BookOpen, FileInput, Users, ShieldCheck,
  ChevronLeft, ChevronRight, Sun, Moon, type LucideIcon,
} from 'lucide-react';
import { useTheme } from './useTheme';
import { useSidebar } from './useSidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const NAV: { to: string; label: string; end: boolean; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', end: false, icon: FileText },
  { to: '/docs', label: 'Docs', end: false, icon: BookOpen },
];
const SOON: { label: string; icon: LucideIcon }[] = [
  { label: 'Forms', icon: FileInput },
  { label: 'Users', icon: Users },
  { label: 'Audit', icon: ShieldCheck },
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

  return (
    <div className="ui-scope flex min-h-screen">
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

        <nav className="flex flex-1 flex-col gap-1 p-2">
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
          {SOON.map(({ label, icon: Icon }) => (
            <span
              key={label}
              aria-disabled
              title={collapsed ? `${label} (coming later)` : 'Coming in a later sub-project'}
              className={cn('flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground opacity-40', collapsed && 'justify-center px-0')}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </span>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : 'px-1')} title={collapsed ? 'operator' : undefined}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">O</span>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-xs font-medium text-foreground">operator</div>
                <div className="text-[10px] text-muted-foreground">local</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
          <span className="font-medium">{title}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <main className={fullBleed ? 'flex min-h-0 flex-1 flex-col' : 'p-6'}>{children}</main>
      </div>
    </div>
  );
}
