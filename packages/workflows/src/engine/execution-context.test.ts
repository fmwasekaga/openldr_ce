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

describe('createContext loop fields', () => {
  it('defaults loopVars to [] and loopMaxItems to 100000', () => {
    const ctx = createContext(undefined, () => {});
    expect(ctx.loopVars).toEqual([]);
    expect(ctx.loopMaxItems).toBe(100_000);
  });
});
