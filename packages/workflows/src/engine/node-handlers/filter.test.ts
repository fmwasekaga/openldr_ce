import { describe, it, expect } from 'vitest';
import { filterHandler } from './filter';
import { createContext } from '../execution-context';

const node = (condition: string) => ({ id: 'f1', type: 'filter', data: { condition } });

function ctx() {
  return createContext(undefined, () => {});
}

describe('filterHandler', () => {
  it('returns only items that pass the condition', async () => {
    const c = ctx();
    const input = [{ json: { keep: true } }, { json: { keep: false } }];
    const result = await filterHandler(node('$json.keep === true'), c, input);
    expect(result).toEqual([{ json: { keep: true } }]);
    expect(c.branches['f1']).toBe('true');
  });

  it('sets ctx.branches to "false" when all items are filtered out', async () => {
    const c = ctx();
    const input = [{ json: { keep: false } }, { json: { keep: false } }];
    const result = await filterHandler(node('$json.keep === true'), c, input);
    expect(result).toEqual([]);
    expect(c.branches['f1']).toBe('false');
  });

  it('sets ctx.branches to "true" when at least one item passes', async () => {
    const c = ctx();
    const input = [{ json: { v: 5 } }, { json: { v: 15 } }];
    const result = await filterHandler(node('$json.v > 10'), c, input);
    expect(result).toEqual([{ json: { v: 15 } }]);
    expect(c.branches['f1']).toBe('true');
  });

  it('sets ctx.branches to "false" for empty condition', async () => {
    const c = ctx();
    const input = [{ json: { x: 1 } }];
    const result = await filterHandler(node(''), c, input);
    expect(result).toEqual([]);
    expect(c.branches['f1']).toBe('false');
  });

  it('handles empty input — sets branches to "false"', async () => {
    const c = ctx();
    const result = await filterHandler(node('$json.keep === true'), c, []);
    expect(result).toEqual([]);
    expect(c.branches['f1']).toBe('false');
  });

  it('throws on an invalid condition expression', async () => {
    const c = ctx();
    await expect(filterHandler(node(')(invalid js'), c, [{ json: {} }])).rejects.toThrow(/Filter condition failed/);
  });

  it('evaluates condition per-item independently', async () => {
    const c = ctx();
    const input = [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];
    const result = await filterHandler(node('$json.n % 2 === 1'), c, input);
    expect(result).toEqual([{ json: { n: 1 } }, { json: { n: 3 } }]);
    expect(c.branches['f1']).toBe('true');
  });
});
