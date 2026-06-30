import { describe, it, expect } from 'vitest';
import { renameKeysHandler } from './rename-keys';
import { createContext } from '../execution-context';

const node = (renames: Array<{ from: string; to: string }>) => ({ id: 'rk1', type: 'action', data: { action: 'rename-keys', config: { renames } } });
const ctx = () => createContext(undefined, () => {});

describe('renameKeysHandler', () => {
  it('renames matching keys, preserving others', async () => {
    const result = await renameKeysHandler(node([{ from: 'a', to: 'x' }]), ctx(), [{ json: { a: 1, b: 2 } }]);
    expect(result).toEqual([{ json: { x: 1, b: 2 } }]);
  });
  it('ignores renames whose source key is absent', async () => {
    const result = await renameKeysHandler(node([{ from: 'missing', to: 'x' }]), ctx(), [{ json: { a: 1 } }]);
    expect(result).toEqual([{ json: { a: 1 } }]);
  });
  it('skips incomplete rename pairs', async () => {
    const result = await renameKeysHandler(node([{ from: 'a', to: '' }]), ctx(), [{ json: { a: 1 } }]);
    expect(result).toEqual([{ json: { a: 1 } }]);
  });
  it('overwrites an existing target key', async () => {
    const result = await renameKeysHandler(node([{ from: 'a', to: 'b' }]), ctx(), [{ json: { a: 1, b: 2 } }]);
    expect(result).toEqual([{ json: { b: 1 } }]);
  });
  it('applies chained renames in order so each sees prior results', async () => {
    const result = await renameKeysHandler(
      node([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]),
      ctx(),
      [{ json: { a: 1, b: 2 } }],
    );
    expect(result).toEqual([{ json: { c: 1 } }]);
  });
});
