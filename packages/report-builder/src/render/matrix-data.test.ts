import { describe, it, expect } from 'vitest';
import { matrixOpts, resultToMatrix, pivotTableResult } from './matrix-data';

const breakdownQuery = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: [] };
const longResult = { columns: [{ key: 'label', label: 'Analyte', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [
  { label: 'Amp', series: 'R', value: 5 }, { label: 'Amp', series: 'S', value: 3 }, { label: 'Cip', series: 'R', value: 2 },
] };

describe('matrixOpts', () => {
  it('returns pivot opts for a builder query with a breakdown', () => {
    expect(matrixOpts(breakdownQuery as any)).toEqual({ rowKey: 'label', colKey: 'series', valueKey: 'value' });
  });
  it('returns null without a breakdown', () => {
    expect(matrixOpts({ mode: 'builder', model: 'x', metric: { key: 'count', agg: 'count' }, filters: [] } as any)).toBeNull();
    expect(matrixOpts(undefined)).toBeNull();
  });
});

describe('resultToMatrix', () => {
  it('pivots long rows into a wide matrix with 0-fill, preserving the row-dim label', () => {
    const m = resultToMatrix(longResult, matrixOpts(breakdownQuery as any)!);
    expect(m.columns.map((c) => c.key)).toEqual(['label', 'R', 'S']);
    expect(m.columns[0].label).toBe('Analyte');
    expect(m.columns[1].kind).toBe('number');
    expect(m.rows).toEqual([{ label: 'Amp', R: 5, S: 3 }, { label: 'Cip', R: 2, S: 0 }]);
  });
});

describe('pivotTableResult', () => {
  it('pivots when the source has a breakdown', () => {
    expect(pivotTableResult(breakdownQuery, longResult)!.columns.map((c) => c.key)).toEqual(['label', 'R', 'S']); // ! — pivotTableResult returns PivotResult | undefined
  });
  it('returns the raw result for a non-breakdown / primary / undefined source', () => {
    expect(pivotTableResult({ mode: 'builder', model: 'x', metric: { key: 'count', agg: 'count' }, filters: [] }, longResult)).toBe(longResult);
    expect(pivotTableResult('primary', longResult)).toBe(longResult);
    expect(pivotTableResult(breakdownQuery, undefined)).toBeUndefined();
  });
});
