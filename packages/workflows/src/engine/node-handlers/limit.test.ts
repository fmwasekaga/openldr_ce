import { describe, it, expect } from 'vitest';
import { limitHandler } from './limit';
import { createContext } from '../execution-context';

const node = (maxItems: number, keep = 'first') => ({ id: 'l1', type: 'action', data: { action: 'limit', config: { maxItems, keep } } });
const ctx = () => createContext(undefined, () => {});
const items = [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];

describe('limitHandler', () => {
  it('keeps the first N items', async () => {
    const result = await limitHandler(node(2), ctx(), items);
    expect(result.map((i) => i.json.n)).toEqual([1, 2]);
  });
  it('keeps the last N items', async () => {
    const result = await limitHandler(node(2, 'last'), ctx(), items);
    expect(result.map((i) => i.json.n)).toEqual([2, 3]);
  });
  it('returns all items when max is 0 or unset', async () => {
    const result = await limitHandler(node(0), ctx(), items);
    expect(result).toEqual(items);
  });
});
