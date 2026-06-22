import { describe, it, expect } from 'vitest';
import { evaluateTrust } from './trust';

const fp = 'a'.repeat(64);

describe('evaluateTrust', () => {
  it('first-use when no pinned record', () => {
    expect(evaluateTrust('acme', fp, undefined)).toEqual({ decision: 'first-use' });
  });
  it('trusted when fingerprint matches the pinned one', () => {
    expect(evaluateTrust('acme', fp, { keyFingerprint: fp })).toEqual({ decision: 'trusted' });
  });
  it('key-mismatch when fingerprint differs', () => {
    expect(evaluateTrust('acme', fp, { keyFingerprint: 'b'.repeat(64) })).toEqual({ decision: 'key-mismatch', pinned: 'b'.repeat(64) });
  });
});
