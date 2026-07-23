import { describe, it, expect } from 'vitest';
import { WidgetConfigSchema, WidgetQuerySchema, MetricSchema, DerivedRatioSchema, ConditionGroupSchema, ExprSchema, CustomColumnSchema, customColumnKind, UserJoinSchema } from './types';

describe('WidgetConfigSchema', () => {
  it('accepts a builder widget', () => {
    const ok = WidgetConfigSchema.safeParse({
      id: 'w1', type: 'kpi', title: 'Orders', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] },
    });
    expect(ok.success).toBe(true);
  });
  it('accepts a sql widget', () => {
    const ok = WidgetConfigSchema.safeParse({
      id: 'w2', type: 'table', title: 'Raw', refreshIntervalSec: 0, visual: {},
      query: { mode: 'sql', sql: 'select 1 as n' },
    });
    expect(ok.success).toBe(true);
  });
  it('strips grain from a builder breakdown (key-only)', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
      dimension: { key: 'status' }, breakdown: { key: 'ward', grain: 'month' }, filters: [],
    });
    expect(q).toMatchObject({ breakdown: { key: 'ward' } });
    expect((q as { breakdown?: Record<string, unknown> }).breakdown).not.toHaveProperty('grain');
  });
  it('rejects an unknown widget type', () => {
    const bad = WidgetConfigSchema.safeParse({
      id: 'w3', type: 'nope', title: 'x', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] },
    });
    expect(bad.success).toBe(false);
  });
});

describe('conditional & multi-metric schema (Slice A)', () => {
  it('accepts a metric with a conditional where predicate', () => {
    const m = MetricSchema.parse({
      key: 'r', label: 'R', agg: 'count',
      where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }],
    });
    expect(m.where?.[0]).toEqual({ dimension: 'interpretation_code', op: 'eq', value: 'R' });
  });

  it('accepts a builder query carrying multiple metrics', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      dimension: { key: 'code_text' }, filters: [],
    });
    if (q.mode !== 'builder') throw new Error('expected builder');
    expect(q.metrics?.map((m) => m.key)).toEqual(['tested', 'r']);
  });

  it('still accepts a legacy single-metric builder query with no metrics field', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
    });
    if (q.mode !== 'builder') throw new Error('expected builder');
    expect(q.metrics).toBeUndefined();
  });
});

describe('derived ratio metric schema (Slice B)', () => {
  it('accepts a metric carrying a derived ratio and applies scale/decimals defaults', () => {
    const m = MetricSchema.parse({
      key: 'percentR', agg: 'count',
      derived: { numerator: 'r', denominator: 'tested' },
    });
    expect(m.derived).toEqual({ numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 });
  });

  it('parses an explicit scale/decimals', () => {
    const d = DerivedRatioSchema.parse({ numerator: 'a', denominator: 'b', scale: 1, decimals: 2 });
    expect(d).toEqual({ numerator: 'a', denominator: 'b', scale: 1, decimals: 2 });
  });

  it('still accepts a plain aggregate metric with no derived field', () => {
    const m = MetricSchema.parse({ key: 'tested', agg: 'count' });
    expect(m.derived).toBeUndefined();
  });
});

describe('ConditionGroup (nested filter tree)', () => {
  const tree = {
    kind: 'group', combinator: 'and',
    children: [
      { kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' },
      { kind: 'group', combinator: 'or', children: [
        { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Blood culture' },
        { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Urine culture' },
      ] },
    ],
  };

  it('parses an arbitrarily nested AND/OR tree', () => {
    const parsed = ConditionGroupSchema.parse(tree);
    expect(parsed.combinator).toBe('and');
    expect(parsed.children).toHaveLength(2);
  });

  it('accepts a builder query carrying a filterTree', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [], filterTree: tree });
    expect(q).toMatchObject({ mode: 'builder', filterTree: { combinator: 'and' } });
  });

  it('a builder query with no filterTree still parses (backward-compat)', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] });
    expect(q).not.toHaveProperty('filterTree');
  });

  it('rejects an unknown combinator', () => {
    expect(() => ConditionGroupSchema.parse({ kind: 'group', combinator: 'nand', children: [] })).toThrow();
  });
});

describe('DimensionRef.reference', () => {
  it('accepts an optional reference on the query dimension', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [], dimension: { key: 'age_band', reference: '{{param.asOf}}' } });
    expect(q).toMatchObject({ mode: 'builder', dimension: { key: 'age_band', reference: '{{param.asOf}}' } });
  });
  it('a dimension without reference still parses', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [], dimension: { key: 'gender' } });
    expect((q as { dimension?: { reference?: string } }).dimension).not.toHaveProperty('reference');
  });
});

describe('optional limit (top-N)', () => {
  it('accepts an optional positive-integer limit on a builder query', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' }, filters: [], limit: 15,
    });
    expect(q.mode === 'builder' && q.limit).toBe(15);
  });

  it('rejects a non-positive limit', () => {
    expect(() => WidgetQuerySchema.parse({
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' }, filters: [], limit: 0,
    })).toThrow();
  });

  it('validates a stored builder query with no limit (backward compat)', () => {
    const q = WidgetQuerySchema.parse({
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' }, filters: [],
    });
    expect(q.mode === 'builder' && q.limit).toBeUndefined();
  });
});

describe('builder adhocDimensions', () => {
  const base = { mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count' as const }, filters: [] };

  it('accepts a well-formed adhoc dimension', () => {
    const parsed = WidgetQuerySchema.parse({
      ...base,
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
    });
    expect(parsed.mode).toBe('builder');
    if (parsed.mode === 'builder') expect(parsed.adhocDimensions?.[0].column).toBe('sex');
  });

  it('rejects an adhoc dimension with an invalid kind', () => {
    expect(() => WidgetQuerySchema.parse({
      ...base,
      adhocDimensions: [{ key: 'x', label: 'X', join: 'jp', column: 'sex', kind: 'boolean' }],
    })).toThrow();
  });

  it('omits the field cleanly when absent', () => {
    const parsed = WidgetQuerySchema.parse(base);
    if (parsed.mode === 'builder') expect(parsed.adhocDimensions).toBeUndefined();
  });
});

describe('builder query without a measure', () => {
  it('parses a builder query that has no metric', () => {
    const parsed = WidgetQuerySchema.parse({ mode: 'builder', model: 'service_requests', filters: [] });
    expect(parsed.mode).toBe('builder');
    if (parsed.mode === 'builder') expect(parsed.metric).toBeUndefined();
  });

  it('still parses a builder query WITH a metric', () => {
    const parsed = WidgetQuerySchema.parse({ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] });
    if (parsed.mode === 'builder') expect(parsed.metric?.agg).toBe('count');
  });
});

describe('custom column schema', () => {
  it('accepts a concat expression of fields and literals', () => {
    const ok = ExprSchema.safeParse({ kind: 'concat', parts: [
      { type: 'field', dimension: 'status' }, { type: 'string', value: ' / ' }, { type: 'field', dimension: 'priority' },
    ] });
    expect(ok.success).toBe(true);
  });

  it('requires at least one concat part', () => {
    expect(ExprSchema.safeParse({ kind: 'concat', parts: [] }).success).toBe(false);
  });

  it('accepts a binary arithmetic expression', () => {
    const ok = ExprSchema.safeParse({ kind: 'arithmetic', op: '/', left: { type: 'field', dimension: 'a' }, right: { type: 'number', value: 1000 } });
    expect(ok.success).toBe(true);
  });

  it('rejects an unknown arithmetic operator', () => {
    expect(ExprSchema.safeParse({ kind: 'arithmetic', op: '^', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } }).success).toBe(false);
  });

  it('accepts a builder query carrying customColumns', () => {
    const ok = WidgetQuerySchema.safeParse({
      mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'full', label: 'Full', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }],
    });
    expect(ok.success).toBe(true);
  });

  it('customColumnKind derives string for concat and number for arithmetic', () => {
    expect(customColumnKind({ kind: 'concat', parts: [{ type: 'string', value: 'x' }] })).toBe('string');
    expect(customColumnKind({ kind: 'arithmetic', op: '+', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } })).toBe('number');
  });
});

describe('user joins schema', () => {
  it('accepts a userJoin', () => {
    expect(UserJoinSchema.safeParse({ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }).success).toBe(true);
  });
  it('accepts a builder query carrying userJoins', () => {
    const ok = WidgetQuerySchema.safeParse({
      mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id' }],
    });
    expect(ok.success).toBe(true);
  });
});
