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
});

describe('unwrapBundleHandler', () => {
  it('reads config.sourcePath (default body) and emits one item per resource', async () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ fullUrl: 'ServiceRequest/obr1', resource: sr }] };
    const node = { id: 'n1', type: 'action', data: { action: 'unwrap-bundle', config: { sourcePath: 'body' } } } as any;
    const out = await unwrapBundleHandler(node, {} as any, [{ json: { body: bundle } }] as any);
    expect(out.map((i) => (i.json as any).resourceType)).toEqual(['ServiceRequest']);
  });
});
