import { describe, it, expect } from 'vitest';
import { createValidationStrictness, VALIDATION_STRICTNESS_KEY } from './validation-settings';

function fakeStore() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k: string) => (data.has(k) ? { key: k, value: data.get(k)!, updatedBy: null, updatedAt: '' } : null),
    getAll: async () => [...data].map(([key, value]) => ({ key, value, updatedBy: null, updatedAt: '' })),
    set: async (k: string, v: string) => { data.set(k, v); },
  } as any;
}

describe('createValidationStrictness', () => {
  it('defaults to high', async () => {
    expect(await createValidationStrictness(fakeStore()).get()).toBe('high');
  });
  it('round-trips a valid level and rejects an invalid one', async () => {
    const store = fakeStore();
    const s = createValidationStrictness(store);
    await s.set('medium', 'admin');
    expect(store.data.get(VALIDATION_STRICTNESS_KEY)).toBe('medium');
    expect(await s.get()).toBe('medium');
    await expect(s.set('bogus' as any, 'admin')).rejects.toThrow();
  });
});
