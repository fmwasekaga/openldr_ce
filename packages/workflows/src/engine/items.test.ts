import { describe, it, expect } from 'vitest';
import { toItems, fromItems, rowsToItems, type WorkflowItem } from './items';

describe('toItems', () => {
  it('passes a WorkflowItem[] through unchanged', () => {
    const items: WorkflowItem[] = [{ json: { a: 1 } }, { json: { b: 2 } }];
    expect(toItems(items)).toBe(items);
  });
  it('maps {columns,rows} to one item per row', () => {
    const out = toItems({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }] });
    expect(out).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('maps {rows} to one item per row', () => {
    expect(toItems({ rows: [{ a: 1 }] })).toEqual([{ json: { a: 1 } }]);
  });
  it('unwraps a plugin-node {items,meta} envelope to its items', () => {
    expect(toItems({ items: [{ json: { a: 1 } }], meta: { count: 1 } })).toEqual([{ json: { a: 1 } }]);
  });
  it('does NOT unwrap {items} when the items are not WorkflowItems', () => {
    expect(toItems({ items: [{ a: 1 }] })).toEqual([{ json: { items: [{ a: 1 }] } }]);
  });
  it('maps a plain object-array to one item per object', () => {
    expect(toItems([{ a: 1 }, { a: 2 }])).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('returns [] for undefined/null', () => {
    expect(toItems(undefined)).toEqual([]);
    expect(toItems(null)).toEqual([]);
  });
  it('wraps a scalar as a single item', () => {
    expect(toItems(42)).toEqual([{ json: { value: 42 } }]);
  });
  it('wraps a bare object as a single item', () => {
    expect(toItems({ a: 1 })).toEqual([{ json: { a: 1 } }]);
  });
});

describe('fromItems', () => {
  it('produces rows + a column union from item json', () => {
    const out = fromItems([{ json: { a: 1 } }, { json: { a: 2, b: 3 } }]);
    expect(out.rows).toEqual([{ a: 1 }, { a: 2, b: 3 }]);
    expect(out.columns).toEqual([{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }]);
  });
});

describe('rowsToItems', () => {
  it('wraps each row as an item', () => {
    expect(rowsToItems([{ a: 1 }, { a: 2 }])).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('returns [] for an empty row list', () => {
    expect(rowsToItems([])).toEqual([]);
  });
});
