import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const runWidgetQuery = vi.fn();
vi.mock('../api', () => ({ runWidgetQuery: (...a: unknown[]) => runWidgetQuery(...a) }));

import { useBlockData } from './useBlockData';
import { createEmptyTemplate } from '@openldr/report-builder/pure';
import { addRowWithBlock, newBlock, updateBlockAt } from './reportBuilderModel';

function result(n: number) { return { columns: [], rows: Array.from({ length: n }, () => ({})), chart: {}, meta: { generatedAt: 'n', rowCount: n } }; }
const bq = (model: string) => ({ mode: 'builder', model, metric: { key: 'count', agg: 'count' }, filters: [] });

beforeEach(() => runWidgetQuery.mockReset());

describe('useBlockData', () => {
  it('fetches a chart block query and exposes the result by cell key', async () => {
    runWidgetQuery.mockResolvedValue(result(3));
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('chart'));
    t = updateBlockAt(t, 0, 0, { query: bq('observations') } as any);
    const { result: hook } = renderHook(() => useBlockData(t, {}));
    await waitFor(() => expect(hook.current.get('0:0')?.result?.rows.length).toBe(3));
    expect(runWidgetQuery).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a block whose query has no model', async () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('chart')); // EMPTY_QUERY has model:''
    renderHook(() => useBlockData(t, {}));
    await new Promise((r) => setTimeout(r, 60));
    expect(runWidgetQuery).not.toHaveBeenCalled();
  });

  it('dedups two blocks with identical queries into one fetch', async () => {
    runWidgetQuery.mockResolvedValue(result(1));
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('kpi'));
    t = addRowWithBlock(t, newBlock('kpi'));
    t = updateBlockAt(t, 0, 0, { query: bq('observations') } as any);
    t = updateBlockAt(t, 1, 0, { query: bq('observations') } as any);
    const { result: hook } = renderHook(() => useBlockData(t, {}));
    await waitFor(() => expect(hook.current.get('1:0')?.result).toBeTruthy());
    expect(runWidgetQuery).toHaveBeenCalledTimes(1);
  });

  it('substitutes a param value into a bound filter before querying', async () => {
    runWidgetQuery.mockResolvedValue(result(1));
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('kpi'));
    t = updateBlockAt(t, 0, 0, {
      query: {
        mode: 'builder',
        model: 'm',
        metric: { key: 'count', agg: 'count' },
        filters: [{ dimension: 'status', op: 'eq', value: '{{param.status}}' }],
      },
    } as any);
    renderHook(() => useBlockData(t, { status: 'active' }));
    await waitFor(() => expect(runWidgetQuery).toHaveBeenCalled());
    const arg = vi.mocked(runWidgetQuery).mock.calls[0][0] as { filters: { value: unknown }[] };
    expect(arg.filters[0].value).toBe('active');
  });

  it('substitutes a param value into a sql block values before querying', async () => {
    runWidgetQuery.mockResolvedValue(result(1));
    const t = {
      id: 't', name: 'T', description: '', category: 'operational', status: 'draft',
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: [], rows: [{ id: 'r0', cells: [{ colSpan: 12, block: {
        kind: 'kpi', label: '', query: { mode: 'sql', sql: 'select {{ward}}', values: { ward: '{{param.site}}' } },
      } }] }],
    } as unknown as import('@openldr/report-builder/pure').ReportTemplate;
    renderHook(() => useBlockData(t, { site: 'ICU' }));
    await waitFor(() => expect(runWidgetQuery).toHaveBeenCalled());
    const arg = vi.mocked(runWidgetQuery).mock.calls[0][0] as { mode: string; values: Record<string, unknown> };
    expect(arg.mode).toBe('sql');
    expect(arg.values.ward).toBe('ICU');
  });
});
