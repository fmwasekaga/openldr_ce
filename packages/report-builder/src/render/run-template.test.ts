import { describe, it, expect } from 'vitest';
import { resolveQueryParams, runTemplate } from './run-template';
import { createEmptyTemplate } from '../helpers';

function result(rows: any[]): any {
  return { columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }],
    rows, chart: { type: 'bar', x: 'label', y: 'value' }, meta: { generatedAt: 'now', rowCount: rows.length } };
}

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

  it('drops a filter whose unknown token resolves to an empty string (Slice G)', () => {
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'd', op: 'eq', value: '{{param.missing}}' }] } as any;
    const out = resolveQueryParams(q, {}) as any;
    expect(out.filters).toEqual([]);
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

describe('resolveQueryParams blank-filter drop (Slice G)', () => {
  const base = {
    mode: 'builder' as const, model: 'observations',
    metric: { key: 'tested', agg: 'count' as const },
    filters: [
      { dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] },
      { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
      { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
    ],
  };

  it('drops date filters when the range is unset (keeps the literal filter)', () => {
    const out = resolveQueryParams(base as never, {});
    if (out.mode !== 'builder') throw new Error('expected builder');
    expect(out.filters).toEqual([{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }]);
  });

  it('keeps date filters with substituted values when the range is set', () => {
    const out = resolveQueryParams(base as never, { from: '2024-01-01', to: '2024-12-31' });
    if (out.mode !== 'builder') throw new Error('expected builder');
    expect(out.filters).toContainEqual({ dimension: 'effective_date_time', op: 'gte', value: '2024-01-01' });
    expect(out.filters).toContainEqual({ dimension: 'effective_date_time', op: 'lte', value: '2024-12-31' });
  });
});

describe('resolveQueryParams filterTree', () => {
  const base = { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const }, filters: [] };

  it('substitutes a bound param inside a rule', () => {
    const q = { ...base, filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' } ] } };
    const r = resolveQueryParams(q as any, { from: '2026-01-01' }) as any;
    expect(r.filterTree.children[0].value).toBe('2026-01-01');
  });

  it('drops a rule whose param resolves blank, then prunes the emptied group', () => {
    const q = { ...base, filterTree: { kind: 'group', combinator: 'and', children: [
      { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Blood culture' },
      { kind: 'group', combinator: 'or', children: [ { kind: 'rule', dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' } ] },
    ] } };
    const r = resolveQueryParams(q as any, {}) as any; // from is unset
    expect(r.filterTree.children).toHaveLength(1);              // the empty OR subgroup pruned
    expect(r.filterTree.children[0].kind).toBe('rule');
  });

  it('deletes filterTree entirely when the whole tree prunes to empty', () => {
    const q = { ...base, filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' } ] } };
    const r = resolveQueryParams(q as any, {}) as any;
    expect(r.filterTree).toBeUndefined();
  });
});

describe('runTemplate', () => {
  it('resolves the primary dataset and each data block, keyed by row:cell', async () => {
    const t = createEmptyTemplate('rt', 'R');
    t.dataset = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] } as any;
    t.rows = [{ id: 'r0', cells: [
      { colSpan: 6, block: { kind: 'kpi', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, label: 'K' } as any },
      { colSpan: 6, block: { kind: 'table', source: 'primary', columns: [] } as any },
    ] }];
    const calls: any[] = [];
    const queryFn = async (q: any) => { calls.push(q); return result([{ label: 'a', value: 1 }]); };
    const resolved = await runTemplate(t, {}, queryFn);
    expect(resolved.primary?.result?.rows.length).toBe(1);
    expect(resolved.cells['0:0'].result?.rows.length).toBe(1); // kpi block
    expect(resolved.cells['0:1']).toBeUndefined();             // table source:'primary' uses primary, not its own query
    expect(calls.length).toBe(2); // primary + kpi
  });

  it('dedups identical resolved queries into one call', async () => {
    const t = createEmptyTemplate('rt', 'R');
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] };
    t.rows = [{ id: 'r0', cells: [
      { colSpan: 6, block: { kind: 'kpi', query: q, label: 'A' } as any },
      { colSpan: 6, block: { kind: 'kpi', query: q, label: 'B' } as any },
    ] }];
    let n = 0;
    const resolved = await runTemplate(t, {}, async () => { n++; return result([{ label: 'a', value: 1 }]); });
    expect(n).toBe(1);
    expect(resolved.cells['0:0'].result).toBe(resolved.cells['0:1'].result);
  });

  it('isolates a failing block query as an error, not a throw', async () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r0', cells: [
      { colSpan: 12, block: { kind: 'chart', query: { mode: 'builder', model: 'boom', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any },
    ] }];
    const resolved = await runTemplate(t, {}, async () => { throw new Error('bad query'); });
    expect(resolved.cells['0:0'].error).toMatch(/bad query/);
    expect(resolved.cells['0:0'].result).toBeUndefined();
  });
});
