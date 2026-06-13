import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell title="Dashboard"><div>content</div></AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders brand, nav, title, and content', () => {
    renderShell();
    expect(screen.getByText('OpenLDR')).toBeInTheDocument();
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
  it('toggles theme on the html element', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderShell();
    fireEvent.click(screen.getByText(/Dark/));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
