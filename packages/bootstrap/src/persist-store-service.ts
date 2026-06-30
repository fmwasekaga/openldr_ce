import type { Provenance, PersistResult } from '@openldr/db';
import type { RunPersistStoreInput, RunPersistStoreOutput } from '@openldr/workflows';

export interface PersistStoreServiceDeps {
  persist(resources: unknown[], provenance: Provenance): Promise<PersistResult[]>;
  publish(event: { type: string; payload: unknown }): Promise<void>;
}

/**
 * Persist FHIR resource items (each item's `json` is one resource) via the shared
 * persist path, then announce success as a `data.persisted` event so downstream
 * (event-triggered) workflows can react. Items pass through unchanged.
 */
export function createPersistStoreService(
  deps: PersistStoreServiceDeps,
): (input: RunPersistStoreInput) => Promise<RunPersistStoreOutput> {
  return async ({ items, source }) => {
    const resources = items.map((i) => i.json);
    const provenance: Provenance = source ? { sourceSystem: source } : {};
    const results = await deps.persist(resources, provenance);

    const flattened = { written: 0, skipped: 0, degraded: 0 };
    for (const r of results) flattened[r.flattened] += 1;

    const resourceTypes = Array.from(
      new Set(
        resources
          .map((r) => (r as { resourceType?: string }).resourceType)
          .filter((t): t is string => Boolean(t)),
      ),
    );
    const persisted = results.filter((r) => r.saved).length;

    if (persisted > 0) {
      await deps.publish({ type: 'data.persisted', payload: { source: source ?? null, resourceTypes: [...resourceTypes], count: persisted } });
    }

    return { items, meta: { persisted, flattened, resourceTypes } };
  };
}
