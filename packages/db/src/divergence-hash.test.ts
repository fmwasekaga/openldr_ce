import { describe, it, expect } from 'vitest';
import { divergenceHash } from './divergence-hash';

describe('divergenceHash', () => {
  it('returns null for a tombstone (no content)', () => {
    expect(divergenceHash(null)).toBeNull();
  });

  it('ignores meta.versionId and meta.lastUpdated', () => {
    const a = { resourceType: 'Observation', id: 'o1', status: 'final', meta: { versionId: '2', lastUpdated: '2026-01-01T00:00:00Z' } };
    const b = { resourceType: 'Observation', id: 'o1', status: 'final', meta: { versionId: '9', lastUpdated: '2099-12-31T23:59:59Z' } };
    expect(divergenceHash(a)).toBe(divergenceHash(b));
  });

  it('preserves other meta fields (they ARE content)', () => {
    const a = { resourceType: 'Observation', id: 'o1', meta: { versionId: '2', source: 'lab-a' } };
    const b = { resourceType: 'Observation', id: 'o1', meta: { versionId: '2', source: 'lab-b' } };
    expect(divergenceHash(a)).not.toBe(divergenceHash(b));
  });

  it('is insensitive to key order', () => {
    const a = { resourceType: 'Observation', id: 'o1', status: 'final' };
    const b = { status: 'final', id: 'o1', resourceType: 'Observation' };
    expect(divergenceHash(a)).toBe(divergenceHash(b));
  });

  it('detects a real content difference', () => {
    const a = { resourceType: 'Observation', id: 'o1', status: 'preliminary' };
    const b = { resourceType: 'Observation', id: 'o1', status: 'final' };
    expect(divergenceHash(a)).not.toBe(divergenceHash(b));
  });

  it('drops meta entirely when it held only volatile fields', () => {
    const withMeta = { resourceType: 'Observation', id: 'o1', meta: { versionId: '2', lastUpdated: 'x' } };
    const without = { resourceType: 'Observation', id: 'o1' };
    expect(divergenceHash(withMeta)).toBe(divergenceHash(without));
  });

  it('parses a serialized body string', () => {
    const obj = { resourceType: 'Observation', id: 'o1', status: 'final' };
    expect(divergenceHash(JSON.stringify(obj))).toBe(divergenceHash(obj));
  });

  it('returns null for an unparseable body string rather than throwing', () => {
    expect(divergenceHash('{not json')).toBeNull();
  });
});
