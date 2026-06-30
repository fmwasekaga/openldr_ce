import { describe, it, expect } from 'vitest';
import { defaultHandler } from './default';
import { createContext } from '../execution-context';

describe('defaultHandler (no-op passthrough)', () => {
  it('returns the input items unchanged', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { a: 1 } }, { json: { b: 2 } }];
    const result = await defaultHandler({ id: 'n1', type: 'action', data: { action: 'no-op' } }, ctx, input);
    expect(result).toBe(input);
  });
});
