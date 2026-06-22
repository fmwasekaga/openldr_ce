import { describe, it, expect } from 'vitest';
import { parseArtifactManifest, pluginManifestToArtifact } from './artifact-manifest';

const fp = 'a'.repeat(64);
const base = {
  schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme', keyFingerprint: fp },
  compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Observation'] }],
  payload: { kind: 'plugin', wasmSha256: 'b'.repeat(64) },
};

describe('artifact manifest', () => {
  it('parses a valid plugin artifact manifest with defaults', () => {
    const m = parseArtifactManifest(base);
    expect(m.id).toBe('demo');
    expect(m.source).toBe('local-file');
    expect(m.dependencies).toEqual([]);
    expect(m.payload.kind).toBe('plugin');
  });
  it('rejects a bad version', () => {
    expect(() => parseArtifactManifest({ ...base, version: 'not-semver' })).toThrow();
  });
  it('rejects a bad publisher fingerprint', () => {
    expect(() => parseArtifactManifest({ ...base, publisher: { ...base.publisher, keyFingerprint: 'xyz' } })).toThrow();
  });
  it('parses form-template and report-template payloads', () => {
    expect(parseArtifactManifest({ ...base, type: 'form-template', payload: { kind: 'form-template', questionnaireSha256: 'c'.repeat(64) } }).type).toBe('form-template');
    expect(parseArtifactManifest({ ...base, type: 'report-template', payload: { kind: 'report-template', templateSha256: 'd'.repeat(64) } }).type).toBe('report-template');
  });
  it('adapts a legacy plugin manifest (no publisher/signature)', () => {
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    const a = pluginManifestToArtifact(legacy);
    expect(a.type).toBe('plugin');
    expect(a.publisher).toBeUndefined();
    expect(a.signature).toBeUndefined();
    expect(a.payload).toMatchObject({ kind: 'plugin', wasmSha256: 'e'.repeat(64), entrypoint: 'convert' });
    expect(() => parseArtifactManifest(a)).not.toThrow();
  });
});
