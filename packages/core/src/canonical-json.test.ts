import { describe, it, expect } from 'vitest';
import { canonicalJson, canonicalHash } from './canonical-json';

describe('canonicalJson', () => {
  it('is insensitive to object key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('sorts keys recursively but preserves array order', () => {
    expect(canonicalJson({ x: [{ b: 1, a: 2 }] })).toBe(canonicalJson({ x: [{ a: 2, b: 1 }] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('canonicalHash is a stable hex digest of the canonical form', () => {
    const h1 = canonicalHash({ a: 1, b: 2 });
    const h2 = canonicalHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});
