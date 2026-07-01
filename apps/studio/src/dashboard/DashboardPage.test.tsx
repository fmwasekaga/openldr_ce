import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { useDashboardStore } from './store';

beforeEach(() => useDashboardStore.setState({ current: null, editing: false, dirty: false }));
afterEach(() => vi.restoreAllMocks());

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
    // Falls through to the graceful empty state, and never POSTs a dashboard.
    expect(await findByText('No dashboards found.')).toBeTruthy();
    expect(postAttempted).toBe(false);
  });
});
