import { describe, it, expect, vi } from 'vitest';
import { fhirHandler } from './fhir';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

describe('fhirHandler', () => {
  it('calls fhirQuery and wraps resources as items', async () => {
    const fhirQuery = vi.fn(async () => ({ resources: [{ id: 'p1', resourceType: 'Patient' }, { id: 'p2', resourceType: 'Patient' }] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { fhirQuery } as unknown as WorkflowServices);
    const out = await fhirHandler(
      { id: 'n1', type: 'action', data: { config: { resourceType: 'Patient', limit: 50 } } },
      ctx,
      [],
    );
    expect(fhirQuery).toHaveBeenCalledWith('Patient', 50);
    expect(out).toEqual([
      { json: { id: 'p1', resourceType: 'Patient' } },
      { json: { id: 'p2', resourceType: 'Patient' } },
    ]);
  });

  it('wraps non-object resources in { value }', async () => {
    const fhirQuery = vi.fn(async () => ({ resources: ['raw-string'] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { fhirQuery } as unknown as WorkflowServices);
    const out = await fhirHandler(
      { id: 'n1', type: 'action', data: { config: { resourceType: 'Observation' } } },
      ctx,
      [],
    );
    expect(out).toEqual([{ json: { value: 'raw-string' } }]);
  });

  it('defaults limit to 100 when not provided', async () => {
    const fhirQuery = vi.fn(async () => ({ resources: [] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { fhirQuery } as unknown as WorkflowServices);
    await fhirHandler(
      { id: 'n1', type: 'action', data: { config: { resourceType: 'Observation' } } },
      ctx,
      [],
    );
    expect(fhirQuery).toHaveBeenCalledWith('Observation', 100);
  });

  it('throws when resourceType is missing', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, {
      fhirQuery: vi.fn(),
    } as unknown as WorkflowServices);
    await expect(
      fhirHandler({ id: 'n1', type: 'action', data: { config: {} } }, ctx, []),
    ).rejects.toThrow(/resourceType is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      fhirHandler({ id: 'n1', type: 'action', data: { config: { resourceType: 'Patient' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
