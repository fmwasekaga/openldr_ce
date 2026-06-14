import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWidgetQuery, listDashboards } from './api';

afterEach(() => vi.restoreAllMocks());

describe('dashboard api client', () => {
  it('POSTs a widget query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [], chart: { type: 'stat', value: '1', label: 'x' }, meta: { generatedAt: 'now', rowCount: 0 } }), { status: 200 }));
    const r = await runWidgetQuery({ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] });
    expect(r.meta.rowCount).toBe(0);
    expect(spy).toHaveBeenCalledWith('/api/dashboards/query', expect.objectContaining({ method: 'POST' }));
  });
  it('GETs dashboards', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    expect(await listDashboards()).toEqual([]);
  });
});
