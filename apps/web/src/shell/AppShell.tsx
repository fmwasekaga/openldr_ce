import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from './useTheme';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/reports', label: 'Reports', end: false },
];
const SOON = ['Forms', 'Users', 'Audit'];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const [theme, toggle] = useTheme();
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, background: 'var(--sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: 12 }}>
        <div style={{ fontWeight: 600, color: 'var(--brand)', padding: '8px 12px', fontSize: 16 }}>OpenLDR</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              style={({ isActive }) => ({
                padding: '8px 12px', borderRadius: 'var(--radius)', fontWeight: 500,
                color: isActive ? 'var(--link)' : 'var(--text-muted)',
                background: isActive ? 'var(--brand-wash)' : 'transparent',
              })}
            >
              {n.label}
            </NavLink>
          ))}
          {SOON.map((s) => (
            <span key={s} aria-disabled title="Coming in a later sub-project" style={{ padding: '8px 12px', color: 'var(--text-muted)', opacity: 0.4 }}>
              {s}
            </span>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn-secondary" onClick={toggle}>{theme === 'dark' ? '☾ Dark' : '☀ Light'}</button>
          <div style={{ color: 'var(--text-muted)', padding: '8px 12px' }} className="mono">operator</div>
        </div>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: 48, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 24px', fontWeight: 500 }}>
          {title}
        </header>
        <main style={{ padding: 24 }}>{children}</main>
      </div>
    </div>
  );
}
