import { describe, it, expect, vi } from 'vitest';
import { createPersistStoreService } from './persist-store-service';
import type { PersistResult } from '@openldr/db';

describe('createPersistStoreService', () => {
  it('persists resources and publishes data.persisted with counts and types', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => [
      { saved: true, flattened: 'written' },
      { saved: true, flattened: 'skipped' },
    ]);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish });

    const out = await svc({
      items: [{ json: { resourceType: 'Observation' } }, { json: { resourceType: 'Bundle' } }],
      source: 'amr',
    });

    expect(persist).toHaveBeenCalledWith(
      [{ resourceType: 'Observation' }, { resourceType: 'Bundle' }],
      { sourceSystem: 'amr' },
    );
    expect(out.meta.persisted).toBe(2);
    expect(out.meta.flattened).toEqual({ written: 1, skipped: 1, degraded: 0 });
    expect(out.meta.resourceTypes.sort()).toEqual(['Bundle', 'Observation']);
    expect(publish).toHaveBeenCalledWith({
      type: 'data.persisted',
      payload: { source: 'amr', resourceTypes: ['Observation', 'Bundle'], count: 2 },
    });
    expect(out.items).toHaveLength(2);
  });

  it('does not publish when nothing was persisted', async () => {
    const persist = vi.fn(async (): Promise<PersistResult[]> => []);
    const publish = vi.fn(async () => {});
    const svc = createPersistStoreService({ persist, publish });
    await svc({ items: [], source: undefined });
    expect(publish).not.toHaveBeenCalled();
  });
});
