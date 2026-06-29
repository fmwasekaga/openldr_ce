import { describe, it, expect } from 'vitest';
import { mergeHandler } from './merge';
import { createContext } from '../execution-context';

const node = (mode: string, preferredBranch?: number) => ({
  id: 'm1',
  type: 'merge',
  data: { config: { mode, ...(preferredBranch !== undefined ? { preferredBranch } : {}) } },
});

function ctx(sourceA: string, sourceB: string) {
  const c = createContext(undefined, () => {}, [
    { id: 'e1', source: sourceA, target: 'm1' },
    { id: 'e2', source: sourceB, target: 'm1' },
  ]);
  c.nodeOutputs[sourceA] = [{ json: { from: 'a', val: 1 } }];
  c.nodeOutputs[sourceB] = [{ json: { from: 'b', val: 2 } }];
  return c;
}

describe('mergeHandler — append (default)', () => {
  it('concatenates items from all incoming branches', async () => {
    const result = await mergeHandler(node('append'), ctx('src1', 'src2'), []);
    expect(result).toEqual([
      { json: { from: 'a', val: 1 } },
      { json: { from: 'b', val: 2 } },
    ]);
  });
});

describe('mergeHandler — combine', () => {
  it('merges all items json into one object', async () => {
    const result = await mergeHandler(node('combine'), ctx('src1', 'src2'), []);
    expect(result).toEqual([{ json: { from: 'b', val: 2 } }]);
  });

  it('later branches overwrite earlier keys', async () => {
    const c = createContext(undefined, () => {}, [
      { id: 'e1', source: 'n1', target: 'm1' },
      { id: 'e2', source: 'n2', target: 'm1' },
    ]);
    c.nodeOutputs['n1'] = [{ json: { x: 1, shared: 'first' } }];
    c.nodeOutputs['n2'] = [{ json: { y: 2, shared: 'second' } }];
    const result = await mergeHandler(node('combine'), c, []);
    expect(result).toEqual([{ json: { x: 1, shared: 'second', y: 2 } }]);
  });
});

describe('mergeHandler — chooseBranch', () => {
  it('returns items from the preferred branch index', async () => {
    const result = await mergeHandler(node('chooseBranch', 1), ctx('src1', 'src2'), []);
    expect(result).toEqual([{ json: { from: 'b', val: 2 } }]);
  });

  it('defaults to index 0 if preferredBranch is out of range', async () => {
    const result = await mergeHandler(node('chooseBranch', 99), ctx('src1', 'src2'), []);
    expect(result).toEqual([{ json: { from: 'a', val: 1 } }]);
  });
});

describe('mergeHandler — missing outputs', () => {
  it('ignores edges whose source has no recorded output yet', async () => {
    const c = createContext(undefined, () => {}, [
      { id: 'e1', source: 'ran', target: 'm1' },
      { id: 'e2', source: 'not-ran', target: 'm1' },
    ]);
    c.nodeOutputs['ran'] = [{ json: { ok: true } }];
    // 'not-ran' has no entry in nodeOutputs
    const result = await mergeHandler(node('append'), c, []);
    expect(result).toEqual([{ json: { ok: true } }]);
  });
});
