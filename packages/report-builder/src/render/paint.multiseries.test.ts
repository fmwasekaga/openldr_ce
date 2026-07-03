import { describe, it, expect } from 'vitest';
import { resultToChartData, chartOpts } from './chart-data';

// paint.ts and the canvas both build ChartData as resultToChartData(result, { title, ...chartOpts(block.query) }).
// This locks that a breakdown chart block derives a multi-series pivot.
describe('paint multi-series wiring', () => {
  it('a chart block with a builder breakdown query derives long pivot opts', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, dimension: { key: 'status' }, breakdown: { key: 'ward' }, filters: [] } as never;
    const result = { columns: [{ key: 'label', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [{ label: 'Jan', series: 'A', value: 5 }, { label: 'Jan', series: 'B', value: 2 }] };
    const d = resultToChartData(result, { title: '', ...chartOpts(q) });
    expect(d.series.map((s) => s.name)).toEqual(['A', 'B']);
  });
});
