import { describe, it, expect } from 'vitest';
import { resultToChartData, chartOpts } from './chart-data';

const wide = { columns: [{ key: 'month', kind: 'string' }, { key: 'opd', kind: 'number' }, { key: 'icu', kind: 'number' }], rows: [{ month: 'Jan', opd: 5, icu: 2 }, { month: 'Feb', opd: 3, icu: 4 }] };
const long = { columns: [{ key: 'label', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [{ label: 'Jan', series: 'A', value: 5 }, { label: 'Jan', series: 'B', value: 2 }, { label: 'Feb', series: 'A', value: 3 }] };

describe('resultToChartData', () => {
  it('wide multi-column → one series per numeric column', () => {
    const d = resultToChartData(wide, {});
    expect(d.categories).toEqual(['Jan', 'Feb']);
    expect(d.series.map((s) => s.name)).toEqual(['opd', 'icu']);
    expect(d.series[0].values).toEqual([5, 3]);
    expect(d.series[1].values).toEqual([2, 4]);
  });

  it('long + breakdown → pivot wide with 0-fill for missing pairs', () => {
    const d = resultToChartData(long, { categoryKey: 'label', breakdownKey: 'series', valueKeys: ['value'] });
    expect(d.categories).toEqual(['Jan', 'Feb']);
    expect(d.series.map((s) => s.name)).toEqual(['A', 'B']);
    expect(d.series[0].values).toEqual([5, 3]);
    expect(d.series[1].values).toEqual([2, 0]);
  });

  it('single numeric column → one series', () => {
    const d = resultToChartData({ columns: [{ key: 'label', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [{ label: 'x', value: 7 }] }, {});
    expect(d.series.length).toBe(1);
    expect(d.series[0].values).toEqual([7]);
  });

  it('empty result → empty', () => {
    expect(resultToChartData(undefined, {})).toEqual({ title: '', categories: [], series: [] });
  });
});

describe('chartOpts', () => {
  it('builder + breakdown → long keys', () => {
    expect(chartOpts({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, dimension: { key: 'status' }, breakdown: { key: 'ward' }, filters: [] } as never))
      .toEqual({ categoryKey: 'label', breakdownKey: 'series', valueKeys: ['value'] });
  });
  it('builder without breakdown → defaults ({})', () => {
    expect(chartOpts({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } as never)).toEqual({});
  });
  it('undefined query → defaults ({})', () => {
    expect(chartOpts(undefined)).toEqual({});
  });
});
