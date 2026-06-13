import { describe, it, expect } from 'vitest';
import { parseManifest } from './manifest';

const valid = { id: 'whonet-sqlite', version: '0.1.0', wasmSha256: 'a'.repeat(64) };

describe('parseManifest', () => {
  it('fills defaults', () => {
    const m = parseManifest(valid);
    expect(m.entrypoint).toBe('convert');
    expect(m.wasi).toBe(false);
    expect(m.limits.memoryMb).toBe(256);
    expect(m.limits.timeoutMs).toBe(30_000);
  });
  it('rejects a bad sha256', () => {
    expect(() => parseManifest({ ...valid, wasmSha256: 'nope' })).toThrow();
  });
  it('rejects a missing id', () => {
    expect(() => parseManifest({ version: '1', wasmSha256: 'a'.repeat(64) })).toThrow();
  });
});
