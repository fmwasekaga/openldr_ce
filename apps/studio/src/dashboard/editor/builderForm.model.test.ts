import { describe, it, expect } from 'vitest';
import { setModelPatch, setMetricPatch, setDimensionPatch, setGrainPatch, setBreakdownPatch, setFiltersPatch, setLimitPatch, setFilterTreePatch, buildSaveQuery, shouldRestoreEjected, measuresOf, setMeasuresPatch, type BuilderQuery } from './builderForm.model';
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

  it('setLimitPatch sets a positive integer limit', () => {
    expect(setLimitPatch(base, 10)).toEqual({ ...base, limit: 10 });
  });

  it('setLimitPatch clears the limit for undefined / 0 / negative', () => {
    const withLimit = { ...base, limit: 10 };
    expect(setLimitPatch(withLimit, undefined)).toEqual(base);
    expect(setLimitPatch(withLimit, 0)).toEqual(base);
    expect(setLimitPatch(withLimit, -5)).toEqual(base);
  });

  it('setLimitPatch clears the limit for a fractional value in (0,1) and for NaN', () => {
    const withLimit = { ...base, limit: 10 };
    expect(setLimitPatch(withLimit, 0.5)).toEqual(base);
    expect(setLimitPatch(withLimit, NaN)).toEqual(base);
  });

  it('setFilterTreePatch sets the tree and clears the flat filters', () => {
    const tree = { kind: 'group' as const, combinator: 'and' as const, children: [] };
    expect(setFilterTreePatch(base, tree)).toEqual({ ...base, filterTree: tree, filters: [] });
  });

  it('setFilterTreePatch clears the tree for undefined', () => {
    const withTree = { ...base, filterTree: { kind: 'group' as const, combinator: 'and' as const, children: [] } };
    expect(setFilterTreePatch(withTree, undefined)).toEqual({ ...base, filters: base.filters });
  });

  it('measuresOf returns the single metric as a one-item list', () => {
    expect(measuresOf(base)).toEqual([base.metric]);
  });

  it('setMeasuresPatch maps one row to metric, clearing metrics', () => {
    const out = setMeasuresPatch({ ...base, metrics: [base.metric, base.metric] }, [base.metric]);
    expect(out.metric).toEqual(base.metric);
    expect(out.metrics).toBeUndefined();
  });

  it('setMeasuresPatch maps multiple rows to metric + metrics', () => {
    const a = { key: 'a', agg: 'count' as const };
    const b = { key: 'b', agg: 'count' as const };
    const out = setMeasuresPatch(base, [a, b]);
    expect(out.metric).toEqual(a);
    expect(out.metrics).toEqual([a, b]);
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

  describe('shouldRestoreEjected', () => {
    // Builder -> SQL eject produces compiled SQL (quoted identifiers, inlined params) that
    // recognizeSql cannot parse, so a plain round-trip (SQL untouched since eject) must restore
    // the in-memory builderQuery losslessly rather than fail recognition.
    it('returns true when in sql mode and the SQL is unchanged since eject', () => {
      const ejected = 'select "status" as "label" from "lab_requests"';
      expect(shouldRestoreEjected('sql', ejected, ejected)).toBe(true);
    });

    // Anti-silent-loss case: the user hand-edited the ejected SQL, so the stale in-memory
    // builderQuery must NOT be restored — the caller must fall through to recognizeSql instead of
    // silently discarding the edit.
    it('returns false when the SQL has been edited since eject', () => {
      const ejected = 'select "status" as "label" from "lab_requests"';
      const edited = 'select "status" as "label" from "lab_requests" where "status" = \'X\'';
      expect(shouldRestoreEjected('sql', edited, ejected)).toBe(false);
    });

    it('returns false when there has been no eject in this session', () => {
      expect(shouldRestoreEjected('sql', 'select 1', undefined)).toBe(false);
    });

    it('returns false when in builder mode', () => {
      const ejected = 'select "status" as "label" from "lab_requests"';
      expect(shouldRestoreEjected('builder', ejected, ejected)).toBe(false);
    });
  });
});
