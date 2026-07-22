import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DashboardWidget, bindQuery } from './DashboardWidget';
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

describe('bindQuery', () => {
  it('expands a date-range dashboard-filter binding into gte + lte', () => {
    const q = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [], variableBindings: { authored_on: 'period' } } as any;
    const out = bindQuery(q, { period: { from: '2024-01-01', to: '2024-03-31' } }) as any;
    expect(out.filters).toEqual([
      { dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
    ]);
  });

  it('binds a scalar dashboard filter as an eq filter (unchanged)', () => {
    const q = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [], variableBindings: { priority: 'prio' } } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filters).toEqual([{ dimension: 'priority', op: 'eq', value: 'stat' }]);
  });

  it('drops a bound row\'s stale literal filter so the binding supersedes it (date-range)', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'authored_on', op: 'eq', value: '' }],
      variableBindings: { authored_on: 'period' },
    } as any;
    const out = bindQuery(q, { period: { from: '2024-01-01', to: '2024-03-31' } }) as any;
    expect(out.filters).toEqual([
      { dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
    ]);
  });

  it('drops a bound row\'s stale literal filter so the binding supersedes it (scalar)', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'priority', op: 'eq', value: '' }],
      variableBindings: { priority: 'prio' },
    } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filters).toEqual([{ dimension: 'priority', op: 'eq', value: 'stat' }]);
  });

  it('injects a scalar binding into a filterTree, pruning the bound dimension', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
      variableBindings: { priority: 'prio' },
    } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filterTree).toEqual({
      kind: 'group', combinator: 'and',
      children: [
        { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
        { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
      ],
    });
  });
});
