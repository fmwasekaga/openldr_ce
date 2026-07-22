import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { useDashboardStore } from './store';

beforeEach(() => useDashboardStore.setState({ current: null, editing: false, dirty: false }));
afterEach(() => vi.restoreAllMocks());

// Radix DropdownMenu opens on pointerDown in jsdom, with a keyboard fallback (matches the
// repo's Connectors/Marketplace test pattern).
function openDashboardMenu() {
  const trigger = screen.getByRole('button', { name: 'Dashboard menu' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('DashboardPage', () => {
  it('loads dashboards and renders the first one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: null, name: 'Overview', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true }]), { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { getByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => expect(getByText('Overview')).toBeTruthy());
  });

  it('does NOT client-seed when the list is empty (server seeds the sample now)', async () => {
    let postAttempted = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, init: any) => {
      if (String(url) === '/api/dashboards' && init?.method === 'POST') { postAttempted = true; return Promise.resolve(new Response('{}', { status: 200 })); }
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { findByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    // Falls through to the graceful empty state (now a friendlier create/import prompt rather
    // than the raw error string), and never POSTs a dashboard.
    expect(await findByText('No dashboards yet.')).toBeTruthy();
    expect(postAttempted).toBe(false);
  });

  it('renders create/import actions in the empty state instead of a dead end', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /New dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import/i })).toBeInTheDocument();
  });

  it('offers a destructive "Delete dashboard" menu item that opens a confirm dialog', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: null, name: 'Overview', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true }]), { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Overview')).toBeTruthy());
    openDashboardMenu();
    const deleteItem = await screen.findByText('Delete dashboard');
    expect(deleteItem).toBeInTheDocument();
    fireEvent.click(deleteItem);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this dashboard?')).toBeInTheDocument();
  });
});
