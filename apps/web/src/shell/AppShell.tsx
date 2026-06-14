import type { ReactNode, ComponentType, SVGProps } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from './useTheme';
import { useSidebar } from './useSidebar';
import {
  IconDashboard, IconReports, IconDocs, IconForms, IconUsers, IconAudit,
  IconChevronLeft, IconChevronRight, IconSun, IconMoon,
} from './icons';

type IconCmp = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: { to: string; label: string; end: boolean; icon: IconCmp }[] = [
  { to: '/', label: 'Dashboard', end: true, icon: IconDashboard },
  { to: '/reports', label: 'Reports', end: false, icon: IconReports },
  { to: '/docs', label: 'Docs', end: false, icon: IconDocs },
];
const SOON: { label: string; icon: IconCmp }[] = [
  { label: 'Forms', icon: IconForms },
  { label: 'Users', icon: IconUsers },
  { label: 'Audit', icon: IconAudit },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const [collapsed, toggleSidebar] = useSidebar();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: collapsed ? 56 : 240,
          background: 'var(--sidebar)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 200ms ease',
        }}
      >
        {/* Header: wordmark + collapse toggle */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            borderBottom: '1px solid var(--border)',
            padding: collapsed ? 0 : '0 12px',
          }}
        >
          {!collapsed && <span style={{ fontWeight: 600, color: 'var(--brand)', fontSize: 16 }}>OpenLDR</span>}
          <button
            className="icon-btn"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: 8 }}>
          {NAV.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}${collapsed ? ' collapsed' : ''}`}
            >
              <Icon />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
          {SOON.map(({ label, icon: Icon }) => (
            <span
              key={label}
              aria-disabled
              title={collapsed ? `${label} (coming later)` : 'Coming in a later sub-project'}
              className={`nav-item disabled${collapsed ? ' collapsed' : ''}`}
            >
              <Icon />
              {!collapsed && <span>{label}</span>}
            </span>
          ))}
        </nav>

        {/* User / avatar area */}
        <div style={{ borderTop: '1px solid var(--border)', padding: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: collapsed ? 0 : 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? 0 : '4px 6px',
            }}
            title={collapsed ? 'operator' : undefined}
          >
            <span className="avatar">O</span>
            {!collapsed && (
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>operator</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>local</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: 48,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          <span style={{ fontWeight: 500 }}>{title}</span>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </header>
        <main style={{ padding: 24 }}>{children}</main>
      </div>
    </div>
  );
}
