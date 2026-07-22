import { describe, it, expect } from 'vitest';
import { uniqueKey, addMeasure, addFormula, updateMeasure, removeMeasure, aggregateMeasures, toBuilderMetrics, type Measure } from './measures.model';

const model = { metrics: [{ key: 'count', label: 'Count', agg: 'count' }, { key: 'avg_value', label: 'Avg', agg: 'avg', column: 'v' }] };

describe('measures.model', () => {
  it('uniqueKey suffixes on collision', () => {
    expect(uniqueKey([{ key: 'count', agg: 'count' }], 'count')).toBe('count-2');
    expect(uniqueKey([], 'count')).toBe('count');
  });

  it('addMeasure appends the first model metric with a unique key', () => {
    const one: Measure[] = [{ key: 'count', label: 'Count', agg: 'count' }];
    expect(addMeasure(one, model)).toEqual([
      { key: 'count', label: 'Count', agg: 'count' },
      { key: 'count-2', label: 'Count', agg: 'count' },
    ]);
  });

  it('addFormula references the first two aggregate measures', () => {
    const two: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'b', agg: 'count' }];
    const out = addFormula(two);
    expect(out[2]).toEqual({ key: 'ratio', label: 'Ratio', agg: 'count', derived: { numerator: 'a', denominator: 'b', scale: 100, decimals: 1 } });
  });

  it('updateMeasure patches one row', () => {
    const two: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'b', agg: 'count' }];
    expect(updateMeasure(two, 1, { label: 'B' })[1]).toEqual({ key: 'b', agg: 'count', label: 'B' });
  });

  it('removeMeasure clears a formula reference to the removed key', () => {
    const list: Measure[] = [
      { key: 'a', agg: 'count' },
      { key: 'b', agg: 'count' },
      { key: 'r', agg: 'count', derived: { numerator: 'a', denominator: 'b', scale: 100, decimals: 1 } },
    ];
    const out = removeMeasure(list, 0); // remove 'a'
    expect(out.find((m) => m.key === 'r')!.derived).toEqual({ numerator: '', denominator: 'b', scale: 100, decimals: 1 });
  });

  it('aggregateMeasures excludes derived rows', () => {
    const list: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'r', agg: 'count', derived: { numerator: 'a', denominator: 'a', scale: 100, decimals: 1 } }];
    expect(aggregateMeasures(list).map((m) => m.key)).toEqual(['a']);
  });

  it('toBuilderMetrics returns a single metric for one aggregate row', () => {
    const one: Measure[] = [{ key: 'count', agg: 'count' }];
    expect(toBuilderMetrics(one)).toEqual({ metric: one[0], metrics: undefined });
  });

  it('toBuilderMetrics returns metric + metrics for multiple rows', () => {
    const list: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'b', agg: 'count' }];
    expect(toBuilderMetrics(list)).toEqual({ metric: list[0], metrics: list });
  });
});
