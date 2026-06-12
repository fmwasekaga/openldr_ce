import { describe, it, expect, vi } from 'vitest';
import { persistResource } from './persist';
import type { FhirStore } from './fhir-store';
import type { FlatWriter, WriteResult } from './flat-writer';

const logger = { error: vi.fn(), info: vi.fn() } as never;

function fakeStore(): FhirStore {
  return {
    save: vi.fn(async (r) => ({ resourceType: (r as { resourceType: string }).resourceType, id: (r as { id?: string }).id ?? 'gen-id' })),
    get: vi.fn(),
  } as unknown as FhirStore;
}

const validPatient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

describe('persistResource', () => {
  it('saves internally then writes externally → written', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async (): Promise<WriteResult> => 'written') };
    const out = await persistResource({ fhirStore, flatWriter, logger }, validPatient);
    expect(out).toEqual({ saved: true, flattened: 'written' });
    expect(fhirStore.save).toHaveBeenCalledOnce();
  });

  it('degrades (no throw) when the external write fails — DP-7', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async () => { throw new Error('ECONNREFUSED at db:5432'); }) };
    const out = await persistResource({ fhirStore, flatWriter, logger }, validPatient);
    expect(out.saved).toBe(true);
    expect(out.flattened).toBe('degraded');
    expect(out.externalError).toContain('ECONNREFUSED');
    expect(fhirStore.save).toHaveBeenCalledOnce();
  });

  it('passes through a skipped (non-domain) flatten result', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async (): Promise<WriteResult> => 'skipped') };
    const out = await persistResource({ fhirStore, flatWriter, logger }, { resourceType: 'Bundle', type: 'collection' });
    expect(out.flattened).toBe('skipped');
  });

  it('throws on invalid FHIR before saving', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn() };
    await expect(persistResource({ fhirStore, flatWriter, logger }, { resourceType: 'Observation', code: { text: 'x' } })).rejects.toThrow();
    expect(fhirStore.save).not.toHaveBeenCalled();
  });
});
