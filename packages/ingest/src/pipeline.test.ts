import { describe, it, expect, vi } from 'vitest';
import { acceptPayload } from './accept';
import { handleIngestEvent } from './handle';
import { defaultConverters } from './default-converters';
import { registryResolver } from './resolver';
import { ConverterRegistry } from './converter';
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
  function deps(persist = vi.fn(async (rs: unknown[]) => rs.map(() => ({ saved: true, flattened: 'written' as const })))) {
    return {
      blob: { get: vi.fn(async () => enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] })) } as never,
      persist,
      resolver: registryResolver(defaultConverters()),
      batches: { markProcessing: vi.fn(async () => {}), markDone: vi.fn(async () => {}), markFailed: vi.fn(async () => {}) } as unknown as BatchStore,
      logger,
      audit: vi.fn(async () => {}),
    };
  }

  it('converts, persists the resources with provenance, marks done', async () => {
    const persist = vi.fn(async (rs: unknown[]) => rs.map(() => ({ saved: true, flattened: 'written' as const })));
    const d = deps(persist);
    await handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'fhir-bundle' } });
    expect(persist).toHaveBeenCalledWith(
      [expect.objectContaining({ resourceType: 'Patient' })],
      expect.objectContaining({ batchId: 'b1', sourceSystem: 'test', pluginId: 'fhir-bundle' }),
    );
    expect(d.batches.markDone).toHaveBeenCalledWith('b1', 1);
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingest.batch.done', entityId: 'b1' }));
  });

  it('persists all converted resources in a single batched call', async () => {
    const persist = vi.fn(async (rs: unknown[]) => rs.map(() => ({ saved: true, flattened: 'written' as const })));
    const d = deps(persist);
    d.blob = {
      get: vi.fn(async () =>
        enc({
          resourceType: 'Bundle',
          type: 'collection',
          entry: [
            { resource: { resourceType: 'Patient', id: 'p1' } },
            { resource: { resourceType: 'Patient', id: 'p2' } },
          ],
        }),
      ),
    } as never;
    await handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'fhir-bundle' } });
    expect(persist).toHaveBeenCalledTimes(1);
    expect((persist.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it('marks failed and rethrows on an unknown converter', async () => {
    const d = deps();
    await expect(handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'nope' } })).rejects.toThrow();
    expect(d.batches.markFailed).toHaveBeenCalled();
  });

  it('onBatchDone carries the blob ref for downstream binary consumers', async () => {
    const onBatchDone = vi.fn(async () => {});
    // Use a valid FHIR bundle payload so the converter succeeds; assert byteSize matches the raw bytes returned.
    const blobPayload = enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] });
    const d = {
      ...deps(),
      blob: {
        get: vi.fn(async () => blobPayload),
      } as never,
      onBatchDone,
    };
    await handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'uploads/b1', source: 'WHONET', converter: 'fhir-bundle' } });
    expect(onBatchDone).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'b1', blobKey: 'uploads/b1', byteSize: blobPayload.byteLength }));
  });
});

describe('config threading', () => {
  it('threads config from acceptPayload through to the converter ctx', async () => {
    let seenConfig: Record<string, string> | undefined;

    const registry = new ConverterRegistry();
    registry.register({
      id: 'rec',
      version: '1',
      async convert(_raw: Uint8Array, ctx: { config?: Record<string, string> }) {
        seenConfig = ctx.config;
        return [];
      },
    });
    const resolver = registryResolver(registry);

    const events: Array<{ type: string; payload: unknown }> = [];
    const blob = {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => new Uint8Array()),
      exists: vi.fn(),
      presign: vi.fn(),
      healthCheck: vi.fn(),
    };
    const eventing = {
      publish: vi.fn(async (e: { type: string; payload: unknown }) => { events.push(e); }),
      subscribe: vi.fn(),
      healthCheck: vi.fn(),
    };
    const batches = {
      create: vi.fn(async () => {}),
      markProcessing: vi.fn(async () => {}),
      markDone: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
    } as unknown as BatchStore;

    const data = new TextEncoder().encode('{}');
    await acceptPayload(
      { blob: blob as never, eventing: eventing as never, batches, logger },
      { data, source: 's', converter: 'rec', config: { mapping: '{"k":"v"}' } },
    );

    // drain: handle all published ingest.received events
    for (const e of events) {
      if (e.type === 'ingest.received') {
        await handleIngestEvent(
          { blob: blob as never, persist: vi.fn(async (rs: unknown[]) => rs.map(() => ({ saved: true, flattened: 'written' as const }))), resolver, batches, logger },
          e as never,
        );
      }
    }

    expect(seenConfig).toEqual({ mapping: '{"k":"v"}' });
  });
});
