import { describe, it, expect } from 'vitest';
import { setPath } from './set-path';

describe('setPath', () => {
  it('sets a simple property', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'gender', 'female');
    expect(o).toEqual({ gender: 'female' });
  });
  it('creates nested objects and array indices', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'name.0.given.0', 'Jane');
    expect(o).toEqual({ name: [{ given: ['Jane'] }] });
  });
});
