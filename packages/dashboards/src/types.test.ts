import { describe, it, expect } from 'vitest';
import { WidgetConfigSchema, WidgetQuerySchema } from './types';

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
