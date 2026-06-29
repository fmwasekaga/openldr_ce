import { describe, it, expect } from 'vitest';
import { ifHandler } from './if';
import { createContext } from '../execution-context';

const node = (condition: string) => ({ id: 'if1', type: 'if', data: { condition } });

function ctx() {
  return createContext(undefined, () => {});
}

describe('ifHandler', () => {
  it('sets ctx.branches to "true" when condition is truthy', async () => {
    const c = ctx();
    const input = [{ json: { n: 1 } }];
    const result = await ifHandler(node('$json.n > 0'), c, input);
    expect(c.branches['if1']).toBe('true');
    expect(result).toEqual(input);
  });

  it('sets ctx.branches to "false" when condition is falsy', async () => {
    const c = ctx();
    const input = [{ json: { n: -1 } }];
    const result = await ifHandler(node('$json.n > 0'), c, input);
    expect(c.branches['if1']).toBe('false');
    expect(result).toEqual(input);
  });

  it('sets ctx.branches to "false" for an empty condition', async () => {
    const c = ctx();
    const input = [{ json: { n: 1 } }];
    const result = await ifHandler(node(''), c, input);
    expect(c.branches['if1']).toBe('false');
    expect(result).toEqual(input);
  });

  it('passes input items through unchanged regardless of branch', async () => {
    const c = ctx();
    const input = [{ json: { x: 'a' } }, { json: { x: 'b' } }];
    const result = await ifHandler(node('true'), c, input);
    expect(result).toEqual(input);
    expect(c.branches['if1']).toBe('true');
  });

  it('exposes $json (first item) and $items in the condition sandbox', async () => {
    const c = ctx();
    const input = [{ json: { v: 10 } }, { json: { v: 20 } }];
    // $items.length === 2 is true
    await ifHandler(node('$items.length === 2'), c, input);
    expect(c.branches['if1']).toBe('true');
  });

  it('throws on an invalid condition expression', async () => {
    const c = ctx();
    await expect(ifHandler(node(')(invalid js'), c, [{ json: {} }])).rejects.toThrow(/Condition failed/);
  });

  it('works with empty input array', async () => {
    const c = ctx();
    const result = await ifHandler(node('true'), c, []);
    expect(c.branches['if1']).toBe('true');
    expect(result).toEqual([]);
  });
});
