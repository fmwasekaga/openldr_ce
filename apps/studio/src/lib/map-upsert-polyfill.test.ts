import { describe, it, expect, vi } from 'vitest';
import './map-upsert-polyfill';

describe('map-upsert-polyfill', () => {
  it('returns the existing value without inserting when the key is present (Map)', () => {
    const map = new Map<string, number>([['a', 1]]);
    expect(map.getOrInsert('a', 99)).toBe(1);
    expect(map.get('a')).toBe(1); // untouched
    expect(map.size).toBe(1);
  });

  it('inserts and returns the value when the key is absent (Map)', () => {
    const map = new Map<string, number>();
    expect(map.getOrInsert('b', 42)).toBe(42);
    expect(map.get('b')).toBe(42);
    expect(map.size).toBe(1);
  });

  it('does not invoke the callback for a present key (getOrInsertComputed, Map)', () => {
    const map = new Map<string, number>([['a', 1]]);
    const callback = vi.fn(() => 99);
    expect(map.getOrInsertComputed('a', callback)).toBe(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it('computes, inserts, and returns the value for an absent key (getOrInsertComputed, Map)', () => {
    const map = new Map<string, number>();
    const callback = vi.fn((key: string) => key.length);
    expect(map.getOrInsertComputed('hello', callback)).toBe(5);
    expect(callback).toHaveBeenCalledWith('hello');
    expect(map.get('hello')).toBe(5);
  });

  it('throws a TypeError when getOrInsertComputed is given a non-function callback', () => {
    const map = new Map<string, number>();
    // @ts-expect-error deliberately passing a bad callback to exercise the guard
    expect(() => map.getOrInsertComputed('x', 123)).toThrow(TypeError);
  });

  it('works against a WeakMap for both getOrInsert and getOrInsertComputed', () => {
    const weak = new WeakMap<object, number>();
    const key = {};
    const callback = vi.fn(() => 7);
    expect(weak.getOrInsertComputed(key, callback)).toBe(7);
    expect(callback).toHaveBeenCalledTimes(1);
    // Second call finds the key and skips the callback.
    expect(weak.getOrInsertComputed(key, callback)).toBe(7);
    expect(callback).toHaveBeenCalledTimes(1);

    const key2 = {};
    expect(weak.getOrInsert(key2, 11)).toBe(11);
    expect(weak.get(key2)).toBe(11);
    expect(weak.getOrInsert(key2, 22)).toBe(11); // existing wins
  });

  it('memoizes computed values so the callback runs at most once per key', () => {
    const map = new Map<string, unknown>();
    const factory = vi.fn(() => ({ built: true }));
    const first = map.getOrInsertComputed('k', factory);
    const second = map.getOrInsertComputed('k', factory);
    expect(first).toBe(second); // same object identity
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
