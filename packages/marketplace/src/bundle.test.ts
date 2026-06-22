import { describe, it, expect } from 'vitest';
import { canonicalJSON, canonicalSigningBytes } from './bundle';

describe('canonicalJSON', () => {
  it('is key-order stable', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
    expect(canonicalJSON({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
  it('handles nested objects/arrays and skips undefined', () => {
    expect(canonicalJSON({ x: [3, { z: 1, y: 2 }], u: undefined })).toBe('{"x":[3,{"y":2,"z":1}]}');
  });
});

describe('canonicalSigningBytes', () => {
  const manifest = { type: 'plugin', id: 'demo', signature: 'deadbeef' };
  it('excludes the signature field and binds the payload hash', () => {
    const a = canonicalSigningBytes(manifest, 'a'.repeat(64));
    const b = canonicalSigningBytes({ ...manifest, signature: 'OTHER' }, 'a'.repeat(64));
    expect(Buffer.from(a).toString('utf8')).not.toContain('signature');
    expect(Buffer.from(a)).toEqual(Buffer.from(b)); // signature ignored
  });
  it('changes when manifest or payload hash changes', () => {
    const base = canonicalSigningBytes(manifest, 'a'.repeat(64));
    expect(Buffer.from(canonicalSigningBytes({ ...manifest, id: 'other' }, 'a'.repeat(64)))).not.toEqual(Buffer.from(base));
    expect(Buffer.from(canonicalSigningBytes(manifest, 'b'.repeat(64)))).not.toEqual(Buffer.from(base));
  });
});
