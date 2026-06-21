import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', 'dark');
});

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell title="Dashboard"><div>content</div></AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders brand, nav, title, content, and the avatar/user area', () => {
    renderShell();
    expect(screen.getByText('OpenLDR')).toBeInTheDocument();
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
    // The avatar initial falls back to 'O' when no user is logged in (user?.username?.[0] ?? 'O').
    expect(screen.getByText('O')).toBeInTheDocument();
  });

  it('renders Forms, Users, and Audit as active navigation links', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Forms' })).toHaveAttribute('href', '/forms');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/audit');
  });

  it('toggles theme via the navbar icon button', () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Switch to light mode'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('collapses the sidebar — hiding the wordmark and nav labels', () => {
    renderShell();
    expect(screen.getByText('OpenLDR')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(screen.queryByText('OpenLDR')).not.toBeInTheDocument();
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });
});
