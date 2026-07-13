import { type Logger, OpenLdrError } from '@openldr/core';
import { validateResource } from '@openldr/fhir';
import type { FhirStore } from './fhir-store';
import type { Provenance } from './provenance';

export interface PersistResult {
  saved: boolean;
  flattened: 'written' | 'skipped' | 'degraded' | 'deferred';
  externalError?: string;
}

export interface PersistDeps {
  fhirStore: FhirStore;
  logger: Logger;
}

// Projection is asynchronous (R2): persist writes the canonical resource + change_log (via
// fhirStore.save) and returns immediately; the projection worker tails change_log and updates the
// external read-model out of band. `flattened: 'deferred'` reflects that decoupling.
export async function persistResource(
  deps: PersistDeps,
  resource: unknown,
  provenance: Provenance = {},
): Promise<PersistResult> {
  const validation = validateResource(resource);
  if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
  await deps.fhirStore.save(validation.resource, provenance);
  return { saved: true, flattened: 'deferred' };
}

export async function persistResources(
  deps: PersistDeps,
  resources: unknown[],
  provenance: Provenance = {},
): Promise<PersistResult[]> {
  const results: PersistResult[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    await deps.fhirStore.save(validation.resource, provenance);
    results.push({ saved: true, flattened: 'deferred' });
  }
  return results;
}
