import { type Logger, OpenLdrError, appError } from '@openldr/core';
import { validateResource, validateBatch, type StrictnessLevel } from '@openldr/fhir';
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

export interface PersistOpts {
  level: StrictnessLevel;
  resolveServiceRequest(id: string): Promise<boolean>;
}

// Projection is asynchronous (R2): persist writes the canonical resource + change_log (via
// fhirStore.save) and returns immediately; the projection worker tails change_log and updates the
// external read-model out of band. `flattened: 'deferred'` reflects that decoupling.
export async function persistResource(
  deps: PersistDeps,
  resource: unknown,
  provenance: Provenance = {},
  opts?: PersistOpts,
): Promise<PersistResult> {
  return (await persistResources(deps, [resource], provenance, opts))[0];
}

export async function persistResources(
  deps: PersistDeps,
  resources: unknown[],
  provenance: Provenance = {},
  opts?: PersistOpts,
): Promise<PersistResult[]> {
  if (opts) {
    const v = await validateBatch(resources, opts);
    if (!v.ok) throw appError('VA0002', { details: { outcome: v.outcome } });
    const results: PersistResult[] = [];
    for (const resource of v.resources) {
      await deps.fhirStore.save(resource, provenance);
      results.push({ saved: true, flattened: 'deferred' });
    }
    return results;
  }
  // Back-compat path (no opts): per-resource structural validation, as before.
  const results: PersistResult[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    await deps.fhirStore.save(validation.resource, provenance);
    results.push({ saved: true, flattened: 'deferred' });
  }
  return results;
}
