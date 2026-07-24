import { describe, it, expect } from 'vitest';
import { bundleToResources, unwrapBundleHandler } from './unwrap-bundle';

const sr = { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' };
const obs = (ref: string) => ({ resourceType: 'Observation', id: 'obs1', status: 'final', basedOn: [{ reference: ref }] });

describe('bundleToResources', () => {
  it('transaction Bundle with real ids + relative refs → resources unchanged', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'ServiceRequest/obr1', resource: sr, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'Observation/obs1', resource: obs('ServiceRequest/obr1'), request: { method: 'PUT', url: 'Observation/obs1' } },
    ] };
    const out = bundleToResources(bundle);
    expect(out.map((r) => r.resourceType)).toEqual(['ServiceRequest', 'Observation']);
    expect((out[1] as any).basedOn[0].reference).toBe('ServiceRequest/obr1');
  });

  it('urn:uuid Bundle → intra-bundle references rewritten to Type/id', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:sr', resource: sr, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'urn:uuid:o', resource: obs('urn:uuid:sr'), request: { method: 'PUT', url: 'Observation/obs1' } },
    ] };
    const out = bundleToResources(bundle);
    expect((out[1] as any).basedOn[0].reference).toBe('ServiceRequest/obr1');
  });

  it('mints an id for a urn:uuid create entry with no resource.id', () => {
    const noId = { resourceType: 'Patient' };
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:p', resource: noId, request: { method: 'POST', url: 'Patient' } },
    ] };
    const out = bundleToResources(bundle);
    expect(typeof (out[0] as any).id).toBe('string');
    expect((out[0] as any).id.length).toBeGreaterThan(0);
  });

  it('bare array → passthrough', () => {
    expect(bundleToResources([sr, obs('ServiceRequest/obr1')])).toEqual([sr, obs('ServiceRequest/obr1')]);
  });

  it('rejects a non-Bundle non-array payload', () => {
    expect(() => bundleToResources({ resourceType: 'Patient' })).toThrow(/Bundle or an array/);
  });

  it('rejects an unsupported Bundle.type', () => {
    expect(() => bundleToResources({ resourceType: 'Bundle', type: 'document', entry: [] })).toThrow(/type/);
  });

  it('rejects a DELETE entry', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { resource: sr, request: { method: 'DELETE', url: 'ServiceRequest/obr1' } },
    ] };
    expect(() => bundleToResources(bundle)).toThrow(/DELETE|method/);
  });

  it('accepts Bundle.type "batch"', () => {
    const bundle = { resourceType: 'Bundle', type: 'batch', entry: [
      { fullUrl: 'ServiceRequest/obr1', resource: { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' }, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
    ] };
    const out = bundleToResources(bundle);
    expect(out.map((r) => r.resourceType)).toEqual(['ServiceRequest']);
  });

  it('accepts Bundle.type "collection"', () => {
    const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
      { fullUrl: 'ServiceRequest/obr1', resource: { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' }, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
    ] };
    const out = bundleToResources(bundle);
    expect(out.map((r) => r.resourceType)).toEqual(['ServiceRequest']);
  });

  it('rejects a lowercase "delete" entry (case-insensitive method check)', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { resource: { resourceType: 'ServiceRequest', id: 'obr1' }, request: { method: 'delete', url: 'ServiceRequest/obr1' } },
    ] };
    expect(() => bundleToResources(bundle)).toThrow(/DELETE|method/);
  });

  it('rewrites a deeply-nested reference (extension.valueReference)', () => {
    const nested = {
      resourceType: 'Observation',
      id: 'obs-nested',
      status: 'final',
      extension: [{ url: 'http://example.org/ext', valueReference: { reference: 'urn:uuid:sr' } }],
    };
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:sr', resource: { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' }, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'urn:uuid:o', resource: nested, request: { method: 'PUT', url: 'Observation/obs-nested' } },
    ] };
    const out = bundleToResources(bundle);
    const observation = out.find((r) => r.resourceType === 'Observation') as any;
    expect(observation.extension[0].valueReference.reference).toBe('ServiceRequest/obr1');
  });

  it('rewrites both a top-level subject.reference and a further nested reference on the same resource', () => {
    const both = {
      resourceType: 'Observation',
      id: 'obs-both',
      status: 'final',
      subject: { reference: 'urn:uuid:sr' },
      identifier: { assigner: { reference: 'urn:uuid:sr' } },
    };
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:sr', resource: { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' }, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'urn:uuid:o', resource: both, request: { method: 'PUT', url: 'Observation/obs-both' } },
    ] };
    const out = bundleToResources(bundle);
    const observation = out.find((r) => r.resourceType === 'Observation') as any;
    expect(observation.subject.reference).toBe('ServiceRequest/obr1');
    expect(observation.identifier.assigner.reference).toBe('ServiceRequest/obr1');
  });

  it('rewrites a reference inside a contained resource', () => {
    const withContained = {
      resourceType: 'Observation',
      id: 'obs-contained',
      status: 'final',
      contained: [
        { resourceType: 'Provenance', id: 'prov1', target: [{ reference: 'urn:uuid:sr' }] },
      ],
    };
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:sr', resource: { resourceType: 'ServiceRequest', id: 'obr1', status: 'active', intent: 'order' }, request: { method: 'PUT', url: 'ServiceRequest/obr1' } },
      { fullUrl: 'urn:uuid:o', resource: withContained, request: { method: 'PUT', url: 'Observation/obs-contained' } },
    ] };
    const out = bundleToResources(bundle);
    const observation = out.find((r) => r.resourceType === 'Observation') as any;
    expect(observation.contained[0].target[0].reference).toBe('ServiceRequest/obr1');
  });

  it('throws a clean error when Bundle.entry is present but not an array', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: { resource: sr } };
    expect(() => bundleToResources(bundle)).toThrow(/entry must be an array/);
  });

  it('throws a clean error when an entry resource has no resourceType', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:x', resource: { id: 'x' }, request: { method: 'PUT', url: 'x' } },
    ] };
    expect(() => bundleToResources(bundle)).toThrow(/resourceType/);
  });

  it('throws a clean error when an entry resource has an empty-string resourceType', () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [
      { fullUrl: 'urn:uuid:x', resource: { resourceType: '', id: 'x' }, request: { method: 'PUT', url: 'x' } },
    ] };
    expect(() => bundleToResources(bundle)).toThrow(/resourceType/);
  });
});

describe('unwrapBundleHandler', () => {
  it('reads config.sourcePath (default body) and emits one item per resource', async () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ fullUrl: 'ServiceRequest/obr1', resource: sr }] };
    const node = { id: 'n1', type: 'action', data: { action: 'unwrap-bundle', config: { sourcePath: 'body' } } } as any;
    const out = await unwrapBundleHandler(node, {} as any, [{ json: { body: bundle } }] as any);
    expect(out.map((i) => (i.json as any).resourceType)).toEqual(['ServiceRequest']);
  });
});
