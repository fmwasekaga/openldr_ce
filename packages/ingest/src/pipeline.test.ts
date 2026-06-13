import { describe, it, expect, vi } from 'vitest';
import { acceptPayload } from './accept';
import { handleIngestEvent } from './handle';
import { defaultConverters } from './default-converters';
import { registryResolver } from './resolver';
import type { BatchStore } from './batch-store';

const logger = { info: vi.fn(), error: vi.fn() } as never;
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe('acceptPayload', () => {
  it('stores the blob, records the batch, and publishes', async () => {
    const blob = { put: vi.fn(async () => {}), get: vi.fn(), exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn() };
    const eventing = { publish: vi.fn(async () => {}), subscribe: vi.fn(), healthCheck: vi.fn() };
    const batches = { create: vi.fn(async () => {}) } as never;
    const out = await acceptPayload({ blob: blob as never, eventing: eventing as never, batches, logger }, { data: enc({ resourceType: 'Patient' }), source: 'test', converter: 'fhir-bundle' });
    expect(out.batchId).toBeTruthy();
    expect(blob.put).toHaveBeenCalledOnce();
    expect(eventing.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingest.received', payload: expect.objectContaining({ batchId: out.batchId, converter: 'fhir-bundle' }) }));
  });
});

describe('handleIngestEvent', () => {
  function deps(persist = vi.fn(async () => ({ saved: true, flattened: 'written' as const }))) {
    return {
      blob: { get: vi.fn(async () => enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] })) } as never,
      persist,
      resolver: registryResolver(defaultConverters()),
      batches: { markProcessing: vi.fn(async () => {}), markDone: vi.fn(async () => {}), markFailed: vi.fn(async () => {}) } as unknown as BatchStore,
      logger,
      audit: vi.fn(async () => {}),
    };
  }

  it('converts, persists each resource with provenance, marks done', async () => {
    const persist = vi.fn(async () => ({ saved: true, flattened: 'written' as const }));
    const d = deps(persist);
    await handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'fhir-bundle' } });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Patient' }), expect.objectContaining({ batchId: 'b1', sourceSystem: 'test', pluginId: 'fhir-bundle' }));
    expect(d.batches.markDone).toHaveBeenCalledWith('b1', 1);
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingest.batch.done', entityId: 'b1' }));
  });

  it('marks failed and rethrows on an unknown converter', async () => {
    const d = deps();
    await expect(handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'nope' } })).rejects.toThrow();
    expect(d.batches.markFailed).toHaveBeenCalled();
  });
});
