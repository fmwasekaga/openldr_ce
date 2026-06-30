import { describe, it, expect } from 'vitest';
import { createContext } from './execution-context';

describe('createContext callStack', () => {
  it('defaults callStack to an empty array', () => {
    const ctx = createContext(undefined, () => {});
    expect(ctx.callStack).toEqual([]);
  });

  it('stores a provided callStack', () => {
    const ctx = createContext(
      undefined, () => {}, [], undefined, undefined, undefined, undefined, undefined, ['wf-a', 'wf-b'],
    );
    expect(ctx.callStack).toEqual(['wf-a', 'wf-b']);
  });
});
