import { describe, it, expect } from 'vitest';
import { resolveQueryParams } from './run-template';

describe('resolveQueryParams', () => {
  it('substitutes a param token in a builder filter value', () => {
    const q = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'code_text', op: 'eq', value: '{{param.analyte}}' }] } as any;
    const out = resolveQueryParams(q, { analyte: 'Glucose' }) as any;
    expect(out.filters[0].value).toBe('Glucose');
    // original is not mutated
    expect(q.filters[0].value).toBe('{{param.analyte}}');
  });

  it('substitutes tokens embedded in a larger string', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'd', op: 'contains', value: 'x-{{param.a}}-y' }] } as any;
    const out = resolveQueryParams(q, { a: 'Z' }) as any;
    expect(out.filters[0].value).toBe('x-Z-y');
  });

  it('leaves unknown tokens as empty string', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'd', op: 'eq', value: '{{param.missing}}' }] } as any;
    const out = resolveQueryParams(q, {}) as any;
    expect(out.filters[0].value).toBe('');
  });

  it('substitutes into sql-mode values', () => {
    const q = { mode: 'sql', sql: 'select 1', values: { fac: '{{param.facility}}', n: 5 } } as any;
    const out = resolveQueryParams(q, { facility: 'Ndola' }) as any;
    expect(out.values.fac).toBe('Ndola');
    expect(out.values.n).toBe(5);
  });

  it('passes a query with no tokens through unchanged (structurally)', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } as any;
    expect(resolveQueryParams(q, { a: 'b' })).toEqual(q);
  });
});
