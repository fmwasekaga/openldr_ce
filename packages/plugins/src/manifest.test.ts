import { describe, it, expect } from 'vitest';
import { parseManifest } from './manifest';

const valid = { id: 'whonet-sqlite', version: '0.1.0', wasmSha256: 'a'.repeat(64) };

const BASE = {
  id: 'demo',
  version: '1.0.0',
  wasmSha256: 'a'.repeat(64),
};

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
  it('defaults kind to source and entrypoints to []', () => {
    const m = parseManifest(valid);
    expect(m.kind).toBe('source');
    expect(m.entrypoints).toEqual([]);
  });
  it('parses a sink manifest with named entrypoints', () => {
    const m = parseManifest({ ...valid, kind: 'sink', entrypoints: ['health_check', 'push_aggregate'] });
    expect(m.kind).toBe('sink');
    expect(m.entrypoints).toEqual(['health_check', 'push_aggregate']);
  });
  it('rejects an unknown kind', () => {
    expect(() => parseManifest({ ...valid, kind: 'proxy' })).toThrow();
  });
});

describe('parseManifest workflowNodes', () => {
  it('leaves workflowNodes undefined when absent (byte-identical existing manifests)', () => {
    const m = parseManifest(BASE);
    expect(m.workflowNodes).toBeUndefined();
    expect('workflowNodes' in m).toBe(false);
  });

  it('parses a manifest declaring workflowNodes', () => {
    const m = parseManifest({
      ...BASE,
      kind: 'sink',
      entrypoints: ['wf_push_aggregate'],
      workflowNodes: [
        { id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
          ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'] },
      ],
    });
    expect(m.workflowNodes).toHaveLength(1);
    expect(m.workflowNodes![0].id).toBe('aggregate-push');
    expect(m.workflowNodes![0].config).toEqual([]); // field default applied
  });

  it('rejects an invalid workflowNodes entry', () => {
    expect(() => parseManifest({ ...BASE, workflowNodes: [{ id: 'x' }] })).toThrow();
  });
});
