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

  it('addMeasure carries the model metric column when the first metric has one', () => {
    const avgFirst = { metrics: [{ key: 'avg_value', label: 'Avg', agg: 'avg', column: 'numeric_value' }] };
    expect(addMeasure([], avgFirst)).toEqual([{ key: 'avg_value', label: 'Avg', agg: 'avg', column: 'numeric_value' }]);
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

  it('toBuilderMetrics keeps a lone formula row wide (never collapses a derived row to a scalar metric)', () => {
    // Degenerate but reachable: every aggregate deleted, leaving one formula row. Collapsing it to the
    // scalar `metric` would render its placeholder agg (COUNT(*)) mislabeled as the ratio — so it must
    // stay in the wide metrics[] path.
    const lone: Measure[] = [{ key: 'r', agg: 'count', derived: { numerator: 'a', denominator: 'b', scale: 100, decimals: 1 } }];
    expect(toBuilderMetrics(lone)).toEqual({ metric: lone[0], metrics: lone });
  });
});

describe('toBuilderMetrics with no measures', () => {
  it('yields undefined metric and metrics for an empty list', () => {
    const { metric, metrics } = toBuilderMetrics([]);
    expect(metric).toBeUndefined();
    expect(metrics).toBeUndefined();
  });
});
