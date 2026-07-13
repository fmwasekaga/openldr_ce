import { describe, it, expect, vi } from 'vitest';
import { persistResource, persistResources } from './persist';
import type { FhirStore } from './fhir-store';
import type { FlatWriter, WriteResult } from './flat-writer';
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
  it('saves internally then writes externally → written', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async (): Promise<WriteResult> => 'written'), writeMany: vi.fn(async () => []), deleteById: vi.fn(async () => undefined) };
    const out = await persistResource({ fhirStore, flatWriter, logger }, validPatient);
    expect(out).toEqual({ saved: true, flattened: 'written' });
    expect(fhirStore.save).toHaveBeenCalledOnce();
  });

  it('degrades (no throw) when the external write fails — DP-7', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async () => { throw new Error('ECONNREFUSED at db:5432'); }), writeMany: vi.fn(async () => []), deleteById: vi.fn(async () => undefined) };
    const out = await persistResource({ fhirStore, flatWriter, logger }, validPatient);
    expect(out.saved).toBe(true);
    expect(out.flattened).toBe('degraded');
    expect(out.externalError).toContain('ECONNREFUSED');
    expect(fhirStore.save).toHaveBeenCalledOnce();
  });

  it('passes through a skipped (non-domain) flatten result', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async (): Promise<WriteResult> => 'skipped'), writeMany: vi.fn(async () => []), deleteById: vi.fn(async () => undefined) };
    const out = await persistResource({ fhirStore, flatWriter, logger }, { resourceType: 'Bundle', type: 'collection' });
    expect(out.flattened).toBe('skipped');
  });

  it('throws on invalid FHIR before saving', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(), writeMany: vi.fn(async () => []), deleteById: vi.fn(async () => undefined) };
    await expect(persistResource({ fhirStore, flatWriter, logger }, { resourceType: 'Observation', code: { text: 'x' } })).rejects.toThrow();
    expect(fhirStore.save).not.toHaveBeenCalled();
  });
});

describe('persistResources (batched)', () => {
  it('saves each canonically then flat-writes the batch in one writeMany', async () => {
    const saved: unknown[] = [];
    const save = vi.fn(async (r: any) => { saved.push(r); return { id: r.id ?? 'gen' }; });
    const fhirStore = { save } as never;
    const writeMany = vi.fn(async (items: unknown[]) => items.map(() => 'written'));
    const flatWriter = { write: vi.fn(), writeMany } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const b = { resourceType: 'Patient', id: 'p2', gender: 'female' };
    const res = await persistResources({ fhirStore, flatWriter, logger }, [a, b], {});
    expect(save).toHaveBeenCalledTimes(2);
    expect(writeMany).toHaveBeenCalledTimes(1);
    expect(res.every((r) => r.saved && r.flattened === 'written')).toBe(true);
  });

  it('degrades (no throw) when the batch flat-write fails, and redacts the error', async () => {
    const fhirStore = { save: vi.fn(async (r: any) => ({ id: r.id })) } as never;
    const flatWriter = { write: vi.fn(), writeMany: vi.fn(async () => { throw new Error('boom postgres://u:p@h/db'); }) } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const res = await persistResources({ fhirStore, flatWriter, logger }, [a], {});
    expect(res[0].saved).toBe(true);
    expect(res[0].flattened).toBe('degraded');
    expect(res[0].externalError).not.toContain('p@h'); // redacted
  });

  it('throws on the first invalid resource (must-succeed validation)', async () => {
    const fhirStore = { save: vi.fn(async (r: any) => ({ id: r.id })) } as never;
    const flatWriter = { write: vi.fn(), writeMany: vi.fn(async () => []) } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    await expect(persistResources({ fhirStore, flatWriter, logger }, [{ nonsense: true }], {})).rejects.toBeTruthy();
  });
});
