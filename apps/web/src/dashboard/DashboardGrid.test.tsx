import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardGrid } from './DashboardGrid';
import { useDashboardStore } from './store';

beforeEach(() => useDashboardStore.setState({ current: { id: 'd', ownerId: null, name: 'D', refreshIntervalSec: 0, isDefault: false, filters: [], widgets: [{ id: 'w1', type: 'kpi', title: 'X', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } }], layout: [{ i: 'w1', x: 0, y: 0, w: 3, h: 2 }] }, editing: false, dirty: false }));
afterEach(() => vi.restoreAllMocks());

describe('DashboardGrid', () => {
  it('renders one widget panel with its title', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [{ value: 1 }], chart: { type: 'stat', value: '1', label: 'x' }, meta: { generatedAt: 'n', rowCount: 1 } }), { status: 200 }));
    const { getByText } = render(<DashboardGrid filterValues={{}} />);
    expect(getByText('X')).toBeTruthy();
  });
});
