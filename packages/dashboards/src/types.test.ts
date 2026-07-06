import { describe, it, expect } from 'vitest';
import { WidgetConfigSchema, WidgetQuerySchema, MetricSchema, DerivedRatioSchema, ConditionGroupSchema } from './types';

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
