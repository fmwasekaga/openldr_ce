import { describe, it, expect } from 'vitest';
import { setModelPatch, setMetricPatch, setDimensionPatch, setGrainPatch, setBreakdownPatch, setFiltersPatch, setLimitPatch, setFilterTreePatch, buildSaveQuery, shouldRestoreEjected, measuresOf, setMeasuresPatch, removeAdhocDimensionPatch, adhocKey, makeAdhocDimension, setRelationshipColumnsPatch, removeRelationshipPatch, addUserJoinPatch, removeUserJoinPatch, setUserJoinKeysPatch, uniqueJoinId, type BuilderQuery } from './builderForm.model';
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
    tableColumns: [],
  },
  {
    id: 'observations',
    label: 'Results',
    dimensions: [{ key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' }],
    metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
    tableColumns: [],
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

  describe('measuresOf with no measure', () => {
    it('returns [] when the query has neither metric nor metrics', () => {
      expect(measuresOf({ mode: 'builder', model: 'm', filters: [] } as never)).toEqual([]);
    });
    it('returns the single metric as a 1-element list when present', () => {
      expect(measuresOf({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } as never)).toHaveLength(1);
    });
  });

  it('setMeasuresPatch maps one row to metric, clearing metrics', () => {
    const out = setMeasuresPatch({ ...base, metrics: [base.metric!, base.metric!] }, [base.metric!]);
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

const baseQ = () => ({
  mode: 'builder' as const, model: 'service_requests',
  metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [],
});
const adhoc = { key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' as const };

describe('adhoc dimension patches', () => {
  it('removes an adhoc dimension and clears any group-by that referenced it', () => {
    let q: BuilderQuery = { ...baseQ(), adhocDimensions: [adhoc] };
    q = setDimensionPatch(q, 'jp__sex');
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect(next.adhocDimensions).toEqual([]);
    expect(next.dimension).toBeUndefined();       // orphan cleanup
  });

  it('removes an adhoc dimension and clears any breakdown that referenced it', () => {
    let q: BuilderQuery = { ...baseQ(), adhocDimensions: [adhoc] };
    q = { ...q, breakdown: { key: 'jp__sex' } };
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect(next.breakdown).toBeUndefined();
  });

  it('removes an adhoc dimension and clears orphaned flat filters that referenced it', () => {
    let q: BuilderQuery = { ...baseQ(), adhocDimensions: [adhoc] };
    q = { ...q, filters: [{ dimension: 'jp__sex', op: 'eq', value: 'male' }, { dimension: 'status', op: 'eq', value: 'x' }] };
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect(next.filters).toEqual([{ dimension: 'status', op: 'eq', value: 'x' }]);
  });

  it('removes an adhoc dimension and prunes orphaned filterTree rules that referenced it', () => {
    let q: BuilderQuery = { ...baseQ(), adhocDimensions: [adhoc] };
    q = {
      ...q,
      filterTree: {
        kind: 'group' as const,
        combinator: 'and' as const,
        children: [
          { kind: 'rule' as const, dimension: 'jp__sex', op: 'eq', value: 'male' },
          { kind: 'rule' as const, dimension: 'status', op: 'eq', value: 'x' },
        ],
      },
    };
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect(next.filterTree).toEqual({
      kind: 'group',
      combinator: 'and',
      children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'x' }],
    });
  });

  it('drops the adhocDimensions field when the list becomes empty', () => {
    const q: BuilderQuery = { ...baseQ(), adhocDimensions: [adhoc] };
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect('adhocDimensions' in next ? next.adhocDimensions?.length : 0).toBe(0);
  });

  it('clears adhoc dimensions when the source model changes', () => {
    const models = [
      { id: 'service_requests', label: 'Test Orders', dimensions: [], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
      { id: 'observations', label: 'Results', dimensions: [], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
    ] as never;
    const q: BuilderQuery = { ...baseQ(), adhocDimensions: [adhoc] };
    const next = setModelPatch(models, q, 'observations');
    expect(next.adhocDimensions).toBeUndefined();
  });

  it('clears custom columns when the source model changes', () => {
    const models = [
      { id: 'service_requests', label: 'Test Orders', dimensions: [], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
      { id: 'observations', label: 'Results', dimensions: [], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
    ] as never;
    const q = { ...baseQ(), customColumns: [{ key: 'sp', label: 'S/P', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }] } as never;
    const next = setModelPatch(models, q, 'observations');
    expect(next.customColumns).toBeUndefined();
  });
});

describe('join relationship patches', () => {
  const q0 = () => ({ mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] });

  it('adhocKey builds a stable join__column key', () => {
    expect(adhocKey('js', 'status')).toBe('js__status');
  });

  it('makeAdhocDimension derives key/label/kind for a column', () => {
    expect(makeAdhocDimension('js', 'Specimen', 'received_time')).toEqual({
      key: 'js__received_time', label: 'Specimen → Received Time', join: 'js', column: 'received_time', kind: 'date',
    });
  });

  it('setRelationshipColumnsPatch adds the selected columns for one relationship', () => {
    const next = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status', 'origin']);
    expect(next.adhocDimensions).toEqual([
      { key: 'js__status', label: 'Specimen → Status', join: 'js', column: 'status', kind: 'string' },
      { key: 'js__origin', label: 'Specimen → Origin', join: 'js', column: 'origin', kind: 'string' },
    ]);
  });

  it('setRelationshipColumnsPatch leaves other relationships untouched', () => {
    let q = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status']);
    q = setRelationshipColumnsPatch(q, 'jr', 'Request', ['priority']);
    expect((q.adhocDimensions ?? []).map((d) => d.key)).toEqual(['js__status', 'jr__priority']);
  });

  it('setRelationshipColumnsPatch drops a deselected column and orphan-cleans its group-by', () => {
    let q = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status', 'origin']);
    q = setDimensionPatch(q, 'js__origin');
    const next = setRelationshipColumnsPatch(q, 'js', 'Specimen', ['status']); // drop origin
    expect((next.adhocDimensions ?? []).map((d) => d.key)).toEqual(['js__status']);
    expect(next.dimension).toBeUndefined(); // orphan cleanup
  });

  it('removeRelationshipPatch removes every column for the alias and orphan-cleans references', () => {
    let q = setRelationshipColumnsPatch(q0(), 'js', 'Specimen', ['status']);
    q = setRelationshipColumnsPatch(q, 'jr', 'Request', ['priority']);
    q = setDimensionPatch(q, 'js__status');
    q = { ...q, breakdown: { key: 'jr__priority' } };
    const next = removeRelationshipPatch(q, 'js');
    expect((next.adhocDimensions ?? []).map((d) => d.key)).toEqual(['jr__priority']); // jr kept
    expect(next.dimension).toBeUndefined();                 // js group-by cleaned
    expect(next.breakdown).toEqual({ key: 'jr__priority' }); // jr breakdown kept
  });
});

describe('user join patches', () => {
  const q0 = () => ({ mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] });

  it('addUserJoinPatch appends a user join', () => {
    const next = addUserJoinPatch(q0(), { id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' });
    expect(next.userJoins).toEqual([{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }]);
  });

  it('uniqueJoinId avoids collisions', () => {
    expect(uniqueJoinId([])).toBe('u1');
    expect(uniqueJoinId([{ id: 'u1' }])).toBe('u2');
  });

  it('setUserJoinKeysPatch updates one join\'s keys', () => {
    let q = addUserJoinPatch(q0(), { id: 'u1', table: 'patients', left: 'patient_id', right: 'id' });
    q = setUserJoinKeysPatch(q, 'u1', { right: 'patient_guid' });
    expect(q.userJoins![0].right).toBe('patient_guid');
  });

  it('removeUserJoinPatch removes the join, its adhoc columns, and orphan-cleans references', () => {
    let q: any = addUserJoinPatch(q0(), { id: 'u1', table: 'patients', left: 'patient_id', right: 'id' });
    q = { ...q, adhocDimensions: [{ key: 'u1__sex', label: 'Sex', join: 'u1', column: 'sex', kind: 'string' }], dimension: { key: 'u1__sex' } };
    const next = removeUserJoinPatch(q, 'u1');
    expect(next.userJoins ?? []).toHaveLength(0);
    expect((next.adhocDimensions ?? []).some((d: any) => d.join === 'u1')).toBe(false);
    expect(next.dimension).toBeUndefined();
  });
});
