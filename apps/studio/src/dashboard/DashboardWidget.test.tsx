import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DashboardWidget } from './DashboardWidget';
import type { WidgetConfig } from '../api';

afterEach(() => vi.restoreAllMocks());
const cfg: WidgetConfig = { id: 'w', type: 'kpi', title: 'Orders', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } };

describe('DashboardWidget', () => {
  it('fetches and renders the value', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [{ label: 'x', value: 7 }], chart: { type: 'stat', value: '7', label: 'x' }, meta: { generatedAt: 'now', rowCount: 1 } }), { status: 200 }));
    const { getByText } = render(<DashboardWidget config={cfg} filterValues={{}} />);
    await waitFor(() => expect(getByText('7')).toBeTruthy());
  });
  it('shows an error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 400 }));
    const { findByText } = render(<DashboardWidget config={cfg} filterValues={{}} />);
    expect(await findByText(/boom/)).toBeTruthy();
  });
});
