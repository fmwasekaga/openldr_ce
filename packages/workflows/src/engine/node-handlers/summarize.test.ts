import { describe, it, expect } from 'vitest';
import { summarizeHandler } from './summarize';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'sm1', type: 'action', data: { action: 'summarize', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('summarizeHandler', () => {
  it('counts all items when operation=count, no group', async () => {
    const result = await summarizeHandler(node({ operation: 'count' }), ctx(), [{ json: {} }, { json: {} }]);
    expect(result).toEqual([{ json: { count: 2 } }]);
  });
  it('sums a field grouped by another field', async () => {
    const result = await summarizeHandler(
      node({ groupBy: 'g', field: 'v', operation: 'sum' }),
      ctx(),
      [{ json: { g: 'a', v: 1 } }, { json: { g: 'a', v: 2 } }, { json: { g: 'b', v: 5 } }],
    );
    expect(result).toEqual([{ json: { g: 'a', sum_v: 3 } }, { json: { g: 'b', sum_v: 5 } }]);
  });
  it('computes avg of a field', async () => {
    const result = await summarizeHandler(node({ field: 'v', operation: 'avg' }), ctx(), [{ json: { v: 2 } }, { json: { v: 4 } }]);
    expect(result).toEqual([{ json: { avg_v: 3 } }]);
  });
  it('computes min of a field', async () => {
    const result = await summarizeHandler(node({ field: 'v', operation: 'min' }), ctx(), [{ json: { v: 3 } }, { json: { v: 1 } }, { json: { v: 2 } }]);
    expect(result).toEqual([{ json: { min_v: 1 } }]);
  });
  it('computes max of a field', async () => {
    const result = await summarizeHandler(node({ field: 'v', operation: 'max' }), ctx(), [{ json: { v: 3 } }, { json: { v: 1 } }, { json: { v: 2 } }]);
    expect(result).toEqual([{ json: { max_v: 3 } }]);
  });
  it('returns 0 when no values are numeric', async () => {
    const result = await summarizeHandler(node({ field: 'v', operation: 'sum' }), ctx(), [{ json: { v: 'x' } }, { json: { v: 'y' } }]);
    expect(result).toEqual([{ json: { sum_v: 0 } }]);
  });
});
