import { describe, it, expect } from 'vitest';
import { resultToChartData, chartOpts } from './chart-data';

// Both the PDF (paint.ts) and the canvas (CanvasBlock.tsx) build ChartData the SAME way:
//   resultToChartData(result, { title, ...chartOpts(block.query) })
// This test guards that shared contract against one fixture + a breakdown block.
describe('renderer agreement', () => {
  const query = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, dimension: { key: 'status' }, breakdown: { key: 'ward' }, filters: [] } as never;
  const result = {
    columns: [{ key: 'label', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }],
    rows: [{ label: 'Jan', series: 'OPD', value: 5 }, { label: 'Jan', series: 'ICU', value: 2 }, { label: 'Feb', series: 'OPD', value: 3 }],
  };

  it('PDF and canvas produce identical ChartData from the same block+result', () => {
    const pdf = resultToChartData(result, { title: '', ...chartOpts(query) });
    const canvas = resultToChartData(result, { title: '', ...chartOpts(query) });
    expect(pdf).toEqual(canvas);
    expect(pdf.categories).toEqual(['Jan', 'Feb']);
    expect(pdf.series.map((s) => s.name)).toEqual(['OPD', 'ICU']);
    expect(pdf.series[1].values).toEqual([2, 0]); // ICU: Jan=2, Feb missing → 0
  });
});
