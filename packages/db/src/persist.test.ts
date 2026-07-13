import { describe, it, expect, vi } from 'vitest';
import { persistResource, persistResources } from './persist';
import type { FhirStore } from './fhir-store';
import type { Logger } from '@openldr/core';

const logger = { error: vi.fn(), info: vi.fn() } as unknown as Logger;

function fakeStore(): FhirStore {
  return {
    save: vi.fn(async (r) => ({ resourceType: (r as { resourceType: string }).resourceType, id: (r as { id?: string }).id ?? 'gen-id' })),
    get: vi.fn(),
  } as unknown as FhirStore;
}

const validPatient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

describe('persistResource', () => {
  it('saves internally → projection deferred to the async worker', async () => {
    const fhirStore = fakeStore();
    const out = await persistResource({ fhirStore, logger }, validPatient);
    expect(out).toEqual({ saved: true, flattened: 'deferred' });
    expect(fhirStore.save).toHaveBeenCalledOnce();
  });

  it('defers projection for a non-domain resource too', async () => {
    const fhirStore = fakeStore();
    const out = await persistResource({ fhirStore, logger }, { resourceType: 'Bundle', type: 'collection' });
    expect(out.flattened).toBe('deferred');
  });

  it('throws on invalid FHIR before saving', async () => {
    const fhirStore = fakeStore();
    await expect(persistResource({ fhirStore, logger }, { resourceType: 'Observation', code: { text: 'x' } })).rejects.toThrow();
    expect(fhirStore.save).not.toHaveBeenCalled();
  });
});

describe('persistResources (batched)', () => {
  it('saves each canonically → projection deferred to the async worker', async () => {
    const saved: unknown[] = [];
    const save = vi.fn(async (r: any) => { saved.push(r); return { id: r.id ?? 'gen' }; });
    const fhirStore = { save } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const b = { resourceType: 'Patient', id: 'p2', gender: 'female' };
    const res = await persistResources({ fhirStore, logger }, [a, b], {});
    expect(save).toHaveBeenCalledTimes(2);
    expect(res.every((r) => r.saved && r.flattened === 'deferred')).toBe(true);
  });

  it('throws on the first invalid resource (must-succeed validation)', async () => {
    const fhirStore = { save: vi.fn(async (r: any) => ({ id: r.id })) } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    await expect(persistResources({ fhirStore, logger }, [{ nonsense: true }], {})).rejects.toBeTruthy();
  });
});
