import type { Provenance, PersistResult } from '@openldr/db';
import type { RunPersistStoreInput, RunPersistStoreOutput } from '@openldr/workflows';

export interface PersistStoreServiceDeps {
  persist(resources: unknown[], provenance: Provenance): Promise<PersistResult[]>;
  publish(event: { type: string; payload: unknown }): Promise<void>;
  /** Generate a fresh per-run correlation id, stamped on every persisted row + the event. */
  newId(): string;
}

/**
 * Persist FHIR resource items (each item's `json` is one resource) via the shared
 * persist path, then announce success as a `data.persisted` event so downstream
 * (event-triggered) workflows can react. A per-run `batchId` is stamped into the
 * provenance of every row (fhir_resources + flat tables get `batch_id`) and carried
 * in the event payload, so an outbound workflow can query exactly this run's rows.
 * Items pass through unchanged.
 */
export function createPersistStoreService(
  deps: PersistStoreServiceDeps,
): (input: RunPersistStoreInput) => Promise<RunPersistStoreOutput> {
  return async ({ items, source }) => {
    const resources = items.map((i) => i.json);
    const batchId = deps.newId();
    const provenance: Provenance = source ? { batchId, sourceSystem: source } : { batchId };
    const results = await deps.persist(resources, provenance);

    const flattened = { written: 0, skipped: 0, degraded: 0, deferred: 0 };
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
      await deps.publish({
        type: 'data.persisted',
        payload: { source: source ?? null, batchId, resourceTypes: [...resourceTypes], count: persisted },
      });
    }

    return { items, meta: { persisted, batchId, flattened, resourceTypes } };
  };
}
