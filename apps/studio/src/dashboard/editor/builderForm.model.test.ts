import { describe, it, expect } from 'vitest';
import { setModelPatch, setMetricPatch, setDimensionPatch, setGrainPatch, setBreakdownPatch, setFiltersPatch, buildSaveQuery, type BuilderQuery } from './builderForm.model';
import type { QueryModel, WidgetVariableDef } from '../../api';

const models: QueryModel[] = [
  {
    id: 'service_requests',
    label: 'Test Orders',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'collected', label: 'Collected', column: 'collected', kind: 'date', dateGrain: ['day', 'month'] },
    ],
    metrics: [
      { key: 'count', label: 'Count', agg: 'count' },
      { key: 'sum_x', label: 'Sum X', agg: 'sum', column: 'x' },
    ],
  },
  {
    id: 'observations',
    label: 'Results',
    dimensions: [{ key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' }],
    metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  },
];

const base: BuilderQuery = {
  mode: 'builder',
  model: 'service_requests',
  metric: { key: 'count', label: 'Count', agg: 'count' },
  dimension: { key: 'status' },
  breakdown: { key: 'status' },
  filters: [{ dimension: 'status', op: 'eq', value: 'x' }],
};

describe('builderForm.model', () => {
  it('setModelPatch switches model and resets metric/dimension/breakdown/filters', () => {
    expect(setModelPatch(models, base, 'observations')).toEqual({
      mode: 'builder',
      model: 'observations',
      metric: { key: 'count', label: 'Count', agg: 'count' },
      metrics: undefined,
      dimension: undefined,
      breakdown: undefined,
      filters: [],
      filterTree: undefined,
    });
  });

  it('setModelPatch is a no-op for an unknown model id', () => {
    expect(setModelPatch(models, base, 'nope')).toEqual(base);
  });

  it('setMetricPatch swaps in the chosen metric definition', () => {
    const model = models[0];
    expect(setMetricPatch(model, base, 'sum_x')).toEqual({ ...base, metric: { key: 'sum_x', label: 'Sum X', agg: 'sum', column: 'x' } });
  });

  it('setMetricPatch is a no-op for an unknown metric key', () => {
    const model = models[0];
    expect(setMetricPatch(model, base, 'nope')).toEqual(base);
  });

  it('setDimensionPatch sets the group-by dimension', () => {
    expect(setDimensionPatch(base, 'status')).toEqual({ ...base, dimension: { key: 'status' } });
  });

  it('setDimensionPatch clears the dimension for an empty key', () => {
    expect(setDimensionPatch(base, '')).toEqual({ ...base, dimension: undefined });
  });

  it('setGrainPatch sets grain on the existing group-by dimension', () => {
    const withDate = { ...base, dimension: { key: 'collected' } };
    expect(setGrainPatch(withDate, 'day')).toEqual({ ...withDate, dimension: { key: 'collected', grain: 'day' } });
  });

  it('setGrainPatch is a no-op when there is no group-by dimension', () => {
    const noDim = { ...base, dimension: undefined };
    expect(setGrainPatch(noDim, 'day')).toEqual(noDim);
  });

  it('setBreakdownPatch sets and clears the breakdown', () => {
    expect(setBreakdownPatch(base, 'status')).toEqual({ ...base, breakdown: { key: 'status' } });
    expect(setBreakdownPatch(base, '')).toEqual({ ...base, breakdown: undefined });
  });

  it('setFiltersPatch replaces the top-level filters list', () => {
    const next = [{ dimension: 'priority', op: 'eq', value: 'high' }];
    expect(setFiltersPatch(base, next)).toEqual({ ...base, filters: next });
  });

  describe('buildSaveQuery', () => {
    const bindings: Record<string, string> = { ward: 'filter-1' };
    const varDefs: Record<string, WidgetVariableDef> = { ward: { type: 'text', label: 'Ward' } };

    it('returns the builder query verbatim in builder mode, ignoring SQL state', () => {
      expect(buildSaveQuery('builder', base, 'select 1', bindings, varDefs)).toEqual(base);
    });

    it('returns a sql-mode query in sql mode, ignoring the builder state', () => {
      expect(buildSaveQuery('sql', base, 'select 1 as value', bindings, varDefs)).toEqual({
        mode: 'sql',
        sql: 'select 1 as value',
        variableBindings: bindings,
        variables: varDefs,
      });
    });
  });
});
