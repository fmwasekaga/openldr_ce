import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWidgetQuery, listDashboards, listValueSets, saveValueSet, expandValueSet, valueSetExportUrl } from './api';

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

describe('terminology value-set api client', () => {
  it('wires list/save/expand/export requests', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'vs1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ codes: [], total: 0 }), { status: 200 }));

    await expect(listValueSets('pub one')).resolves.toEqual([]);
    expect(spy).toHaveBeenNthCalledWith(1, '/api/terminology/valuesets?publisherId=pub%20one');

    await saveValueSet({ url: 'urn:test', status: 'draft', compose: { include: [] } });
    expect(spy).toHaveBeenNthCalledWith(2, '/api/terminology/valuesets', expect.objectContaining({ method: 'POST' }));

    await expandValueSet('vs1', false);
    expect(spy).toHaveBeenNthCalledWith(3, '/api/terminology/valuesets/vs1/expand?activeOnly=false');
    expect(valueSetExportUrl('vs1')).toBe('/api/terminology/valuesets/vs1/export');
  });
});
