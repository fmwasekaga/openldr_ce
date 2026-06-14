import { type Logger, errorMessage, redact, OpenLdrError } from '@openldr/core';
import { validateResource } from '@openldr/fhir';
import type { FhirStore } from './fhir-store';
import type { FlatWriter, FlatWriteItem } from './flat-writer';
import type { Provenance } from './provenance';

export interface PersistResult {
  saved: boolean;
  flattened: 'written' | 'skipped' | 'degraded';
  externalError?: string;
}

export interface PersistDeps {
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  logger: Logger;
}

export async function persistResource(
  deps: PersistDeps,
  resource: unknown,
  provenance: Provenance = {},
): Promise<PersistResult> {
  const validation = validateResource(resource);
  if (!validation.ok) {
    throw new OpenLdrError('cannot persist invalid FHIR resource');
  }
  const valid = validation.resource;

  // Note: a valid non-domain resource (e.g. Bundle) is still saved canonically here;
  // the flat writer below returns 'skipped' for it (no analytics projection).
  const ref = await deps.fhirStore.save(valid, provenance);
  const withId = { ...valid, id: ref.id };

  try {
    const flattened = await deps.flatWriter.write(withId, provenance);
    return { saved: true, flattened };
  } catch (err) {
    const externalError = redact(errorMessage(err));
    deps.logger.error({ externalError, resourceType: valid.resourceType, id: ref.id }, 'flatten write degraded');
    return { saved: true, flattened: 'degraded', externalError };
  }
}

/**
 * Batched persist: save each resource canonically (must-succeed, DP-7), then flat-write the
 * whole batch with a single writeMany (the throughput win). A batch-level external failure
 * degrades every resource's flat result without throwing — the canonical saves still stand.
 */
export async function persistResources(
  deps: PersistDeps,
  resources: unknown[],
  provenance: Provenance = {},
): Promise<PersistResult[]> {
  const withIds: unknown[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    const valid = validation.resource;
    const ref = await deps.fhirStore.save(valid, provenance);
    withIds.push({ ...valid, id: ref.id });
  }
  const items: FlatWriteItem[] = withIds.map((withId) => ({ resource: withId, provenance }));
  try {
    const flat = await deps.flatWriter.writeMany(items);
    return withIds.map((_, i) => ({ saved: true, flattened: flat[i] }));
  } catch (err) {
    const externalError = redact(errorMessage(err));
    deps.logger.error({ externalError, count: items.length }, 'batched flatten write degraded');
    return withIds.map(() => ({ saved: true, flattened: 'degraded', externalError }));
  }
}
