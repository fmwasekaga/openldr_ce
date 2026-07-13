import { describe, it, expect, vi } from 'vitest';
import { createPersistStoreService } from './persist-store-service';
import type { PersistResult } from '@openldr/db';

describe('createPersistStoreService', () => {
  it('stamps a batchId into provenance, the event, and meta; reports counts and types', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => [
      { saved: true, flattened: 'written' },
      { saved: true, flattened: 'skipped' },
    ]);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish, newId: () => 'batch-1' });

    const out = await svc({
      items: [{ json: { resourceType: 'Observation' } }, { json: { resourceType: 'Bundle' } }],
      source: 'amr',
    });

    expect(persist).toHaveBeenCalledWith(
      [{ resourceType: 'Observation' }, { resourceType: 'Bundle' }],
      { batchId: 'batch-1', sourceSystem: 'amr' },
    );
    expect(out.meta.persisted).toBe(2);
    expect(out.meta.batchId).toBe('batch-1');
    expect(out.meta.flattened).toEqual({ written: 1, skipped: 1, degraded: 0, deferred: 0 });
    expect(out.meta.resourceTypes.sort()).toEqual(['Bundle', 'Observation']);
    expect(publish).toHaveBeenCalledWith({
      type: 'data.persisted',
      payload: { source: 'amr', batchId: 'batch-1', resourceTypes: ['Observation', 'Bundle'], count: 2 },
    });
    expect(out.items).toHaveLength(2);
  });

  it('stamps batchId even when no source is given', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => [{ saved: true, flattened: 'written' }]);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish, newId: () => 'batch-2' });
    await svc({ items: [{ json: { resourceType: 'Patient' } }], source: undefined });
    expect(persist).toHaveBeenCalledWith([{ resourceType: 'Patient' }], { batchId: 'batch-2' });
    expect(publish).toHaveBeenCalledWith({
      type: 'data.persisted',
      payload: { source: null, batchId: 'batch-2', resourceTypes: ['Patient'], count: 1 },
    });
  });

  it('does not publish when nothing was persisted', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => []);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish, newId: () => 'batch-3' });
    await svc({ items: [], source: undefined });
    expect(publish).not.toHaveBeenCalled();
  });
});
