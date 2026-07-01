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

  it('seeds a default dashboard when none exist', async () => {
    const created: any[] = [];
    const emptyResult = JSON.stringify({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: '' }, meta: { generatedAt: 'now', rowCount: 0 } });
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, init: any) => {
      if (String(url) === '/api/dashboards' && (!init || init.method !== 'POST')) return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }));
      if (String(url) === '/api/dashboards' && init?.method === 'POST') { const d = JSON.parse(init.body); created.push(d); return Promise.resolve(new Response(JSON.stringify(d), { status: 200 })); }
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      if (String(url).endsWith('/query')) return Promise.resolve(new Response(emptyResult, { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { findByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await findByText('Lab Overview (Sample)')).toBeTruthy();
  });
});
